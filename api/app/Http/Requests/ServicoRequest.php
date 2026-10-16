<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class ServicoRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true; // autorização é do middleware permission: das rotas
    }

    public function rules(): array
    {
        return [
            'procedimento' => [
                'required', 'string', 'max:255',
                Rule::unique('servicos', 'procedimento')
                    ->where('convenio_id', (int) $this->route('convenioId'))
                    ->ignore($this->route('id')),
            ],
            /*
             * O código do procedimento na tabela da OPERADORA (change
             * codigo-do-procedimento-no-servico). Opcional e SEM formato: a TISS usa
             * dígitos, outras operadoras usam alfanumérico — validar "8 dígitos" seria
             * chumbar a regra de uma operadora no sistema (§13). Sem `unique`: o mesmo
             * código pode repetir em serviços do mesmo convênio (design D3).
             */
            'codigo_procedimento' => ['sometimes', 'nullable', 'string', 'max:40'],
            // dinheiro: >= 0, teto do decimal(10,2), máx 2 casas — REJEITAR, nunca
            // arredondar (parecer T-fin-01)
            'valor' => ['required', 'numeric', 'decimal:0,2', 'min:0', 'max:99999999.99'],
        ];
    }

    public function messages(): array
    {
        return [
            'procedimento.unique' => 'Este procedimento já existe na tabela deste convênio.',
            'valor.decimal' => 'O valor deve ter no máximo 2 casas decimais.',
        ];
    }
}
