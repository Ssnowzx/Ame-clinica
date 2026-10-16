<?php

namespace App\Http\Requests;

use App\Models\Usuario;
use App\Support\Rbac\SemEscalada;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\Password;

/**
 * Criação/edição de usuário da clínica (design D6). NUNCA aceita nível/role no
 * payload (parecer T-usr-02) — atribuição só pelo endpoint dedicado.
 */
class UsuarioGestaoRequest extends FormRequest
{
    /** Política mínima de senha (parecer T-usr-01/P3). */
    private const SENHA_MINIMA = 10;

    public function authorize(): bool
    {
        // o módulo é do middleware `permission:` das rotas; aqui, a régua do acesso (change
        // `trava-de-usuarios-e-niveis`), antes das regras: o 403 não vem depois de um 422 que descreve o
        // pedido. O id da rota é só dígitos (`whereNumber`, SEC-TRV-01): a régua e o controller acham o
        // MESMO registro. O inexistente não é achado; o 404 é do controller, depois da validação
        // O vínculo com um profissional é ESCOPO (D11): pôr ou trocar é dar acesso (SEC-TRV-02). O
        // controller refaz a régua sob a âncora, para a atomicidade (CR-TRV-07)
        $id = $this->route('id');
        $alvo = $id === null ? null : Usuario::find((int) $id);
        // a senha e o e-mail entregam a conta (SEC-PP-04): vão crus, antes da validação, para o 403
        // vencer o 422 de uma senha curta
        app(SemEscalada::class)->assegurarEdicaoDeUsuario($this->user(), $alvo, $this->input('profissional_id'), $this->only(['senha', 'email']));

        return true;
    }

    public function rules(): array
    {
        $criando = $this->isMethod('post');

        return [
            'nome' => [$criando ? 'required' : 'sometimes', 'string', 'max:255'],
            'email' => [
                $criando ? 'required' : 'sometimes', 'email', 'max:255',
                // o email é a identidade do login
                Rule::unique('usuarios', 'email')->ignore($this->route('id')),
            ],
            'senha' => [
                $criando ? 'required' : 'sometimes',
                'string',
                // composição letras+números: decisão da clínica (bloco 8, gatilho PWD)
                Password::min(self::SENHA_MINIMA)->letters()->numbers(),
            ],
            'acesso_mobile' => ['sometimes', 'boolean'],
            'ativo' => ['sometimes', 'boolean'],
            // vínculo opcional (§12): profissional existente, ainda sem outro usuário
            'profissional_id' => [
                'sometimes', 'nullable', 'integer',
                Rule::exists('profissionais', 'id'),
                Rule::unique('usuarios', 'profissional_id')->ignore($this->route('id')),
            ],
        ];
    }

    public function messages(): array
    {
        return [
            'email.unique' => 'Este e-mail já está em uso.',
        ];
    }
}
