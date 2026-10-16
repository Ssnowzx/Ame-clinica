<?php

namespace Database\Seeders\Apresentacao;

use App\Support\Ciclos\CalendarioDoCiclo;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * O dinheiro do ano: cada sessão particular realizada (e a falta, que a clínica cobra)
 * vira receita do paciente; os convênios faturam no fim do ciclo e pagam 30–45 dias
 * depois; e as despesas fixas, a folha, o repasse aos profissionais e os impostos saem
 * todo mês. O mês corrente fica com contas a vencer, e há algumas em atraso.
 */
final class Financeiro
{
    /** @var list<array<string, mixed>> */
    private array $lancamentos = [];

    /** @var array<string, array<int, float>> "Y-m" → profissional (índice) → produção */
    private array $producao = [];

    public function __construct(private readonly Contexto $ctx) {}

    public function semear(): void
    {
        $this->sessoesParticulares();
        $this->faturamentoDosConvenios();
        for ($mes = $this->ctx->inicio; $mes <= $this->ctx->hoje->addMonth(); $mes = $mes->addMonth()) {
            $this->despesasDoMes($mes);
        }
        $this->investimentoParcelado();
        $this->ctx->inserirEmLote('lancamentos_caixa', $this->lancamentos);
        $this->transferencias();
        $this->fechamentosDeCiclo();
    }

    private function sessoesParticulares(): void
    {
        foreach ($this->ctx->sessoes as $sessao) {
            $plano = $this->ctx->planos[$sessao['plano']];
            $realizada = $sessao['status'] === 'Finalizado';
            if (! in_array($sessao['status'], ['Finalizado', 'Não Compareceu'], true) || $sessao['fim'] > $this->ctx->agora) {
                continue;
            }
            $valor = $this->ctx->convenios[$plano['convenio']]['precos'][$plano['especialidade']]['valor'];
            $mes = $sessao['inicio']->format('Y-m');
            $this->producao[$mes][$plano['profissional']] = ($this->producao[$mes][$plano['profissional']] ?? 0) + $valor;
            if (! $this->ctx->convenios[$plano['convenio']]['particular']) {
                continue;
            }
            $dias = (int) $sessao['inicio']->diffInDays($this->ctx->agora);
            $pago = match (true) {
                $dias < 12 => $this->ctx->chance(0.7),
                $dias < 45 => $this->ctx->chance(0.95),
                default => $this->ctx->chance(0.997),
            };
            $pagoEm = $pago ? $sessao['fim']->addDays($this->ctx->chance(0.85) ? 0 : $this->ctx->entre(1, 6))->min($this->ctx->agora) : null;
            // quem ainda não pagou a sessão recente acerta no fechamento do mês (a receber);
            // só a dívida antiga fica vencida — o "em atraso" de uma clínica saudável é pequeno
            $vencimento = $pagoEm === null && $dias < 45 ? $sessao['inicio']->endOfMonth()->startOfDay()->max($this->ctx->hoje->addDays(3)) : $sessao['inicio'];
            $forma = $this->ctx->pesado(['PIX' => 45, 'Cartão de crédito' => 25, 'Cartão de débito' => 15, 'Dinheiro' => 10, 'Transferência' => 5]);
            $this->lancamento('receita', $sessao['inicio'], $vencimento, $valor, 'Atendimentos', 'Sessões particulares', $forma, $pagoEm, [
                'interessado_tipo' => 'paciente', 'interessado_id' => $this->ctx->pacientes[$plano['paciente']]['id'],
                'agendamento_id' => $sessao['id'], 'tratamento_id' => $sessao['tratamento_id'],
                'obs' => $realizada ? null : 'Falta sem aviso — cobrada conforme o contrato',
                'pago_por_id' => $pagoEm !== null ? $this->ctx->um($this->ctx->recepcao) : null,
            ]);
        }
    }

