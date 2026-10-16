<?php

namespace App\Http\Controllers;

use App\Jobs\EnviarMensagemJob;
use App\Models\Conversa;
use App\Models\Mensagem;
use App\Models\MensagemMidia;
use App\Support\Auditoria\RegistroDeAuditoria;
use App\Support\Mensageria\EnvioDeMensagens;
use App\Support\Mensageria\GravadorDeMidia;
use App\Support\Mensageria\MidiaBaixada;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpFoundation\HeaderUtils;
use Symfony\Component\Mime\MimeTypes;

/**
 * Enviar, reenviar e baixar mídia (change mensageria-whatsapp).
 *
 * As três regras do canal são verificadas no SERVIÇO, antes de qualquer chamada externa
 * (`EnvioDeMensagens`): conectado, janela de 24h, teto do mês. Aqui só entra o que é do
 * boundary — validar o payload e devolver a mensagem que nasceu.
 */
class MensagemController extends Controller
{
    public function __construct(
        private readonly EnvioDeMensagens $envio,
        private readonly GravadorDeMidia $gravador,
    ) {}

    public function store(Request $request, int $conversaId): JsonResponse
    {
        $conversa = Conversa::query()->findOrFail($conversaId);

        $dados = $request->validate([
            'tipo' => ['required', 'in:texto,template,midia'],
            'corpo' => ['required_if:tipo,texto', 'nullable', 'string', 'max:4000'],
            'template' => ['required_if:tipo,template', 'nullable', 'string', 'max:120'],
            'variaveis' => ['sometimes', 'array'],
            'variaveis.*' => ['string', 'max:500'],
            'arquivo' => ['required_if:tipo,midia', 'file', 'max:16384'],
            'legenda' => ['sometimes', 'nullable', 'string', 'max:1000'],
        ]);

        $autor = $request->user()->id;

        $mensagem = match ($dados['tipo']) {
            'texto' => $this->envio->enviarTexto($conversa, $dados['corpo'], $autor),
            'template' => $this->envio->enviarTemplate(
                $conversa,
                $dados['template'],
                array_map('strval', $dados['variaveis'] ?? []),
                $autor,
            ),
            'midia' => $this->enviarMidia($request, $conversa, $dados['legenda'] ?? null, $autor),
        };

        return response()->json([
            'id' => $mensagem->id,
            'status' => $mensagem->status,
            'tipo' => $mensagem->tipo,
            'corpo' => $mensagem->corpo,
        ], Response::HTTP_CREATED);
    }

    /**
     * "Tentar novamente" de uma mensagem que falhou. Reenfileira a MESMA linha — criar
     * outra encheria a thread de tentativas e faria a família receber duas se a primeira
     * tiver chegado.
     *
     * A CARGA É RECONSTRUÍDA do que está gravado. Reenfileirar vazio (como fazia antes)
     * apagava o tipo do envio: uma mensagem de MÍDIA perdia o `midia_id`, caía no ramo de
     * texto do Job, e a família recebia a legenda solta — "Segue o pedido médico da Ana" —
     * sem arquivo nenhum, com a thread marcando `enviada`. A recepção teria prova visual de
     * ter mandado um documento que nunca saiu (achado do gate de code review).
     */
    public function reenviar(int $id): JsonResponse
    {
        $mensagem = Mensagem::query()->with(['midia', 'conversa'])->findOrFail($id);

        if ($mensagem->status !== 'falhou') {
            throw ValidationException::withMessages([
                'status' => 'Só uma mensagem que falhou pode ser reenviada.',
            ]);
        }

        // reenviar é ENVIAR de novo: passa pelas mesmas guardas (SEC-WA-10)
        $this->envio->exigirPodeReenviar($mensagem->conversa, $mensagem->template_nome !== null);

        $carga = $this->cargaDoReenvio($mensagem);

        $mensagem->avancarEntrega(function (Mensagem $alvo): void {
            $alvo->status = 'pendente';
            $alvo->erro_motivo = null;
        });

        EnviarMensagemJob::dispatch($mensagem->id, $carga);

        return response()->json(['id' => $mensagem->id, 'status' => 'pendente']);
    }

