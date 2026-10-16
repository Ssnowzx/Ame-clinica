<?php

namespace App\Support\Clinica;

use Illuminate\Support\Str;

/**
 * A régua ÚNICA da igualdade de nomes (guarda de homônimos, CR-FX-09/SEC-FX-03):
 * sem caixa, sem espaço repetido, sem borda, sem ACENTO e sem caractere de FORMATO
 * (categoria Cf — zero-width). Extraída do PacienteController na change
 * importacao-da-virada (SEC-IV-06/15): a chave de idempotência da carga usa a MESMA
 * régua da guarda. O preparador python (`bin/preparar-virada.py::norm_nome`) mantém
 * paridade para o REPERTÓRIO pt-BR (ç/ã/é/ü — cada lado com o seu teste); fora dele há
 * divergência conhecida (`Str::ascii` translitera ø/ß, o NFKD do python não) — sem
 * impacto na carga porque o comando re-deriva TODAS as chaves dos CSVs com ESTA régua
 * nos dois lados do join, e reprova chave duplicada no próprio arquivo (I1 do gate).
 *
 * O que ela NÃO dobra (decisão registrada em HOMONIMO-REGUA): grafia diferente
 * (`Ana Silva` × `Ana da Silva`), hífen e homoglifo de outro alfabeto.
 */
final class NomeNormalizado
{
    public static function aplicar(string $nome): string
    {
        $semInvisivel = (string) preg_replace('/\p{Cf}/u', '', $nome);
        $espacoUnico = (string) preg_replace('/\s+/u', ' ', $semInvisivel);

        return mb_strtolower(trim(Str::ascii($espacoUnico)));
    }
}