    /** Uma fatura por convênio por mês, paga 30–45 dias depois, com uma glosa pequena. */
    private function faturamentoDosConvenios(): void
    {
        $porConvenioMes = [];
        foreach ($this->ctx->sessoes as $sessao) {
            $plano = $this->ctx->planos[$sessao['plano']];
            if ($this->ctx->convenios[$plano['convenio']]['particular'] || ! in_array($sessao['status'], ['Finalizado', 'Não Compareceu'], true) || $sessao['fim'] > $this->ctx->agora) {
                continue;
            }
            $chave = $plano['convenio'].'|'.$sessao['inicio']->format('Y-m');
            $porConvenioMes[$chave] = ($porConvenioMes[$chave] ?? 0) + $this->ctx->convenios[$plano['convenio']]['precos'][$plano['especialidade']]['valor'];
        }
        foreach ($porConvenioMes as $chave => $total) {
            [$convenio, $mes] = explode('|', $chave);
            if ($mes === $this->ctx->inicio->format('Y-m')) {
                foreach ([1, 2] as $recuo) {
                    $porConvenioMes[$convenio.'|'.$this->ctx->inicio->subMonths($recuo)->format('Y-m')] = round($total * (1 - $recuo * 0.04), 2);
                }
            }
        }
        foreach ($porConvenioMes as $chave => $total) {
            [$convenio, $mes] = explode('|', $chave);
            $competencia = CarbonImmutable::parse("{$mes}-01", $this->ctx->agora->timezone)->endOfMonth()->startOfDay();
            if ($competencia >= $this->ctx->hoje) {
                continue; // o mês corrente ainda não foi faturado
            }
            // prazo que cai no MEIO do mês seguinte: vencer no dia 30/31 jogava a fatura ora num mês,
            // ora no outro, e o resultado mensal oscilava sem motivo de negócio
            $vencimento = $competencia->addDays($convenio === 'Sempre Bem Assistência' ? 40 : 25);
            $pagoEm = $vencimento <= $this->ctx->hoje ? $vencimento->addDays($this->ctx->entre(0, 2))->setTime(10, 0)->min($this->ctx->agora) : null;
            $this->lancamento('receita', $competencia, $vencimento, round($total, 2), 'Atendimentos', 'Faturamento de convênios', 'Transferência', $pagoEm, [
                'documento' => 'FAT-'.str_replace('-', '', $mes).'-'.strtoupper(substr(Str::slug($convenio), 0, 4)),
                'desconto' => round($total * $this->ctx->entre(5, 35) / 1000, 2),
                'obs' => "Faturamento de {$mes} — {$convenio}", 'pago_por_id' => $pagoEm !== null ? $this->ctx->ids['usuario:financeiro'] : null,
            ]);
        }
    }

    private function despesasDoMes(CarbonImmutable $mes): void
    {
        $energia = 980 + ($mes->month >= 11 || $mes->month <= 3 ? 420 : 0) + $this->ctx->entre(-60, 90);
        $fixas = [
            ['Despesas da clínica', 'Aluguel e condomínio', 7800, 5, 'Horizonte Imóveis', 'Aluguel e condomínio'],
            ['Despesas da clínica', 'Energia, água e internet', $energia, 12, 'Energia', 'Conta de energia'],
            ['Despesas da clínica', 'Energia, água e internet', 389.90, 15, 'Conecta Fibra', 'Internet e telefonia'],
            ['Despesas da clínica', 'Contabilidade', 980, 10, 'Exata Contabilidade', 'Honorários contábeis'],
            ['Despesas da clínica', 'Software e sistemas', 489, 8, null, 'Sistema de gestão da clínica'],
            ['Despesas da clínica', 'Manutenção e limpeza', 1250, 20, 'Limpa Bem', 'Limpeza e higienização das salas'],
            ['Materiais terapêuticos', 'Brinquedos e jogos', $this->ctx->entre(450, 1600), 18, 'Brincar e Aprender', 'Reposição de jogos e materiais'],
            ['Marketing', 'Anúncios on-line', $this->ctx->entre(600, 1100), 25, null, 'Anúncios em redes sociais'],
            ['Despesas bancárias', 'Tarifas e taxas de cartão', $this->ctx->entre(310, 520), 28, null, 'Tarifas bancárias e taxa da maquininha'],
        ];
        foreach ($fixas as [$categoria, $sub, $valor, $dia, $fornecedor, $obs]) {
            $extra = $fornecedor !== null ? ['interessado_tipo' => 'fornecedor', 'interessado_id' => $this->ctx->fornecedores[$fornecedor]] : [];
            $this->despesa($mes, $dia, (float) $valor, $categoria, $sub, $extra + ['obs' => $obs]);
        }
        foreach ($this->ctx->funcionarios as $indice => $funcionario) {
            $salario = [4200, 2450, 2450, 1850][$indice] ?? 2000;
            $this->despesa($mes, 5, $salario, 'Pessoal', 'Salários', ['interessado_tipo' => 'funcionario', 'interessado_id' => $funcionario, 'obs' => 'Salário']);
        }
        $this->despesa($mes, 20, 3150, 'Pessoal', 'Encargos e benefícios', ['obs' => 'FGTS, INSS e vale-transporte']);
        $this->repasseEImposto($mes);
        $this->despesa($mes, 28, round(58000 * 0.0085, 2), 'Receitas financeiras', 'Rendimento de aplicação', ['obs' => 'Rendimento da reserva'], 'receita');
    }

