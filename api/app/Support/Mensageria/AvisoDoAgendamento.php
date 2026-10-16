<?php

namespace App\Support\Mensageria;

use App\Models\Agendamento;
use App\Models\AvisoAFamilia;
use App\Models\Conversa;
use App\Models\Mensagem;
use App\Models\Paciente;
use App\Models\Profissional;
use App\Models\StatusAgendamento;
use App\Support\Clinica\ResumoDoPaciente;
use App\Support\Configuracoes\ConfiguracaoService;
use DateTimeInterface;
use Illuminate\Database\QueryException;
use Illuminate\Validation\ValidationException;
use RuntimeException;
use Throwable;

/**
 * Os avisos do agendamento à família (change `avisos-do-agendamento-por-whatsapp`): a confirmação
 * do primeiro agendamento, a mudança de horário e o cancelamento — os dois últimos só quando quem
 * gravou pediu (`avisar_familia`).
 *
 * Quem chama é o CONTROLLER, depois do commit — nunca o serviço nem um observer: o serviço também
 * serve ao desmarque em lote (que tem aviso próprio e dobraria) e o encadeamento grava por `save()`.
 * Só o controller sabe que a mudança foi um gesto individual (design D1).
 *
 * Nada aqui lança: aviso que não sai é resultado, não erro (SEC-AV-04/11). A gravação do
 * agendamento já aconteceu e não pode ser desfeita — nem virar 500 e levar a recepção a gravar de
 * novo.
 *
 * Os freios: a confirmação sai UMA vez por criança (marca `avisos_a_familia`, que sobrevive à
 * exclusão); mudança de horário e cancelamento NÃO têm marca — cada um é informação nova para a
 * família, e uma trava de "já avisei" calava aviso necessário (rodada 2 do gate) —, e os três
 * respeitam o teto diário por família (`mensagens.avisos_por_familia_dia`).
 *
 * Retorno de cada método: `null` quando não era caso de aviso (a resposta nem menciona), ou
 * `{enviado, motivo}` quando um aviso foi tentado — inclusive quando o pedido explícito da recepção
 * foi recusado por um portão, para a tela dizer por quê.
 */
