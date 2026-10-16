<?php

namespace App\Http\Requests;

use App\Http\Requests\Concerns\ValidaContatosEEndereco;
use App\Support\Validacao\DocumentoFiscal;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class FornecedorRequest extends FormRequest
{
    use ValidaContatosEEndereco;

    public function authorize(): bool
    {
        return true; // autorização é do middleware permission: das rotas
    }

    public function rules(): array
    {

        return [
            'razao_social' => ['required', 'string', 'max:255'],
            'nome_fantasia' => ['sometimes', 'nullable', 'string', 'max:255'],
            // CPF (11) ou CNPJ (14), só dígitos, DV validado (T-fin-05)
            'cpf_cnpj' => [
                'sometimes', 'nullable', 'regex:/^\d{11}$|^\d{14}$/',
                function (string $attribute, mixed $value, \Closure $fail): void {
                    if (! DocumentoFiscal::cpfOuCnpjValido((string) $value)) {
                        $fail('CPF/CNPJ inválido.');
                    }
                },
                Rule::unique('fornecedores', 'cpf_cnpj')
                    ->ignore($this->route('id')),
            ],
            'categoria_id' => [
                'sometimes', 'nullable', 'integer',
                Rule::exists('categorias', 'id'),
            ],
            'subcategoria_id' => [
                'sometimes', 'nullable', 'integer',
                Rule::exists('subcategorias', 'id'),
            ],
            'centro_custo' => ['sometimes', 'nullable', 'string', 'max:100'],
            'ativo' => ['sometimes', 'boolean'],
            ...$this->regrasDeContatosEEndereco(),
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(fn (Validator $v) => $this->validarWhitelistsDePessoa($v));
    }

    public function messages(): array
    {
        return [
            'cpf_cnpj.unique' => 'Já existe um fornecedor com este documento.',
            'cpf_cnpj.regex' => 'Informe CPF (11 dígitos) ou CNPJ (14 dígitos), somente números.',
        ];
    }
}