    private function repasseEImposto(CarbonImmutable $mes): void
    {
        $anterior = $mes->subMonth()->format('Y-m');
        // o mês ANTES do histórico também teve produção: sem ela, o primeiro mês sairia sem
        // repasse nem imposto e o resultado dele pareceria inflado
        $producaoAnterior = $this->producao[$anterior] ?? $this->producao[$this->ctx->inicio->format('Y-m')] ?? [];
        foreach ($producaoAnterior as $profissional => $producao) {
            $this->despesa($mes, 10, round($producao * 0.38, 2), 'Repasse aos profissionais', 'Repasse mensal', [
                'documento' => 'RPA-'.str_replace('-', '', $anterior).'-'.($profissional + 1),
                'obs' => 'Repasse de '.$anterior.' — '.$this->ctx->profissionais[$profissional]['nome'],
            ]);
        }
        $base = array_sum($producaoAnterior);
        if ($base > 0) {
            $this->despesa($mes, 20, round($base * 0.064, 2), 'Impostos', 'Simples Nacional', ['documento' => 'DAS '.$anterior, 'obs' => 'Simples Nacional (DAS)']);
        }
    }

    /** O balanço de integração sensorial comprado em 4x — mostra o parcelamento. */
    private function investimentoParcelado(): void
    {
        $grupo = (string) Str::uuid();
        $compra = $this->ctx->hoje->subMonths(2)->startOfMonth()->addDays(14);
        for ($parcela = 1; $parcela <= 4; $parcela++) {
            $vencimento = $compra->addMonths($parcela - 1);
            $this->lancamento('despesa', $compra, $vencimento, 3150, 'Investimentos', 'Equipamentos', 'Transferência',
                $vencimento < $this->ctx->hoje ? $vencimento->setTime(9, 0) : null, [
                    'interessado_tipo' => 'fornecedor', 'interessado_id' => $this->ctx->fornecedores['Sensorial Kids'],
                    'grupo_parcelamento' => $grupo, 'parcela' => $parcela, 'parcelas_total' => 4, 'documento' => 'NF 20931',
                    'obs' => 'Balanço e plataforma de integração sensorial', 'pago_por_id' => $vencimento < $this->ctx->hoje ? $this->ctx->ids['usuario:financeiro'] : null,
                ]);
        }
    }

    /** @param  array<string, mixed>  $extra */
    private function despesa(CarbonImmutable $mes, int $dia, float $valor, string $categoria, string $sub, array $extra, string $tipo = 'despesa'): void
    {
        $vencimento = $mes->setDay(min($dia, $mes->daysInMonth));
        if ($vencimento > $this->ctx->hoje->addMonth()->endOfMonth()) {
            return;
        }
        // a conta de energia do mês passado ficou para trás — o "em atraso" precisa existir
        $esquecida = $sub === 'Energia, água e internet' && $vencimento->format('Y-m') === $this->ctx->hoje->subMonth()->format('Y-m') && $dia === 12;
        $pagoEm = $vencimento <= $this->ctx->hoje && ! $esquecida ? $vencimento->subDays($this->ctx->entre(0, 2))->setTime(9, 30) : null;
        $forma = $tipo === 'receita' ? 'Transferência' : $this->ctx->pesado(['PIX' => 50, 'Transferência' => 40, 'Cartão de crédito' => 10]);
        $this->lancamento($tipo, $mes, $vencimento, $valor, $categoria, $sub, $forma, $pagoEm, $extra + [
            'pago_por_id' => $pagoEm !== null ? $this->ctx->ids['usuario:financeiro'] : null,
        ]);
    }

