<?php

use App\Models\Anexo;
use App\Models\Auditoria;
use App\Models\Paciente;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Facades\Storage;

/**
 * GUARDA do domínio de anexos (change anexos-do-paciente; parecer pré-código
 * SEC-AX, GO-COM-CONDIÇÕES) — abuse cases AB-01..AB-15.
 *
 * O 1º upload do produto guarda documento de MENOR (potencialmente laudo,
 * art. 11): MIME pelo CONTEÚDO, caminho 100% UUID, arquivo CIFRADO em repouso,
 * download auditado, soft-delete (retenção de prontuário), trilha sem
 * nome/caminho. LGPD: dados 100% fictícios.
 */

/** PDF mínimo REAL (finfo → application/pdf). */
function pdfFicticio(): string
{
    return "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF";
}

/** JPEG mínimo REAL com payload PHP embutido (polyglot — AB-03). */
function jpegPolyglotFicticio(): string
{
    return "\xFF\xD8\xFF\xE0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00"
        .'<?php echo "payload ficticio"; ?>'
        ."\xFF\xD9";
}

function anexoUpload(string $nome, string $conteudo): UploadedFile
{
    return UploadedFile::fake()->createWithContent($nome, $conteudo);
}

beforeEach(function () {
    Storage::fake('local');
});

it('deve aceitar PDF válido, guardar sob UUID e CIFRADO em repouso (AB do caminho feliz)', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $paciente = Paciente::factory()->create();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)
        ->post("/api/pacientes/{$paciente->id}/anexos", [
            'arquivo' => anexoUpload('laudo-ficticio.pdf', pdfFicticio()),
        ]);

    // ASSERT — criado; caminho é UUID (nome original fora dele); conteúdo no disco ≠ claro
    $resposta->assertCreated()->assertJsonPath('nome', 'laudo-ficticio.pdf');
    $anexo = Anexo::firstOrFail();
    expect($anexo->caminho)->not->toContain('laudo-ficticio');
    expect($anexo->caminho)->toStartWith("anexos/{$paciente->id}/");
    $noDisco = Storage::disk('local')->get($anexo->caminho);
    expect($noDisco)->not->toContain('%PDF');
    expect(Crypt::decrypt($noDisco))->toBe(pdfFicticio());
});

it('deve recusar HTML renomeado .pdf pelo MIME real, SEM resto no disco (AB-01)', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $paciente = Paciente::factory()->create();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)
        ->post("/api/pacientes/{$paciente->id}/anexos", [
            'arquivo' => anexoUpload('inocente.pdf', '<html><body>não sou pdf</body></html>'),
        ]);

    // ASSERT — 422 legível; nada gravado
    $resposta->assertUnprocessable()->assertJsonValidationErrors('arquivo');
    expect(Anexo::count())->toBe(0);
    expect(Storage::disk('local')->allFiles())->toBe([]);
});

it('deve recusar SVG — vetor de XSS não entra (AB-02)', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $paciente = Paciente::factory()->create();

    // ACT + ASSERT
    $this->actingAs($adminDaClinica)
        ->post("/api/pacientes/{$paciente->id}/anexos", [
            'arquivo' => anexoUpload('imagem.svg', '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>'),
        ])
        ->assertUnprocessable();
    expect(Storage::disk('local')->allFiles())->toBe([]);
});

it('deve aceitar JPEG polyglot como .jpg inerte e servir como attachment (AB-03/AB-04)', function () {
    // ARRANGE — payload embutido é inerte: gravado fora do docroot, nunca inline
    $adminDaClinica = admin();
    $paciente = Paciente::factory()->create();
    $this->actingAs($adminDaClinica)
        ->post("/api/pacientes/{$paciente->id}/anexos", [
            'arquivo' => anexoUpload('foto.jpg', jpegPolyglotFicticio()),
        ])->assertCreated();
    $anexo = Anexo::firstOrFail();
    expect($anexo->caminho)->toEndWith('.jpg');

    // ACT — download
    $resposta = $this->actingAs($adminDaClinica)->get("/api/anexos/{$anexo->id}/download");

    // ASSERT — attachment SEMPRE, MIME salvo, binário original de volta
    $resposta->assertOk();
    expect($resposta->headers->get('Content-Disposition'))->toStartWith('attachment');
    expect($resposta->headers->get('Content-Type'))->toContain('image/jpeg');
    expect($resposta->getContent())->toBe(jpegPolyglotFicticio());
});

