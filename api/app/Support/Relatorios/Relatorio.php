<?php

namespace App\Support\Relatorios;

use App\Support\Rbac\Escopo;

/**
 * O CONTRATO de um relatório (change `area-de-relatorios`, D1).
 *
 * Um relatório é UM arquivo: ele declara o que exige (permissões — TODAS, não "uma delas"),
 * de que eixo é o seu dado (para o controller injetar o escopo D11 certo), se sai com o
 * nome da criança (régua AP-09 — declarada AQUI para o teste de contrato varrer, não lembrada
 * numa revisão), que parâmetros aceita além do período, e como se executa.
 *
 * O controller não sabe nada do relatório além deste contrato: 404 se o slug não existe,
 * 403 se falta QUALQUER permissão declarada (antes de validar — autorização antes de
 * validação, memória da casa), 422 pelos `regras()`, e o envelope de volta.
 */
interface Relatorio
{
    public function slug(): string;

    public function titulo(): string;

    /**
     * As permissões exigidas — TODAS (E, não OU). `permission:a|b` do Spatie é OU, e três
     * relatórios exigem E; por isso a decisão mora no controller, não na rota.
     *
     * @return list<string>
     */
    public function permissoes(): array;

    /**
     * O eixo do escopo D11 do dado: `agenda`, `clinico` ou `null` (relatório da clínica —
     * auditoria, caixa — sem eixo por profissional; sai plano por DECLARAÇÃO, não por
     * esquecimento).
     */
    public function eixo(): ?string;

    /**
     * Régua AP-09: relatório de conferência/fechamento sai COM o nome da criança; o puramente
     * numérico sai SEM. `RelatoriosContratoTest` varre o payload contra esta declaração.
     */
    public function expoeNomeDaCrianca(): bool;

    /** `de`/`ate` obrigatórios (teto de 366 dias) quando verdadeiro; o envelope traz `periodo`. */
    public function usaPeriodo(): bool;

    /**
     * Regras de validação Laravel dos parâmetros ALÉM de `de`/`ate` (que o controller já
     * valida quando `usaPeriodo()`). Ids de filtro validam existência.
     *
     * @return array<string, list<mixed>>
     */
    public function regras(): array;

    /**
     * Executa com os parâmetros JÁ validados e o escopo JÁ resolvido pelo eixo.
     *
     * @param  array<string, mixed>  $parametros
     */
    public function executar(array $parametros, Escopo $escopo): Envelope;
}
