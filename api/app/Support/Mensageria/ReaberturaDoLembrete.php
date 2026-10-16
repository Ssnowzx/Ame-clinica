<?php

namespace App\Support\Mensageria;

use App\Models\ContatoNormalizado;
use App\Models\LembreteEnviado;
use App\Models\Paciente;
use App\Support\Configuracoes\ConfiguracaoService;

/**
 * O telefone trocado depois do envio recebe o lembrete de novo (change
 * telefone-que-chega-no-whatsapp, D5).
 *
 * Em 01/10 o lembrete de uma criança saiu às 08:00 para o celular de outra paciente. A recepção
 * corrigiu o número às 10:30, e o lembrete nunca chegou à família certa: a marca ENVIADO é única
 * por sessão e dia, e não volta. Aqui ela volta a NÃO ENVIADO — retentável —, e quem envia é a
 * repescagem, pelo caminho de sempre: janela de horário, nunca sessão de hoje, lote por família,
 * teto, marca única. Esta classe NÃO envia nada.
 *
 * Só reabre o lembrete que:
 * - saiu (`ENVIADO`) e a família não respondeu — o "Confirmo" vale, e perguntar de novo não;
 * - fala da sessão como ela está (`falaDaSessao`) e ela ainda é futura;
 * - tem mensagem, e o número dela SAIU do cadastro (com e sem o nono dígito). Acrescentar um
 *   telefone não reabre: o lembrete chegou a um número que continua sendo da família.
 *
 * Vale também para o lembrete NÃO ENTREGUE: "falha de entrega não é retentada" protege contra
 * insistir no MESMO número, e aqui o número é outro.
 *
 * O número que saiu do cadastro PERDE A LINHA, qualquer que seja a resposta (change
 * confirmacao-pela-clinica, gate r1 CR-CC-01 e r2 SEC-CC-07): o toque acha a linha pela mensagem, e quem
 * ficou com o número antigo (outra família) tocaria por cima da confirmação da clínica — ou da própria
 * resposta de antes — e, no modo "desmarcar sozinho", desmarcaria a sessão desta criança. A linha com
 * resposta não reabre (a resposta fica, ver `CC-RESPOSTA-DO-NUMERO-QUE-SAIU` em docs/GATILHOS.md).
 */
class ReaberturaDoLembrete
{
    /** O motivo do lembrete reaberto, que o card mostra como "sem lembrete" até a volta seguinte. */
    public const MOTIVO = 'o telefone do cadastro mudou depois do envio';

    public function __construct(private readonly ConfiguracaoService $configuracoes) {}

    /** @return int quantos lembretes voltaram a pendente */
    public function reabrir(Paciente $paciente): int
    {
        $agora = now((string) $this->configuracoes->get('clinica.timezone'));

        $linhas = LembreteEnviado::query()
            ->where('paciente_id', $paciente->getKey())
            ->where('tipo', LembreteEnviado::TIPO_AGENDAMENTO)
            ->where('status', LembreteEnviado::ENVIADO)
            ->whereNotNull('mensagem_id')
            ->where('competencia', '>=', $agora->toDateString())
            ->with(['agendamento.status', 'mensagem.conversa:id,telefone_e164'])
            ->get();

        if ($linhas->isEmpty()) {
            return 0;
        }

        // os telefones de AGORA — a projeção que o observer acabou de reconstruir —, nas duas
        // leituras do nono dígito
        $doCadastro = ContatoNormalizado::query()
            ->where('paciente_id', $paciente->getKey())
            ->pluck('e164')
            ->flatMap(fn (string $e164): array => TelefoneE164::variantes($e164))
            ->all();

        $reabertas = 0;

        foreach ($linhas as $linha) {
            $agendamento = $linha->agendamento;
            $telefone = $linha->mensagem?->conversa?->telefone_e164;

            if ($agendamento === null || $agendamento->inicio === null || $telefone === null
                || $agendamento->inicio->format('Y-m-d H:i') <= $agora->format('Y-m-d H:i')
                || ! $linha->falaDaSessao($agendamento)
                || in_array($telefone, $doCadastro, true)) {
                continue;
            }

            // A ORDEM decide as corridas, pelo banco e não pela leitura de cima (gate r2, CR-CC-13):
            // 1º o número antigo perde a linha, sem condição — depois disso nenhum toque dele a acha; uma
            // confirmação ou um toque que gravou entre a leitura e aqui fica, e a linha não reabre;
            LembreteEnviado::query()->whereKey($linha->getKey())->update(['mensagem_id' => null]);

            // 2º a linha sem resposta reabre. Condicional: a resposta que chegou no meio vence, e a linha
            // fica respondida (gate r1 da telefone-que-chega-no-whatsapp, SEC-TEL-02)
            $reabertas += LembreteEnviado::query()
                ->whereKey($linha->getKey())
                ->where('status', LembreteEnviado::ENVIADO)
                ->whereNull('resposta')
                ->update(['status' => LembreteEnviado::NAO_ENVIADO, 'motivo' => self::MOTIVO]);
        }

        return $reabertas;
    }
}
