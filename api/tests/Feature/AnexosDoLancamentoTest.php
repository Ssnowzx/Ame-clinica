<?php

use App\Models\Auditoria;
use App\Models\Categoria;
use App\Models\Conta;
use App\Models\LancamentoAnexo;
use App\Models\LancamentoCaixa;
use App\Models\TipoPagamento;
use App\Support\Arquivos\XmlDeNota;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\Storage;

/**
 * Change `anexo-no-lancamento`: comprovante, nota e recibo no lançamento de caixa, na régua dos
 * anexos do paciente. Arquivos e dados 100% fictícios.
 */

/** Um PDF mínimo REAL (o finfo o reconhece como `application/pdf`). */
function comprovanteEmPdf(): UploadedFile
{
    return UploadedFile::fake()->createWithContent('comprovante-ficticio.pdf', "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF");
}

/** `a1="1" a2="1" …` — atributos fictícios para o teto da tag. */
function atributosFicticios(int $quantos): string
{
    return implode(' ', array_map(fn (int $n): string => "a{$n}=\"1\"", range(1, $quantos)));
}

/** Um lançamento de despesa fictício; pago quando pedido. */
function lancamentoComAnexo(bool $pago = false): LancamentoCaixa
{
    $lancamento = new LancamentoCaixa([
        'tipo' => 'despesa', 'competencia' => '2026-09-01', 'vencimento' => '2026-09-10', 'valor' => '1200.00',
        'contabil' => true,
        'categoria_id' => Categoria::firstOrCreate(['nome' => 'Aluguel Fictício', 'tipo' => 'despesa'])->id,
        'tipo_pagamento_id' => TipoPagamento::firstOrCreate(['nome' => 'Transferência Fictícia'])->id,
        'conta_id' => Conta::firstOrCreate(['nome' => 'Banco Fictício'])->id,
    ]);
    $lancamento->pago_em = $pago ? '2026-09-10 10:00' : null;
    $lancamento->save();

    return $lancamento;
}

beforeEach(function () {
    Storage::fake('local');
});

it('deve anexar o PDF, cifrado no disco, e listar sem o caminho físico', function () {
    // ARRANGE
    $this->actingAs(admin());
    $lancamento = lancamentoComAnexo();

    // ACT
    $resposta = $this->post("/api/lancamentos/{$lancamento->id}/anexos", ['arquivo' => comprovanteEmPdf()]);

    // ASSERT
    $resposta->assertCreated()->assertJsonPath('nome', 'comprovante-ficticio.pdf')->assertJsonMissingPath('caminho');
    $anexo = LancamentoAnexo::firstOrFail();
    expect(Storage::disk('local')->get($anexo->caminho))->not->toStartWith('%PDF')
        ->and(Crypt::decrypt(Storage::disk('local')->get($anexo->caminho)))->toStartWith('%PDF')
        ->and($this->getJson("/api/lancamentos/{$lancamento->id}/anexos")->json())->toHaveCount(1)->not->toHaveKey('0.caminho');
});

it('deve aceitar anexo em lançamento pago', function () {
    // ARRANGE — anexar não é mudar dinheiro (D3)
    $this->actingAs(admin());
    $pago = lancamentoComAnexo(pago: true);

    // ACT + ASSERT
    $this->post("/api/lancamentos/{$pago->id}/anexos", ['arquivo' => comprovanteEmPdf()])->assertCreated();
});

