<?php

namespace App\Support\Mensageria;

use App\Models\Agendamento;
use App\Models\AvisoAFamilia;
use App\Models\Conversa;
use App\Models\LembreteEnviado;
use App\Models\Mensagem;
use App\Support\Clinica\ResumoDoPaciente;
use App\Support\Configuracoes\ConfiguracaoService;
use Illuminate\Database\QueryException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Validation\ValidationException;

/**
 * O disparo automático de lembrete (change mensageria-whatsapp) — o que a FA-06 previu
 * quando decidiu que lembrete é PROCESSO, não gesto manual da recepção.
 *
 * A garantia central é "um lembrete por agendamento", e ela é do BANCO: o unique
 * `(agendamento_id, tipo, competencia)` de `lembretes_enviados`. Uma verificação prévia no
 * comando não cobriria duas execuções simultâneas do agendador — e mandar dois lembretes
 * iguais para a mesma mãe é o defeito que a clínica percebe primeiro.
 *
 * Toda elegibilidade se decide por FLAG (`ocupa_horario`, `marca_reserva`), nunca por nome
 * de status: a clínica renomeia status à vontade (§13).
 */
class DisparoDeLembretes
{
    /**
     * A hora do disparo principal, no fuso da clínica. Lida pelo agendador (`bootstrap/app.php`) e
     * pela repescagem, que cobre os dias que ESTE disparo cobriu — as duas pontas não podem divergir.
     */
    public const HORA_DO_DISPARO = 8;

    /**
     * O motivo registrado quando a confirmação dispensa o lembrete (D4). Não diz "hoje": a dispensa
     * vale até o dia da sessão, e a linha é lida dias depois.
     *
     * É CHAVE, não só texto: a volta de outro dia reconhece a dispensa por ele (CR-RP2-03). Reescrever
     * a frase exige migrar as linhas `nao_enviado` que a carregam, ou as dispensas em curso caem.
     */
    public const MOTIVO_JA_CONFIRMADO = LembreteEnviado::MOTIVO_JA_CONFIRMADO;

    /** @var array{enviados: int, nao_enviados: int, motivos: array<string, int>} */
    private array $resultadoCorrente = ['enviados' => 0, 'nao_enviados' => 0, 'motivos' => []];

    public function __construct(
        private readonly ConfiguracaoService $configuracoes,
        private readonly EnvioDeMensagens $envio,
    ) {}

    /**
     * Com `$repescagem`, é a volta de hora em hora depois do disparo principal (change
     * `repescagem-do-lembrete`): alcança a sessão marcada depois das 08:00 para o dia que o disparo
     * já cobriu. O resto — marca única, lote, opt-out, teto, modelo e botões — é o mesmo caminho.
     *
     * @return array{enviados: int, nao_enviados: int, motivos: array<string, int>}
     */
    public function executar(?Carbon $agora = null, bool $repescagem = false): array
    {
        $resultado = ['enviados' => 0, 'nao_enviados' => 0, 'motivos' => []];
        $agoraNaClinica = ($agora ?? now())->copy()->setTimezone((string) $this->configuracoes->get('clinica.timezone'));

        if ($repescagem && ! $this->dentroDaRepescagem($agoraNaClinica)) {
            return $resultado;
        }

        if (! $this->podeDisparar()) {
            return $resultado;
        }

        // a repescagem cobre os dias do disparo das 08:00 de HOJE, nunca os da hora corrente: com
        // antecedência de 36 h, a volta das 17:00 somaria para depois de amanhã e anteciparia o
        // lembrete que é do disparo de amanhã (D3)
        $referencia = $repescagem
            ? $agoraNaClinica->copy()->setTime(self::HORA_DO_DISPARO, 0)
            : $agoraNaClinica;

        foreach ($this->diasAlvo($referencia) as $dia) {
            // a repescagem nunca lembra sessão de HOJE: o modelo diz "amanhã", e com antecedência
            // abaixo de 16 h o dia do disparo das 08:00 é o próprio dia (SEC-RP-03)
            if ($repescagem && $dia->isSameDay($agoraNaClinica)) {
                continue;
            }

            $this->dispararDoDia($dia, $agoraNaClinica, $resultado);
        }

        return $resultado;
    }

