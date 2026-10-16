<?php

namespace App\Support\Mensageria;

use App\Models\Agendamento;
use App\Models\Conversa;
use App\Models\LembreteEnviado;
use App\Models\Mensagem;
use App\Models\MensagemTemplate;
use App\Models\StatusAgendamento;
use App\Support\Agenda\AplicadorDeStatusEmLote;
use App\Support\Auditoria\OrigemDaOperacao;
use App\Support\Configuracoes\ConfiguracaoService;
use DateTimeInterface;
use Illuminate\Database\QueryException;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use RuntimeException;
use Throwable;

/**
 * O toque da família num botão do lembrete vira estado das sessões (change
 * `lembrete-com-botoes-de-resposta`).
 *
 * Roda DEPOIS do commit do webhook (design D5): a resposta automática despacha job, e um job
 * despachado dentro da transação poderia rodar antes de ela existir. E NUNCA lança — o webhook
 * responde 200 de qualquer jeito, ou a Meta reentregaria um toque que já foi registrado na conversa.
 *
 * O caminho de volta é o `context.id` do toque: a mensagem que ele cita tem de ser NOSSA, do MESMO
 * telefone (com ou sem o nono dígito — a Meta entrega celular antigo sem ele; outro número não
 * responde pelo lembrete de uma família), e ter linhas de lembrete. O significado do botão sai da
 * POSIÇÃO — num lembrete cujo modelo tem os dois botões de resposta rápida, 0 é confirmar e 1 é
 * desmarcar (design D2) — e só vale se o TEXTO tocado é o do botão daquela posição no modelo
 * sincronizado: um modelo reordenado na Meta não inverte o significado em silêncio.
 *
 * A resposta vale só para a sessão COMO FOI LEMBRADA: mesma criança e mesmo horário
 * (`LembreteEnviado::valeParaASessao` — rodada 1 do gate, SEC-BT-01), e ainda futura.
 */
class RespostaAoLembrete
{
    /** Posição do botão → resposta. É a convenção do runbook do WhatsApp. */
    private const RESPOSTAS = [0 => LembreteEnviado::CONFIRMOU, 1 => LembreteEnviado::PEDIU_DESMARQUE];

    public function __construct(
        private readonly ConfiguracaoService $configuracoes,
        private readonly EnvioDeMensagens $envio,
        private readonly AplicadorDeStatusEmLote $aplicador,
    ) {}

    public function processar(int $toqueId, int $conversaId, ?string $contexto, ?string $payload, ?string $textoDoBotao, DateTimeInterface $tocadoEm): void
    {
        try {
            $this->aplicar($toqueId, $conversaId, $contexto, $payload, $textoDoBotao, $tocadoEm);
        } catch (Throwable $erro) {
            $this->relatar($erro, 'Resposta ao lembrete não aplicada');
        }
    }

    private function aplicar(int $toqueId, int $conversaId, ?string $contexto, ?string $payload, ?string $textoDoBotao, DateTimeInterface $tocadoEm): void
    {
        $indice = $this->indiceDoBotao($payload);
        if ($indice === null || $contexto === null || $contexto === '') {
            return;
        }

        $respondida = Mensagem::query()
            ->with('conversa:id,telefone_e164')
            ->where('wa_message_id', $contexto)
            ->where('direcao', Mensagem::DIRECAO_ENVIADA)
            ->first();
        $doToque = Conversa::query()->find($conversaId);

        // outro telefone citando o lembrete de uma família: nada muda
        if ($respondida === null || $doToque === null || ! $this->mesmoTelefone($respondida, $doToque)) {
            return;
        }

        // o modelo DAQUELE envio — nome E idioma (a unicidade é por idioma; CRB-05)
        $modelo = MensagemTemplate::query()
            ->where('nome', $respondida->template_nome)
            ->where('idioma', $respondida->template_idioma)
            ->first();
        $resposta = self::RESPOSTAS[$indice] ?? null;
        if ($resposta === null || $modelo === null || ! $modelo->temBotoesDeResposta()
            || ($modelo->botoes_json[$indice]['texto'] ?? null) !== $textoDoBotao) {
            return;
        }

        $mudaram = DB::transaction(fn (): Collection => $this->marcar($respondida, $resposta, $toqueId, $tocadoEm));
        if ($mudaram->isEmpty()) {
            return;
        }

        // o desmarque automático tem relato PRÓPRIO: uma falha dele não pode calar a resposta à família
        // — o pedido já foi gravado (N2-05)
        if ($resposta === LembreteEnviado::PEDIU_DESMARQUE) {
            try {
                $this->desmarcarSeAClinicaQuiser($mudaram);
            } catch (Throwable $erro) {
                $this->relatar($erro, 'Desmarque automático não aplicado');
            }
        }

        // a resposta automática tem relato PRÓPRIO: quando ela falha, a marcação já foi gravada, e o
        // log não pode dizer "não aplicada" (N4)
        try {
            $this->responder($doToque, $resposta);
        } catch (Throwable $erro) {
            $this->relatar($erro, 'Resposta automática ao lembrete não saiu');
        }
    }

