<?php

namespace App\Rules;

use App\Models\Profissional;
use Closure;
use Illuminate\Contracts\Validation\ValidationRule;

/**
 * Boundary do gatilho PROF-DESLIGADO (docs/GATILHOS.md): `profissional_id` DEVE apontar para
 * um profissional ATIVO, com a única exceção do que JÁ estava vinculado ao registro (vínculo
 * histórico). Regra simétrica "ativo OU já vinculado", validada no SERVIDOR — o `.filter()` do
 * front (`opcoesDeProfissional`) é contornado por um `curl`, uma aba velha ou um cliente antigo
 * (§13 — regra é do servidor, nunca só da tela).
 *
 * Na CRIAÇÃO `$profissionalAtual` é `null` (não há registro anterior a preservar) → só ativo
 * passa. Precede-se de `Rule::exists(...)` com `bail`: id inexistente nem chega aqui.
 *
 * PURO por contrato: sem efeito colateral. O log da tentativa bloqueada sai do
 * `failedValidation()` da Request (trait GuardaProfissionalDesligado), NUNCA daqui — logar num
 * Rule sujaria o teste unitário e dispararia em validações combinadas.
 */
class ProfissionalAtivoOuVinculado implements ValidationRule
{
    /** Motivo estruturado do log de segurança (canal `seguranca`). */
    public const MOTIVO = 'profissional_desligado_nao_vinculado';

    /**
     * Mensagem única — constante compartilhada com o trait, que a usa para distinguir ESTA
     * rejeição (a do desligado) de qualquer outro 422 em `profissional_id` (ex.: `exists`).
     */
    public const MENSAGEM = 'Profissional desligado só permanece vinculado onde já estava; para um novo vínculo, escolha um profissional ativo.';

    public function __construct(private readonly ?int $profissionalAtual = null) {}

    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        // já vinculado ao registro: preserva o histórico mesmo desligado
        if ($this->profissionalAtual !== null && (int) $value === $this->profissionalAtual) {
            return;
        }

        // ausente → deixa o `exists` acusar (não duplica erro)
        $profissional = Profissional::find($value);
        if ($profissional === null || $profissional->ativo) {
            return;
        }

        $fail(self::MENSAGEM);
    }
}
