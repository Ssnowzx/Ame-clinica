<?php

namespace App\Http\Requests\Concerns;

use Illuminate\Validation\ValidationException;

/**
 * Lê um id do payload ANTES da validação — que é quando o `authorize()` roda.
 *
 * `(int) $this->input('profissional_id')` era a forma anterior (CR4-09, rodada 4): `(int) ['x']`
 * é 1 e `(int) '2abc'` é 2, então um array ou lixo no campo virava "tentou o profissional 1/2" no
 * canal `seguranca`.
 *
 * A PRIMEIRA versão deste trait devolvia `null` para bool — e abriu o `SEC-VP-53` (re-review da
 * rodada 4): a regra `integer` do Laravel usa `filter_var(FILTER_VALIDATE_INT)`, que coage `true`
 * em `1`; o `authorize()` via `null`, pulava a posse como se o campo estivesse AUSENTE, e o pedido
 * seguia para a validação com `profissional_id = 1` — a coordenadora (plano na agenda, escopada no
 * clínico) criava agendamento e pacote em nome do profissional #1, concedendo-lhe o prontuário da
 * criança. O commit de fechamento pariu o defeito seguinte, pela quinta vez.
 *
 * Por isso a regra agora é uma só: **presente é presente.** O que está no payload é lido com o
 * MESMO parser da validação (`filter_var`), para que `authorize()` e `rules()` enxerguem o mesmo
 * número; e o que está presente mas NÃO é inteiro (array, `false`, lixo) é recusado AQUI, na forma
 * da validação — nunca vira `null` silencioso que a posse deixa passar. `null` só significa que o
 * campo não veio.
 */
trait LeIdDoPayload
{
    protected function idInformado(string $campo): ?int
    {
        $valor = $this->input($campo);

        if ($valor === null) {
            return null;
        }

        $inteiro = is_array($valor) ? false : filter_var($valor, FILTER_VALIDATE_INT);

        if ($inteiro === false) {
            // a mesma mensagem que a regra `integer` daria — sem oráculo: fala do formato, não do
            // registro. Lançada da autorização de propósito: o pedido não chega à validação com um
            // id que a posse não olhou.
            throw ValidationException::withMessages([
                $campo => trans('validation.integer', ['attribute' => trans('validation.attributes.'.$campo)]),
            ]);
        }

        return $inteiro;
    }
}