    /**
     * Ligada, e da hora seguinte ao disparo principal até a última hora configurada — no fuso da
     * CLÍNICA: o agendador roda toda hora e a clínica decide pela própria hora (D2).
     */
    private function dentroDaRepescagem(Carbon $agoraNaClinica): bool
    {
        if (! (bool) $this->configuracoes->get('lembretes.repescagem')) {
            return false;
        }

        return $agoraNaClinica->hour > self::HORA_DO_DISPARO
            && $agoraNaClinica->hour <= (int) $this->configuracoes->get('lembretes.repescagem_ate');
    }

    /**
     * Automação ligada E canal conectado. Faltando qualquer um, termina sem enviar e sem
     * erro: desligar a automação é decisão da clínica, não uma falha a alarmar.
     */
    private function podeDisparar(): bool
    {
        if (! (bool) $this->configuracoes->get('whatsapp.automatico')) {
            return false;
        }

        return ConexaoDaClinica::atual()?->estaConectada() === true;
    }

    /**
     * Os dias que este disparo cobre, no fuso DA CLÍNICA — nunca o do servidor: o servidor
     * roda em UTC, e "amanhã" às 21h de Brasília já é depois de amanhã lá.
     *
     * @return list<Carbon>
     */
    private function diasAlvo(Carbon $referencia): array
    {
        $antecedencia = (int) $this->configuracoes->get('lembretes.antecedencia_horas');

        // `startOfDay` DEPOIS de somar a antecedência: a chave escolhe o DIA a avisar, e é
        // isso que ela significa (avisar "24 h antes" numa rotina diária é avisar o dia
        // seguinte). Com `antecedencia = 1` o disparo das 08:00 cobre HOJE — e os horários
        // que já passaram ficam de fora por `elegiveis()`; a faixa da chave começa em 1 por
        // fidelidade à referência, mas o uso real é 24/48.
        $alvo = $referencia->copy()->addHours($antecedencia)->startOfDay();
        $dias = [$alvo];

        // Sem esta regra, o lembrete de segunda sairia no DOMINGO — dia em que a clínica
        // não atende e a família não tem a quem responder se precisar remarcar.
        if ((bool) $this->configuracoes->get('lembretes.segunda_na_sexta') && $referencia->isFriday()) {
            $segunda = $referencia->copy()->next(Carbon::MONDAY)->startOfDay();

            if (! $segunda->isSameDay($alvo)) {
                $dias[] = $segunda;
            }
        }

        return $dias;
    }

    /** @param array{enviados: int, nao_enviados: int, motivos: array<string, int>} $resultado */
    private function dispararDoDia(Carbon $dia, Carbon $agoraNaClinica, array &$resultado): void
    {
        // `agrupar()` também precisa contar (o telefone ausente sai por lá) — a referência
        // não atravessa a chamada, então o acumulador fica acessível por propriedade
        $this->resultadoCorrente = &$resultado;
        $agendamentos = $this->semOsJaConfirmados($this->elegiveis($dia, $agoraNaClinica), $dia, $agoraNaClinica);

        if ($agendamentos->isEmpty()) {
            return;
        }

        foreach ($this->agrupar($agendamentos) as $telefone => $grupo) {
            $this->dispararGrupo((string) $telefone, $grupo, $dia, $resultado);
        }
    }

