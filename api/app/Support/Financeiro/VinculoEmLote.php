<?php

namespace App\Support\Financeiro;

use App\Exceptions\CorridaDoCicloException;
use App\Models\LancamentoCaixa;
use App\Models\Tratamento;
use App\Models\Usuario;
use App\Support\Auditoria\ContextoDoLote;
use Illuminate\Support\Collection;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpException;

/**
 * "Vincular sugestões": liga de uma vez as receitas pagas que ficaram sem tratamento (change
 * `vincular-pagamentos-ao-tratamento`, D3). TUDO OU NADA: uma transação só (a do `ContextoDoLote`,
 * que marca a auditoria com o `lote_id`), e um item recusado
 * recusa o lote com o erro em `vinculos.{i}` — metade vinculada num fechamento de mês é pior que
 * "conserte a linha 7 e mande de novo".
 *
 * Cada item passa pelas MESMAS travas do vínculo um a um, sem cópia de regra:
 * - `AutorizacaoDoVinculo` — posse do tratamento (eixo agenda) e `lancamentos.pagar` no pago;
 * - o lançamento ainda SEM tratamento, conferido sob lock (alguém pode tê-lo vinculado depois de
 *   a lista ser carregada — sem isto, o lote sobrescreveria a escolha dele);
 * - `LancamentoCaixaService::atualizar` — mesma criança, faturado intocável, ordem de locks,
 *   período fechado e auditoria. O `pago_em` nunca muda.
 */
final class VinculoEmLote
{
    public function __construct(
        private readonly LancamentoCaixaService $lancamentos,
        private readonly AutorizacaoDoVinculo $autorizacao,
        private readonly ContextoDoLote $contexto,
    ) {}

    /**
     * Pelo `ContextoDoLote` da casa (o mesmo da baixa e do desmarque em lote): transação única,
     * toda linha auditada com o mesmo `lote_id` (a trilha reagrupa o lote), e o deadlock/lock wait
     * traduzido em 409 `ciclo_em_alteracao` — "tente de novo", nunca 500 (SEC-VPT-03).
     *
     * @param  list<array{lancamento_id: int, tratamento_id: int}>  $vinculos
     * @return array{vinculados: int, lote_id: string}
     */
    public function vincular(array $vinculos, ?Usuario $usuario): array
    {
        return $this->contexto->executar('vinculo_em_lote', function (string $loteId) use ($vinculos, $usuario): array {
            // ORDEM DE LOCKS da casa ANTES do laço (SEC-VPT-03): todos os lançamentos, depois todos
            // os tratamentos, cada grupo em ordem CRESCENTE de id — e só então o laço, que trava os
            // convênios pela guarda de ciclo. Travando item a item, o convênio do item 1 ficava preso
            // enquanto o lote pedia o lançamento do item 2: cruzado com um PUT (lançamento →
            // tratamento → convênio) ou com outro lote na ordem oposta, deadlock
            $travados = $this->travarLancamentos(array_column($vinculos, 'lancamento_id'));
            $this->travarTratamentos(array_column($vinculos, 'tratamento_id'));

            foreach ($vinculos as $indice => $vinculo) {
                $this->vincularUm($indice, $travados->get((int) $vinculo['lancamento_id']), (int) $vinculo['tratamento_id'], $usuario);
            }

            return ['vinculados' => count($vinculos), 'lote_id' => $loteId];
        });
    }

    /**
     * @param  list<int|string>  $ids
     * @return Collection<int, LancamentoCaixa>
     */
    private function travarLancamentos(array $ids): Collection
    {
        // o salário escondido vira "não existe mais", como o id que não existe (gate r1 de
        // `financeiro-sem-faturamento-total`, CR-FIN-01): outra recusa denunciaria o id
        return LancamentosVisiveis::filtrar(LancamentoCaixa::query())
            ->whereKey(array_map('intval', $ids))->orderBy('id')->lockForUpdate()->get()->keyBy('id');
    }

    /** @param  list<int|string>  $ids */
    private function travarTratamentos(array $ids): void
    {
        Tratamento::whereKey(array_values(array_unique(array_map('intval', $ids))))->orderBy('id')->lockForUpdate()->get(['id']);
    }

    private function vincularUm(int $indice, ?LancamentoCaixa $lancamento, int $tratamentoId, ?Usuario $usuario): void
    {
        if ($lancamento === null) {
            throw ValidationException::withMessages([
                "vinculos.{$indice}.lancamento_id" => 'Este lançamento não existe mais.',
            ]);
        }
        if ($lancamento->tratamento_id !== null) {
            throw ValidationException::withMessages([
                "vinculos.{$indice}.lancamento_id" => 'Este pagamento já foi vinculado a um tratamento — recarregue a lista.',
            ]);
        }
        // o lote é o da LISTA: receita paga de criança, sem sessão faturada — o resto se acerta
        // um a um, pelo formulário (nit da segurança: uma despesa em aberto passava)
        if ($lancamento->tipo !== 'receita' || $lancamento->pago_em === null
            || $lancamento->interessado_tipo !== 'paciente' || $lancamento->agendamento_id !== null) {
            throw ValidationException::withMessages([
                "vinculos.{$indice}.lancamento_id" => 'Este lançamento não é um pagamento de criança sem tratamento.',
            ]);
        }

        $this->autorizacao->assegurar($usuario, $lancamento, $tratamentoId);

        try {
            $this->lancamentos->atualizar(
                $lancamento,
                ['tratamento_id' => $tratamentoId],
                // o estado que ESTA autorização viu, sob o lock acima
                ['tratamento_id' => null, 'pago' => $lancamento->pago_em !== null],
            );
        } catch (ValidationException $excecao) {
            // o erro do item volta com o ENDEREÇO dele, para a tela apontar a linha
            $erros = [];
            foreach ($excecao->errors() as $campo => $mensagens) {
                $erros["vinculos.{$indice}.{$campo}"] = $mensagens;
            }
            throw ValidationException::withMessages($erros);
        } catch (CorridaDoCicloException $corrida) {
            throw $corrida; // "tente de novo" é do LOTE, não um erro do item (SEC-VPT-03)
        } catch (HttpException $excecao) {
            // só o 409 do ESTADO (o lançamento mudou) é do item; qualquer outro status sobe como veio
            // (CR-VPT-03) — um 403 não pode virar "erro na linha"
            if ($excecao->getStatusCode() !== 409) {
                throw $excecao;
            }
            throw ValidationException::withMessages([
                "vinculos.{$indice}.lancamento_id" => $excecao->getMessage() ?: 'Este pagamento mudou — recarregue a lista.',
            ]);
        }
    }
}