it('deve recusar acima do teto de 10 MB (AB-05)', function () {
    // ARRANGE — 11 MB declarados pelo fake (validação de tamanho antes do finfo)
    $adminDaClinica = admin();
    $paciente = Paciente::factory()->create();

    // ACT + ASSERT
    $this->actingAs($adminDaClinica)
        ->post("/api/pacientes/{$paciente->id}/anexos", [
            'arquivo' => UploadedFile::fake()->create('grande.pdf', 11 * 1024, 'application/pdf'),
        ])
        ->assertUnprocessable()->assertJsonValidationErrors('arquivo');
});

it('deve recusar o 51º anexo do paciente (AB-06)', function () {
    // ARRANGE — 50 linhas direto no banco (o teto é de contagem, não de upload)
    $adminDaClinica = admin();
    $paciente = Paciente::factory()->create();
    foreach (range(1, 50) as $indice) {
        $anexo = new Anexo(['nome' => "doc-{$indice}.pdf", 'mime' => 'application/pdf', 'tamanho' => 10]);
        $anexo->paciente_id = $paciente->id;
        $anexo->caminho = "anexos/{$paciente->id}/ficticio-{$indice}.pdf";
        $anexo->save();
    }

    // ACT + ASSERT
    $this->actingAs($adminDaClinica)
        ->post("/api/pacientes/{$paciente->id}/anexos", [
            'arquivo' => anexoUpload('mais-um.pdf', pdfFicticio()),
        ])
        ->assertUnprocessable()->assertJsonValidationErrors('arquivo');
    expect(Anexo::count())->toBe(50);
});

it('deve auditar o download como consultou — e 404/403 NÃO auditam (AB-07/09/11)', function () {
    // ARRANGE — TODOS os atores ANTES da 1ª request (guard pegajoso do sanctum)
    $adminDaClinica = admin();
    $semPermissao = usuarioCom(['pacientes.ver'], 'Sem Anexos');
    $paciente = Paciente::factory()->create();
    $this->actingAs($adminDaClinica)
        ->post("/api/pacientes/{$paciente->id}/anexos", [
            'arquivo' => anexoUpload('laudo-ficticio.pdf', pdfFicticio()),
        ])->assertCreated();
    $anexo = Anexo::firstOrFail();

    // ACT — download legítimo
    $this->actingAs($adminDaClinica)->get("/api/anexos/{$anexo->id}/download")->assertOk();

    // ASSERT — consultou com autor e IP
    $consulta = Auditoria::where('entidade', 'anexos')->where('acao', 'consultou')
        ->where('entidade_id', $anexo->id)->firstOrFail();
    expect($consulta->usuario_id)->toBe($adminDaClinica->id)->and($consulta->ip)->not->toBeNull();

    // ACT 2 — sem permissão: 403 e NENHUM consultou novo
    $this->flushSession();
    $this->app['auth']->forgetGuards();
    $this->actingAs($semPermissao)->get("/api/anexos/{$anexo->id}/download")->assertForbidden();

    // ACT 3 — id inexistente (enumeração de id): 404 e NENHUM consultou novo
    $this->flushSession();
    $this->app['auth']->forgetGuards();
    $this->actingAs($adminDaClinica)->get('/api/anexos/99999999/download')->assertNotFound();

    // ASSERT final — só a leitura legítima na trilha
    expect(Auditoria::where('entidade', 'anexos')->where('acao', 'consultou')->count())->toBe(1);
});

