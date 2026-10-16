<?php

namespace App\Http\Controllers;

use App\Models\LancamentoAnexo;
use App\Support\Arquivos\ArquivoCifrado;
use App\Support\Arquivos\XmlDeNota;
use App\Support\Auditoria\RegistroDeAuditoria;
use App\Support\Configuracoes\ConfiguracaoService;
use App\Support\Financeiro\LancamentosVisiveis;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpFoundation\Response as RespostaDeArquivo;

/**
 * Anexos do lançamento de caixa (change `anexo-no-lancamento`), na MESMA régua dos anexos do
 * paciente (`ArquivoCifrado`): tipo pelo conteúdo, nome saneado, cifra em repouso, download como
 * anexo e auditado, exclusão lógica. Anexar vale no lançamento PAGO e no de período fechado (D3):
 * o anexo não é dinheiro nem entra em total — a mesma exceção de `obs` e `documento`.
 */
class LancamentoAnexoController extends Controller
{
    /** MIME detectado → extensão. XML é a nota eletrônica (D4). */
    private const MIMES = [
        'application/pdf' => 'pdf',
        'image/jpeg' => 'jpg',
        'image/png' => 'png',
        'image/webp' => 'webp',
        'text/xml' => 'xml',
        'application/xml' => 'xml',
    ];

    private const TETO_BYTES = 10 * 1024 * 1024;

    /** Teto de contagem por lançamento — DoS por volume (SEC-AX-06, a mesma régua). */
    private const TETO_POR_LANCAMENTO = 20;

    private const RECUSA_DO_FORMATO = 'Formato não aceito. Envie PDF, imagem (JPEG, PNG, WEBP) ou o XML da nota fiscal.';

    public function __construct(private readonly ArquivoCifrado $arquivos) {}

    public function index(int $id): JsonResponse
    {
        $lancamento = LancamentosVisiveis::encontrar($id); // inexistente, ou salário sem a folha → 404

        return response()->json(LancamentoAnexo::query()
            ->where('lancamento_id', $lancamento->id)
            ->with('criadoPor:id,nome')
            ->orderByDesc('id')
            ->get(['id', 'nome', 'mime', 'tamanho', 'criado_por', 'created_at'])
            ->map(fn (LancamentoAnexo $a): array => $this->serializar($a, $a->criadoPor?->only(['id', 'nome'])))
            ->all());
    }

    public function store(Request $request, int $id): JsonResponse
    {
        $lancamento = LancamentosVisiveis::encontrar($id);

        $request->validate(
            ['arquivo' => ['required', 'file', 'max:'.intval(self::TETO_BYTES / 1024)]],
            ['arquivo.max' => 'O arquivo excede o tamanho máximo de 10 MB.'],
        );

        // os EXCLUÍDOS contam (SEC-FIN-05): a exclusão é lógica e o arquivo fica no disco — sem
        // isto, enviar e excluir em laço enchia o disco com zero anexos ativos
        if (LancamentoAnexo::withTrashed()->where('lancamento_id', $lancamento->id)->count() >= self::TETO_POR_LANCAMENTO) {
            throw ValidationException::withMessages([
                'arquivo' => 'Este lançamento atingiu o limite de '.self::TETO_POR_LANCAMENTO.' anexos — os excluídos também contam.',
            ]);
        }

        $arquivo = $request->file('arquivo');
        // o XML só entra com a declaração (D4): o finfo só diz `text/xml` quando o conteúdo começa
        // por `<?xml` — sem ela é `text/plain`, fora da whitelist
        $mime = $this->arquivos->tipoAceito($arquivo, self::MIMES, self::RECUSA_DO_FORMATO);
        // XML com conteúdo ATIVO não é nota fiscal (SEC-FIN-03): o finfo chama de `text/xml` um
        // XHTML com `<script>` ou um SVG com comentário longo antes da raiz — lido pela ESTRUTURA
        // o teto do XML, com a razão dita (CR-R3-01): acima dele nem se lê o conteúdo
        if (self::MIMES[$mime] === 'xml' && $arquivo->getSize() > XmlDeNota::TETO_BYTES) {
            throw ValidationException::withMessages([
                'arquivo' => 'O XML passa de 1 MB, e a nota fiscal eletrônica tem poucos KB. Confira se é o arquivo certo, ou envie o PDF da nota.',
            ]);
        }
        if (self::MIMES[$mime] === 'xml' && ! XmlDeNota::inerte((string) file_get_contents($arquivo->getRealPath()))) {
            throw ValidationException::withMessages(['arquivo' => self::RECUSA_DO_FORMATO]);
        }

        $caminho = sprintf('lancamentos/%d/%s.%s', $lancamento->id, (string) Str::uuid(), self::MIMES[$mime]);
        $this->arquivos->gravar($caminho, $arquivo);

        $anexo = new LancamentoAnexo([
            'nome' => $this->arquivos->nomeDeExibicao($arquivo->getClientOriginalName(), self::MIMES[$mime]),
            'mime' => $mime,
            'tamanho' => $arquivo->getSize(),
        ]);
        $anexo->lancamento_id = $lancamento->id;
        $anexo->caminho = $caminho;
        $anexo->criado_por = $request->user()->id;

        try {
            // a linha e a trilha na MESMA transação: se a trilha falhar, nem a linha fica
            DB::transaction(fn () => $anexo->save());
        } catch (\Throwable $erro) {
            // sem a linha, nenhuma purga acharia o arquivo — órfão não fica
            $this->arquivos->apagar($caminho);
            throw $erro;
        }

        return response()->json($this->serializar($anexo, $request->user()->only(['id', 'nome'])), Response::HTTP_CREATED);
    }

    public function download(int $anexoId): RespostaDeArquivo
    {
        $anexo = self::anexoVisivel($anexoId); // inexistente, excluído ou de salário sem a folha → 404
        abort_unless($this->arquivos->existe($anexo->caminho), Response::HTTP_NOT_FOUND);

        // o comprovante pode trazer o nome da criança e do responsável: a leitura fica na trilha
        RegistroDeAuditoria::registrar($anexo, 'consultou', []);

        return $this->arquivos->resposta($anexo->caminho, $anexo->mime, $anexo->nome);
    }

    public function destroy(int $anexoId): Response
    {
        self::anexoVisivel($anexoId)->delete(); // lógico: o arquivo cifrado fica

        return response()->noContent();
    }

    /**
     * O anexo pelo id, só se o LANÇAMENTO dele é visível: o comprovante do salário é da folha
     * (change `financeiro-sem-faturamento-total`). O lançamento sempre existe — a FK é `restrict`.
     */
    private static function anexoVisivel(int $anexoId): LancamentoAnexo
    {
        return LancamentoAnexo::query()
            ->whereHas('lancamento', fn (Builder $lancamento) => LancamentosVisiveis::filtrar($lancamento))
            ->findOrFail($anexoId);
    }

    /** Metadados em whitelist — o `caminho` físico NUNCA sai. */
    private function serializar(LancamentoAnexo $anexo, ?array $autor): array
    {
        return [
            'id' => $anexo->id,
            'nome' => $anexo->nome,
            'mime' => $anexo->mime,
            'tamanho' => $anexo->tamanho,
            // created_at é UTC do framework — exibição na parede da clínica (§13)
            'criado_em' => $anexo->created_at->timezone(app(ConfiguracaoService::class)->get('clinica.timezone'))->format('Y-m-d H:i'),
            'criado_por' => $autor,
        ];
    }
}