    /** @return Collection<int, Agendamento> */
    private function elegiveis(Carbon $dia, Carbon $agoraNaClinica): Collection
    {
        $incluirReservas = (bool) $this->configuracoes->get('lembretes.incluir_reservas');

        return Agendamento::query()
            // fonte única do whitelist do menor — a guarda de arquitetura reprova a cópia
            ->with([ResumoDoPaciente::relacao(), 'profissional:id,nome'])
            ->where('lembrete_whatsapp', true)
            // o profissional que confirma com as famílias por conta própria fica fora (change
            // mensagens-automaticas-por-profissional, D2). Lido do cadastro AGORA, não copiado para o
            // agendamento; e fora da consulta, não como "não enviado", que a faixa contaria como falha
            ->whereDoesntHave('profissional', fn ($q) => $q->where('mensagens_automaticas', false))
            ->whereBetween('inicio', [
                $dia->copy()->startOfDay()->format('Y-m-d H:i:s'),
                $dia->copy()->endOfDay()->format('Y-m-d H:i:s'),
            ])
            // sessão que já começou não se lembra (D5). `inicio` é hora de parede da clínica, e é
            // nela que `agora` se compara; com antecedência curta o dia-alvo é HOJE, e a volta de
            // hora em hora lembraria a sessão das 10:00 às 15:00
            ->where('inicio', '>', $agoraNaClinica->format('Y-m-d H:i:s'))
            // já lembrado nesta competência: nem entra (a volta de hora em hora não tenta de novo o
            // INSERT que o unique recusaria). O `marcar()` continua sendo a garantia — isto é custo
            ->whereDoesntHave('lembretesEnviados', fn ($q) => $q
                ->where('tipo', LembreteEnviado::TIPO_AGENDAMENTO)
                ->where('competencia', $dia->format('Y-m-d'))
                ->where('status', LembreteEnviado::ENVIADO))
            // flags, nunca nomes (§13): "ocupa horário" é o dado que já diz que o
            // compromisso está de pé; desmarcado libera o horário e não gera lembrete
            ->whereHas('status', function ($q) use ($incluirReservas): void {
                $q->where('ocupa_horario', true);

                if (! $incluirReservas) {
                    $q->where('marca_reserva', false);
                }
            })
            ->orderBy('inicio')
            ->get();
    }

    /**
     * A criança nova que recebeu a confirmação do primeiro agendamento no dia não recebe o lembrete
     * da mesma sessão (D4): "confirmado para amanhã" e, uma hora depois, "podemos confirmar?".
     *
     * A dispensa nasce quando a confirmação é de HOJE (no fuso da clínica) e VALE para a competência
     * dali em diante: com a segunda avisada na sexta, a volta de domingo não pode mandar o lembrete
     * que a sexta dispensou (CR-RP-01). Nunca dispensa: confirmação que falhou (sem ela, o lembrete é
     * o único aviso — e como a dispensa é um não enviado retentável, a falha que chega DEPOIS libera
     * o lembrete na volta seguinte), nem sessão que não está mais como a confirmação anunciou —
     * criança trocada (SEC-RP-02) ou horário mudado, antes ou depois da dispensa (SEC-RP2-01).
     *
     * @param  Collection<int, Agendamento>  $agendamentos
     * @return Collection<int, Agendamento>
     */
    private function semOsJaConfirmados(Collection $agendamentos, Carbon $dia, Carbon $agoraNaClinica): Collection
    {
        if ($agendamentos->isEmpty()) {
            return $agendamentos;
        }

        $confirmacoes = AvisoAFamilia::query()
            ->where('tipo', AvisoAFamilia::TIPO_CONFIRMACAO)
            ->whereIn('agendamento_id', $agendamentos->modelKeys())
            ->get()
            ->keyBy('agendamento_id');

        if ($confirmacoes->isEmpty()) {
            return $agendamentos;
        }

        // o "hoje" é o da CLÍNICA; a comparação com `created_at` é por instante, não por texto
        $inicioDoDia = $agoraNaClinica->copy()->startOfDay();
        $dispensadas = LembreteEnviado::query()
            ->where('tipo', LembreteEnviado::TIPO_AGENDAMENTO)
            ->where('competencia', $dia->format('Y-m-d'))
            ->where('status', LembreteEnviado::NAO_ENVIADO)
            ->where('motivo', self::MOTIVO_JA_CONFIRMADO)
            ->whereIn('agendamento_id', $confirmacoes->keys()->all())
            ->get()
            ->keyBy('agendamento_id');

        return $agendamentos->reject(function (Agendamento $agendamento) use ($confirmacoes, $dispensadas, $inicioDoDia): bool {
            $confirmacao = $confirmacoes->get($agendamento->id);

            // a confirmação precisa ter falado desta sessão como ela está — mesma criança e mesmo
            // horário (SEC-RP-02, SEC-RP2-01/CR-RP2-01): remarcada sem aviso, só o lembrete leva o
            // horário novo. Checagens baratas antes da consulta do `falhou()` (CR-RP2-05)
            if (! $confirmacao instanceof AvisoAFamilia || ! $confirmacao->anunciou($agendamento)) {
                return false;
            }

            $deHoje = $confirmacao->created_at !== null && $confirmacao->created_at->gte($inicioDoDia);

            if ((! $deHoje && ! $dispensadas->has($agendamento->id)) || $confirmacao->falhou()) {
                return false;
            }

            // a dispensa supõe "a família recebeu a confirmação": se ela foi para um número que SAIU
            // do cadastro (o de outra família, corrigido depois), a família certa ficaria sem
            // confirmação e sem lembrete (gate r1, CR-TEL-02)
            if (! $this->confirmacaoFoiAoCadastroDeAgora($confirmacao, $agendamento)) {
                return false;
            }

            if ($this->registrarNaoEnviado($agendamento, self::MOTIVO_JA_CONFIRMADO)) {
                $this->contar($this->resultadoCorrente, self::MOTIVO_JA_CONFIRMADO);
            }

            return true;
        })->values();
    }

