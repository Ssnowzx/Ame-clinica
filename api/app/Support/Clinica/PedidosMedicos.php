<?php

namespace App\Support\Clinica;

use App\Models\Agendamento;
use App\Models\Tratamento;
use App\Support\Configuracoes\ConfiguracaoService;
use App\Support\Rbac\Escopo;
use Carbon\Carbon;
use Illuminate\Database\Eloquent\Builder;

/**
 * Pedidos médicos a vencer/vencidos — a REGRA em UM lugar só (SEC-LP-06).
 *
 * Dois consumidores dependem da mesma definição: o bloco do centro de
 * notificações (sob `tratamentos.ver`) e o alerta do painel do agendamento
 * (`show`, sob posse D11). A base é a MESMA consulta do módulo `tratamentos`
 * (`Tratamento::query()`) — nunca uma query
 * copiada; o vencimento vem da derivação única do model (`pedidoVenceEm`,
 * D4): o DATE_ADD do filtro SQL e o addMonthsNoOverflow do PHP clampam o fim
 * de mês do MESMO jeito.
 *
 * Escopo: eixo AGENDA (D11), aplicado DENTRO da fonte desde a rodada 4 do gate de
 * `vinculo-previo-para-agendar` (`SEC-VP-45`). O registro SEC-LP-06 ("plano por construção,
 * segue o módulo `tratamentos`") era anterior ao perfil escopado da matriz AP-10 e ao
 * `TRAT-ESCOPO`, que recortou o `index` pelo mesmo argumento: contador escopado levando à
 * lista plana é o escopo sumindo no caminho.
 */
class PedidosMedicos
{
    public function __construct(private readonly ConfiguracaoService $configuracoes) {}

    /**
     * Antecedência do aviso (§13, `tratamentos.pedido_aviso_antecedencia_dias`)
     * com clamp defensivo na LEITURA (SEC-LP-16): a faixa 7..180 vale na escrita
     * do catálogo E aqui — um valor adulterado direto no banco nunca alarga a
     * janela além de 180 dias nem a estreita abaixo de 7.
     */
    public function antecedenciaDias(): int
    {
        $valor = (int) $this->configuracoes->get('tratamentos.pedido_aviso_antecedencia_dias');

        return min(max($valor, 7), 180);
    }

    /**
     * Base ÚNICA da janela: tratamentos EM ANDAMENTO com pedido registrado e
     * convênio com validade, vencidos ou vencendo até hoje + antecedência —
     * ordenados do vencimento mais urgente para o mais distante.
     *
     * Escopo D11 do eixo AGENDA aplicado DENTRO da fonte (`SEC-VP-45`, rodada 4), como em
     * `PacotesAcabando`: o bloco listava, para o profissional escopado, o pedido médico de toda
     * criança da clínica — nome, convênio, modalidade e validade — sob a mesma `tratamentos.ver`
     * que o `index` recorta. Sem vínculo e sem `agenda.ver_todos`, bloco vazio (fail-closed).
     *
     * @return Builder<Tratamento>
     */
    public function consulta(string $hoje, Escopo $escopo): Builder
    {
        $teto = Carbon::createFromFormat('Y-m-d', $hoje)
            ->addDays($this->antecedenciaDias())
            ->toDateString();

        return $escopo->aplicar(Tratamento::query(), 'tratamentos.profissional_id')
            ->where('tratamentos.status', 'andamento')
            ->whereNotNull('tratamentos.pedido_emitido_em')
            ->join('convenios', 'convenios.id', '=', 'tratamentos.convenio_id')
            ->whereNotNull('convenios.pedido_validade_meses')
            ->whereRaw(
                'DATE_ADD(tratamentos.pedido_emitido_em, INTERVAL convenios.pedido_validade_meses MONTH) <= ?',
                [$teto],
            )
            ->orderByRaw('DATE_ADD(tratamentos.pedido_emitido_em, INTERVAL convenios.pedido_validade_meses MONTH)')
            ->select('tratamentos.*')
            ->with([
                ResumoDoPaciente::relacao(),
                'convenio:id,nome,pedido_validade_meses',
                'especialidade:id,nome',
            ]);
    }

    /**
     * Item do bloco — a whitelist EXATA do SEC-LP-02, nada além dela: NUNCA
     * `pedido_sessoes_por_semana`, guia/matrícula, nascimento/necessidade.
     *
     * @return array<string, mixed>
     */
    public function item(Tratamento $tratamento, string $hoje): array
    {
        $venceEm = $tratamento->pedidoVenceEm();
        $vencido = $venceEm !== null && $venceEm < $hoje;

        return [
            'tratamento_id' => $tratamento->id,
            'paciente' => ResumoDoPaciente::deOuNulo($tratamento->paciente),
            'convenio' => $tratamento->convenio?->only(['id', 'nome']),
            'especialidade' => $tratamento->especialidade?->only(['id', 'nome']),
            'vencido' => $vencido,
            'vence_em' => $venceEm,
            'vence_em_dias' => $vencido || $venceEm === null
                ? null
                : $this->diasAte($hoje, $venceEm),
        ];
    }

    /**
     * O sinal do PAINEL (D5): pedido do tratamento DESTE agendamento vencido ou
     * vencendo dentro da antecedência — sob demanda no `show`, nunca no card da
     * grade (SEC-LP-03). Mesmos critérios do bloco (status em andamento incluso):
     * o centro e o painel nunca divergem.
     *
     * @return array{vencido: bool, vence_em_dias: int|null}|null
     */
    public function alertaDoAgendamento(Agendamento $agendamento): ?array
    {
        $tratamento = $agendamento->tratamento;
        if ($tratamento === null || $tratamento->status !== 'andamento') {
            return null;
        }

        $venceEm = $tratamento->pedidoVenceEm();
        if ($venceEm === null) {
            return null; // sem pedido ou convênio sem validade: nenhum alarme falso
        }

        $hoje = now($this->configuracoes->get('clinica.timezone'))->toDateString();
        if ($venceEm < $hoje) {
            return ['vencido' => true, 'vence_em_dias' => null];
        }

        $dias = $this->diasAte($hoje, $venceEm);

        return $dias <= $this->antecedenciaDias()
            ? ['vencido' => false, 'vence_em_dias' => $dias]
            : null;
    }

    private function diasAte(string $hoje, string $venceEm): int
    {
        return (int) Carbon::createFromFormat('Y-m-d', $hoje)
            ->diffInDays(Carbon::createFromFormat('Y-m-d', $venceEm));
    }
}