    /**
     * O que o Job precisa para repetir ESTE envio, lido do estado persistido.
     *
     * @return array<string, mixed>
     */
    private function cargaDoReenvio(Mensagem $mensagem): array
    {
        // template: o Job lê variáveis e idioma da própria mensagem (SEC-WA-07 — nome de
        // menor não viaja no payload da fila)
        if ($mensagem->template_nome !== null) {
            return [];
        }

        if ($mensagem->midia !== null) {
            // arquivo já expurgado pela retenção: reenviar mandaria a legenda sozinha,
            // que é justamente o defeito que este método existe para impedir
            if ($mensagem->midia->caminho === null) {
                throw ValidationException::withMessages([
                    'arquivo' => 'O arquivo desta mensagem não está mais disponível. Anexe-o de novo.',
                ]);
            }

            return ['midia_id' => $mensagem->midia->id];
        }

        return [];
    }

    /**
     * Download da mídia — sob `mensagens.ver` (id inexistente → 404 pelo `findOrFail`).
     *
     * MESMO REGIME DOS ANEXOS DO PACIENTE (SEC-AX-10), e agora sem exceção silenciosa:
     *
     * - **Leitura AUDITADA** antes da resposta: é potencial laudo de menor, e "quem baixou o
     *   documento que a mãe mandou" precisa ter resposta. Negado (403/404) não audita.
     * - **`attachment`, nunca `inline`**: PDF aberto inline executa JS em leitores. O nome
     *   é server-set — o original codifica diagnóstico e não sai daqui.
     * - **`no-store`**: documento de menor não fica no cache de disco de uma máquina de
     *   balcão compartilhada.
     */
    public function midia(int $id): Response
    {
        $midia = MensagemMidia::query()->findOrFail($id);
        $conteudo = $this->gravador->ler($midia);

        abort_if($conteudo === null, Response::HTTP_NOT_FOUND);

        RegistroDeAuditoria::registrar($midia, 'consultou', [], $midia->camposAuditaveisExcluidos());

        return response($conteudo, Response::HTTP_OK, [
            'Content-Type' => $midia->mime,
            'Content-Disposition' => HeaderUtils::makeDisposition(
                HeaderUtils::DISPOSITION_ATTACHMENT,
                'anexo-da-conversa'.$this->extensaoDe($midia->mime),
            ),
            'X-Content-Type-Options' => 'nosniff',
            'Cache-Control' => 'private, no-store',
        ]);
    }

    /** Extensão a partir do mime já validado pelo conteúdo — nunca do nome original. */
    private function extensaoDe(string $mime): string
    {
        $extensao = (new MimeTypes)->getExtensions($mime)[0] ?? null;

        return $extensao === null ? '' : '.'.$extensao;
    }

    private function enviarMidia(Request $request, Conversa $conversa, ?string $legenda, int $autor): Mensagem
    {
        $arquivo = $request->file('arquivo');
        $conteudo = (string) file_get_contents($arquivo->getRealPath());

        // TRANSAÇÃO: a mensagem nasce antes do arquivo (ele precisa de uma dona), e a
        // validação por conteúdo só acontece depois. Sem envolver as duas, um `.zip`
        // recusado deixava a mensagem `pendente` órfã na thread — para sempre, porque
        // nenhum Job chega a existir para marcá-la como falha (achado do gate).
        $mensagem = DB::transaction(function () use ($conversa, $legenda, $autor, $arquivo, $conteudo): Mensagem {
            $mensagem = $this->envio->iniciarMidia($conversa, $legenda, $autor);

            $registro = new MensagemMidia;
            $registro->mensagem_id = $mensagem->id;
            $registro->mime = (string) $arquivo->getMimeType();
            $registro->save();

            $aceita = $this->gravador->gravar(
                $registro,
                // o mime declarado entra só como referência: o gravador decide pelo CONTEÚDO
                new MidiaBaixada($conteudo, $registro->mime, strlen($conteudo)),
            );

            if (! $aceita) {
                throw ValidationException::withMessages([
                    'arquivo' => 'Este tipo de arquivo não pode ser enviado pelo WhatsApp.',
                ]);
            }

            // o tipo real só se conhece depois da validação por conteúdo
            $mensagem->avancarEntrega(fn (Mensagem $alvo) => $alvo->tipo = $this->tipoDoMime($registro->fresh()->mime));
            $mensagem->setRelation('midiaDespachada', $registro);

            return $mensagem;
        });

        $this->envio->despacharMidia($mensagem, $mensagem->getRelation('midiaDespachada')->id);

        return $mensagem;
    }

    private function tipoDoMime(string $mime): string
    {
        return match (true) {
            str_starts_with($mime, 'image/') => 'imagem',
            str_starts_with($mime, 'video/') => 'video',
            str_starts_with($mime, 'audio/') => 'audio',
            default => 'documento',
        };
    }
}