it('deve recusar pelo conteúdo, não pela extensão', function (string $nome, string $conteudo) {
    // ARRANGE
    $this->actingAs(admin());
    $lancamento = lancamentoComAnexo();

    // ACT
    $resposta = $this->post("/api/lancamentos/{$lancamento->id}/anexos", [
        'arquivo' => UploadedFile::fake()->createWithContent($nome, $conteudo),
    ]);

    // ASSERT
    $resposta->assertUnprocessable()->assertJsonValidationErrors('arquivo');
    expect(LancamentoAnexo::count())->toBe(0)
        ->and(Storage::disk('local')->allFiles())->toBe([]);
})->with([
    'executável com nome de pdf' => ['nota.pdf', "MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00\xFF\xFF\x00\x00"],
    'script com nome de xml' => ['nota.xml', "<script>alert('ficticio')</script>"],
    'html com nome de xml' => ['nota.xml', '<html><body>ficticio</body></html>'],
    'xml sem a declaração' => ['nota.xml', '<nfeProc><NFe/></nfeProc>'],
    'svg com script' => ['nota.xml', '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'],
    // SEC-FIN-03: o finfo chama de `text/xml` o que começa pela declaração — o conteúdo ativo é recusado
    'xhtml com script' => ['nota.xml', '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><script>alert(1)</script></html>'],
    'svg depois de comentário longo' => ['nota.xml', '<?xml version="1.0"?><!-- '.str_repeat('a', 5000).' --><svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'],
    'evento num elemento qualquer' => ['nota.xml', '<?xml version="1.0"?><nota><a onclick="alert(1)">x</a></nota>'],
    // CR-R2-02: os desvios que a regex deixava passar
    'svg com prefixo' => ['nota.xml', '<?xml version="1.0"?><x:svg xmlns:x="http://www.w3.org/2000/svg"><x:script>alert(1)</x:script></x:svg>'],
    'xhtml com prefixo dentro da nota' => ['nota.xml', '<?xml version="1.0"?><nota><h:script xmlns:h="http://www.w3.org/1999/xhtml">alert(1)</h:script></nota>'],
    'folha de estilo' => ['nota.xml', '<?xml version="1.0"?><?xml-stylesheet type="text/xsl" href="data:text/xml,x"?><nota/>'],
    'xhtml em utf-16' => ['nota.xml', "\xFF\xFE".mb_convert_encoding('<?xml version="1.0" encoding="UTF-16"?><html xmlns="http://www.w3.org/1999/xhtml"><script>alert(1)</script></html>', 'UTF-16LE', 'UTF-8')],
]);

it('deve ler o XML pela estrutura: cada forma de conteúdo ativo é recusada', function (string $xml) {
    // ARRANGE + ACT + ASSERT — direto no verificador: cada ramo tem a sua prova (CR-R2-02)
    expect(XmlDeNota::inerte($xml))->toBeFalse();
})->with([
    'elemento em namespace ativo, com prefixo' => ['<?xml version="1.0"?><nota><m:mi xmlns:m="http://www.w3.org/1998/Math/MathML">x</m:mi></nota>'],
    'elemento com nome ativo, sem namespace' => ['<?xml version="1.0"?><nota><iframe>x</iframe></nota>'],
    'manipulador de evento' => ['<?xml version="1.0"?><nota><item onload="x">1</item></nota>'],
    'atributo do xlink' => ['<?xml version="1.0"?><nota xmlns:xl="http://www.w3.org/1999/xlink"><item xl:href="javascript:alert(1)">1</item></nota>'],
    'instrução de processamento' => ['<?xml version="1.0"?><nota><?php echo 1; ?></nota>'],
    // CR-R3-02: exemplos que SÓ a guarda recusa — a libxml para no nulo e não vê o script depois
    'nulo depois da raiz' => ["<?xml version=\"1.0\"?><nota/>\0<h:script xmlns:h=\"http://www.w3.org/1999/xhtml\">1</h:script>"],
    // só UTF-8: a nota inerte em UTF-16 também sai (a política, não só o conteúdo)
    'nota inerte em utf-16' => ["\xFF\xFE".mb_convert_encoding('<?xml version="1.0" encoding="UTF-16"?><nota/>', 'UTF-16LE', 'UTF-8')],
    'outra codificação declarada' => ['<?xml version="1.0" encoding="Shift_JIS"?><nota/>'],
    // EBCDIC: a declaração não é ASCII, e só a checagem de UTF-8 o recusa — a libxml o leria
    'ebcdic inerte' => [iconv('UTF-8', 'IBM037', '<?xml version="1.0" encoding="IBM037"?><nota/>')],
    'latino declarado com xhtml' => [iconv('UTF-8', 'ISO-8859-1', '<?xml version="1.0" encoding="ISO-8859-1"?><nota><h:b xmlns:h="http://www.w3.org/1999/xhtml">ação</h:b></nota>')],
    'doctype com entidade externa' => ['<?xml version="1.0"?><!DOCTYPE nota [<!ENTITY x SYSTEM "file:///etc/hostname">]><nota>&x;</nota>'],
    'mal formado' => ['<?xml version="1.0"?><nota>'],
    'ativo num irmão depois' => ['<?xml version="1.0"?><nota><item>1</item><h:i xmlns:h="http://www.w3.org/1999/xhtml">x</h:i></nota>'],
    'instrução depois da raiz' => ['<?xml version="1.0"?><nota/><?x y?>'],
    // CR-R3-01: o custo da libxml é conferido ANTES de ela ler
    'tag com atributos demais' => ['<?xml version="1.0"?><nota '.atributosFicticios(XmlDeNota::TETO_DE_ATRIBUTOS + 1).'/>'],
    'atributos demais escondidos atrás de um apóstrofo de comentário' => ["<?xml version=\"1.0\"?><!-- ' --><nota ".atributosFicticios(XmlDeNota::TETO_DE_ATRIBUTOS + 1)."/><!-- ' -->"],
    'mais de 1 MB' => ['<?xml version="1.0"?><nota>'.str_repeat('a', XmlDeNota::TETO_BYTES).'</nota>'],
]);

