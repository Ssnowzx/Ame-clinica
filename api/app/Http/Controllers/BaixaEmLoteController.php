<?php

namespace App\Http\Controllers;

use App\Exceptions\PreviaDesatualizadaException;
use App\Http\Requests\BaixaEmLoteRequest;
use App\Models\Agendamento;
use App\Models\Profissional;
use App\Models\StatusAgendamento;
use App\Support\Agenda\AlcanceEmLote;
use App\Support\Agenda\AplicadorDeStatusEmLote;
use App\Support\Agenda\BaixaEmLote;
use App\Support\Auditoria\ContextoDoLote;
use App\Support\Auditoria\RegistroDeAuditoria;
use App\Support\Rbac\EscopoDoProfissional;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Collection;

/**
 * Baixa em lote por status da agenda de um profissional (change `baixa-em-lote-por-status`).
 *
 * Duas rotas com os MESMOS parâmetros de alcance: `previa` classifica sem escrever e devolve a
 * assinatura do conjunto elegível + a referência temporal; `executar` exige os dois, RECALCULA
 * sob lock com a mesma referência e só escreve se a assinatura bater (D5). O número que a
 * recepção leu é o número que roda — ou é 409 com a prévia nova.
 *
 * A execução é uma transação só (D10): status relido, locks na ordem da casa, cada linha pelo
 * `AgendamentoService::atualizar` sem encadeamento (D9), linha-mãe na trilha (D11), commit.
 * Recusa de UMA linha é resultado; falha de um PASSO reverte tudo. Nada roda depois do commit.
 */
class BaixaEmLoteController extends Controller
{
    public function __construct(
        private readonly BaixaEmLote $baixa,
        private readonly AplicadorDeStatusEmLote $aplicador,
        private readonly AlcanceEmLote $alcance,
        private readonly ContextoDoLote $contexto,
        private readonly EscopoDoProfissional $escopos,
    ) {}

    /**
     * O escopo AGENDA do usuário (D11/D13), pela fonte única — além do `authorize()` da
     * Request, que já decidiu a posse antes da validação. A prévia é escopada porque a
     * contagem da agenda do colega já é vazamento.
     */
    private function assegurarPosseDaAgenda(int $profissionalId): void
    {
        $this->escopos->agenda(request()->user())->assegurarPosse($profissionalId);
    }

    /** Não escreve NADA: nem status, nem sessão, nem trilha. */
    public function previa(BaixaEmLoteRequest $request): JsonResponse
    {
        $dados = $request->validated();
        $this->assegurarPosseDaAgenda($dados['profissional_id']);
        $status = $this->baixa->statusAplicado($dados['status_id']);

        $previa = $this->baixa->resolver(
            $dados['profissional_id'], $status, $dados['de'], $dados['ate'], $this->baixa->agoraNaParede(),
        );

        return response()->json(BaixaEmLote::serializarPrevia($previa));
    }

    public function executar(BaixaEmLoteRequest $request): JsonResponse
    {
        $dados = $request->validated();
        $this->assegurarPosseDaAgenda($dados['profissional_id']);
        // ANTES da transação: erro de cadastro não merece rollback
        $status = $this->baixa->statusAplicado($dados['status_id']);
        $profissional = Profissional::findOrFail($dados['profissional_id']);
        $referencia = CarbonImmutable::parse($dados['referencia']);

        // prévia velha demais ou vinda do futuro: 409 com a prévia nova, sem tomar lock nenhum
        if (! $this->baixa->referenciaValida($referencia, $this->baixa->agoraNaParede())) {
            throw new PreviaDesatualizadaException($this->previaNova($dados, $status));
        }

        // transação única com o lote aberto dentro e fechado em `finally` (D11): um passo que
        // falha no meio reverte tudo, e a escrita seguinte da requisição nasce sem lote. A
        // corrida do motor (lock wait/deadlock → 409) é traduzida pela espinha, para os dois lotes
        $lote = $this->contexto->executar(
            'baixa_em_lote',
            fn (string $loteId): array => $this->aplicarSobLock($loteId, $dados, $referencia, $profissional),
        );

        return response()->json([
            'lote_id' => $lote['lote_id'],
            'aplicados' => $lote['aplicados']->count(),
            'contagens' => [
                'criancas' => $this->alcance->criancasDistintas($lote['aplicados']),
                'sessoes_descontadas' => $lote['sessoes_descontadas'],
            ],
            'recusados' => AplicadorDeStatusEmLote::serializar($lote['recusados']),
        ]);
    }

