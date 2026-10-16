<?php

namespace App\Support\Validacao;

/**
 * Dígitos verificadores de CPF/CNPJ (parecer T-fin-05: lixo fora do banco).
 * Só dígitos — máscara é responsabilidade de quem chama.
 */
class DocumentoFiscal
{
    public static function cpfValido(string $cpf): bool
    {
        if (strlen($cpf) !== 11 || preg_match('/^(\d)\1{10}$/', $cpf) === 1) {
            return false;
        }

        foreach ([9, 10] as $tamanho) {
            $soma = 0;
            for ($posicao = 0; $posicao < $tamanho; $posicao++) {
                $soma += (int) $cpf[$posicao] * (($tamanho + 1) - $posicao);
            }
            $digito = (10 * $soma) % 11 % 10;
            if ((int) $cpf[$tamanho] !== $digito) {
                return false;
            }
        }

        return true;
    }

    public static function cnpjValido(string $cnpj): bool
    {
        if (strlen($cnpj) !== 14 || preg_match('/^(\d)\1{13}$/', $cnpj) === 1) {
            return false;
        }

        foreach ([12, 13] as $tamanho) {
            $peso = $tamanho - 7; // 5 para o 1º dígito, 6 para o 2º
            $soma = 0;
            for ($posicao = 0; $posicao < $tamanho; $posicao++) {
                $soma += (int) $cnpj[$posicao] * $peso;
                $peso = $peso === 2 ? 9 : $peso - 1;
            }
            $resto = $soma % 11;
            $digito = $resto < 2 ? 0 : 11 - $resto;
            if ((int) $cnpj[$tamanho] !== $digito) {
                return false;
            }
        }

        return true;
    }

    /** CPF (11 dígitos) ou CNPJ (14 dígitos) — qualquer outro tamanho é inválido. */
    public static function cpfOuCnpjValido(string $documento): bool
    {
        return match (strlen($documento)) {
            11 => self::cpfValido($documento),
            14 => self::cnpjValido($documento),
            default => false,
        };
    }
}
