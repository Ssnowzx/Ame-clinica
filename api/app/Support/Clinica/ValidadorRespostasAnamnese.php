<?php

namespace App\Support\Clinica;

use Carbon\Carbon;

/**
 * Validação ESTRITA das respostas contra o campos_json do modelo (T-ate-10):
 * o schema da etapa 2 é a defesa da resposta — nada fora dele entra. As
 * mensagens NUNCA ecoam o valor recebido (dado sensível de menor, parecer §5.10);
 * rótulos e ids citados vêm do MODELO, não do payload.
 */
class ValidadorRespostasAnamnese
{
    public const TETO_TEXTO = 2000; // por campo (P4)

    /**
     * @param  list<array{id: string, tipo: string, rotulo: string, obrigatorio: bool, opcoes?: list<string>}>  $campos
     * @param  array<mixed>  $respostas
     * @return array<string, string> erros por chave de validação (vazio = válido)
     */
    public static function validar(array $campos, array $respostas): array
    {
        $erros = [];
        $idsDoModelo = array_column($campos, 'id');

        // whitelist de chaves: id fora do modelo é contrabando — sem ecoar a chave
        if (array_diff(array_keys($respostas), $idsDoModelo) !== []) {
            $erros['respostas_json'] = 'As respostas contêm campos que não pertencem ao modelo.';
        }

        foreach ($campos as $campo) {
            $id = $campo['id'];
            $valor = $respostas[$id] ?? null;
            $presente = $valor !== null && $valor !== '';

            if (! $presente) {
                if ($campo['obrigatorio']) {
                    $erros["respostas_json.{$id}"] = "O campo \"{$campo['rotulo']}\" é obrigatório.";
                }

                continue;
            }

            if (! self::valorCompativel($campo, $valor)) {
                $erros["respostas_json.{$id}"] = "Resposta inválida para o campo \"{$campo['rotulo']}\".";
            }
        }

        return $erros;
    }

    /** @param array{tipo: string, opcoes?: list<string>} $campo */
    private static function valorCompativel(array $campo, mixed $valor): bool
    {
        return match ($campo['tipo']) {
            'texto' => is_string($valor) && mb_strlen($valor) <= self::TETO_TEXTO,
            'numero' => is_int($valor) || is_float($valor),
            'opcoes' => is_string($valor) && in_array($valor, $campo['opcoes'] ?? [], true),
            'data' => is_string($valor) && Carbon::canBeCreatedFromFormat($valor, 'Y-m-d'),
            'booleano' => is_bool($valor),
            default => false,
        };
    }
}