it('deve aceitar a nota cujo TEXTO lembra marcação ou evento', function (string $xml) {
    // ARRANGE + ACT + ASSERT — texto dentro da nota é livre (a regex recusava `online="sim"`)
    expect(XmlDeNota::inerte($xml))->toBeTrue();
})->with([
    'nfs-e com online= na discriminação' => ['<?xml version="1.0"?><CompNfse><Discriminacao>Pagamento fictício online="sim"</Discriminacao></CompNfse>'],
    'nfs-e abrasf' => ['<?xml version="1.0" encoding="utf-8"?><CompNfse xmlns="http://www.abrasf.org.br/nfse.xsd"><Nfse versao="2.02"><InfNfse Id="nfse1"><Discriminacao>Sessão fictícia &lt;script&gt;</Discriminacao></InfNfse></Nfse></CompNfse>'],
    'nf-e assinada' => ['<?xml version="1.0" encoding="UTF-8"?><nfeProc versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe1" versao="4.00"/><Signature xmlns="http://www.w3.org/2000/09/xmldsig#"><SignedInfo><Reference URI="#NFe1"><DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"/></Reference></SignedInfo></Signature></NFe></nfeProc>'],
    'com bom do utf-8' => ["\xEF\xBB\xBF<?xml version=\"1.0\" encoding=\"UTF-8\"?><nota/>"],
    // CR-R3-03: layout municipal antigo, em Latin-1 declarado, com acento
    'nfs-e em iso-8859-1' => [iconv('UTF-8', 'ISO-8859-1', '<?xml version="1.0" encoding="ISO-8859-1"?><CompNfse><Discriminacao>Sessão de fonoaudiologia fictícia</Discriminacao></CompNfse>')],
    'no teto de atributos' => ['<?xml version="1.0"?><nota '.atributosFicticios(XmlDeNota::TETO_DE_ATRIBUTOS).'/>'],
]);

