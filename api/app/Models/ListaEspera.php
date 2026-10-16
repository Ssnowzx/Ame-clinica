<?php

namespace App\Models;

use App\Support\Auditoria\Auditavel;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ListaEspera extends Model
{
    use Auditavel;

    protected $table = 'lista_espera';

    /**
     * A `obs` da fila é OPERACIONAL — "prefere terça de manhã", "só com a avó".
     *
     * Ela não é mascarada na auditoria (decisão do gate, SEC-LE-06): o campo viaja
     * inteiro para toda a tela de quem tem `lista_espera.ver`, então escondê-lo só
     * do diff protegeria nada e destruiria a trilha de quem mudou o quê (§12). O
     * formulário diz ao usuário, em letras, que ali não se registra dado clínico —
     * prontuário é `evolucoes`/`anamneses`, com cifra em repouso.
     */
    protected $fillable = ['paciente_id', 'especialidade_id', 'profissional_id', 'prioridade', 'obs'];

    protected function casts(): array
    {
        return [
            'prioridade' => 'integer',
        ];
    }

    public function paciente(): BelongsTo
    {
        return $this->belongsTo(Paciente::class);
    }

    public function especialidade(): BelongsTo
    {
        return $this->belongsTo(Especialidade::class);
    }

    public function profissional(): BelongsTo
    {
        return $this->belongsTo(Profissional::class);
    }
}