    /**
     * O número que recebeu a confirmação continua no cadastro da criança (com e sem o nono dígito)?
     * Uma consulta por confirmação: só chega aqui a criança nova com confirmação do dia, que são
     * poucas por volta.
     */
    private function confirmacaoFoiAoCadastroDeAgora(AvisoAFamilia $confirmacao, Agendamento $agendamento): bool
    {
        $telefone = Mensagem::query()->with('conversa:id,telefone_e164')->find($confirmacao->mensagem_id)?->conversa?->telefone_e164;

        if ($telefone === null) {
            // sem mensagem ainda é envio em andamento — quem decide é o `falhou()`, que já passou
            return true;
        }

        $doCadastro = collect(CorrespondenciaDePaciente::telefonesDoPaciente((int) $agendamento->paciente_id))
            ->flatMap(fn (string $e164): array => TelefoneE164::variantes($e164))
            ->all();

        return in_array($telefone, $doCadastro, true);
    }

    /**
     * Agrupa por telefone de destino. Com o lote ligado, a família com dois filhos recebe
     * UMA mensagem — antes eram quatro seguidas, e cada uma é uma conversa cobrada.
     *
     * @param  Collection<int, Agendamento>  $agendamentos
     * @return array<string, list<Agendamento>>
     */
    private function agrupar(Collection $agendamentos): array
    {
        $emLote = (bool) $this->configuracoes->get('lembretes.em_lote');
        $grupos = [];

        // UMA consulta para todos os telefones do lote: perguntar por agendamento seria um
        // N+1 numa rotina que roda de madrugada, sem ninguém para notar a lentidão
        $telefones = CorrespondenciaDePaciente::preferidosDe(
            $agendamentos->pluck('paciente_id')->filter()->unique()->values()->all()
        );
        // o PORQUÊ de quem ficou sem telefone, numa consulta só: vazio ou digitado errado mandam a
        // recepção a lugares diferentes do cadastro (change telefone-que-chega-no-whatsapp)
        $faltas = CorrespondenciaDePaciente::faltaDeTelefone(
            $agendamentos->pluck('paciente_id')->filter()->unique()
                ->reject(fn ($id): bool => isset($telefones[$id]))->values()->all()
        );

        foreach ($agendamentos as $agendamento) {
            $telefone = $telefones[$agendamento->paciente_id][0] ?? null;

            if ($telefone === null) {
                // sem telefone utilizável: fica REGISTRADO, nunca silencioso — a recepção
                // precisa saber quem ficou sem aviso. E CONTA no resultado: o comando
                // reportava menos não-enviados do que a realidade.
                $motivo = CorrespondenciaDePaciente::FRASES[$faltas[$agendamento->paciente_id] ?? CorrespondenciaDePaciente::SEM_TELEFONE];

                if ($this->registrarNaoEnviado($agendamento, $motivo)) {
                    $this->contar($this->resultadoCorrente, $motivo);
                }

                continue;
            }

            // sem lote, cada agendamento vira seu próprio grupo (a chave carrega o id)
            $chave = $emLote ? $telefone : $telefone.'#'.$agendamento->id;
            $grupos[$chave][] = $agendamento;
        }

        return $grupos;
    }

