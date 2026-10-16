<?php

namespace App\Models;

use App\Support\Auditoria\Auditavel;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Fornecedor extends Model
{
    use Auditavel;

    protected $table = 'fornecedores';

    /** Dados pessoais de ADULTO (parecer §1.1): documento, contatos e endereço fora do diff. */
    protected array $auditExclude = ['cpf_cnpj', 'contatos_json', 'endereco_json'];

    protected $fillable = [
        'razao_social', 'nome_fantasia', 'cpf_cnpj', 'contatos_json',
        'endereco_json', 'categoria_id', 'subcategoria_id', 'centro_custo', 'ativo',
    ];

    protected function casts(): array
    {
        return [
            'contatos_json' => 'array',
            'endereco_json' => 'array',
            'ativo' => 'boolean',
        ];
    }

    public function categoria(): BelongsTo
    {
        return $this->belongsTo(Categoria::class);
    }

    public function subcategoria(): BelongsTo
    {
        return $this->belongsTo(Subcategoria::class);
    }
}
