<?php

namespace App\Support\Clinica;

use App\Models\Agendamento;
use App\Models\Atendimento;
use App\Support\Configuracoes\ConfiguracaoService;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Registrar que a sessão ACONTECEU — o atendimento 1:1 com o agendamento.
 *
 * Extraído do `AtendimentoController::store` sem mudar uma linha da regra (change
 * evolucao-finaliza-a-sessao, D1): a evolução escrita direto da sessão registra o atendimento que
 * falta pelo MESMO caminho — lock, tipo, unicidade e a trava da evolução vencida. Quem chama já
 * fez a posse (403/404) e decidiu `finalizado_em`.
 */
class RegistroDeAtendimento
{
    private const ERRO_UNIQUE = 1062;

    public function __construct(
        private readonly ConfiguracaoService $configuracoes,
        private readonly EvolucoesEmAberto $evolucoesEmAberto,
    ) {}

    /**
     * @param  array<string, mixed>  $dados  os campos do atendimento, com `finalizado_em` já decidido
     */
    public function registrar(int $agendamentoId, array $dados): Atendimento
    {
        return DB::transaction(function () use ($agendamentoId, $dados): Atendimento {
            $agendamento = Agendamento::whereKey($agendamentoId)->lockForUpdate()->firstOrFail();

            // revalidado SOB LOCK: o PUT concorrente pode ter convertido para bloqueio entre
            // a leitura de cima e este ponto
            if ($agendamento->tipo !== 'atendimento') {
                throw ValidationException::withMessages([
                    'agendamento_id' => 'Bloqueio de agenda não é atendível.',
                ]);
            }

            if ($agendamento->atendimento()->exists()) {
                throw ValidationException::withMessages([
                    'agendamento_id' => 'Este agendamento já tem atendimento registrado.',
                ]);
            }

            // A TRAVA da evolução vencida (change trava-de-evolucao, D1) — pós-posse,
            // SOB O MESMO LOCK do save: quem decide é o profissional do AGENDAMENTO
            // relido, nunca quem clica (a recepção não contorna a trava de ninguém).
            $this->assegurarSemEvolucaoVencidaAlemDaCarencia((int) $agendamento->profissional_id);

            $novo = new Atendimento($dados);
            $novo->agendamento_id = $agendamento->id;

            try {
                $novo->save(); // unique(agendamento_id) é o anti-race no banco (T-ate-01)
            } catch (QueryException $excecao) {
                if (($excecao->errorInfo[1] ?? null) !== self::ERRO_UNIQUE) {
                    throw $excecao;
                }
                throw ValidationException::withMessages([
                    'agendamento_id' => 'Este agendamento já tem atendimento registrado.',
                ]);
            }

            return $novo;
        });
    }

    /**
     * A trava do finalizar (change trava-de-evolucao, D1/FA-10): profissional com ≥1
     * evolução em aberto vencida há mais de `evolucoes.trava_carencia_dias` além do
     * prazo fica inapto de REGISTRAR novas sessões até quitar as vencidas. A contagem
     * vem da fonte única `EvolucoesEmAberto` — a MESMA do aviso do centro de
     * notificações (D3): o dia em que `bloqueio_em_dias` chega a 0 é o dia deste 422.
     * A escrita da evolução atrasada continua SEMPRE aceita (D2) — quitou, destravou.
     * Regra é DADO (§13): prazo e carência saem do catálogo, nunca daqui.
     */
    private function assegurarSemEvolucaoVencidaAlemDaCarencia(int $profissionalId): void
    {
        $vencidas = $this->evolucoesEmAberto->vencidasAlemDaCarencia($profissionalId)->count();
        if ($vencidas === 0) {
            return;
        }

        $carencia = (int) $this->configuracoes->get('evolucoes.trava_carencia_dias');
        // carência 0 é valor válido do catálogo (D4): "há mais de 0 dias" seria copy quebrada
        $alemDoPrazo = $carencia === 0
            ? 'além do prazo'
            : sprintf('há mais de %d %s do prazo', $carencia, $carencia === 1 ? 'dia além' : 'dias além');
        throw ValidationException::withMessages([
            'evolucoes_vencidas' => sprintf(
                $vencidas === 1
                    ? 'O profissional deste agendamento tem %d evolução vencida %s — registre as evoluções pendentes para voltar a finalizar.'
                    : 'O profissional deste agendamento tem %d evoluções vencidas %s — registre as evoluções pendentes para voltar a finalizar.',
                $vencidas,
                $alemDoPrazo,
            ),
        ]);
    }
}
