<?php

namespace App\Support\Financeiro;

use App\Models\Convenio;
use App\Models\Tratamento;
use App\Support\Rbac\Escopo;

/**
 * De qual tratamento é o pagamento de uma criança — a SUGESTÃO (change
 * `vincular-pagamentos-ao-tratamento`, design D1). Em setembro de 2026, 29 de 33 receitas foram
 * lançadas com a criança e sem o tratamento, e caíram em "Sem profissional"; 23 eram de crianças
 * com UM pacote particular em andamento — o sistema sabia de quem era o dinheiro.
 *
 * Sugere **se e só se** a criança tem exatamente UM tratamento de convênio `particular` com
 * status `andamento`, dentro do escopo D11 do eixo agenda. Zero ou dois ou mais: nada — a
 * ambiguidade é decisão humana (com dois pacotes de terapeutas diferentes, "o mais recente"
 * erraria o dinheiro em silêncio). É SUGESTÃO: quem aplica é quem lança ou confere o lote; o
 * servidor nunca vincula sozinho.
 *
 * Mora no servidor, e só aqui: a tela nem sempre alcança a lista de convênios particulares
 * (`convenios.ver`), e duas cópias da regra divergem — a casa já pagou por isso.
 */
final class SugestaoDeTratamento
{
    /** O tratamento sugerido para a criança, ou `null` quando não há um só. */
    public function para(int $pacienteId, Escopo $escopo): ?int
    {
        return $this->paraVarias([$pacienteId], $escopo)[$pacienteId] ?? null;
    }

    /**
     * A sugestão de cada criança, numa consulta só (a lista do lote tem dezenas de crianças).
     *
     * @param  list<int>  $pacienteIds
     * @return array<int, int|null> paciente_id → tratamento_id sugerido
     */
    public function paraVarias(array $pacienteIds, Escopo $escopo): array
    {
        if ($pacienteIds === []) {
            return [];
        }

        $candidatos = $escopo->aplicar(Tratamento::query(), 'tratamentos.profissional_id')
            ->whereIn('tratamentos.paciente_id', $pacienteIds)
            ->where('tratamentos.status', 'andamento')
            ->whereIn('tratamentos.convenio_id', Convenio::query()->where('particular', true)->select('id'))
            ->get(['tratamentos.id', 'tratamentos.paciente_id'])
            ->groupBy('paciente_id');

        $sugestoes = array_fill_keys($pacienteIds, null);
        foreach ($candidatos as $pacienteId => $tratamentos) {
            if ($tratamentos->count() === 1) {
                $sugestoes[(int) $pacienteId] = (int) $tratamentos->first()->id;
            }
        }

        return $sugestoes;
    }
}
