<?php

namespace App\Http\Requests\Concerns;

use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

/**
 * Regras e whitelist dos JSONs de contato/endereço (padrão de pacientes,
 * parecer T-fin-05/§17: chave extra → 422).
 */
trait ValidaContatosEEndereco
{
    private static array $tiposContato = ['telefone', 'celular', 'whatsapp', 'email'];

    private static array $chavesContato = ['tipo', 'valor', 'obs'];

    private static array $chavesEndereco = ['cep', 'logradouro', 'numero', 'complemento', 'bairro', 'cidade', 'uf'];

    private static array $ufs = [
        'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT',
        'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO',
    ];

    /** @return array<string, list<mixed>> */
    private function regrasDeContatosEEndereco(): array
    {
        return [
            'contatos_json' => ['sometimes', 'nullable', 'array', 'max:10'],
            'contatos_json.*.tipo' => ['required', Rule::in(self::$tiposContato)],
            'contatos_json.*.valor' => ['required', 'string', 'max:255'],
            'contatos_json.*.obs' => ['sometimes', 'nullable', 'string', 'max:255'],

            'endereco_json' => ['sometimes', 'nullable', 'array'],
            'endereco_json.cep' => ['sometimes', 'nullable', 'string', 'max:9'],
            'endereco_json.logradouro' => ['sometimes', 'nullable', 'string', 'max:255'],
            'endereco_json.numero' => ['sometimes', 'nullable', 'string', 'max:20'],
            'endereco_json.complemento' => ['sometimes', 'nullable', 'string', 'max:100'],
            'endereco_json.bairro' => ['sometimes', 'nullable', 'string', 'max:100'],
            'endereco_json.cidade' => ['sometimes', 'nullable', 'string', 'max:100'],
            'endereco_json.uf' => ['sometimes', 'nullable', Rule::in(self::$ufs)],
        ];
    }

    private function validarWhitelistsDePessoa(Validator $validator): void
    {
        foreach ((array) $this->input('contatos_json', []) as $indice => $contato) {
            if (! is_array($contato)) {
                continue; // já rejeitado pelas rules
            }
            $extras = array_diff(array_keys($contato), self::$chavesContato);
            if ($extras !== []) {
                $validator->errors()->add(
                    "contatos_json.{$indice}",
                    'Chaves não permitidas: '.implode(', ', $extras).'.'
                );
            }
        }

        $endereco = $this->input('endereco_json');
        if (is_array($endereco)) {
            $extras = array_diff(array_keys($endereco), self::$chavesEndereco);
            if ($extras !== []) {
                $validator->errors()->add(
                    'endereco_json',
                    'Chaves não permitidas no endereço: '.implode(', ', $extras).'.'
                );
            }
        }
    }
}