it('deve baixar com a extensão do tipo detectado, qualquer que seja o nome enviado', function (string $enviado, string $esperado) {
    // ARRANGE — SEC-FIN-03: `recibo".html` ou `nota.svg` sairiam com a extensão que abre página
    $this->actingAs(admin());
    $lancamento = lancamentoComAnexo();

    // ACT
    $resposta = $this->post("/api/lancamentos/{$lancamento->id}/anexos", [
        'arquivo' => UploadedFile::fake()->createWithContent($enviado, "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF"),
    ]);

    // ASSERT
    $resposta->assertCreated()->assertJsonPath('nome', $esperado);
})->with([
    'extensão ativa' => ['recibo".html', 'recibo.pdf'],
    'extensão de outro tipo' => ['nota.svg', 'nota.pdf'],
    'sem extensão' => ['comprovante', 'comprovante.pdf'],
    'maiúscula' => ['EXTRATO.PDF', 'EXTRATO.pdf'],
    'abreviação com ponto' => ['Recibo Dr. Fulano Fictício', 'Recibo Dr. Fulano Fictício.pdf'],
    'data com pontos' => ['Extrato 25.09.2026', 'Extrato 25.09.2026.pdf'],
    'só a extensão' => ['.pdf', 'anexo.pdf'],
    'extensão de cinco letras' => ['Recibo.pages', 'Recibo.pdf'],
    'sufixo de seis letras não é extensão' => ['copia.backup', 'copia.backup.pdf'],
]);

it('deve aceitar a nota fiscal eletrônica de verdade', function () {
    // ARRANGE — a regra do conteúdo ativo não pode barrar a NF-e com namespace e atributos
    $this->actingAs(admin());
    $lancamento = lancamentoComAnexo();
    $nfe = '<?xml version="1.0" encoding="UTF-8"?><nfeProc versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe">'
        .'<NFe><infNFe Id="NFe00000000000000000000000000000000000000000000" versao="4.00"><infAdic><infCpl>Condomínio fictício; ontem pago.</infCpl></infAdic></infNFe></NFe></nfeProc>';

    // ACT + ASSERT
    $this->post("/api/lancamentos/{$lancamento->id}/anexos", [
        'arquivo' => UploadedFile::fake()->createWithContent('nfe.xml', $nfe),
    ])->assertCreated()->assertJsonPath('nome', 'nfe.xml');
});

it('deve recusar o XML acima de 1 MB dizendo o porquê', function () {
    // ARRANGE — CR-R3-01: a nota tem poucos KB; acima do teto nem se lê o conteúdo
    $this->actingAs(admin());
    $lancamento = lancamentoComAnexo();
    $grande = '<?xml version="1.0" encoding="UTF-8"?><nfeProc>'.str_repeat('a', XmlDeNota::TETO_BYTES).'</nfeProc>';

    // ACT
    $resposta = $this->post("/api/lancamentos/{$lancamento->id}/anexos", [
        'arquivo' => UploadedFile::fake()->createWithContent('nfe-grande.xml', $grande),
    ]);

    // ASSERT
    $resposta->assertUnprocessable()
        ->assertJsonPath('errors.arquivo.0', 'O XML passa de 1 MB, e a nota fiscal eletrônica tem poucos KB. Confira se é o arquivo certo, ou envie o PDF da nota.');
    expect(Storage::disk('local')->allFiles())->toBe([]);
});

it('deve aceitar o XML da nota fiscal', function () {
    // ARRANGE
    $this->actingAs(admin());
    $lancamento = lancamentoComAnexo();
    $xml = UploadedFile::fake()->createWithContent('nfe-ficticia.xml', '<?xml version="1.0" encoding="UTF-8"?><nfeProc><NFe/></nfeProc>');

    // ACT + ASSERT
    $this->post("/api/lancamentos/{$lancamento->id}/anexos", ['arquivo' => $xml])->assertCreated();
});

