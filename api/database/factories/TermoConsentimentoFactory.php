<?php

namespace Database\Factories;

use App\Models\TermoConsentimento;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * Dados FICTÍCIOS (LGPD): o texto real do Regulamento pertence à clínica e entra
 * pela tela, no go-live — nunca em código versionado. `versao`/`vigente` são explícitos porque não são fillable.
 *
 * @extends Factory<TermoConsentimento>
 */
class TermoConsentimentoFactory extends Factory
{
    protected $model = TermoConsentimento::class;

    public function definition(): array
    {
        return [
            'titulo' => 'Regulamento de exemplo',
            'versao' => 1,
            'texto' => "Texto de exemplo do contrato terapêutico.\n\nUso apenas em desenvolvimento.",
            'vigente' => true,
        ];
    }

    public function aposentado(): static
    {
        return $this->state(fn (): array => ['vigente' => false]);
    }

    /**
     * `versao` e `vigente` não são fillable de propósito (quem os define é o
     * controller, dentro da transação de publicação) — o construtor os
     * descartaria em silêncio. A fábrica é caminho de TESTE: força o preenchimento
     * aqui, sem afrouxar a proteção do model no caminho de produção.
     *
     * @param  array<string, mixed>  $attributes
     */
    public function newModel(array $attributes = []): TermoConsentimento
    {
        return (new TermoConsentimento)->forceFill($attributes);
    }
}
