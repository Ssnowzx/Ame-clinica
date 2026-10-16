<?php

namespace App\Support\Auditoria;

use App\Models\Auditoria;
use App\Models\Equipamento;
use App\Models\Especialidade;
use App\Models\Medico;
use App\Models\Paciente;
use App\Models\Profissional;
use App\Models\Sala;
use App\Models\StatusAgendamento;
use App\Support\Clinica\ResumoDoPaciente;

/**
 * Traduz os VALORES do diff de auditoria de um AGENDAMENTO para algo que a clínica
 * lê: FK vira NOME (Status → "Finalizado", Profissional → nome), datetime vira
 * "dd/mm/yyyy às HH:MM", booleano vira Sim/Não. O valor mascarado ('***') e o nulo
 * passam intactos — não se ressuscita o que o RegistroDeAuditoria escondeu (art. 11).
 *
 * Nome de paciente/profissional/status já aparece em outras telas (card, catálogos),
 * então resolvê-lo aqui não é vazamento novo — é o MESMO dado, agora legível. Os
 * catálogos da clínica são pequenos e carregados UMA vez; os pacientes referenciados
 * (raros no diff — só a correção de criança) vêm pelos ids efetivamente vistos.
 *
 * **SÓ para `entidade=agendamentos`.** A postura é ALLOW-por-default (campo desconhecido
 * sai cru — necessário para enums inócuos como `origem`/`tipo`), o que só é seguro porque
 * as colunas de agendamento são fixas e sem dado de saúde em claro (`obs` já mascarado).
 * REUSAR este resolvedor para outra entidade (ex.: `pacientes`) vazaria campos não-mapeados
 * (`necessidade`/`nascimento`) CRUS — o `AuditoriaController` o instancia só para agendamentos.
 */
final class ResolvedorDeValores
{
    /** campo FK => [id => nome] dos catálogos pequenos da clínica. */
    private array $mapas;

    /** paciente_id => nome_social ?? nome. */
    private array $pacientes;

    /** @param list<int> $pacienteIds ids de paciente que aparecem no diff da página */
    public function __construct(array $pacienteIds)
    {
        $this->mapas = [
            'status_id' => StatusAgendamento::pluck('nome', 'id')->all(),
            'profissional_id' => Profissional::pluck('nome', 'id')->all(),
            'especialidade_id' => Especialidade::pluck('nome', 'id')->all(),
            'sala_id' => Sala::pluck('nome', 'id')->all(),
            'medico_id' => Medico::pluck('nome', 'id')->all(),
            'equipamento_id' => Equipamento::pluck('nome', 'id')->all(),
        ];

        $this->pacientes = Paciente::whereIn('id', $pacienteIds)
            ->get(ResumoDoPaciente::CAMPOS)
            ->mapWithKeys(fn (Paciente $paciente): array => [$paciente->id => $paciente->nome_social ?? $paciente->nome])
            ->all();
    }

    public function valor(string $campo, mixed $valor): mixed
    {
        // nunca reinterpretar o que já é nulo/mascarado
        if ($valor === null || $valor === '' || $valor === '***') {
            return $valor;
        }

        if ($campo === 'paciente_id') {
            return $this->pacientes[$valor] ?? "#{$valor}";
        }

        if (isset($this->mapas[$campo])) {
            return $this->mapas[$campo][$valor] ?? "#{$valor}";
        }

        // sem nome natural — o número identifica, com # para não parecer contagem
        if ($campo === 'tratamento_id' || $campo === 'reposicao_de_id') {
            return "#{$valor}";
        }

        if ($campo === 'inicio' || $campo === 'fim') {
            return self::dataHora((string) $valor);
        }

        if ($campo === 'is_reposicao') {
            return $valor ? 'Sim' : 'Não';
        }

        return $valor;
    }

    /**
     * Colhe os `paciente_id` (antes/depois) de uma página de registros de AGENDAMENTO,
     * para carregar só os pacientes que o diff realmente cita.
     *
     * @param  iterable<Auditoria>  $registros
     * @return list<int>
     */
    public static function pacienteIdsDe(iterable $registros): array
    {
        $ids = [];
        foreach ($registros as $registro) {
            foreach (['antes', 'depois'] as $lado) {
                $id = $registro->diff_json[$lado]['paciente_id'] ?? null;
                // `is_numeric` (não só `is_int`): um paciente_id string ("5") também
                // pré-carrega — senão o NOME do menor degradaria em silêncio para "#5"
                // (os mapas de catálogo já resolvem string pela coerção de chave do PHP).
                if (is_numeric($id)) {
                    $ids[] = (int) $id;
                }
            }
        }

        return $ids;
    }

    /** "2026-07-15 08:00:00" → "15/07/2026 às 08:00" (parede da clínica, sem `new Date`). */
    private static function dataHora(string $valor): string
    {
        if (! preg_match('/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/', $valor, $m)) {
            return $valor;
        }

        return "{$m[3]}/{$m[2]}/{$m[1]} às {$m[4]}:{$m[5]}";
    }
}
