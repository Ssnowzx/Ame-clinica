<?php

namespace App\Http\Controllers;

use App\Models\Anexo;
use App\Models\Paciente;
use App\Support\Arquivos\ArquivoCifrado;
use App\Support\Auditoria\RegistroDeAuditoria;
use App\Support\Configuracoes\ConfiguracaoService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpFoundation\Response as RespostaDeArquivo;

/**
 * Anexos do paciente (change anexos-do-paciente) — o 1º domínio de upload do
 * produto, e o conteúdo é documento de MENOR (potencialmente laudo, art. 11).
 *
 * Endurecimento (parecer SEC-AX, GO-COM-CONDIÇÕES):
 * - upload: MIME detectado do CONTEÚDO (finfo — nunca extensão/Content-Type do
 *   cliente) → whitelist → tetos → SÓ ENTÃO grava (SEC-AX-05/06); caminho 100%
 *   derivado de UUID — nada do cliente entra nele (D1);
 * - repouso: arquivo CIFRADO (`Crypt`) — paridade com o texto clínico do banco
 *   (SEC-AX-02/D6);
 * - download: 404 inexistente → 403 permissão → `consultou` → resposta decifrada
 *   como attachment (SEC-AX-10/D2); 403 não audita;
 * - exclusão: SOFT-delete (laudo é prontuário com retenção — SEC-AX-08/D4);
 * - trilha: `nome`/`caminho` mascarados no model (SEC-AX-04/D7);
 * - payload: `caminho` físico NUNCA sai (SEC-AX-09).
 *
 * Detecção, nome, cifra e download moram em `ArquivoCifrado` desde a change
 * `anexo-no-lancamento`: o anexo do lançamento usa a MESMA régua.
 */
class AnexoController extends Controller
{
    public function __construct(private readonly ArquivoCifrado $arquivos) {}

    /** MIME detectado → extensão gravada (whitelist estrita — D1). */
    private const MIMES = [
        'application/pdf' => 'pdf',
        'image/jpeg' => 'jpg',
        'image/png' => 'png',
    ];

    /** Teto por arquivo (bytes) — 10 MB. */
    private const TETO_BYTES = 10 * 1024 * 1024;

    /** Teto de CONTAGEM por paciente (SEC-AX-06) — DoS por volume. */
    private const TETO_POR_PACIENTE = 50;

    public function index(int $pacienteId): JsonResponse
    {
        $paciente = Paciente::findOrFail($pacienteId); // inexistente → 404

        // whitelist de metadados — `caminho` físico NUNCA sai (SEC-AX-09)
        $anexos = Anexo::query()
            ->where('paciente_id', $paciente->id)
            ->with('criadoPor:id,nome')
            ->orderByDesc('id')
            ->get(['id', 'nome', 'mime', 'tamanho', 'criado_por', 'created_at']);

        return response()->json($anexos->map(fn (Anexo $a): array => [
            'id' => $a->id,
            'nome' => $a->nome,
            'mime' => $a->mime,
            'tamanho' => $a->tamanho,
            // created_at é UTC do framework — exibição na PAREDE (§13)
            'criado_em' => $a->created_at->timezone($this->fusoDaClinica())->format('Y-m-d H:i'),
            'criado_por' => $a->criadoPor?->only(['id', 'nome']),
        ])->all());
    }

    public function store(Request $request, int $pacienteId): JsonResponse
    {
        $paciente = Paciente::findOrFail($pacienteId);

        $request->validate(
            ['arquivo' => ['required', 'file', 'max:'.intval(self::TETO_BYTES / 1024)]],
            ['arquivo.max' => 'O arquivo excede o tamanho máximo de 10 MB.'],
        );

        // teto de contagem ANTES de tocar o disco (SEC-AX-06)
        $existentes = Anexo::where('paciente_id', $paciente->id)->count();
        if ($existentes >= self::TETO_POR_PACIENTE) {
            throw ValidationException::withMessages([
                'arquivo' => 'Este paciente atingiu o limite de '.self::TETO_POR_PACIENTE.' anexos.',
            ]);
        }

        // ORDEM da defesa (SEC-AX-05): detectar do CONTEÚDO → whitelist → só então gravar.
        // O arquivo ainda está no tmp do PHP — recusa não deixa resto no disco da app.
        $arquivo = $request->file('arquivo');
        $mime = $this->arquivos->tipoAceito($arquivo, self::MIMES, 'Formato não aceito. Envie PDF, JPEG ou PNG.');

        // nome de EXIBIÇÃO sanitizado (SEC-AX-07): sem separadores de caminho nem
        // controles; nunca entra no caminho físico (que é 100% UUID — D1)
        $nome = $this->arquivos->nomeDeExibicao($arquivo->getClientOriginalName(), self::MIMES[$mime]);
        $caminho = sprintf(
            'anexos/%d/%s.%s',
            $paciente->id,
            (string) Str::uuid(),
            self::MIMES[$mime],
        );

        // CIFRADO em repouso (SEC-AX-02/D6) — paridade com o texto clínico do banco
        $this->arquivos->gravar($caminho, $arquivo);

        $anexo = new Anexo([
            'nome' => $nome,
            'mime' => $mime,
            'tamanho' => $arquivo->getSize(),
        ]);
        $anexo->paciente_id = $paciente->id;
        $anexo->caminho = $caminho;
        $anexo->criado_por = $request->user()->id;

        try {
            $anexo->save();
        } catch (\Throwable $erro) {
            // INSERT falhou depois da gravação: sem a linha, a purga governada nunca
            // acharia o arquivo — órfão em produção não é aceitável (CR menor r1)
            $this->arquivos->apagar($caminho);
            throw $erro;
        }

        return response()->json([
            'id' => $anexo->id,
            'nome' => $anexo->nome,
            'mime' => $anexo->mime,
            'tamanho' => $anexo->tamanho,
            'criado_em' => $anexo->created_at->timezone($this->fusoDaClinica())->format('Y-m-d H:i'),
            // paridade com o index — o tipo do front promete criado_por (CR I-3 r1)
            'criado_por' => $request->user()->only(['id', 'nome']),
        ], Response::HTTP_CREATED);
    }

    public function download(int $id): RespostaDeArquivo
    {
        $anexo = Anexo::findOrFail($id); // inexistente E soft-deleted → 404

        // drift operacional (linha sem arquivo — restore parcial): 404 ANTES de
        // auditar, como as outras negativas — a trilha `consultou` só registra
        // leitura que DE FATO entregou conteúdo (F-03 do gate)
        abort_unless($this->arquivos->existe($anexo->caminho), Response::HTTP_NOT_FOUND);

        // leitura de potencial laudo (art. 11): AUDITADA antes da resposta
        // (SEC-AX-10); o 403 de permissão acontece no middleware — negado não audita
        RegistroDeAuditoria::registrar($anexo, 'consultou', []);

        return $this->arquivos->resposta($anexo->caminho, $anexo->mime, $anexo->nome);
    }

    public function destroy(int $id): Response
    {
        $anexo = Anexo::findOrFail($id);

        // SOFT-delete (SEC-AX-08/D4): some da lista e do download na hora; o
        // arquivo PERMANECE (retenção de prontuário — purga é processo futuro)
        $anexo->delete();

        return response()->noContent();
    }

    private function fusoDaClinica(): string
    {
        return app(ConfiguracaoService::class)->get('clinica.timezone');
    }
}
