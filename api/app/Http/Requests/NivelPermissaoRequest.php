<?php

namespace App\Http\Requests;

use App\Models\NivelPermissao;
use App\Support\Rbac\PermissaoCatalogo;
use App\Support\Rbac\SemEscalada;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class NivelPermissaoRequest extends FormRequest
{
    public function authorize(): bool
    {
        // o módulo é do middleware `permission:` das rotas; aqui, a régua do acesso em jogo (change
        // `trava-de-usuarios-e-niveis`): as permissões propostas e, na edição, as que o nível tem hoje.
        // O nível inexistente não é achado e segue para o 404 do controller
        $id = $this->route('id');
        app(SemEscalada::class)->assegurarNivel(
            $this->user(),
            SemEscalada::propostas($this->input('permissoes')),
            $id === null ? null : NivelPermissao::find((int) $id),
        );

        return true;
    }

    public function rules(): array
    {
        $id = $this->route('id');

        return self::regras($id === null ? null : (int) $id);
    }

    /**
     * As regras como FONTE ÚNICA (SEC-SD-03a): a APROVAÇÃO de uma pendência de
     * edição de nível re-executa exatamente esta validação sobre o payload
     * armazenado (entrada não-confiável) — duplicar as regras divergiria.
     *
     * @return array<string, list<mixed>>
     */
    public static function regras(?int $idIgnorado): array
    {
        return [
            'nome' => [
                'required', 'string', 'max:255',
                // nome duplicado seria 500 (unique do Spatie) sem esta regra
                Rule::unique('roles', 'name')
                    ->where('guard_name', 'web')
                    ->ignore($idIgnorado),
            ],
            'permissoes' => ['present', 'array'],
            // só permissões do catálogo global — nunca criação via API (T-rbac-04). Pela lista EXATA do
            // código, não pelo banco: o `exists` do MariaDB não diferencia maiúsculas, e
            // `FLUXO_CAIXA.VER` passava aqui e estourava 500 no Spatie (gate r1, SEC-TRV-04/CR-TRV-08)
            'permissoes.*' => ['string', Rule::in(PermissaoCatalogo::PERMISSOES)],
        ];
    }

    public function messages(): array
    {
        return [
            'nome.unique' => 'Já existe um nível de permissão com este nome.',
        ];
    }
}