    /** O mesmo telefone, com ou sem o nono dígito (CRB-02). */
    private function mesmoTelefone(Mensagem $respondida, Conversa $doToque): bool
    {
        if ((int) $respondida->conversa_id === (int) $doToque->id) {
            return true;
        }

        $doLembrete = $respondida->conversa?->telefone_e164;

        return $doLembrete !== null && in_array($doLembrete, TelefoneE164::variantes($doToque->telefone_e164), true);
    }

    /**
     * Grava o toque nas linhas do lembrete que ainda valem. O último toque vence — pelo instante do
     * TOQUE (`ultimo_toque_em`), não pela ordem de chegada: a Meta pode entregar o mais velho depois,
     * inclusive quando a família repete o mesmo botão (rodada 2 do gate, CRB2-02: "Confirmo" t1,
     * "Confirmo" t3 e "Preciso desmarcar" t2 chegando por último termina em confirmado).
     *
     * Só a linha cuja resposta MUDA volta: tocar "Confirmo" dez vezes não manda dez "Obrigado!" (nem
     * tenta desmarcar dez vezes), e a hora do card (`respondido_em`) continua a do primeiro toque
     * da resposta atual.
     *
     * @return Collection<int, LembreteEnviado> as linhas cuja resposta mudou
     */
    private function marcar(Mensagem $respondida, string $resposta, int $toqueId, DateTimeInterface $tocadoEm): Collection
    {
        $mudaram = collect();

        $linhas = LembreteEnviado::query()
            ->where('mensagem_id', $respondida->id)
            ->with('agendamento.status')
            ->lockForUpdate()
            ->get()
            ->filter(fn (LembreteEnviado $linha): bool => $this->aindaVale($linha))
            ->filter(fn (LembreteEnviado $linha): bool => $linha->ultimo_toque_em === null || $linha->ultimo_toque_em->lt($tocadoEm));

        foreach ($linhas as $linha) {
            $linha->ultimo_toque_em = $tocadoEm;
            if ($linha->resposta !== $resposta) {
                $linha->resposta = $resposta;
                $linha->respondido_em = $tocadoEm;
                $linha->resposta_mensagem_id = $toqueId;
                // a resposta agora é da FAMÍLIA: a confirmação da clínica deixa de valer (change
                // confirmacao-pela-clinica, D4) — e um "Confirmo" que não muda nada a mantém
                $linha->confirmado_por = null;
                $mudaram->push($linha);
            }
            $linha->save();
        }

        return $mudaram;
    }

    /**
     * O toque só vale para a sessão que ainda vai acontecer COMO FOI LEMBRADA: a regra única de
     * `LembreteEnviado::valeParaASessao` (mesma criança, mesmo horário, ainda marcada) e futura na
     * hora de parede da clínica.
     */
    private function aindaVale(LembreteEnviado $linha): bool
    {
        $agendamento = $linha->agendamento;
        if (! $agendamento instanceof Agendamento || $agendamento->inicio === null) {
            return false;
        }

        $agora = now((string) $this->configuracoes->get('clinica.timezone'))->format('Y-m-d H:i');

        return $agendamento->inicio->format('Y-m-d H:i') > $agora && $linha->valeParaASessao($agendamento);
    }

