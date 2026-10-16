<?php

namespace App\Http\Requests;

use App\Http\Requests\Concerns\ValidaContatosEEndereco;
use App\Support\Validacao\DocumentoFiscal;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class FuncionarioRequest extends FormRequest
{
    use ValidaContatosEEndereco;

    public function authorize(): bool
    {
        return true; // autorização é do middleware permission: das rotas
    }

    public function rules(): array
    {
        return [
            'nome' => ['required', 'string', 'max:255'],
            'funcao' => ['required', 'string', 'max:100'],
            'cpf' => [
                'sometimes', 'nullable', 'digits:11',
                function (string $attribute, mixed $value, \Closure $fail): void {
                    if (! DocumentoFiscal::cpfValido((string) $value)) {
                        $fail('CPF inválido.');
                    }
                },
                Rule::unique('funcionarios', 'cpf')
                    ->ignore($this->route('id')),
            ],
            'nascimento' => [
                'sometimes', 'nullable', 'date_format:Y-m-d',
                'before_or_equal:today', 'after_or_equal:1900-01-01',
            ],
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
            'cpf.unique' => 'Já existe um funcionário com este CPF.',
        ];
    }
}
