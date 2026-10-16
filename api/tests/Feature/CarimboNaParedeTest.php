<?php

use App\Models\Informativo;

/**
 * CARIMBO-UTC-NA-TELA (bugfix 2026-07-27): created_at é UTC do framework e o
 * front renderiza a string crua como PAREDE da clínica (§13, contrato de
 * datas.ts) — a exibição DEVE converter. Este teste fixa o mecanismo no caso
 * mais barato de montar (informativo); os demais pontos (anexos, aprovações,
 * fechamento de ciclo) usam a mesma linha de conversão.
 */
it('deve exibir o publicado_em do informativo na parede da clínica, não em UTC', function () {
    // ARRANGE — created_at cravado em UTC; a parede (America/Sao_Paulo) é -03:00
    $adminDaClinica = admin();
    $this->actingAs($adminDaClinica);
    $informativo = new Informativo([
        'titulo' => 'Aviso fictício da recepção',
        'corpo' => 'Conteúdo fictício.',
        'publicado' => true,
    ]);
    $informativo->criado_por = $adminDaClinica->id;
    $informativo->created_at = '2026-07-27 18:30:00'; // UTC
    $informativo->save();

    // ACT
    $bloco = $this->getJson('/api/notificacoes')->assertOk()->json('informativos');

    // ASSERT — 18:30 UTC é 15:30 na parede; sem a conversão sairia "18:30"
    expect($bloco['itens'][0]['publicado_em'])->toBe('2026-07-27 15:30');
});
