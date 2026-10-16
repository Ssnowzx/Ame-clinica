<?php

namespace App\Models;

use App\Support\Auditoria\Auditavel;
use Illuminate\Database\Eloquent\Model;

/**
 * Override da régua do cadastro para um campo (change campos-do-cadastro-configuraveis).
 *
 * Nada aqui é dado de paciente — é regra da clínica —, então nenhum campo é mascarado na
 * auditoria: o diff PRECISA dizer qual campo e qual chave mudaram, porque é isso que
 * explica, meses depois, por que um cadastro passou a ser recusado (§12).
 *
 * `NULL` numa chave significa "usa o padrão do catálogo", e é diferente de `false`.
 */
class CampoCadastro extends Model
{
    use Auditavel;

    protected $table = 'campos_cadastro';

    protected $fillable = ['formulario', 'campo', 'obrigatorio', 'desabilitado', 'rapido', 'online'];

    protected function casts(): array
    {
        return [
            'obrigatorio' => 'boolean',
            'desabilitado' => 'boolean',
            'rapido' => 'boolean',
            'online' => 'boolean',
        ];
    }
}
