<?php

use App\Support\Rbac\AncoraDaClinica;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;

/**
 * A âncora da clínica (SEC-SD-01) SÓ serializa se a linha de `clinica` BLOQUEIA de
 * verdade — e só uma segunda conexão responde isso (mesma régua do
 * GuardaClinicaSobLockTest). O cenário que a âncora existe para matar: dois admins
 * rebaixando, cada um, um dos dois últimos admins — com lock por-conjunto-contado
 * (`exceto`), A trava {B} e B trava {A}, conjuntos DISJUNTOS, zero contenção, e as
 * duas commitam para ZERO admins. Com a âncora, o segundo espera o primeiro e a
 * `GuardaUltimoAdmin` enxerga o estado pós-primeiro (422).
 */
function segundaConexaoDaAncora(): string
{
    config(['database.connections.segunda_ancora' => config('database.connections.mysql')]);
    DB::purge('segunda_ancora');

    return 'segunda_ancora';
}

it('deve BLOQUEAR a segunda mutação de acesso enquanto a âncora da clínica está travada', function () {
    // ARRANGE — dados COMMITADOS (esta suíte não roda dentro de transação)
    admin();
    $segunda = segundaConexaoDaAncora();
    DB::connection($segunda)->statement('SET SESSION innodb_lock_wait_timeout = 2');

    // ACT — a conexão A roda uma mutação de acesso pela âncora REAL (a mesma que os
    // boundaries usam) e, enquanto ela segura o lock, a conexão B tenta o mesmo primeiro passo
    $bloqueou = app(AncoraDaClinica::class)->serializado(function () use ($segunda): bool {
        try {
            DB::connection($segunda)
                ->table('clinica')
                ->where('id', clinica()->id)
                ->lockForUpdate()
                ->get();
        } catch (QueryException $excecao) {
            // 1205 = lock wait timeout · 1213 = deadlock — qualquer um PROVA o bloqueio
            return in_array($excecao->errorInfo[1] ?? null, [1205, 1213], true);
        }

        return false;
    });

    // ASSERT — sem este bloqueio, a corrida de 2 admins volta a zerar a administração
    expect($bloqueou)->toBeTrue(
        'A âncora da clínica NÃO bloqueou a segunda conexão. A serialização das mutações '
        .'de acesso (SEC-SD-01) perdeu a base — o TOCTOU do NIVEL-ROOT reabriu.',
    );
});

it('deve LIBERAR a âncora quando a mutação de acesso termina', function () {
    // ARRANGE
    admin();
    $segunda = segundaConexaoDaAncora();
    DB::connection($segunda)->statement('SET SESSION innodb_lock_wait_timeout = 2');

    // ACT — a mutação commita; a âncora não pode ficar presa depois dela
    app(AncoraDaClinica::class)->serializado(fn (): bool => true);

    $livre = true;
    try {
        DB::connection($segunda)->transaction(function () use ($segunda): void {
            DB::connection($segunda)->table('clinica')->where('id', clinica()->id)->lockForUpdate()->get();
        });
    } catch (QueryException) {
        $livre = false;
    }

    // ASSERT
    expect($livre)->toBeTrue('A âncora continuou travada depois do commit da mutação de acesso.');
});