    /**
     * Modo `desmarcar` (`lembretes.acao_desmarque`): aplica o status do desmarque pela família pelo
     * mesmo caminho das operações em lote — as guardas do agendamento valem, e a recusa de uma
     * sessão (ciclo fechado, por exemplo) a deixa só sinalizada.
     *
     * Rodada 1 do gate:
     * - o status é RELIDO aqui (SEC-BT-02/CRB-06): a regra "não desconta e libera o horário" só era
     *   conferida quando o ponteiro era gravado, e a clínica pode editar o status depois — fora dela,
     *   a sessão fica só sinalizada;
     * - as sessões são TRAVADAS e a regra refeita dentro desta transação (SEC-BT-04/CRB-07): entre a
     *   marcação e aqui, a recepção pode ter remarcado ou trocado a criança;
     * - na trilha, a origem é a FAMÍLIA PELO WHATSAPP (CRB-04), desfeita ao sair.
     *
     * @param  Collection<int, LembreteEnviado>  $linhas
     */
    private function desmarcarSeAClinicaQuiser(Collection $linhas): void
    {
        $statusId = (int) $this->configuracoes->get('lembretes.status_desmarque_familia_id');
        if ($this->configuracoes->get('lembretes.acao_desmarque') !== 'desmarcar' || $statusId <= 0) {
            return;
        }

        app(OrigemDaOperacao::class)->executarPeloWhatsapp(fn () => DB::transaction(function () use ($linhas, $statusId): void {
            // o status relido DENTRO da transação que aplica (N2 da segurança)
            $statusValido = StatusAgendamento::query()
                ->whereKey($statusId)
                ->where('desconta_sessao', false)
                ->where('ocupa_horario', false)
                ->exists();
            if (! $statusValido) {
                return;
            }

            // as linhas do lembrete TAMBÉM travadas: um "Confirmo" que chegue no meio não pode ser
            // passado por cima pelo desmarque (N2-02)
            $travadas = LembreteEnviado::query()
                ->whereKey($linhas->map(fn (LembreteEnviado $linha): int => (int) $linha->getKey())->all())
                ->with(['agendamento' => fn ($agendamentos) => $agendamentos->lockForUpdate(), 'agendamento.status'])
                ->orderBy('agendamento_id')
                ->lockForUpdate()
                ->get()
                ->filter(fn (LembreteEnviado $linha): bool => $linha->resposta === LembreteEnviado::PEDIU_DESMARQUE && $this->aindaVale($linha));

            if ($travadas->isNotEmpty()) {
                $this->aplicador->aplicar($travadas->map(fn (LembreteEnviado $linha): Agendamento => $linha->agendamento)->all(), $statusId);
            }
        }));
    }

    /**
     * A resposta automática, em TEXTO, na conversa do TOQUE: ele acabou de abrir a janela de 24 h,
     * então não gasta modelo nem entra no teto mensal (que conta só modelo). Respeita o que desliga
     * os outros automáticos (`whatsapp.automatico` — CRB-03), o texto vazio e o opt-out da conversa.
     */
    private function responder(Conversa $conversa, string $resposta): void
    {
        $chave = $resposta === LembreteEnviado::CONFIRMOU ? 'lembretes.resposta_confirmou' : 'lembretes.resposta_desmarque';
        $texto = trim((string) $this->configuracoes->get($chave));

        if ($texto === '' || $conversa->sem_lembretes || ! (bool) $this->configuracoes->get('whatsapp.automatico')) {
            return;
        }

        $this->envio->enviarTexto($conversa, $texto, null, automatica: true);
    }

    /** `botao:<n>` → n; qualquer outro payload (um modelo antigo, texto solto) não tem significado. */
    private function indiceDoBotao(?string $payload): ?int
    {
        if ($payload === null || preg_match('/^'.preg_quote(MensagemTemplate::PREFIXO_DO_BOTAO, '/').'(\d{1,2})$/', $payload, $casou) !== 1) {
            return null;
        }

        return (int) $casou[1];
    }

    /**
     * O log recebe só a FORMA do erro, como em `AvisoDoAgendamento::relatar`: a mensagem de uma
     * `QueryException` traz os bindings — o telefone da família.
     */
    private function relatar(Throwable $erro, string $oQueFalhou): void
    {
        $sqlstate = $erro instanceof QueryException
            ? ' SQLSTATE '.($erro->errorInfo[0] ?? '?').'/'.($erro->errorInfo[1] ?? '?')
            : '';

        report(new RuntimeException(sprintf(
            '%s: %s%s em %s:%d',
            $oQueFalhou,
            $erro::class,
            $sqlstate,
            $erro->getFile(),
            $erro->getLine(),
        )));
    }
}
