<?php

namespace App\Models;

use App\Support\Auditoria\Auditavel;
use Illuminate\Database\Eloquent\Model;

/** Registro operacional (§9) — NÃO é usuário do sistema (sem credencial). */
class Funcionario extends Model
{
    use Auditavel;

    protected $table = 'funcionarios';

    /** Dados pessoais de ADULTO (parecer §1.2): documento, contatos e endereço fora do diff. */
    protected array $auditExclude = ['cpf', 'contatos_json', 'endereco_json'];

    protected $fillable = [
        'nome', 'cpf', 'funcao', 'contatos_json', 'endereco_json', 'nascimento', 'ativo',
    ];

    protected function casts(): array
    {
        return [
            'contatos_json' => 'array',
            'endereco_json' => 'array',
            'nascimento' => 'date:Y-m-d',
            'ativo' => 'boolean',
        ];
    }
}