    /**
     * O corpo da transação (D10), nesta ordem: status RELIDO → alcance travado (agendamentos →
     * atendimentos → tratamentos) e classificado com a referência da prévia → assinatura
     * comparada → loop de escrita → linha-mãe.
     *
     * @param  array<string, mixed>  $dados
     * @return array{lote_id: string, aplicados: Collection<int, Agendamento>, sessoes_descontadas: int, recusados: list<array{agendamento: Agendamento, motivo: string}>}
     */
    private function aplicarSobLock(string $loteId, array $dados, CarbonImmutable $referencia, Profissional $profissional): array
    {
        // o admin que desligou `aplicavel_em_lote` entre a validação e o commit não deixa o lote passar
        $status = $this->baixa->statusAplicado($dados['status_id']);

        $resolvido = $this->baixa->resolver(
            $dados['profissional_id'], $status, $dados['de'], $dados['ate'], $referencia, sobLock: true,
        );

        // o conjunto que ela conferiu não é o que rodaria: 409 com a prévia nova, rollback
        if (! hash_equals($resolvido['assinatura'], (string) $dados['assinatura'])) {
            throw new PreviaDesatualizadaException($this->previaNova($dados, $status));
        }

        $aplicacao = $this->aplicador->aplicar($resolvido['elegiveis'], $status->id);
        $recusados = [...$resolvido['recusados'], ...$aplicacao['recusados']];
        $sessoesDescontadas = self::sessoesDescontadas($aplicacao['aplicados'], $resolvido['ids_a_descontar']);

        $this->registrarLinhaMae($profissional, $status, $dados, $aplicacao['aplicados'], $sessoesDescontadas, $recusados);

        return [
            'lote_id' => $loteId,
            'aplicados' => $aplicacao['aplicados'],
            'sessoes_descontadas' => $sessoesDescontadas,
            'recusados' => $recusados,
        ];
    }

    /**
     * A prévia como está AGORA — o corpo do 409 (D5): calculada com o minuto atual como
     * referência, sem lock, para a recepção conferir os números novos sem uma segunda ida.
     *
     * @param  array<string, mixed>  $dados
     * @return array<string, mixed>
     */
    private function previaNova(array $dados, StatusAgendamento $status): array
    {
        return BaixaEmLote::serializarPrevia($this->baixa->resolver(
            $dados['profissional_id'], $status, $dados['de'], $dados['ate'], $this->baixa->agoraNaParede(),
        ));
    }

    /**
     * Quantas sessões o lote consumiu de fato: das linhas que a prévia disse que descontariam,
     * as que foram aplicadas e saíram com o marcador de consumo — o `reconciliar` decide sob
     * lock, e é o estado gravado que conta, não a promessa.
     *
     * @param  Collection<int, Agendamento>  $aplicados
     * @param  list<int>  $idsADescontar
     */
    private static function sessoesDescontadas(Collection $aplicados, array $idsADescontar): int
    {
        return $aplicados
            ->filter(fn (Agendamento $a) => in_array($a->id, $idsADescontar, true) && $a->sessao_consumida_em !== null)
            ->count();
    }

    /**
     * A LINHA-MÃE do lote (D11), pela porta única da trilha, na entidade do profissional cuja
     * agenda foi tocada — SEM `paciente_id`: os ids de agendamento bastam para reconstituir, e
     * quem precisa do nome segue pela trilha do agendamento, com o mascaramento de sempre.
     *
     * @param  array<string, mixed>  $dados
     * @param  Collection<int, Agendamento>  $aplicados
     * @param  list<array{agendamento: Agendamento, motivo: string}>  $recusados
     */
    private function registrarLinhaMae(
        Profissional $profissional,
        StatusAgendamento $status,
        array $dados,
        Collection $aplicados,
        int $sessoesDescontadas,
        array $recusados,
    ): void {
        RegistroDeAuditoria::registrar($profissional, 'baixa_em_lote', ['depois' => [
            'status_id' => $status->id,
            'status_nome' => $status->nome,
            'de' => $dados['de'],
            'ate' => $dados['ate'],
            'aplicados' => $aplicados->count(),
            'criancas' => $this->alcance->criancasDistintas($aplicados),
            'sessoes_descontadas' => $sessoesDescontadas,
            'recusados' => AplicadorDeStatusEmLote::paraTrilha($recusados),
        ]]);
    }
}
