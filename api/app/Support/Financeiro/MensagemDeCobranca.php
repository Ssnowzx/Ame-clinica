<?php

namespace App\Support\Financeiro;

/**
 * A mensagem de cobrança pelo WhatsApp (change `cobranca-pelo-whatsapp`, D4): texto da CLÍNICA
 * (configuração `financeiro.mensagem_cobranca`), com marcas que o servidor preenche. Uma marca
 * desconhecida é recusada na escrita — `{paciente}` no lugar de `{crianca}` sairia literal para a
 * família.
 */
final class MensagemDeCobranca
{
    /** @var list<string> */
    public const MARCAS = ['responsavel', 'crianca', 'valor', 'vencimento', 'clinica'];

    public const PADRAO = 'Olá, {responsavel}! Aqui é da {clinica}. Passando para lembrar do pagamento de {valor} '
        .'referente a {crianca}, com vencimento em {vencimento}. Se já pagou, desconsidere. Obrigada!';

    public const TETO = 1000;

    /**
     * As marcas do texto que não existem, na ordem em que aparecem.
     *
     * @return list<string>
     */
    public static function marcasDesconhecidas(string $texto): array
    {
        preg_match_all('/\{([^{}]*)\}/u', $texto, $achadas);

        return array_values(array_unique(array_filter(
            $achadas[1],
            fn (string $marca): bool => ! in_array($marca, self::MARCAS, true),
        )));
    }

    public static function valida(string $texto): bool
    {
        return trim($texto) !== '' && mb_strlen($texto) <= self::TETO && self::marcasDesconhecidas($texto) === [];
    }

    /** @param array<string, string> $valores por marca */
    public static function preencher(string $texto, array $valores): string
    {
        return strtr($texto, collect($valores)->mapWithKeys(fn (string $valor, string $marca): array => ['{'.$marca.'}' => $valor])->all());
    }

    /**
     * "R$ 1.234,50" — o mesmo formato do recibo e da tela, direto da string decimal, sem passar por
     * ponto flutuante (regra da casa para dinheiro).
     */
    public static function emReais(string $decimal): string
    {
        $normalizado = bcadd($decimal, '0', 2);
        $negativo = str_starts_with($normalizado, '-');
        [$inteiro, $centavos] = explode('.', ltrim($normalizado, '-'));
        $comMilhar = strrev(implode('.', str_split(strrev($inteiro), 3)));

        return ($negativo ? '-' : '').'R$ '.$comMilhar.','.$centavos;
    }
}
