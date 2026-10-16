<?php

namespace App\Support\Auditoria;

/**
 * Rótulos HUMANOS por campo na trilha de auditoria (spec auditoria · change
 * detalhe-do-agendamento). A chave crua (snake_case do banco) NUNCA sai na API:
 * ou tem rótulo mapeado, ou cai num fallback humanizado. Os VALORES sensíveis já
 * chegam mascarados do RegistroDeAuditoria (art. 11) — aqui só rotulamos.
 *
 * Só CAMPOS, não ações: a `acao` sai crua no `AuditoriaResource` e é a tela de auditoria
 * que a rotula (lista própria em `pagina-auditoria.tsx`). Um `rotularAcao()` chegou a existir
 * aqui sem consumidor nenhum e foi removido no gate (CR-07): API pública sem chamador é código
 * morto com teste, e envelhece sem ninguém perceber.
 */
final class RotulosDeAuditoria
{
    /**
     * Colunas de banco que NÃO são "o que mudou" para um usuário — some da trilha
     * exibida (em qualquer entidade). É o que a tela mostrava como "Id".
     *
     * @var list<string>
     */
    public const CAMPOS_INTERNOS = [
        'id', 'created_at', 'updated_at', 'criado_em', 'atualizado_em',
        'recorrencia_grupo_id', 'sessao_consumida_em',
    ];

    /** @var array<string, array<string, string>> */
    private const ROTULOS = [
        'agendamentos' => [
            'tipo' => 'Tipo',
            'paciente_id' => 'Paciente',
            'profissional_id' => 'Profissional',
            'especialidade_id' => 'Especialidade',
            'tratamento_id' => 'Tratamento',
            'sala_id' => 'Sala',
            'equipamento_id' => 'Equipamento',
            'medico_id' => 'Médico solicitante',
            'status_id' => 'Status',
            'inicio' => 'Horário',
            'fim' => 'Término',
            'origem' => 'Origem',
            'is_reposicao' => 'Reposição',
            'reposicao_de_id' => 'Reposição de',
            'obs' => 'Observação',
            // "Manter a sessão (a família desistiu)" — lembrete-com-botoes-de-resposta, CRB2-03
            'confirmacao' => 'Resposta ao lembrete',
        ],
        // a LINHA-MÃE de uma operação em lote (D11 de `baixa-em-lote-por-status`) vive na
        // entidade do profissional cuja agenda foi tocada: são as chaves do diff dela —
        // `baixa_em_lote` e `desmarque_em_lote` gravam subconjuntos deste bloco
        'profissionais' => [
            'status_id' => 'Status aplicado',
            'status_nome' => 'Nome do status',
            'de' => 'Data inicial',
            'ate' => 'Data final',
            'periodo' => 'Período',
            'motivo' => 'Motivo',
            'aplicados' => 'Agendamentos aplicados',
            'desmarcados' => 'Agendamentos desmarcados',
            'criancas' => 'Crianças distintas',
            'sessoes_descontadas' => 'Sessões descontadas',
            'recusados' => 'Recusados',
            // o cadastro em si (change mensagens-automaticas-por-profissional)
            'mensagens_automaticas' => 'Mensagens automáticas às famílias',
        ],
    ];

    /**
     * Rótulos que valem em QUALQUER entidade. `lote_id` é coluna da trilha, não campo do diff
     * (por isso não entra em `CAMPOS_INTERNOS`), mas a tela o nomeia ao agrupar por lote.
     *
     * @var array<string, string>
     */
    private const ROTULOS_COMUNS = [
        'lote_id' => 'Operação em lote',
    ];

    /**
     * Traduz o diff cru (já mascarado) em alterações com rótulo por campo. Com um
     * `$resolvedor`, os VALORES também viram legíveis (FK→nome, data/booleano) —
     * sem ele, o valor sai cru (o comportamento das entidades sem resolvedor).
     *
     * @param  array{antes?: array<string, mixed>, depois?: array<string, mixed>}|null  $diff
     * @return list<array{campo: string, de: mixed, para: mixed}>
     */
    public static function alteracoes(string $entidade, ?array $diff, ?ResolvedorDeValores $resolvedor = null): array
    {
        $antes = $diff['antes'] ?? [];
        $depois = $diff['depois'] ?? [];
        $campos = array_values(array_unique([...array_keys($antes), ...array_keys($depois)]));
        // campos internos de banco (id, timestamps) nunca são "o que mudou"
        $campos = array_values(array_filter($campos, fn (string $campo): bool => ! in_array($campo, self::CAMPOS_INTERNOS, true)));

        return array_map(fn (string $campo): array => [
            'campo' => self::rotular($entidade, $campo),
            'de' => self::valor($resolvedor, $campo, $antes[$campo] ?? null),
            'para' => self::valor($resolvedor, $campo, $depois[$campo] ?? null),
        ], $campos);
    }

    private static function valor(?ResolvedorDeValores $resolvedor, string $campo, mixed $valor): mixed
    {
        return $resolvedor === null ? $valor : $resolvedor->valor($campo, $valor);
    }

    public static function rotular(string $entidade, string $campo): string
    {
        return self::ROTULOS[$entidade][$campo] ?? self::ROTULOS_COMUNS[$campo] ?? self::humanizar($campo);
    }

    /** Fallback: humaniza a chave — nunca devolve a snake_case crua. */
    private static function humanizar(string $campo): string
    {
        $semSufixo = preg_replace('/_id$/', '', $campo) ?? $campo;

        return ucfirst(str_replace('_', ' ', $semSufixo));
    }
}