it('deve baixar como anexo, decifrado, e registrar a consulta', function () {
    // ARRANGE
    $this->actingAs(admin());
    $lancamento = lancamentoComAnexo();
    $id = $this->post("/api/lancamentos/{$lancamento->id}/anexos", ['arquivo' => comprovanteEmPdf()])->json('id');

    // ACT
    $resposta = $this->get("/api/lancamentos/anexos/{$id}/download");

    // ASSERT
    $resposta->assertOk();
    expect($resposta->headers->get('Content-Disposition'))->toStartWith('attachment')
        ->and($resposta->getContent())->toStartWith('%PDF')
        ->and(Auditoria::where('entidade', 'lancamento_anexos')->where('acao', 'consultou')->count())->toBe(1);
});

it('deve exigir lancamentos.ver para baixar e lancamentos.editar para anexar', function () {
    // ARRANGE
    $admin = admin();
    $semVer = usuarioCom(['pacientes.ver'], 'Sem lançamentos');
    $soVe = usuarioCom(['lancamentos.ver'], 'Só vê lançamentos');
    $this->actingAs($admin);
    $lancamento = lancamentoComAnexo();
    $id = $this->post("/api/lancamentos/{$lancamento->id}/anexos", ['arquivo' => comprovanteEmPdf()])->json('id');
    trocarDeUsuario();

    // ACT + ASSERT
    $this->actingAs($semVer)->get("/api/lancamentos/anexos/{$id}/download")->assertForbidden();
    trocarDeUsuario();
    $this->actingAs($soVe)->post("/api/lancamentos/{$lancamento->id}/anexos", ['arquivo' => comprovanteEmPdf()])->assertForbidden();
    $this->actingAs($soVe)->deleteJson("/api/lancamentos/anexos/{$id}")->assertForbidden();
});

it('deve excluir logicamente, mantendo o arquivo', function () {
    // ARRANGE
    $this->actingAs(admin());
    $lancamento = lancamentoComAnexo();
    $id = $this->post("/api/lancamentos/{$lancamento->id}/anexos", ['arquivo' => comprovanteEmPdf()])->json('id');
    $caminho = LancamentoAnexo::findOrFail($id)->caminho;

    // ACT
    $this->deleteJson("/api/lancamentos/anexos/{$id}")->assertNoContent();

    // ASSERT
    expect($this->getJson("/api/lancamentos/{$lancamento->id}/anexos")->json())->toBe([])
        ->and(Storage::disk('local')->exists($caminho))->toBeTrue();
    $this->get("/api/lancamentos/anexos/{$id}/download")->assertNotFound();
});

it('deve recusar excluir o lançamento que tem anexo ativo', function () {
    // ARRANGE
    $this->actingAs(admin());
    $lancamento = lancamentoComAnexo();
    $this->post("/api/lancamentos/{$lancamento->id}/anexos", ['arquivo' => comprovanteEmPdf()])->assertCreated();

    // ACT
    $resposta = $this->deleteJson("/api/lancamentos/{$lancamento->id}");

    // ASSERT
    $resposta->assertUnprocessable()->assertJsonValidationErrors('lancamento');
    expect(LancamentoCaixa::find($lancamento->id))->not->toBeNull();
});

it('deve excluir o lançamento cujos anexos já foram excluídos, levando os arquivos', function () {
    // ARRANGE — sem isto, a FK `restrict` seguraria o lançamento em aberto para sempre
    $this->actingAs(admin());
    $lancamento = lancamentoComAnexo();
    $id = $this->post("/api/lancamentos/{$lancamento->id}/anexos", ['arquivo' => comprovanteEmPdf()])->json('id');
    $caminho = LancamentoAnexo::findOrFail($id)->caminho;
    $this->deleteJson("/api/lancamentos/anexos/{$id}")->assertNoContent();

    // ACT
    $resposta = $this->deleteJson("/api/lancamentos/{$lancamento->id}");

    // ASSERT
    $resposta->assertNoContent();
    expect(LancamentoCaixa::find($lancamento->id))->toBeNull()
        ->and(LancamentoAnexo::withTrashed()->count())->toBe(0)
        ->and(Storage::disk('local')->exists($caminho))->toBeFalse();
    // a trilha do anexo: a exclusão da pessoa e a purga — nenhum "excluiu" a mais do forceDelete (CR-R2-07)
    $trilha = Auditoria::where('entidade', 'lancamento_anexos')->where('entidade_id', $id)->pluck('acao')->sort()->values()->all();
    expect($trilha)->toBe(['criou', 'excluiu', 'purgou']);
});