    /**
     * @param  list<Agendamento>  $grupo
     * @param  array{enviados: int, nao_enviados: int, motivos: array<string, int>}  $resultado
     */
    private function dispararGrupo(string $chave, array $grupo, Carbon $dia, array &$resultado): void
    {
        $telefone = explode('#', $chave)[0];
        $conversa = $this->conversaDe($telefone);

        // opt-out da família: cala o AUTOMÁTICO, e só ele — responder continua liberado
        if ($conversa->sem_lembretes) {
            foreach ($grupo as $agendamento) {
                if ($this->registrarNaoEnviado($agendamento, LembreteEnviado::MOTIVO_OPT_OUT)) {
                    $this->contar($resultado, LembreteEnviado::MOTIVO_OPT_OUT);
                }
            }

            return;
        }

        // as marcas ANTES do envio: se a Meta recusar, o unique já garantiu que ninguém
        // mais tenta este agendamento hoje, e o motivo fica gravado no lugar do sucesso
        $marcas = [];

        foreach ($grupo as $agendamento) {
            $marca = $this->marcar($agendamento, $dia);

            // já lembrado (execução anterior ou concorrente): sai de fininho
            if ($marca !== null) {
                $marcas[] = [$agendamento, $marca];
            }
        }

        if ($marcas === []) {
            return;
        }

        try {
            $mensagem = $this->envio->enviarTemplate(
                $conversa,
                (string) $this->configuracoes->get('lembretes.template'),
                $this->variaveis($marcas[0][0], array_column($marcas, 0)),
                autorId: null,
                automatica: true,
            );
        } catch (ValidationException $erro) {
            $motivo = $this->primeiroMotivo($erro);

            foreach ($marcas as [$agendamento, $marca]) {
                $marca->forceFill(['status' => LembreteEnviado::NAO_ENVIADO, 'motivo' => $motivo])->save();
                $this->contar($resultado, $motivo);
            }

            return;
        }

        foreach ($marcas as [$agendamento, $marca]) {
            $marca->forceFill(['mensagem_id' => $mensagem->id])->save();
            $resultado['enviados']++;
        }
    }

