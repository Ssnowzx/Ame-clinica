<?php

namespace App\Http\Requests\Concerns;

use App\Rules\ProfissionalAtivoOuVinculado;
use Illuminate\Contracts\Validation\Validator;
use Illuminate\Support\Facades\Log;

/**
 * Compartilha, entre as três Requests que gravam `profissional_id` num agendamento/tratamento
 * (Tratamento, Agendamento, Encaixe — SEC-PD-01), a guarda do gatilho PROF-DESLIGADO:
 *
 * 1. Constrói o Rule `ProfissionalAtivoOuVinculado` guardando o contexto para o log.
 * 2. No `failedValidation`, quando — e SÓ quando — a rejeição for a do desligado, registra a
 *    tentativa bloqueada no canal de log de segurança (Decisão 3 do design; SEC-PD-02).
 *
 * O log carrega APENAS a whitelist de identificadores operacionais. `obs` (texto livre) e
 * `paciente_id` (liga a um MENOR) NUNCA entram — nada de `$request->all()`/`validated()`.
 */
trait GuardaProfissionalDesligado
{
    private ?int $profissionalAtualParaLog = null;

    /**
     * @param  int|null  $profissionalAtual  o `profissional_id` já gravado (null na criação)
     */
    protected function regraProfissionalAtivoOuVinculado(?int $profissionalAtual): ProfissionalAtivoOuVinculado
    {
        $this->profissionalAtualParaLog = $profissionalAtual;

        return new ProfissionalAtivoOuVinculado($profissionalAtual);
    }

    /**
     * Rótulos do recurso para o log: `recurso` (tratamento|agendamento|encaixe), `operacao`
     * (criar|editar) e `recurso_id` (null na criação, ou quando o `{id}` da rota não é o do
     * agendamento — caso do encaixe, cujo `{id}` é a entrada da fila).
     *
     * @return array{recurso: string, operacao: string, recurso_id: int|null}
     */
    abstract protected function dadosDoRecursoDesligado(): array;

    protected function failedValidation(Validator $validator): void
    {
        $erros = $validator->errors()->get('profissional_id');
        if (in_array(ProfissionalAtivoOuVinculado::MENSAGEM, $erros, true)) {
            $this->registrarTentativaBloqueada();
        }

        parent::failedValidation($validator);
    }

    private function registrarTentativaBloqueada(): void
    {
        Log::channel('seguranca')->warning('prof_desligado.bloqueado', [
            ...$this->dadosDoRecursoDesligado(),
            'usuario_id' => $this->user()?->id,
            'profissional_tentado_id' => $this->input('profissional_id'),
            'profissional_atual_id' => $this->profissionalAtualParaLog,
            'motivo' => ProfissionalAtivoOuVinculado::MOTIVO,
            'ip' => $this->ip(),
        ]);
    }
}
