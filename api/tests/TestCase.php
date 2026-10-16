<?php

namespace Tests;

use App\Models\Clinica;
use Carbon\Carbon;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Foundation\Testing\TestCase as BaseTestCase;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;

abstract class TestCase extends BaseTestCase
{
    /**
     * Toda request de teste se comporta como a SPA (origem stateful do Sanctum):
     * o EnsureFrontendRequestsAreStateful só aplica sessão/cookies quando o
     * Referer/Origin é um domínio stateful — exatamente o fluxo real do produto.
     */
    protected $defaultHeaders = [
        'Referer' => 'http://localhost:5173',
    ];

    /**
     * Todo teste com banco nasce com A CLÍNICA (a linha única de `clinica`) — e, com ela, os
     * defaults que o `ClinicaObserver` semeia (nível Administrador, status de agendamento,
     * catálogo do caixa). Roda depois do `RefreshDatabase` abrir a transação do teste, então a
     * linha some no rollback como qualquer outro dado do teste.
     *
     * @return array<class-string, class-string>
     */
    protected function setUpTraits()
    {
        $uses = parent::setUpTraits();

        if (isset($uses[RefreshDatabase::class])) {
            $this->prepararClinica();
        }

        return $uses;
    }

    /** Cria a clínica do teste. Use `Clinica::atual()` (ou `clinica()`) para lê-la. */
    protected function prepararClinica(): void
    {
        Clinica::factory()->create();
    }

    /**
     * `putJson` com a concorrência otimista do produto (EX-05): resolve o
     * `updated_at` ATUAL do registro-alvo direto no banco (fresco a cada
     * chamada — o segundo PUT do mesmo teste ganha o token novo) e o envia no
     * `If-Match`, como a SPA faz. Helper ÚNICO — nenhum teste monta o header à
     * mão (task 2.8 da change `concorrencia-otimista`).
     *
     * URL sem id reconhecível (ex.: `/api/configuracoes`, exceção classificada)
     * segue sem header — e é isso que o teste dela espera.
     *
     * @param  array<string, mixed>  $data
     * @param  array<string, string>  $headers
     */
    public function putJsonComVersao(string $uri, array $data = [], array $headers = []): TestResponse
    {
        return $this->putJson($uri, $data, [...$this->versaoDoRegistro($uri), ...$headers]);
    }

    /** @return array<string, string> */
    private function versaoDoRegistro(string $uri): array
    {
        if (preg_match('#/api/convenios/\d+/servicos/(\d+)#', $uri, $m) === 1) {
            [$tabela, $id] = ['servicos', (int) $m[1]];
        } elseif (preg_match('#/api/convenios/\d+/regras/(\d+)#', $uri, $m) === 1) {
            [$tabela, $id] = ['regras_limite_convenio', (int) $m[1]];
        } elseif (preg_match('#/api/([a-z-]+)/(\d+)#', $uri, $m) === 1) {
            $tabela = match ($m[1]) {
                'anamnese-modelos' => 'anamnese_modelos',
                'status-agendamento' => 'status_agendamento',
                'lista-espera' => 'lista_espera',
                'tipos-pagamento' => 'tipos_pagamento',
                'lancamentos' => 'lancamentos_caixa',
                'niveis-permissao' => 'roles', // NivelPermissao estende o Role do Spatie
                default => str_replace('-', '_', $m[1]),
            };
            $id = (int) $m[2];
        } else {
            return [];
        }

        try {
            $registro = DB::table($tabela)->where('id', $id)->first(['updated_at']);
        } catch (QueryException) {
            // URL que não corresponde a uma tabela versionável (ex.: a prova de
            // imutabilidade da trilha faz PUT em /api/auditoria/{id}, tabela
            // append-only SEM updated_at — a rota nem existe; o 404/405 é o assert)
            return [];
        }
        if ($registro === null || $registro->updated_at === null) {
            return [];
        }

        return ['If-Match' => Carbon::parse($registro->updated_at)->toISOString()];
    }
}
