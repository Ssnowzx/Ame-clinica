<?php

namespace App\Support\Auditoria;

use Illuminate\Database\Eloquent\Model;

/**
 * Audita criação/alteração/exclusão da entidade (§12):
 * criou → valores novos · atualizou → só os campos alterados (antes/depois) ·
 * excluiu → valores antigos. Defina `protected array $auditExclude` no model
 * para mascarar campos sensíveis adicionais.
 */
trait Auditavel
{
    public static function bootAuditavel(): void
    {
        // valores crus aqui — o mascaramento mora num único lugar: RegistroDeAuditoria
        static::created(function (Model $model): void {
            RegistroDeAuditoria::registrar($model, 'criou', [
                'depois' => $model->getAttributes(),
            ], $model->camposAuditaveisExcluidos());
        });

        static::updated(function (Model $model): void {
            $depois = collect($model->getChanges())->except(['created_at', 'updated_at']);
            if ($depois->isEmpty()) {
                return;
            }

            $antes = collect($model->getOriginal())->only($depois->keys());

            RegistroDeAuditoria::registrar($model, 'atualizou', [
                'antes' => $antes->all(),
                'depois' => $depois->all(),
            ], $model->camposAuditaveisExcluidos());
        });

        static::deleted(function (Model $model): void {
            RegistroDeAuditoria::registrar($model, 'excluiu', [
                'antes' => $model->getOriginal(),
            ], $model->camposAuditaveisExcluidos());
        });
    }

    /** @return list<string> */
    public function camposAuditaveisExcluidos(): array
    {
        return property_exists($this, 'auditExclude') ? $this->auditExclude : [];
    }
}