it('deve fazer SOFT-delete: some da lista e do download, arquivo permanece (AB-08 + retenção)', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $paciente = Paciente::factory()->create();
    $this->actingAs($adminDaClinica)
        ->post("/api/pacientes/{$paciente->id}/anexos", [
            'arquivo' => anexoUpload('engano-ficticio.pdf', pdfFicticio()),
        ])->assertCreated();
    $anexo = Anexo::firstOrFail();

    // ACT — exclusão legítima
    $this->actingAs($adminDaClinica)->deleteJson("/api/anexos/{$anexo->id}")->assertNoContent();

    // ASSERT — sumiu da lista e do download; linha soft-deleted; ARQUIVO no disco (retenção)
    $this->actingAs($adminDaClinica)->getJson("/api/pacientes/{$paciente->id}/anexos")
        ->assertOk()->assertJsonCount(0);
    $this->actingAs($adminDaClinica)->get("/api/anexos/{$anexo->id}/download")->assertNotFound();
    expect(Anexo::withTrashed()->find($anexo->id)->deleted_at)->not->toBeNull();
    expect(Storage::disk('local')->exists($anexo->caminho))->toBeTrue();
    expect(Auditoria::where('entidade', 'anexos')->where('acao', 'excluiu')->count())->toBe(1);
});

it('deve exigir a permissão de CADA ação (AB-10)', function () {
    // ARRANGE — atores ANTES da 1ª request (guard pegajoso do sanctum)
    $adminDaClinica = admin();
    $soVer = usuarioCom(['anexos.ver'], 'Só Vê Anexos');
    $paciente = Paciente::factory()->create();
    $this->actingAs($adminDaClinica)
        ->post("/api/pacientes/{$paciente->id}/anexos", [
            'arquivo' => anexoUpload('laudo-ficticio.pdf', pdfFicticio()),
        ])->assertCreated();
    $anexo = Anexo::firstOrFail();

    // ACT + ASSERT — vê e baixa, mas não cria nem exclui
    $this->flushSession();
    $this->app['auth']->forgetGuards();
    $this->actingAs($soVer)->getJson("/api/pacientes/{$paciente->id}/anexos")->assertOk();
    $this->actingAs($soVer)
        ->post("/api/pacientes/{$paciente->id}/anexos", [
            'arquivo' => anexoUpload('novo.pdf', pdfFicticio()),
        ])->assertForbidden();
    $this->actingAs($soVer)->deleteJson("/api/anexos/{$anexo->id}")->assertForbidden();
});

it('deve sanitizar nome hostil no banco e no header do download (AB-12)', function () {
    // ARRANGE — aspas, CRLF, traversal e unicode no nome enviado
    $adminDaClinica = admin();
    $paciente = Paciente::factory()->create();
    $hostil = "../..\\evil\"\r\nSet-Cookie: x=1;laudo çã.pdf";

    // ACT
    $resposta = $this->actingAs($adminDaClinica)
        ->post("/api/pacientes/{$paciente->id}/anexos", [
            'arquivo' => anexoUpload($hostil, pdfFicticio()),
        ]);

    // ASSERT — sem traversal/controles no banco; header sem CRLF cru
    $resposta->assertCreated();
    $anexo = Anexo::firstOrFail();
    expect($anexo->nome)->not->toContain('../')->not->toContain("\r")->not->toContain("\n");
    $download = $this->actingAs($adminDaClinica)->get("/api/anexos/{$anexo->id}/download");
    $download->assertOk();
    $disposition = (string) $download->headers->get('Content-Disposition');
    expect($disposition)->toStartWith('attachment');
    expect($disposition)->not->toContain("\r")->not->toContain("\n");
});

it('deve manter o caminho físico fora de TODO payload (AB-13) e da trilha (AB-14)', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $paciente = Paciente::factory()->create();
    $criacao = $this->actingAs($adminDaClinica)
        ->post("/api/pacientes/{$paciente->id}/anexos", [
            'arquivo' => anexoUpload('laudo-tea-ficticio.pdf', pdfFicticio()),
        ]);
    $criacao->assertCreated();
    $anexo = Anexo::firstOrFail();
    $this->actingAs($adminDaClinica)->deleteJson("/api/anexos/{$anexo->id}")->assertNoContent();

    // ACT
    $lista = $this->actingAs($adminDaClinica)->getJson("/api/pacientes/{$paciente->id}/anexos");

    // ASSERT — caminho nunca em payload; trilha sem nome nem caminho (art. 11 no nome)
    $lista->assertOk();
    semVazamento($lista->json(), $anexo->caminho);
    semVazamento($criacao->json(), 'anexos/'.$paciente->id.'/');
    $trilha = Auditoria::where('entidade', 'anexos')
        ->whereIn('acao', ['criou', 'excluiu'])->get();
    expect($trilha)->toHaveCount(2);
    foreach ($trilha as $registro) {
        semVazamento($registro->diff_json, 'laudo-tea-ficticio');
        semVazamento($registro->diff_json, $anexo->caminho);
    }
});