    /** @param  array<string, mixed>  $extra */
    private function lancamento(string $tipo, CarbonImmutable $competencia, CarbonImmutable $vencimento, float $valor, string $categoria,
        string $sub, string $forma, ?CarbonImmutable $pagoEm, array $extra): void
    {
        $conta = match (true) {
            $tipo === 'receita' && $sub === 'Rendimento de aplicação' => 'conta:aplicacao',
            $forma === 'Dinheiro' => 'conta:caixa',
            default => 'conta:banco',
        };
        $this->lancamentos[] = array_merge([
            'tipo' => $tipo, 'competencia' => $competencia->toDateString(), 'vencimento' => $vencimento->toDateString(),
            'interessado_tipo' => null, 'interessado_id' => null,
            'categoria_id' => $this->ctx->ids["categoria:{$categoria}"], 'subcategoria_id' => $this->ctx->ids["sub:{$sub}"],
            'valor' => $valor, 'juros' => 0, 'multa' => 0, 'desconto' => 0,
            'tipo_pagamento_id' => $this->ctx->ids["pagamento:{$forma}"], 'conta_id' => $this->ctx->ids[$conta],
            'contabil' => true, 'documento' => null, 'obs' => null, 'agendamento_id' => null, 'tratamento_id' => null,
            'grupo_parcelamento' => null, 'parcela' => null, 'parcelas_total' => null,
            'pago_em' => $pagoEm?->format('Y-m-d H:i:s'), 'pago_por_id' => null,
            'created_at' => $this->ctx->utc($competencia->min($this->ctx->agora)->setTime(8, 0)),
        ], $extra);
    }

    /** Depósito do dinheiro da recepção e reforço da reserva. */
    private function transferencias(): void
    {
        $linhas = [];
        for ($mes = $this->ctx->inicio; $mes < $this->ctx->hoje; $mes = $mes->addMonth()) {
            foreach ([10, 25] as $dia) {
                $data = $mes->setDay($dia);
                if ($data < $this->ctx->hoje) {
                    $linhas[] = ['conta_origem_id' => $this->ctx->ids['conta:caixa'], 'conta_destino_id' => $this->ctx->ids['conta:banco'],
                        'valor' => $this->ctx->entre(9, 22) * 100, 'data' => $data->toDateString(), 'obs' => 'Depósito do dinheiro da recepção'];
                }
            }
            if ($mes->month % 3 === 0) {
                $linhas[] = ['conta_origem_id' => $this->ctx->ids['conta:banco'], 'conta_destino_id' => $this->ctx->ids['conta:aplicacao'],
                    'valor' => 8000, 'data' => $mes->setDay(28)->toDateString(), 'obs' => 'Reforço da reserva'];
            }
        }
        $this->ctx->inserirEmLote('transferencias', $linhas);
    }

    /** Ciclos dos convênios fechados até o último completo; o corrente fica aberto. */
    private function fechamentosDeCiclo(): void
    {
        foreach ($this->ctx->convenios as $convenio) {
            $linha = DB::table('convenios')->where('id', $convenio['id'])->first(['ciclo_tipo_corte', 'ciclo_dia_corte']);
            if ($linha->ciclo_tipo_corte === null) {
                continue;
            }
            $janela = CalendarioDoCiclo::janelaQueContem($linha->ciclo_tipo_corte, $linha->ciclo_dia_corte, $this->ctx->inicio);
            while (CarbonImmutable::parse($janela['periodo_fim']) < $this->ctx->hoje) {
                $fechado = CarbonImmutable::parse($janela['periodo_fim'], $this->ctx->agora->timezone)->addDays(3)->setTime(17, 0);
                $this->ctx->inserir('fechamentos_ciclo', ['convenio_id' => $convenio['id'], 'periodo_inicio' => $janela['periodo_inicio'],
                    'periodo_fim' => $janela['periodo_fim'], 'fechado_por' => $this->ctx->ids['usuario:financeiro'],
                    'fechado_em' => $this->ctx->utc($fechado->min($this->ctx->agora)), 'created_at' => $this->ctx->utc($fechado->min($this->ctx->agora))]);
                $janela = CalendarioDoCiclo::janelaQueContem($linha->ciclo_tipo_corte, $linha->ciclo_dia_corte, CarbonImmutable::parse($janela['periodo_fim'])->addDay());
            }
        }
    }
}