it('deve marcar na lista os lançamentos com anexo', function () {
    // ARRANGE
    $this->actingAs(admin());
    $comAnexo = lancamentoComAnexo();
    $semAnexo = lancamentoComAnexo();
    $this->post("/api/lancamentos/{$comAnexo->id}/anexos", ['arquivo' => comprovanteEmPdf()])->assertCreated();

    // ACT
    $linhas = collect($this->getJson('/api/lancamentos')->json('data'))->keyBy('id');

    // ASSERT
    expect($linhas[$comAnexo->id]['tem_anexo'])->toBeTrue()
        ->and($linhas[$semAnexo->id]['tem_anexo'])->toBeFalse();
});

it('não deve registrar o nome do arquivo nem o caminho na trilha', function () {
    // ARRANGE — o nome é texto livre ("recibo-joao-da-silva.pdf")
    $this->actingAs(admin());
    $lancamento = lancamentoComAnexo();

    // ACT
    $this->post("/api/lancamentos/{$lancamento->id}/anexos", ['arquivo' => comprovanteEmPdf()])->assertCreated();

    // ASSERT
    // pelo helper da casa (CR-API2-01): o `json_encode` cru vira `/` em `\/`, e a guarda do
    // caminho nunca falhava
    $registro = Auditoria::where('entidade', 'lancamento_anexos')->where('acao', 'criou')->firstOrFail();
    semVazamento($registro->diff_json, 'comprovante-ficticio');
    semVazamento($registro->diff_json, LancamentoAnexo::firstOrFail()->caminho);
});

it('deve contar os anexos excluídos no teto do lançamento', function () {
    // ARRANGE — SEC-FIN-05: a exclusão é lógica e o arquivo fica; enviar e excluir em laço
    // enchia o disco com zero anexos ativos
    $this->actingAs(admin());
    $lancamento = lancamentoComAnexo();
    foreach (range(1, 20) as $_) {
        $id = $this->post("/api/lancamentos/{$lancamento->id}/anexos", ['arquivo' => comprovanteEmPdf()])->assertCreated()->json('id');
        $this->deleteJson("/api/lancamentos/anexos/{$id}")->assertNoContent();
    }

    // ACT
    $resposta = $this->post("/api/lancamentos/{$lancamento->id}/anexos", ['arquivo' => comprovanteEmPdf()]);

    // ASSERT
    // a lista pode estar vazia: a razão tem de dizer que os excluídos contam
    $resposta->assertUnprocessable()->assertJsonPath('errors.arquivo.0', 'Este lançamento atingiu o limite de 20 anexos — os excluídos também contam.');
});

// ==================== o ciclo de vida do arquivo (CR-API2-02) ====================

it('não deve deixar arquivo órfão quando a gravação do anexo falha', function () {
    // ARRANGE — a trilha falha DEPOIS do INSERT (o `created` é onde o Auditavel grava): sem a
    // transação, a linha ficaria (CR-R2-01 — o `creating` falhava antes do INSERT e não provava nada)
    $this->actingAs(admin());
    $lancamento = lancamentoComAnexo();
    LancamentoAnexo::created(fn () => throw new RuntimeException('trilha fictícia falhou'));

    // ACT
    $resposta = $this->post("/api/lancamentos/{$lancamento->id}/anexos", ['arquivo' => comprovanteEmPdf()]);

    // ASSERT
    $resposta->assertServerError();
    expect(LancamentoAnexo::withTrashed()->count())->toBe(0)
        ->and(Storage::disk('local')->allFiles())->toBe([]);
});

