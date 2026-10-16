<?php

namespace App\Models;

use App\Support\Auditoria\Auditavel;
use Database\Factories\TermoConsentimentoFactory;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

/**
 * Uma VERSÃO do termo de consentimento da clínica (FA-08).
 *
 * `versao` é do SERVIDOR (a próxima da clínica) e `vigente` é estado do catálogo,
 * mantido por transação com lock na publicação. A leitura do vigente NUNCA depende
 * de "só existir uma": desempata pela maior versão, para que uma corrida jamais
 * ponha duas réguas em uso ao mesmo tempo.
 */
class TermoConsentimento extends Model
{
    /** @use HasFactory<TermoConsentimentoFactory> */
    use Auditavel, HasFactory;

    protected $table = 'termos_consentimento';

    /** `versao` e `vigente` ficam fora: quem os define é o controller, na transação. */
    protected $fillable = ['titulo', 'texto'];

    protected function casts(): array
    {
        return [
            'versao' => 'integer',
            'vigente' => 'boolean',
        ];
    }

    /** @param  Builder<TermoConsentimento>  $consulta */
    public function scopeVigente(Builder $consulta): void
    {
        $consulta->where('vigente', true)->orderByDesc('versao');
    }

    /** A versão que está valendo, ou `null` quando a clínica ainda não publicou. */
    public static function emVigor(): ?self
    {
        return static::query()->vigente()->first();
    }

    /**
     * Existe aceite preso a esta versão?
     *
     * É o que trava o texto (editar sob um aceite é falsificar prova) e o que impede
     * a exclusão. A prova vive no JSON do paciente (design D4): `JSON_CONTAINS` casa
     * o candidato-objeto contra qualquer elemento do array.
     *
     * `JSON_CONTAINS` casa por TIPO — `'{"termo_id":"5"}'` contra `[{"termo_id":5}]` é **0**
     * nesta MariaDB —, e um guarda de prova jamais pode falhar ABERTO. O `(int)` explicita
     * essa dependência; ele é REDUNDANTE, não uma correção: o Eloquent já mescla
     * `id => int` nos casts da chave primária incremental (verificado: `getCasts()` devolve
     * `{"id":"int",…}`), então `$this->id` não chega como string por este caminho. Fica como
     * registro da dependência (levantada no parecer SEC-TR-07), sem teste próprio — teste
     * que não consegue ficar vermelho é proxy.
     */
    public function temAceite(): bool
    {
        return Paciente::query()
            ->whereJsonContains('consentimentos_json', ['termo_id' => (int) $this->id])
            ->exists();
    }

    /** Quantos aceites esta versão acumulou — CONTAGEM, jamais a lista de quem (design D8). */
    public function aceitesTotal(): int
    {
        return Paciente::query()
            ->whereJsonContains('consentimentos_json', ['termo_id' => (int) $this->id])
            ->count();
    }
}
