<?php

use Tests\Arquitetura\Fontes;

/**
 * GUARDA DE IDIOMA — **quem escreve em `configuracoes` é uma lista fechada**.
 *
 * `ConfiguracaoService::set()` grava a chave sem passar por `MutacoesDeAcesso::aplicarConfiguracao`,
 * que é onde moram o maker-checker (`seguranca.aprovacao_dupla`) e as pré-condições ancoradas. Hoje
 * isso não é brecha: as chaves gravadas por fora não têm pré-condição nenhuma, e toda escrita
 * continua auditada.
 *
 * O risco é o DIA SEGUINTE (achado SEC-M2 do gate de 2026-08-28): no momento em que uma chave
 * gravada por fora ganhar pré-condição, o desvio passa a ser silencioso — sem erro, sem log, com a
 * suíte verde. Esta guarda faz o chamador novo aparecer no diff e virar decisão.
 *
 * Mesmo mecanismo (e mesma razão) do `PortaoDoPacienteTest`: varredura de TEXTO, sem framework e
 * sem banco.
 */
it('deve manter fechada a lista de quem escreve em configuracoes', function () {
    // ARRANGE — os três chamadores legítimos, cada um com o porquê:
    //   Rbac/MutacoesDeAcesso            → a porta oficial (valida, aplica pré-condição, aprova)
    //   StatusAgendamentoController      → zera o alvo quando o status apontado é excluído
    //   ClinicaLogoController            → enviar a logo aplica a identidade (mesma transação)
    $permitidos = [
        'Support/Rbac/MutacoesDeAcesso.php',
        'Http/Controllers/StatusAgendamentoController.php',
        'Http/Controllers/ClinicaLogoController.php',
        'Support/Configuracoes/ConfiguracaoService.php', // o próprio serviço
    ];

    // ACT — qualquer forma de chamar o `set()` do serviço
    $infratores = collect(Fontes::doApp($permitidos))
        ->filter(fn (string $fonte) => str_contains($fonte, 'ConfiguracaoService')
            && preg_match('/->\s*set\(\s*[\'"]/', $fonte) === 1)
        ->keys()->all();

    // ASSERT
    expect($infratores)->toBe([]);
});