it('deve manter o arquivo quando a exclusão do lançamento é desfeita', function () {
    // ARRANGE — o anexo já excluído seria purgado, mas a exclusão do lançamento falha depois:
    // o arquivo só pode sair DEPOIS do commit
    $this->actingAs(admin());
    $lancamento = lancamentoComAnexo();
    $id = $this->post("/api/lancamentos/{$lancamento->id}/anexos", ['arquivo' => comprovanteEmPdf()])->json('id');
    $caminho = LancamentoAnexo::findOrFail($id)->caminho;
    $this->deleteJson("/api/lancamentos/anexos/{$id}")->assertNoContent();
    LancamentoCaixa::deleting(fn () => throw new RuntimeException('falha fictícia na exclusão'));

    // ACT
    $resposta = $this->deleteJson("/api/lancamentos/{$lancamento->id}");

    // ASSERT
    $resposta->assertServerError();
    expect(Storage::disk('local')->exists($caminho))->toBeTrue()
        ->and(LancamentoAnexo::withTrashed()->count())->toBe(1);
});

it('deve recusar a exclusão do grupo com anexo ativo, e purgar o anexo já excluído', function () {
    // ARRANGE — o caminho "aplicar no grupo" passa pela mesma régua dos anexos
    $this->actingAs(admin());
    $modelo = lancamentoComAnexo();
    $criadas = $this->postJson('/api/lancamentos', [
        'tipo' => 'despesa', 'competencia' => '2026-09-01', 'vencimento' => '2026-09-10', 'valor' => '600.00',
        'categoria_id' => $modelo->categoria_id, 'tipo_pagamento_id' => $modelo->tipo_pagamento_id,
        'conta_id' => $modelo->conta_id, 'parcelas' => 2,
    ])->assertCreated()->json('lancamentos');
    $segunda = $criadas[1]['id'];
    $anexoId = $this->post("/api/lancamentos/{$segunda}/anexos", ['arquivo' => comprovanteEmPdf()])->json('id');
    $caminho = LancamentoAnexo::findOrFail($anexoId)->caminho;

    // ACT + ASSERT — com o anexo ativo, 422 e nada sai
    $this->deleteJson("/api/lancamentos/{$criadas[0]['id']}", ['aplicar_no_grupo' => true])
        ->assertUnprocessable()->assertJsonValidationErrors('lancamento');
    expect(LancamentoCaixa::whereIn('id', array_column($criadas, 'id'))->count())->toBe(2);

    // ACT + ASSERT — com o anexo excluído, o grupo sai e o arquivo é purgado, registrado como `purgou`
    $this->deleteJson("/api/lancamentos/anexos/{$anexoId}")->assertNoContent();
    $this->deleteJson("/api/lancamentos/{$criadas[0]['id']}", ['aplicar_no_grupo' => true])->assertNoContent();
    expect(LancamentoCaixa::whereIn('id', array_column($criadas, 'id'))->count())->toBe(0)
        ->and(Storage::disk('local')->exists($caminho))->toBeFalse()
        ->and(Auditoria::where('entidade', 'lancamento_anexos')->where('acao', 'purgou')->count())->toBe(1);
});

it('não deve marcar "com anexo" o lançamento cujo anexo foi excluído', function () {
    // ARRANGE
    $this->actingAs(admin());
    $lancamento = lancamentoComAnexo();
    $id = $this->post("/api/lancamentos/{$lancamento->id}/anexos", ['arquivo' => comprovanteEmPdf()])->json('id');
    $this->deleteJson("/api/lancamentos/anexos/{$id}")->assertNoContent();

    // ACT
    $linha = collect($this->getJson('/api/lancamentos')->json('data'))->firstWhere('id', $lancamento->id);

    // ASSERT
    expect($linha['tem_anexo'])->toBeFalse();
});