    /**
     * A marca de "este agendamento foi tratado hoje". Devolve null quando JÁ existe — é
     * assim que duas execuções concorrentes do agendador não duplicam: quem perde a corrida
     * do índice único simplesmente não envia.
     */
    private function marcar(Agendamento $agendamento, Carbon $dia): ?LembreteEnviado
    {
        try {
            return LembreteEnviado::create([
                'agendamento_id' => $agendamento->id,
                ...LembreteEnviado::doQueFoiLembrado($agendamento),
                'tipo' => LembreteEnviado::TIPO_AGENDAMENTO,
                'competencia' => $dia->format('Y-m-d'),
                'status' => LembreteEnviado::ENVIADO,
            ]);
        } catch (QueryException $erro) {
            if ((int) ($erro->errorInfo[1] ?? 0) !== 1062) {
                throw $erro;
            }

            // Já existe marca para hoje. Se ela é de ENVIADO, acabou — não se manda duas
            // vezes. Se é de NÃO ENVIADO (sem telefone, teto, falha), ela é RETENTÁVEL: a
            // recepção corrige o cadastro às 09:00 e reexecuta, e antes disso a marca
            // queimava o dia inteiro do agendamento — nenhum lembrete jamais sairia, e não
            // existe envio manual (FA-06). Achado do gate de code review.
            $existente = LembreteEnviado::query()
                ->where('agendamento_id', $agendamento->id)
                ->where('tipo', LembreteEnviado::TIPO_AGENDAMENTO)
                ->where('competencia', $dia->format('Y-m-d'))
                ->first();

            if ($existente === null || $existente->status === LembreteEnviado::ENVIADO) {
                return null;
            }

            // o reenvio fala da criança e do horário de AGORA (a recepção pode ter corrigido o
            // cadastro). A troca é CONDICIONAL: ler NÃO ENVIADO e gravar ENVIADO sem condição deixava
            // duas execuções simultâneas (a volta da hora e uma manual) enviarem as duas — com a
            // repescagem, esse ramo roda sozinho de hora em hora (SEC-RP-01/CR-RP-05). Quem não
            // conseguiu virar a linha não envia; a garantia volta a ser do banco.
            //
            // Sem mensagem até o envio gravar a nova (gate r1, SEC-TEL-02/CR-TEL-05): uma linha antiga
            // pode apontar para a mensagem de OUTRO número, e o toque acha a linha pela mensagem
            //
            // A linha com resposta que fala DESTA sessão não vira (change confirmacao-pela-clinica, D4):
            // a família confirmou com a clínica por telefone, e o telefone corrigido depois mandaria
            // "podemos confirmar?" a quem já confirmou. A condição mora no UPDATE, e não numa leitura
            // antes, porque a confirmação trava a linha: quem vira depois dela a vê. A linha que já fala
            // de OUTRA sessão (remarcada no mesmo dia) vira, e sem a resposta do horário antigo.
            $lembrado = LembreteEnviado::doQueFoiLembrado($agendamento);
            $virou = LembreteEnviado::query()
                ->whereKey($existente->id)
                ->where('status', LembreteEnviado::NAO_ENVIADO)
                ->where(fn ($linha) => $linha->whereNull('resposta')->orWhere(fn ($outra) => $outra->deOutraSessao($lembrado)))
                ->update([
                    'status' => LembreteEnviado::ENVIADO,
                    'motivo' => null,
                    'mensagem_id' => null,
                    ...LembreteEnviado::SEM_RESPOSTA,
                    ...$lembrado,
                ]);

            return $virou === 1 ? $existente->refresh() : null;
        }
    }

