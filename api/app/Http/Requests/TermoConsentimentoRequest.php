<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * O boundary do TERMO (FA-08). Quem numera a versão é o SERVIDOR — a próxima da
 * clínica —, pelo mesmo motivo que carimba o instante do aceite: a régua da prova
 * não pode vir de quem está sendo provado. `versao` e `vigente` no payload são
 * recusados (não ignorados: ignorar deixaria o chamador convencido de ter gravado).
 */
class TermoConsentimentoRequest extends FormRequest
{
    /** Teto do texto — regulamento de clínica, não livro (e o campo é longText). */
    private const MAX_TEXTO = 50000;

    public function authorize(): bool
    {
        return true; // autorização é do middleware permission: das rotas
    }

    public function rules(): array
    {
        return [
            'titulo' => ['required', 'string', 'max:160'],
            'texto' => ['required', 'string', 'max:'.self::MAX_TEXTO],
            // `missing`, NUNCA `prohibited` (guarda de idioma `ContratoDeBoundaryTest`):
            // `prohibited` é "ausente OU vazio" e deixa a chave presente-e-NULA passar.
            // Imutabilidade decide por PRESENÇA da chave — quem manda a chave, manda o campo.
            'versao' => ['missing'],
            'vigente' => ['missing'],
        ];
    }

    public function messages(): array
    {
        return [
            'versao.missing' => 'A versão é numerada pelo servidor.',
            'vigente.missing' => 'Publicar uma versão é o que a torna vigente.',
        ];
    }
}
