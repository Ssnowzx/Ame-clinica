<?php

namespace App\Support\Financeiro;

use App\Models\Fornecedor;
use App\Models\Funcionario;
use App\Models\LancamentoCaixa;
use App\Models\Paciente;
use Illuminate\Support\Collection;

/**
 * O nome de cada interessado dos lançamentos dados — criança, fornecedor ou funcionário —, numa
 * consulta por tipo, com a chave `tipo#id`. A fonte ÚNICA da lista de lançamentos, do Fluxo, das
 * notificações e dos relatórios do caixa. Mora em `Support` (CR-API2-05): código de suporte não
 * depende de controller.
 */
final class NomesDosInteressados
{
    /**
     * @param  Collection<int, LancamentoCaixa|array{interessado_tipo: string|null, interessado_id: int|null}>  $lancamentos
     * @return Collection<string, string>
     */
    public static function de(Collection $lancamentos): Collection
    {
        $porTipo = $lancamentos->whereNotNull('interessado_tipo')
            ->groupBy('interessado_tipo')
            ->map(fn (Collection $grupo) => $grupo->pluck('interessado_id')->unique()->all());

        $nomes = collect();
        foreach ($porTipo as $tipo => $ids) {
            $consulta = match ($tipo) {
                'paciente' => Paciente::whereIn('id', $ids)->pluck('nome', 'id'),
                'fornecedor' => Fornecedor::whereIn('id', $ids)->pluck('razao_social', 'id'),
                'funcionario' => Funcionario::whereIn('id', $ids)->pluck('nome', 'id'),
                default => collect(),
            };
            foreach ($consulta as $id => $nome) {
                $nomes["{$tipo}#{$id}"] = $nome;
            }
        }

        return $nomes;
    }
}
