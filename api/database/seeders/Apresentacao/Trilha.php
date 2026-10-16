<?php

namespace Database\Seeders\Apresentacao;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * A trilha de auditoria de uma clínica que funciona há meses — e não de um seeder que
 * rodou agora. Os registros que a semeadura gerou (todos "sistema", todos com o
 * carimbo de hoje) saem; entram os de 90 dias de operação, com autor e data: quem marcou,
 * quem deu baixa, quem remarcou, quem recebeu, e as crianças que tiveram alta.
 *
 * É daqui que saem "movimentação da agenda", "movimentação do financeiro" e o "saíram"
 * do painel de pacientes.
 */
final class Trilha
{
    /** @var list<array<string, mixed>> */
    private array $linhas = [];

    public function __construct(private readonly Contexto $ctx) {}

    public function semear(int $primeiroIdDaSemeadura): void
    {
        DB::table('auditoria')->where('id', '>=', $primeiroIdDaSemeadura)->delete();

        $this->agenda();
        $this->financeiro();
        $this->altas();
        usort($this->linhas, fn (array $a, array $b) => $a['criado_em'] <=> $b['criado_em']);
        $this->ctx->inserirEmLote('auditoria', $this->linhas, carimbos: false);
    }

    private function agenda(): void
    {
        $desde = $this->ctx->hoje->subDays(90);
        foreach ($this->ctx->sessoes as $sessao) {
            if ($sessao['inicio'] < $desde || $sessao['inicio'] > $this->ctx->hoje->addDays(14)) {
                continue;
            }
            $plano = $this->ctx->planos[$sessao['plano']];
            $profissional = $this->ctx->profissionais[$plano['profissional']];
            $marcado = $sessao['inicio']->subDays($this->ctx->entre(2, 20))->setTime($this->ctx->entre(8, 17), $this->ctx->entre(0, 59));
            $this->registrar('agendamentos', $sessao['id'], 'criou', $marcado->min($this->ctx->agora), $this->ctx->um($this->ctx->recepcao), [
                'depois' => ['paciente_id' => $this->ctx->pacientes[$plano['paciente']]['id'], 'profissional_id' => $profissional['id'],
                    'inicio' => $sessao['inicio']->format('Y-m-d H:i:s'), 'fim' => $sessao['fim']->format('Y-m-d H:i:s'), 'status_id' => $this->ctx->status['Em Aberto']],
            ]);
            if ($this->ctx->chance(0.06)) {
                $antes = $sessao['inicio']->subDay();
                $this->registrar('agendamentos', $sessao['id'], 'atualizou', $marcado->addDay()->min($this->ctx->agora), $this->ctx->um($this->ctx->recepcao), [
                    'antes' => ['inicio' => $antes->format('Y-m-d H:i:s')], 'depois' => ['inicio' => $sessao['inicio']->format('Y-m-d H:i:s')],
                ]);
            }
            if ($sessao['status'] === 'Em Aberto' || $sessao['fim'] > $this->ctx->agora) {
                continue;
            }
            $autor = $sessao['status'] === 'Finalizado' && $profissional['usuario_id'] !== null ? $profissional['usuario_id'] : $this->ctx->um($this->ctx->recepcao);
            $this->registrar('agendamentos', $sessao['id'], 'atualizou', $sessao['fim']->addMinutes($this->ctx->entre(1, 50))->min($this->ctx->agora), $autor, [
                'antes' => ['status_id' => $this->ctx->status['Em Aberto']], 'depois' => ['status_id' => $this->ctx->status[$sessao['status']]],
            ]);
        }
    }

    /** Baixas dos últimos 90 dias: o "atualizou pago_em" que a movimentação do financeiro lê. */
    private function financeiro(): void
    {
        $desde = $this->ctx->hoje->subDays(90)->format('Y-m-d H:i:s');
        DB::table('lancamentos_caixa')->where('pago_em', '>=', $desde)
            ->orderBy('id')->get(['id', 'pago_em', 'pago_por_id', 'created_at'])
            ->each(function (object $lancamento): void {
                $pagoEm = CarbonImmutable::parse($lancamento->pago_em, $this->ctx->agora->timezone);
                $this->registrar('lancamentos_caixa', (int) $lancamento->id, 'atualizou', $pagoEm->addMinutes(2),
                    $lancamento->pago_por_id !== null ? (int) $lancamento->pago_por_id : $this->ctx->adminId,
                    ['antes' => ['pago_em' => null], 'depois' => ['pago_em' => $pagoEm->format('Y-m-d H:i:s')]]);
            });
    }

    /** A alta: `ativo` true → false é o que o painel conta como "saíram". */
    private function altas(): void
    {
        foreach ($this->ctx->pacientes as $paciente) {
            if ($paciente['saida'] === null) {
                continue;
            }
            $this->registrar('pacientes', $paciente['id'], 'atualizou', $paciente['saida']->addDays(2)->setTime(16, 20), $this->ctx->recepcao[0], [
                'antes' => ['ativo' => true], 'depois' => ['ativo' => false],
            ]);
        }
    }

    /** @param  array<string, mixed>  $diff */
    private function registrar(string $entidade, int $id, string $acao, CarbonImmutable $quando, int $usuario, array $diff): void
    {
        $this->linhas[] = ['usuario_id' => $usuario, 'autor_tipo' => 'usuario', 'entidade' => $entidade,
            'entidade_id' => $id, 'acao' => $acao, 'lote_id' => null, 'diff_json' => json_encode($diff), 'ip' => '10.0.0.'.(20 + $usuario % 30),
            'criado_em' => $this->ctx->utc($quando)];
    }
}