class AvisoDoAgendamento
{
    /** Dia da semana por tabela própria: não depende do locale instalado no servidor. */
    private const DIAS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];

    /**
     * A tradução das recusas do `EnvioDeMensagens` para a recepção: as mensagens de lá falam com
     * quem opera a caixa de entrada ("sincronize e tente de novo"), e repetir a remarcação não
     * reenvia nada.
     */
    private const MOTIVOS = [
        'conexao' => 'o canal do WhatsApp não está conectado',
        'template' => 'o modelo da mensagem não está aprovado na Meta',
        'variaveis' => 'o modelo da mensagem não bate com os dados do aviso',
        'limite' => 'o teto mensal de mensagens foi atingido',
    ];

    public function __construct(
        private readonly ConfiguracaoService $configuracoes,
        private readonly EnvioDeMensagens $envio,
    ) {}

    /**
     * A confirmação: só quando a criança não tinha NENHUM outro agendamento de paciente, não veio
     * da virada, e a sessão é futura e marcada de verdade (ocupa o horário e não é reserva). Uma
     * série confirma uma vez, sobre a primeira sessão.
     *
     * @param  list<Agendamento>  $criados  os registros criados por UMA ação (avulso ou série)
     * @return array{enviado: bool, motivo: string|null}|null
     */
    public function confirmar(array $criados, ?int $autorId): ?array
    {
        return $this->semDerrubar(function () use ($criados, $autorId): ?array {
            $primeiro = collect($criados)
                ->filter(fn (Agendamento $a) => $a->tipo !== 'bloqueio' && $a->paciente_id !== null)
                ->sortBy(fn (Agendamento $a) => $a->inicio?->format('Y-m-d H:i'))
                ->first();

            if (! $primeiro instanceof Agendamento
                || ! $this->ehFutura($primeiro->inicio)
                || ! $this->statusDeSessaoMarcada($primeiro->status_id)
                || ! $this->ehOPrimeiroDaCrianca($primeiro, $criados)) {
                return null;
            }

            // o profissional que confirma com as famílias por conta própria (change
            // mensagens-automaticas-por-profissional, D3). AQUI e nunca em `enviar()`, que também
            // serve à remarcação e ao cancelamento pedidos pela recepção. É caso recusado com motivo,
            // não `null`: a recepção fica sabendo que a família não recebeu nada do sistema
            if (! $this->mandaMensagensAutomaticas($primeiro->profissional_id)) {
                return $this->naoEnviado('as mensagens automáticas estão desligadas para este profissional');
            }

            return $this->enviar(
                $primeiro,
                'mensagens.template_confirmacao',
                "paciente:{$primeiro->paciente_id}",
                $autorId,
                fn (): array => [
                    '1' => $this->nomeDaCrianca($primeiro),
                    '2' => $this->diaDaSemanaEHora($primeiro->inicio),
                    '3' => $this->nomeDoProfissional($primeiro->profissional_id),
                ],
            );
        });
    }

    /**
     * A mudança de horário, com o pedido explícito de quem gravou. Não é caso (null) quando dia,
     * hora e profissional não mudaram; é caso recusado — com motivo — quando a criança do
     * agendamento mudou, a sessão não está marcada (desmarcada, falta, reserva) ou o novo horário já
     * passou.
     *
     * @param  int  $seguintes  as sessões seguintes da série que a gravação alcançou (0 fora de série)
     * @return array{enviado: bool, motivo: string|null}|null
     */
    public function remarcacao(Agendamento $agendamento, DateTimeInterface $deInicio, ?int $deProfissionalId, ?int $dePacienteId, int $seguintes, ?int $autorId): ?array
    {
        return $this->semDerrubar(function () use ($agendamento, $deInicio, $deProfissionalId, $dePacienteId, $seguintes, $autorId): ?array {
            if ($agendamento->tipo === 'bloqueio' || $agendamento->paciente_id === null) {
                return null;
            }

            $mudouProfissional = (int) $agendamento->profissional_id !== (int) $deProfissionalId;

            if (! $this->mudouHorarioOuProfissional($agendamento, $deInicio, $deProfissionalId)) {
                return null;
            }

            if ((int) $agendamento->paciente_id !== (int) $dePacienteId) {
                return $this->naoEnviado('a criança do agendamento mudou');
            }
            // sessão desmarcada, falta ou reserva não é "remarcada": o horário dela está livre
            if (! $this->statusDeSessaoMarcada($agendamento->status_id)) {
                return $this->naoEnviado('a sessão não está marcada (desmarcada, falta ou reserva)'.$this->eAsSeguintes($seguintes, 'mudou', 'mudaram'));
            }
            if (! $this->ehFutura($agendamento->inicio)) {
                return $this->naoEnviado('a sessão já passou');
            }

            return $this->enviar($agendamento, 'mensagens.template_remarcacao', null, $autorId, function () use ($agendamento, $deInicio, $deProfissionalId, $mudouProfissional, $seguintes): array {
                $de = $this->dataEHora($deInicio);
                $para = $this->dataEHora($agendamento->inicio);

                // o profissional só entra no texto quando ele é parte da mudança
                if ($mudouProfissional) {
                    $de .= ' com '.$this->nomeDoProfissional($deProfissionalId);
                    $para .= ' com '.$this->nomeDoProfissional($agendamento->profissional_id);
                }

                // série inteira: a família precisa saber que não foi só uma (SEC-AV-05)
                if ($seguintes > 0) {
                    $para .= $seguintes === 1
                        ? ' (a próxima sessão também muda)'
                        : " (as próximas {$seguintes} sessões também mudam)";
                }

                return ['1' => $this->nomeDaCrianca($agendamento), '2' => $de, '3' => $para];
            });
        });
    }

    /**
     * O cancelamento pela clínica, com o pedido explícito de quem gravou: a transição PARA o status
     * que a clínica declarou como o do desmarque do profissional (`agenda.status_desmarque_id`) — o
     * status é o dado que diz quem desmarcou, nunca o nome dele (§13). Não é caso (null) quando o
     * status final não é esse, ou quando a sessão já estava nele e o horário/profissional mudou (aí
     * é a remarcação que responde); é caso recusado quando a sessão JÁ estava nele ou não estava marcada
     * (desmarcada pela família, falta, reserva — rodada 3, CR3-02/SEC-AV-16: "cancelado pela
     * clínica" sobre sessão que a família já tinha desmarcado é mensagem falsa), quando a criança
     * mudou ou a sessão já passou. O texto cita o horário que a família conhecia (o de ANTES).
     *
     * @param  int  $seguintes  as sessões seguintes da série desmarcadas junto (0 fora de série)
     * @return array{enviado: bool, motivo: string|null}|null
     */
    public function cancelamento(Agendamento $agendamento, ?int $statusAnteriorId, DateTimeInterface $deInicio, ?int $deProfissionalId, ?int $dePacienteId, int $seguintes, ?int $autorId): ?array
    {
        return $this->semDerrubar(function () use ($agendamento, $statusAnteriorId, $deInicio, $deProfissionalId, $dePacienteId, $seguintes, $autorId): ?array {
            $statusDaClinica = (int) $this->configuracoes->get('agenda.status_desmarque_id');

            if ($statusDaClinica <= 0
                || $agendamento->tipo === 'bloqueio'
                || $agendamento->paciente_id === null
                || (int) $agendamento->status_id !== $statusDaClinica) {
                return null;
            }

            if ((int) $statusAnteriorId === $statusDaClinica) {
                // nada foi cancelado AGORA: se o horário ou o profissional mudou, quem responde é a
                // remarcação — e ela diz se as sessões seguintes da série mudaram (CR4-03)
                if ($this->mudouHorarioOuProfissional($agendamento, $deInicio, $deProfissionalId)) {
                    return null;
                }

                return $this->naoEnviado('a sessão já estava desmarcada');
            }
            if (! $this->statusDeSessaoMarcada($statusAnteriorId)) {
                return $this->naoEnviado('a sessão já não estava marcada (desmarcada, falta ou reserva)'.$this->eAsSeguintes($seguintes, 'foi desmarcada', 'foram desmarcadas'));
            }
            if ((int) $agendamento->paciente_id !== (int) $dePacienteId) {
                return $this->naoEnviado('a criança do agendamento mudou');
            }
            if (! $this->ehFutura($deInicio)) {
                return $this->naoEnviado('a sessão já passou');
            }

            return $this->enviar($agendamento, 'mensagens.template_cancelamento', null, $autorId, function () use ($agendamento, $deInicio, $seguintes): array {
                $quando = $this->dataEHora($deInicio);
                if ($seguintes > 0) {
                    $quando .= $seguintes === 1 ? ' e da próxima sessão' : " e das próximas {$seguintes} sessões";
                }

                return ['1' => $this->nomeDaCrianca($agendamento), '2' => $quando];
            });
        });
    }

    /**
     * Os portões da spec, em ordem; a marca (só da confirmação); e o envio. O regime é o da automação
     * da clínica (design D2): `automatica: true`, com o autor de quem gravou para a trilha saber quem
     * causou.
     *
     * @param  string|null  $chaveDaMarca  a marca de "uma vez só" — `null` para os avisos sem ela
     * @param  callable(): array<string, string>  $variaveis  montadas só se for enviar
     * @return array{enviado: bool, motivo: string|null}
     */
    private function enviar(Agendamento $agendamento, string $chaveDoModelo, ?string $chaveDaMarca, ?int $autorId, callable $variaveis): array
    {
        if (! (bool) $this->configuracoes->get('whatsapp.automatico')) {
            return $this->naoEnviado('as mensagens automáticas estão desligadas');
        }

        if (ConexaoDaClinica::atual()?->estaConectada() !== true) {
            return $this->naoEnviado(self::MOTIVOS['conexao']);
        }

        $modelo = trim((string) $this->configuracoes->get($chaveDoModelo));
        if ($modelo === '') {
            return $this->naoEnviado('este aviso não está configurado');
        }

        if (! $agendamento->lembrete_whatsapp) {
            return $this->naoEnviado('o agendamento está sem WhatsApp');
        }

        $telefone = CorrespondenciaDePaciente::telefonesDoPaciente((int) $agendamento->paciente_id)[0] ?? null;
        if ($telefone === null) {
            // vazio ou digitado errado: a recepção vai a lugares diferentes do cadastro
            // (change telefone-que-chega-no-whatsapp)
            $falta = CorrespondenciaDePaciente::faltaDeTelefone([(int) $agendamento->paciente_id])[(int) $agendamento->paciente_id] ?? null;

            return $this->naoEnviado($falta === CorrespondenciaDePaciente::TELEFONE_INVALIDO
                ? 'o telefone do cadastro não é válido para WhatsApp'
                : 'a criança não tem telefone cadastrado');
        }

        $conversa = $this->conversaDe($telefone);

        // o opt-out da família vale para tudo que a clínica manda sozinha
        if ($conversa->sem_lembretes) {
            return $this->naoEnviado('a família pediu para não receber mensagens automáticas');
        }

        // o freio por família (SEC-AV-10): andar por horários diferentes mandava uma mensagem paga
        // por gravação e podia esgotar o teto do mês, calando o lembrete da clínica inteira
        if ($this->avisosDeHoje($conversa) >= (int) $this->configuracoes->get('mensagens.avisos_por_familia_dia')) {
            return $this->naoEnviado('o limite diário de avisos para esta família foi atingido; avise à mão se precisar');
        }

        // a marca ANTES do envio, pelo índice único: duas criações em paralelo não furam
        $registro = null;
        if ($chaveDaMarca !== null) {
            $registro = $this->marcar($agendamento, $chaveDaMarca);
            if ($registro === null) {
                return $this->naoEnviado('a confirmação já foi enviada a esta família; veja a conversa');
            }
        }

        try {
            $mensagem = $this->envio->enviarTemplate($conversa, $modelo, $variaveis(), autorId: $autorId, automatica: true);
        } catch (ValidationException $erro) {
            $registro?->delete();

            return $this->naoEnviado(self::MOTIVOS[(string) array_key_first($erro->errors())] ?? 'falha no envio');
        } catch (Throwable $erro) {
            // não saiu: a marca sai junto, para uma próxima tentativa legítima poder avisar
            $registro?->delete();
            throw $erro;
        }

        // a mensagem JÁ saiu: uma falha daqui em diante não pode virar "não avisada" na tela — a
        // recepção avisaria à mão e a família ouviria duas vezes (SEC-AV-18). A marca fica sem
        // mensagem e vale como envio em andamento pelo prazo de `AvisoAFamilia::MARCA_SEM_MENSAGEM_MINUTOS`.
        if ($registro !== null) {
            try {
                $registro->mensagem_id = $mensagem->id;
                $registro->save();
            } catch (Throwable $erro) {
                $this->relatar($erro);
            }
        }

        return ['enviado' => true, 'motivo' => null];
    }

    /**
     * Nada que os portões consultam pode virar 500 depois do commit (SEC-AV-04/11). O relato vai
     * para o log de erros SANEADO (ver `relatar`).
     *
     * @param  callable(): (array{enviado: bool, motivo: string|null}|null)  $aviso
     * @return array{enviado: bool, motivo: string|null}|null
     */
    private function semDerrubar(callable $aviso): ?array
    {
        try {
            return $aviso();
        } catch (Throwable $erro) {
            $this->relatar($erro);

            return $this->naoEnviado('falha inesperada no envio; avise a família à mão');
        }
    }

    /**
     * O log recebe só a FORMA do erro — classe, SQLSTATE e onde —, nunca a mensagem: a de uma
     * `QueryException` traz o SQL com os bindings, e o binding é o telefone da família (SEC-AV-15;
     * `zend.exception_ignore_args` não resolve, o texto é montado pelo Laravel). Sem `previous`
     * encadeado pela mesma razão: o log serializa a cadeia inteira.
     */
    private function relatar(Throwable $erro): void
    {
        $sqlstate = $erro instanceof QueryException
            ? ' SQLSTATE '.($erro->errorInfo[0] ?? '?').'/'.($erro->errorInfo[1] ?? '?')
            : '';

        report(new RuntimeException(sprintf(
            'Aviso do agendamento não saiu: %s%s em %s:%d',
            $erro::class,
            $sqlstate,
            $erro->getFile(),
            $erro->getLine(),
        )));
    }

    /**
     * Grava a marca da confirmação; `null` quando ela já existe e vale. A marca de uma mensagem que
     * FALHOU na entrega não vale: é trocada, e a confirmação sai de novo (rodada 2 do gate — "já
     * recebeu" sobre uma mensagem que nunca chegou mandava a recepção não avisar à mão). Marca SEM
     * mensagem vale enquanto é recente (envio em andamento) e deixa de valer depois do prazo.
     */
    private function marcar(Agendamento $agendamento, string $chave): ?AvisoAFamilia
    {
        $existente = AvisoAFamilia::query()->where('tipo', AvisoAFamilia::TIPO_CONFIRMACAO)->where('chave', $chave)->first();

        if ($existente !== null) {
            if (! $existente->falhou()) {
                return null;
            }

            $existente->delete();
        }

        try {
            return AvisoAFamilia::create([
                'tipo' => AvisoAFamilia::TIPO_CONFIRMACAO,
                'chave' => $chave,
                'paciente_id' => $agendamento->paciente_id,
                'agendamento_id' => $agendamento->id,
                // o horário que a confirmação anuncia: é ele que deixa a confirmação dispensar o
                // lembrete da mesma sessão (change `repescagem-do-lembrete`)
                'inicio_confirmado' => $agendamento->inicio,
            ]);
        } catch (QueryException $erro) {
            // outra criação em paralelo marcou primeiro: ela confirma, esta não
            if ((int) ($erro->errorInfo[1] ?? 0) === 1062) {
                return null;
            }

            throw $erro;
        }
    }

    /**
     * Os avisos do agendamento CRIADOS para esta família HOJE (no dia da clínica), inclusive os que
     * falharam — erra para o lado de parar cedo, como o teto mensal (`WA-TETO-APROX`). O lembrete
     * não conta: é o freio destes três avisos, não do canal.
     */
    private function avisosDeHoje(Conversa $conversa): int
    {
        $modelos = array_values(array_filter(array_map(
            fn (string $chave): string => trim((string) $this->configuracoes->get($chave)),
            ['mensagens.template_confirmacao', 'mensagens.template_remarcacao', 'mensagens.template_cancelamento'],
        )));
        $inicioDoDia = now((string) $this->configuracoes->get('clinica.timezone'))
            ->startOfDay()
            ->setTimezone((string) config('app.timezone'));

        return Mensagem::query()
            ->where('conversa_id', $conversa->id)
            ->whereIn('template_nome', $modelos)
            ->where('created_at', '>=', $inicioDoDia)
            ->count();
    }

    /**
     * Nenhum outro agendamento de paciente da criança — cancelados contam, bloqueio não — fora os
     * registros desta mesma ação; e a criança não veio da carga da virada. Uma consulta só.
     *
     * @param  list<Agendamento>  $criados
     */
    private function ehOPrimeiroDaCrianca(Agendamento $primeiro, array $criados): bool
    {
        $idsDaAcao = collect($criados)->map(fn (Agendamento $a) => $a->getKey())->all();

        return Paciente::query()
            ->whereKey($primeiro->paciente_id)
            ->whereNull('importado_clinicaagil_em')
            ->whereDoesntHave('agendamentos', fn ($outros) => $outros
                ->where('tipo', '!=', 'bloqueio')
                ->whereNotIn('id', $idsDaAcao))
            ->exists();
    }

    /** Status de sessão MARCADA: ocupa o horário e não é reserva (o molde do lembrete). */
    private function statusDeSessaoMarcada(?int $statusId): bool
    {
        return StatusAgendamento::query()
            ->whereKey($statusId)
            ->where('ocupa_horario', true)
            ->where('marca_reserva', false)
            ->exists();
    }

    /**
     * A sessão ainda vai acontecer — na HORA DE PAREDE da clínica (`inicio` é naive, convenção da
     * agenda). Sessão que já passou não se avisa: seria "cancelado: hoje às 09:00" à tarde.
     */
    private function ehFutura(?DateTimeInterface $inicio): bool
    {
        $agora = now((string) $this->configuracoes->get('clinica.timezone'))->format('Y-m-d H:i');

        return $inicio !== null && $inicio->format('Y-m-d H:i') > $agora;
    }

    private function mudouHorarioOuProfissional(Agendamento $agendamento, DateTimeInterface $deInicio, ?int $deProfissionalId): bool
    {
        return $agendamento->inicio?->format('Y-m-d H:i') !== $deInicio->format('Y-m-d H:i')
            || (int) $agendamento->profissional_id !== (int) $deProfissionalId;
    }

    /**
     * A recusa sobre a sessão EDITADA não pode esconder que a série mudou (rodada 4, CR4-03): a
     * recepção leria "não está marcada" e concluiria que não há o que avisar, com as sessões
     * seguintes — marcadas, e que a família conhece — já mudadas.
     */
    private function eAsSeguintes(int $seguintes, string $singular, string $plural): string
    {
        return match (true) {
            $seguintes === 1 => "; mas a próxima sessão da série {$singular} — avise a família à mão",
            $seguintes > 1 => "; mas as próximas {$seguintes} sessões da série {$plural} — avise a família à mão",
            default => '',
        };
    }

    /** @return array{enviado: bool, motivo: string} */
    private function naoEnviado(string $motivo): array
    {
        return ['enviado' => false, 'motivo' => $motivo];
    }

    /** Nome social na frente — é como a criança é chamada. Lido pela relação mínima do menor. */
    private function nomeDaCrianca(Agendamento $agendamento): string
    {
        $agendamento->loadMissing(ResumoDoPaciente::relacao());

        return (string) ($agendamento->paciente?->nome_social ?: $agendamento->paciente?->nome);
    }

    /** Sem cadastro achado, vale o padrão (ligado): só a escolha explícita da clínica cala o aviso. */
    private function mandaMensagensAutomaticas(?int $profissionalId): bool
    {
        return Profissional::query()->whereKey($profissionalId)->value('mensagens_automaticas') !== false;
    }

    private function nomeDoProfissional(?int $id): string
    {
        return (string) (Profissional::query()->whereKey($id)->value('nome') ?? '');
    }

    /**
     * `inicio` já é HORA DE PAREDE da clínica (convenção da agenda) — convertê-lo diria 11:00 para
     * uma sessão das 14:00, e a família descobriria chegando na hora errada.
     */
    private function dataEHora(?DateTimeInterface $quando): string
    {
        return $quando === null ? '' : $quando->format('d/m').' às '.$quando->format('H:i');
    }

    private function diaDaSemanaEHora(?DateTimeInterface $quando): string
    {
        return $quando === null ? '' : self::DIAS[(int) $quando->format('w')].', '.$this->dataEHora($quando);
    }

    /** O mesmo caminho do lembrete e do desmarque: a conversa é única por telefone canônico. */
    private function conversaDe(string $telefone): Conversa
    {
        $conversa = Conversa::query()->where('telefone_e164', $telefone)->first();

        if ($conversa !== null) {
            return $conversa;
        }

        $nova = new Conversa;
        $nova->telefone_e164 = $telefone;
        $nova->paciente_id = CorrespondenciaDePaciente::paraTelefone($telefone);

        try {
            $nova->save();
        } catch (QueryException $erro) {
            // irmãos gravados ao mesmo tempo: a outra requisição criou a conversa primeiro (SEC-AV-11)
            if ((int) ($erro->errorInfo[1] ?? 0) !== 1062) {
                throw $erro;
            }

            return Conversa::query()->where('telefone_e164', $telefone)->firstOrFail();
        }

        return $nova;
    }
}
