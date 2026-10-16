<?php

namespace App\Models;

use App\Support\Auditoria\Auditavel;
use Illuminate\Database\Eloquent\Model;

/**
 * Override de configuração da clínica (§13). Toda escrita é auditada —
 * parametrização controla regra de negócio da clínica (parecer T-cfg-04).
 */
class Configuracao extends Model
{
    use Auditavel;

    protected $table = 'configuracoes';

    protected $fillable = ['chave', 'valor'];
}
