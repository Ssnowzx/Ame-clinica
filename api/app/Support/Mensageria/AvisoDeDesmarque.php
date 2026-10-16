<?php

namespace App\Support\Mensageria;

use App\Models\Agendamento;
use App\Models\Conversa;
use App\Support\Configuracoes\ConfiguracaoService;
use Illuminate\Support\Collection;
use Illuminate\Validation\ValidationException;

/**
 * O aviso às famílias de uma baixa em massa (change `desmarque-do-profissional`).
 *
 * Ele roda DEPOIS do commit, nunca dentro da transação (design D3): mensagem enviada não
 * volta, e avisar a família de um desmarque que a transação reverteu faria a criança perder a
 * sessão por um aviso falso. Não existe atomicidade com um sistema externo; existe escolher
 * qual lado falha melhor — falhar sem avisar se reexecuta, avisar sem desmarcar não.
 *
 * Nada aqui LANÇA por família que ficou sem aviso: quem não pôde ser avisado entra na lista de
 * não-avisados, com o motivo, e o lote segue. Derrubar 20 desmarques porque uma mãe não tem
 * telefone cadastrado seria trocar um problema pequeno por um grande.
 */
class AvisoDeDesmarque
{
    public function __construct(
        private readonly ConfiguracaoService $configuracoes,
        private readonly EnvioDeMensagens $envio,
    ) {}

    /**
     * @param  Collection<int, Agendamento>  $desmarcados
     * @return array{avisados: int, nao_avisados: list<array{paciente_id: int|null, motivo: string}>}
     */
    public function avisar(Collection $desmarcados, ?int $autorId = null): array
    {
        $resultado = ['avisados' => 0, 'nao_avisados' => []];

        if ($desmarcados->isEmpty()) {
            return $resultado;
        }

        if (ConexaoDaClinica::atual()?->estaConectada() !== true) {
            // canal desconectado não é falha a alarmar — é estado da clínica. A recepção
            // recebe a lista e avisa à mão.
            return $this->todosSemAviso($desmarcados, 'canal do WhatsApp não conectado', $resultado);
        }

        $template = (string) $this->configuracoes->get('mensagens.template_desmarque');
        if ($template === '') {
            return $this->todosSemAviso($desmarcados, 'template de desmarque não configurado', $resultado);
        }

        // UMA consulta para os telefones do lote inteiro: perguntar por agendamento seria um
        // N+1 num gesto que a recepcionista faz com o telefone tocando
        $telefones = CorrespondenciaDePaciente::preferidosDe(
            $desmarcados->pluck('paciente_id')->filter()->unique()->values()->all()
        );
        $faltas = CorrespondenciaDePaciente::faltaDeTelefone(
            $desmarcados->pluck('paciente_id')->filter()->unique()
                ->reject(fn ($id): bool => isset($telefones[$id]))->values()->all()
        );

        // agrupado por telefone: a família com dois filhos na mesma tarde recebe UMA mensagem,
        // e cada mensagem iniciada pela clínica é uma conversa cobrada pela Meta
        $porTelefone = [];
        foreach ($desmarcados as $agendamento) {
            $telefone = $telefones[$agendamento->paciente_id][0] ?? null;

            if ($telefone === null) {
                $resultado['nao_avisados'][] = [
                    'paciente_id' => $agendamento->paciente_id,
                    'motivo' => CorrespondenciaDePaciente::FRASES[$faltas[$agendamento->paciente_id] ?? CorrespondenciaDePaciente::SEM_TELEFONE],
                ];

                continue;
            }

            $porTelefone[$telefone][] = $agendamento;
        }

        foreach ($porTelefone as $telefone => $grupo) {
            $this->avisarGrupo((string) $telefone, $grupo, $template, $autorId, $resultado);
        }

        return $resultado;
    }

    /**
     * @param  list<Agendamento>  $grupo
     * @param  array{avisados: int, nao_avisados: list<array{paciente_id: int|null, motivo: string}>}  $resultado
     */
    private function avisarGrupo(string $telefone, array $grupo, string $template, ?int $autorId, array &$resultado): void
    {
        $conversa = $this->conversaDe($telefone);

        // opt-out da família vale para o automático; este aviso é automático
        if ($conversa->sem_lembretes) {
            foreach ($grupo as $agendamento) {
                $resultado['nao_avisados'][] = [
                    'paciente_id' => $agendamento->paciente_id,
                    'motivo' => 'família pediu para não receber mensagens automáticas',
                ];
            }

            return;
        }

        try {
            // REGIME: mensagem OPERADA POR PESSOA, não automação (achado do gate de segurança).
            // A escolha importa e é uma só para a via inteira: quem dispara é alguém que
            // clicou, sob `mensagens.responder`, com a consequência escrita na tela. Por isso
            // `automatica: false` e o AUTOR preenchido — dezenas de mensagens sobre crianças
            // sem autor é repudiation, e a trilha de `agendamentos` sabe quem mudou cada
            // status enquanto a das mensagens não sabia quem as mandou.
            //
            // O opt-out da família (`sem_lembretes`) continua valendo mesmo assim: ela pediu
            // para não receber mensagem que a clínica dispara sozinha, e do lado de quem
            // recebe esta é exatamente isso.
            $this->envio->enviarTemplate(
                $conversa,
                $template,
                $this->variaveis($grupo),
                autorId: $autorId,
                automatica: false,
            );
        } catch (ValidationException $erro) {
            $motivo = collect($erro->errors())->flatten()->first() ?? 'falha no envio';
            foreach ($grupo as $agendamento) {
                $resultado['nao_avisados'][] = [
                    'paciente_id' => $agendamento->paciente_id,
                    'motivo' => (string) $motivo,
                ];
            }

            return;
        }

        $resultado['avisados']++;
    }

    /**
     * @param  Collection<int, Agendamento>  $desmarcados
     * @param  array{avisados: int, nao_avisados: list<array{paciente_id: int|null, motivo: string}>}  $resultado
     * @return array{avisados: int, nao_avisados: list<array{paciente_id: int|null, motivo: string}>}
     */
    private function todosSemAviso(Collection $desmarcados, string $motivo, array $resultado): array
    {
        foreach ($desmarcados->pluck('paciente_id')->filter()->unique() as $pacienteId) {
            $resultado['nao_avisados'][] = ['paciente_id' => $pacienteId, 'motivo' => $motivo];
        }

        return $resultado;
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
     * `{{1}}` é a data (ou a primeira delas) e `{{2}}` os horários desmarcados. O TEXTO do
     * template é cadastro, e precisa ser escrito com a clínica antes do primeiro uso real —
     * é comunicação em nome dela, sobre a criança.
     *
     * @param  list<Agendamento>  $grupo
     * @return array<string, string>
     */
    private function variaveis(array $grupo): array
    {
        // `inicio` já é HORA DE PAREDE da clínica (convenção da agenda): convertê-lo diria
        // 11:00 para uma sessão das 14:00, e a família descobriria chegando na hora errada
        $quando = array_map(
            fn (Agendamento $a) => $a->inicio->format('d/m').' às '.$a->inicio->format('H:i'),
            $grupo
        );

        return [
            '1' => $grupo[0]->inicio->format('d/m/Y'),
            '2' => implode(', ', $quando),
        ];
    }
}