it('deve responder 404 SEM consultou quando a linha existe mas o arquivo sumiu (F-03)', function () {
    // ARRANGE — drift operacional (restore parcial): linha no banco, disco vazio
    $adminDaClinica = admin();
    $paciente = Paciente::factory()->create();
    $this->actingAs($adminDaClinica)
        ->post("/api/pacientes/{$paciente->id}/anexos", [
            'arquivo' => anexoUpload('laudo-ficticio.pdf', pdfFicticio()),
        ])->assertCreated();
    $anexo = Anexo::firstOrFail();
    Storage::disk('local')->delete($anexo->caminho);

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->get("/api/anexos/{$anexo->id}/download");

    // ASSERT — 404 ANTES de auditar: a trilha `consultou` só registra leitura que
    // DE FATO entregou conteúdo (a ordem exists→registrar é o invariante)
    $resposta->assertNotFound();
    expect(
        Auditoria::where('entidade', 'anexos')->where('acao', 'consultou')->count()
    )->toBe(0);
});

it('deve NÃO ter rota de serve do storage no router (AB-15 — SEC-AX-01)', function () {
    // ARRANGE + ACT
    $uris = collect(Route::getRoutes())->map(fn ($rota) => $rota->uri())->all();

    // ASSERT — o disco privado (onde vivem os laudos) não tem rota de framework
    expect(collect($uris)->filter(fn (string $uri) => str_starts_with($uri, 'storage'))->values()->all())
        ->toBe([]);
});

it('deve guardar o nome com a extensão do tipo detectado, sem comer o fim do nome com ponto', function (string $enviado, string $esperado) {
    // ARRANGE — SEC-FIN-03 vale para o laudo também; "Dr." e "25.09" não são extensão (CR-R2-11)
    $adminDaClinica = admin();
    $paciente = Paciente::factory()->create();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)
        ->post("/api/pacientes/{$paciente->id}/anexos", ['arquivo' => anexoUpload($enviado, pdfFicticio())]);

    // ASSERT
    $resposta->assertCreated()->assertJsonPath('nome', $esperado);
})->with([
    'extensão de outro tipo' => ['laudo.svg', 'laudo.pdf'],
    'abreviação com ponto' => ['Laudo Dr. Fulano Fictício', 'Laudo Dr. Fulano Fictício.pdf'],
    'data com pontos' => ['Relatório 25.09.2026', 'Relatório 25.09.2026.pdf'],
    'só a extensão' => ['.pdf', 'anexo.pdf'],
]);

it('deve baixar o anexo ANTIGO com a extensão do arquivo gravado, não a do nome guardado', function () {
    // ARRANGE — um anexo de antes da regra (CR-R2-03): o nome guardado diz .html, o arquivo é PDF
    $adminDaClinica = admin();
    $paciente = Paciente::factory()->create();
    $this->actingAs($adminDaClinica)
        ->post("/api/pacientes/{$paciente->id}/anexos", ['arquivo' => anexoUpload('laudo-ficticio.pdf', pdfFicticio())])
        ->assertCreated();
    $anexo = Anexo::firstOrFail();
    DB::table('anexos')->where('id', $anexo->id)->update(['nome' => 'laudo-ficticio.html']);

    // ACT
    $download = $this->actingAs($adminDaClinica)->get("/api/anexos/{$anexo->id}/download");

    // ASSERT
    $download->assertOk();
    expect((string) $download->headers->get('Content-Disposition'))
        ->toContain('laudo-ficticio.pdf')
        ->not->toContain('.html');
});
