<?php

namespace App\Support\Relatorios;

use Illuminate\Database\Eloquent\Model;

/**
 * O objeto da trilha de uma planilha baixada (change `relatorio-em-planilha`, D4): a auditoria
 * registra sobre um model; a exportação não tem linha em tabela nenhuma. Nunca é gravado —
 * serve só para a trilha dizer "relatorios #0 exportou", com o slug e os parâmetros no diff.
 */
final class ExportacaoDeRelatorio extends Model
{
    protected $table = 'relatorios';

    protected $attributes = ['id' => 0];
}
