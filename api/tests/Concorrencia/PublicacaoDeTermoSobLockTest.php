<?php

use App\Models\TermoConsentimento;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;

/**
 * Publicar uma versão do termo (FA-08) só é seguro se DUAS publicações simultâneas
 * não puderem acontecer — e isso só uma segunda conexão responde.
 *
 * O cenário que a âncora existe para matar: duas abas publicando ao mesmo tempo. Sem
 * serialização, ambas leem `MAX(versao)` e calculam o MESMO número — a primeira grava,
 * a segunda estoura o único `versao` com um 500; e, na primeira publicação
 * da clínica (tabela vazia), não há sequer linha de termo para travar, então um
 * `MAX(versao) FOR UPDATE` não seguraria nada. Por isso o lock é na linha da CLÍNICA.
 *
 * Este teste prova UMA coisa, e só ela: o CAMINHO DE PUBLICAÇÃO tenta mesmo tomar aquela
 * linha em modo EXCLUSIVO. Trocar a âncora por um lock que não trava (ou apagá-la) deixa
 * o teste vermelho — provado por erosão.
 *
 * O que ele **NÃO** discrimina, e por isso não se afirma aqui: a existência da
 * `DB::transaction`. Um `SELECT … FOR UPDATE` em autocommit espera o lock alheio do mesmo
 * jeito, então apagar a transação mantém este teste verde — a atomicidade
 * numerar→aposentar→gravar é coberta pelos testes de RESULTADO na suíte Feature
 * (`TermosConsentimentoTest`), não aqui. (Achado CR-5 do gate: a redação anterior
 * prometia essa discriminação e não a tinha.)
 */
function segundaConexaoDoTermo(): string
{
    config(['database.connections.segunda_termo' => config('database.connections.mysql')]);
    DB::purge('segunda_termo');

    return 'segunda_termo';
}

it('deve BLOQUEAR a publicação enquanto outra segura a âncora da clínica', function () {
    // ARRANGE — dados COMMITADOS (esta suíte não roda dentro de transação)
    $adminDaClinica = admin();
    $segunda = segundaConexaoDoTermo();

    // A segunda conexão segura a linha da clínica em modo COMPARTILHADO — e é isso que
    // torna este teste uma prova, e não uma encenação.
    //
    // Em modo compartilhado a diferença aparece: S com S convive (duas publicações sem
    // âncora NÃO se serializariam, que é exatamente o defeito), e só quem pede X — o
    // `lockForUpdate` da publicação — espera.
    DB::connection($segunda)->beginTransaction();
    DB::connection($segunda)->table('clinica')
        ->where('id', clinica()->id)->sharedLock()->get();

    // sem teto, a publicação esperaria os 50s default do InnoDB e o teste "travaria"
    DB::statement('SET SESSION innodb_lock_wait_timeout = 2');

    // ACT — a publicação de verdade, pela rota, com o handler desligado para o erro subir
    $bloqueou = false;
    try {
        $this->withoutExceptionHandling()
            ->actingAs($adminDaClinica)
            ->postJson('/api/termos-consentimento', [
                'titulo' => 'Regulamento dos Atendimentos',
                'texto' => 'Texto fictício da versão.',
            ]);
    } catch (QueryException $excecao) {
        // 1205 = lock wait timeout · 1213 = deadlock — qualquer um PROVA o bloqueio
        $bloqueou = in_array($excecao->errorInfo[1] ?? null, [1205, 1213], true);
    }

    DB::connection($segunda)->rollBack();

    // ASSERT — bloqueou. (A contagem zero abaixo NÃO prova rollback: a exceção estoura na
    // PRIMEIRA instrução da transação, antes de qualquer escrita — ela só confirma que a
    // publicação não deixou versão órfã pelo caminho.)
    expect($bloqueou)->toBeTrue(
        'A publicação do termo NÃO esperou a âncora da clínica. Sem essa serialização, '
        .'duas abas publicam a MESMA versão — e a clínica termina com duas réguas vigentes.',
    );
    expect(TermoConsentimento::query()->count())->toBe(0);
});

it('deve BLOQUEAR a correção da versão enquanto um ACEITE está sendo gravado', function () {
    // ARRANGE — o TOCTOU que o gate achou (SEC-TR-01/CR-1): `temAceite()` lia e o
    // `update()` escrevia fora de qualquer serialização. A administradora corrige uma
    // versão recém-publicada no mesmo instante em que a recepção registra o PRIMEIRO
    // aceite dela: as duas passam, e a família fica com um aceite apontando para um
    // texto que mudou DEPOIS da assinatura.
    //
    // As duas pontas passaram a tomar a MESMA âncora da clínica. Aqui a segunda conexão
    // faz o papel do registro de aceite em curso (âncora tomada, transação aberta), e a
    // correção precisa ESPERAR.
    $adminDaClinica = admin();
    $termo = $this->actingAs($adminDaClinica)->postJson('/api/termos-consentimento', [
        'titulo' => 'Regulamento dos Atendimentos', 'texto' => 'Texto original.',
    ])->assertCreated()->json();
    $segunda = segundaConexaoDoTermo();

    DB::connection($segunda)->beginTransaction();
    DB::connection($segunda)->table('clinica')
        ->where('id', clinica()->id)->lockForUpdate()->get();

    DB::statement('SET SESSION innodb_lock_wait_timeout = 2');

    // ACT — a correção, pela rota
    $bloqueou = false;
    try {
        $this->withoutExceptionHandling()
            ->withHeader('If-Match', TermoConsentimento::find($termo['id'])->updated_at->toJSON())
            ->putJson("/api/termos-consentimento/{$termo['id']}", [
                'titulo' => 'Regulamento dos Atendimentos', 'texto' => 'Texto reescrito.',
            ]);
    } catch (QueryException $excecao) {
        $bloqueou = in_array($excecao->errorInfo[1] ?? null, [1205, 1213], true);
    }

    DB::connection($segunda)->rollBack();

    // ASSERT — esperou, e o texto não mudou por baixo
    expect($bloqueou)->toBeTrue(
        'A correção da versão NÃO esperou a âncora. Sem isso, a checagem de aceite volta a '
        .'ser check-then-act e o texto pode ser reescrito DEPOIS de assinado.',
    );
    expect(TermoConsentimento::find($termo['id'])->texto)->toBe('Texto original.');
});