    /**
     * Registra o não enviado; `true` só quando ESTA chamada criou a linha. A volta de hora em hora
     * passa de novo pelo mesmo motivo, e contá-lo a cada volta inflava o resultado (CR-RP-06).
     *
     * A linha que já existe como NÃO enviado passa a dizer o motivo e a sessão de AGORA (change
     * telefone-que-chega-no-whatsapp): o cadastro vazio às 08:00 e digitado errado às 08:40 não
     * pode continuar dizendo "sem telefone", e a sessão remarcada tem de seguir com alerta. O UPDATE
     * é condicional ao status — o enviado nunca é reescrito — e não conta no resultado: a volta não
     * registrou nada novo.
     */
    private function registrarNaoEnviado(Agendamento $agendamento, string $motivo): bool
    {
        try {
            LembreteEnviado::create([
                'agendamento_id' => $agendamento->id,
                ...LembreteEnviado::doQueFoiLembrado($agendamento),
                'tipo' => LembreteEnviado::TIPO_AGENDAMENTO,
                'competencia' => $agendamento->inicio->format('Y-m-d'),
                'status' => LembreteEnviado::NAO_ENVIADO,
                'motivo' => $motivo,
            ]);

            return true;
        } catch (QueryException $erro) {
            if ((int) ($erro->errorInfo[1] ?? 0) !== 1062) {
                throw $erro;
            }

            // o motivo E a sessão de agora (gate r1, CR-TEL-01): remarcada no mesmo dia, ou com a criança
            // trocada, a linha que guardava o horário antigo deixava o card sem alerta para sempre.
            // A confirmação da clínica era do horário ANTIGO: a linha que passa a falar de outra sessão
            // a perde ANTES de ganhar o horário novo (change confirmacao-pela-clinica, D4). A que continua
            // com resposta é a desta sessão, confirmada pela clínica: registro fechado, não se reescreve
            // (gate r1, CR-CC-02/SEC-CC-02) — um motivo de DECISÃO (opt-out, dispensa) gravado nela
            // tirava a confirmação do card, que não mostra decisão.
            $lembrado = LembreteEnviado::doQueFoiLembrado($agendamento);
            $daSessao = fn () => LembreteEnviado::query()
                ->where('agendamento_id', $agendamento->id)
                ->where('tipo', LembreteEnviado::TIPO_AGENDAMENTO)
                ->where('competencia', $agendamento->inicio->format('Y-m-d'))
                ->where('status', LembreteEnviado::NAO_ENVIADO);
            $daSessao()->deOutraSessao($lembrado)->update(LembreteEnviado::SEM_RESPOSTA);
            $daSessao()->whereNull('resposta')->update(['motivo' => $motivo, ...$lembrado]);

            return false;
        }
    }

    private function conversaDe(string $telefone): Conversa
    {
        $conversa = Conversa::query()->where('telefone_e164', $telefone)->first();

        if ($conversa !== null) {
            return $conversa;
        }

        $nova = new Conversa;
        $nova->telefone_e164 = $telefone;
        $nova->paciente_id = CorrespondenciaDePaciente::paraTelefone($telefone);
        $nova->save();

        return $nova;
    }

    /**
     * As variáveis do template. `{{1}}` é o nome de quem se atende; `{{2}}`, os horários —
     * um só, ou a lista do dia quando o lote juntou a família.
     *
     * @param  list<Agendamento>  $doGrupo
     * @return array<string, string>
     */
    private function variaveis(Agendamento $primeiro, array $doGrupo): array
    {
        $lote = count($doGrupo) > 1;

        $horarios = array_map(function (Agendamento $agendamento) use ($lote): string {
            // `inicio` já é HORA DE PAREDE da clínica (naive, convenção da agenda) —
            // convertê-lo de UTC diria 11:00 para uma sessão das 14:00, que é exatamente
            // o tipo de erro que a família só descobre chegando na hora errada
            $hora = $agendamento->inicio->format('H:i');

            // no lote, cada horário precisa dizer DE QUEM é: a mãe com dois filhos
            // recebendo "14:00, 15:00" não sabe quem vai a que horas
            return $lote ? $this->nomeDe($agendamento).' às '.$hora : $hora;
        }, $doGrupo);

        return [
            '1' => $this->nomeDe($primeiro),
            '2' => implode(', ', $horarios),
        ];
    }

    /** Nome social na frente — é como a criança é chamada. */
    private function nomeDe(Agendamento $agendamento): string
    {
        return (string) ($agendamento->paciente?->nome_social ?: $agendamento->paciente?->nome);
    }

    /** @param array{enviados: int, nao_enviados: int, motivos: array<string, int>} $resultado */
    private function contar(array &$resultado, string $motivo): void
    {
        $resultado['nao_enviados']++;
        $resultado['motivos'][$motivo] = ($resultado['motivos'][$motivo] ?? 0) + 1;
    }

    private function primeiroMotivo(ValidationException $erro): string
    {
        $primeiro = collect($erro->errors())->flatten()->first();

        return (string) ($primeiro ?? 'não foi possível enviar');
    }
}
