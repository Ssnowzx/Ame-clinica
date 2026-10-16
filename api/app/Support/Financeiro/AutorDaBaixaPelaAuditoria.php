<?php

namespace App\Support\Financeiro;

use Illuminate\Support\Facades\DB;

/**
 * O autor dos pagamentos anteriores à coluna `pago_por_id` (change `fechamento-de-caixa`, D2):
 * copia o autor do registro de auditoria MAIS RECENTE em que o `pago_em` do lançamento passou a ter
 * valor (a criação já paga ou a baixa). Sem autor na trilha (console, importação), fica nulo: não se inventa quem pagou. Só
 * toca lançamento pago com a coluna vazia, então rodar de novo não muda nada.
 *
 * O registro que vale é o MAIS RECENTE que pôs o `pago_em`, e o autor é o DELE — mesmo nulo
 * (CR-API1-07): filtrar "com autor" antes de escolher o mais recente fazia um pagamento de
 * sistema, depois de um estorno, herdar quem tinha pago antes.
 *
 * Mora fora da migration para o teste provar a MESMA consulta que a migration roda.
 */
final class AutorDaBaixaPelaAuditoria
{
    /** @return int lançamentos preenchidos */
    public static function preencher(): int
    {
        return DB::affectingStatement(<<<'SQL'
            UPDATE lancamentos_caixa l
            JOIN (
                SELECT a.entidade_id, MAX(a.id) AS ultimo
                FROM auditoria a
                WHERE a.entidade = 'lancamentos_caixa'
                  AND a.acao IN ('criou', 'atualizou')
                  AND JSON_VALUE(a.diff_json, '$.depois.pago_em') IS NOT NULL
                GROUP BY a.entidade_id
            ) trilha ON trilha.entidade_id = l.id
            JOIN auditoria ultimo ON ultimo.id = trilha.ultimo
            SET l.pago_por_id = ultimo.usuario_id
            WHERE l.pago_em IS NOT NULL AND l.pago_por_id IS NULL AND ultimo.usuario_id IS NOT NULL
        SQL);
    }
}
