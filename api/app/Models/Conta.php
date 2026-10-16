<?php

namespace App\Models;

use App\Support\Auditoria\Auditavel;
use Illuminate\Database\Eloquent\Model;

class Conta extends Model
{
    use Auditavel;

    protected $table = 'contas';

    protected $fillable = ['nome', 'codigo_contabil', 'ativo'];

    /**
     * O saldo de abertura é número do dinheiro da clínica (change `saldo-das-contas`, D5): fica
     * fora do CRUD comum, que responde a `contas.ver`. Sai só por `/contas/saldos`, sob
     * `fluxo_caixa.ver`, e muda só pela rota própria.
     */
    protected $hidden = ['saldo_inicial', 'saldo_inicial_em'];

    protected function casts(): array
    {
        return [
            'ativo' => 'boolean',
            'saldo_inicial' => 'decimal:2',
            'saldo_inicial_em' => 'date:Y-m-d',
        ];
    }
}
