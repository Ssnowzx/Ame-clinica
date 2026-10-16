<?php

namespace App\Http\Controllers;

use App\Http\Requests\DesmarqueEmLoteRequest;
use App\Models\Agendamento;
use App\Models\Profissional;
use App\Models\StatusAgendamento;
use App\Support\Agenda\AgendamentoService;
use App\Support\Agenda\AlcanceEmLote;
use App\Support\Agenda\AplicadorDeStatusEmLote;
use App\Support\Agenda\DesmarqueEmLote;
use App\Support\Auditoria\ContextoDoLote;
use App\Support\Auditoria\RegistroDeAuditoria;
use App\Support\Mensageria\AvisoDeDesmarque;
use App\Support\Rbac\EscopoDoProfissional;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Log;

/**
 * Baixa em massa da agenda de um profissional (change `desmarque-do-profissional`).
 *
 * Duas rotas com os MESMOS parâmetros: `previa` classifica sem escrever, `executar` recalcula e
 * escreve. A execução não recebe ids da prévia de propósito (design D1).
 *
 * A execução roda sobre a espinha partilhada com a baixa em lote por status (D1 de
 * `baixa-em-lote-por-status`): alcance travado antes do loop (`sobLock`), status aplicado linha
 * a linha pelo `AplicadorDeStatusEmLote` sem encadeamento, e a trilha ligada por um `lote_id`
 * (D11) — cada linha de agendamento carrega a chave, e a linha-mãe no profissional guarda o
 * alcance, o motivo digitado e os recusados. A resposta é a de sempre, com `lote_id` a mais.
 */
class DesmarqueEmLoteController extends Controller
{
    public function __construct(
        private readonly DesmarqueEmLote $desmarque,
        private readonly AgendamentoService $agendamentos,
        private readonly AplicadorDeStatusEmLote $aplicador,
        private readonly AlcanceEmLote $alcance,
        private readonly ContextoDoLote $contexto,
        private readonly EscopoDoProfissional $escopos,
        private readonly AvisoDeDesmarque $avisos,
    ) {}

    /**
     * O escopo AGENDA do usuário (D11 · SEC-VP-01), pela fonte única. Sem isto a operação
     * nasceria PLANA: um profissional vinculado, SEM `agenda.ver_todos`, poderia desmarcar a
     * agenda de um COLEGA — e em massa. Foi a guarda `EscopoPorPadrao` do repo que pegou a
     * omissão, não eu.
     */
    private function assegurarPosseDaAgenda(int $profissionalId): void
    {
        $this->escopos->agenda(request()->user())->assegurarPosse($profissionalId);
    }

    /** Não escreve NADA: nem status, nem bloqueio, nem mensagem. */
    public function previa(DesmarqueEmLoteRequest $request): JsonResponse
    {
        $dados = $request->validated();
        $this->assegurarPosseDaAgenda($dados['profissional_id']);
        $alcance = $this->desmarque->resolver(
            $dados['profissional_id'], $dados['de'], $dados['ate'], $dados['periodo']
        );

        return response()->json([
            'contagens' => [
                ...$alcance['contagens'],
                // quantas famílias receberiam mensagem: uma por criança distinta
                'avisos' => $alcance['contagens']['criancas'],
            ],
            'recusados' => AplicadorDeStatusEmLote::serializar($alcance['recusados']),
        ]);
    }

    public function executar(DesmarqueEmLoteRequest $request): JsonResponse
    {
        $dados = $request->validated();
        $this->assegurarPosseDaAgenda($dados['profissional_id']);
        // valida o status ANTES de abrir transação: erro de configuração não merece rollback
        $status = $this->desmarque->statusAplicado($dados['status_id'] ?? null);
        $profissional = Profissional::findOrFail($dados['profissional_id']);

        // transação única com o lote aberto dentro dela e fechado em `finally` (D11): um passo
        // que falha no meio reverte tudo, e a escrita seguinte da requisição nasce sem lote
        $lote = $this->contexto->executar('desmarque_em_lote', function (string $loteId) use ($dados, $status, $profissional): array {
            // RECALCULA sob a transação (D1), agora com o alcance TRAVADO (D7): agendamentos
            // e atendimentos em `id` crescente antes do loop — a classificação da prévia
            // envelheceu, e um atendimento registrado no meio do lote não pode ser desmarcado
            $alcance = $this->desmarque->resolver(
                $dados['profissional_id'], $dados['de'], $dados['ate'], $dados['periodo'], sobLock: true
            );
            $aplicacao = $this->aplicador->aplicar($alcance['elegiveis'], $status->id);
            $recusados = [...$alcance['recusados'], ...$aplicacao['recusados']];

            if ($dados['bloquear']) {
                $this->bloquearJanelas($dados);
            }

            $this->registrarLinhaMae($profissional, $status, $dados, $aplicacao['aplicados'], $recusados);

            return ['lote_id' => $loteId, 'desmarcados' => $aplicacao['aplicados'], 'recusados' => $recusados];
        });

        /** @var Collection<int, Agendamento> $desmarcados */
        $desmarcados = $lote['desmarcados'];

        // AQUI, depois do commit (design D3): nenhuma mensagem pode sair antes de a escrita
        // estar confirmada. Se a transação acima tivesse revertido, este ponto não seria
        // alcançado — e é essa ordem, não uma flag, que garante a promessa.
        //
        // Sem a permissão do módulo de mensagens, ninguém é avisado e a recepção recebe a
        // lista para resolver à mão: o desmarque não fica refém do canal.
        $temPermissao = $request->user()?->can('mensagens.responder') === true;
        $aviso = $dados['avisar'] && $temPermissao
            ? $this->avisarSemDerrubarOLote($desmarcados, $request->user()?->id)
            : ['avisados' => 0, 'nao_avisados' => $this->familiasSemAviso($desmarcados, $dados['avisar'], $temPermissao)];

        return response()->json([
            'desmarcados' => $desmarcados->count(),
            'recusados' => AplicadorDeStatusEmLote::serializar($lote['recusados']),
            'avisados' => $aviso['avisados'],
            'nao_avisados' => $aviso['nao_avisados'],
            'lote_id' => $lote['lote_id'],
        ]);
    }

    /**
     * Um bloqueio por dia do intervalo, cobrindo o período (design D5). IDEMPOTENTE: repetir o
     * gesto (o atestado que se estende mais um dia) não pode empilhar bloqueios iguais nem
     * falhar por conflito consigo mesmo — dois bloqueios sobre a mesma janela são o mesmo fato
     * dito duas vezes.
     *
     * @param  array<string, mixed>  $dados
     */
    private function bloquearJanelas(array $dados): void
    {
        foreach ($this->desmarque->janelasDoBloqueio($dados['de'], $dados['ate'], $dados['periodo']) as $janela) {
            $jaBloqueado = Agendamento::where('tipo', 'bloqueio')
                ->where('profissional_id', $dados['profissional_id'])
                ->where('inicio', '<=', $janela['inicio'])
                ->where('fim', '>=', $janela['fim'])
                ->exists();

            if ($jaBloqueado) {
                continue;
            }

            $this->agendamentos->criar([
                'tipo' => 'bloqueio',
                'profissional_id' => $dados['profissional_id'],
                'inicio' => $janela['inicio']->format('Y-m-d H:i'),
                'fim' => $janela['fim']->format('Y-m-d H:i'),
                'obs' => $dados['motivo'],
            ]);
        }
    }

    /**
     * A LINHA-MÃE do lote (D11), pela porta única da trilha, na entidade do profissional cuja
     * agenda foi tocada — SEM `paciente_id`: os ids de agendamento bastam para reconstituir, e
     * quem precisa do nome segue pela trilha do agendamento, com o mascaramento de sempre. O
     * `motivo` digitado entra aqui (fecha `DESMARQUE-MOTIVO-FORA-DA-TRILHA`).
     *
     * @param  array<string, mixed>  $dados
     * @param  Collection<int, Agendamento>  $desmarcados
     * @param  list<array{agendamento: Agendamento, motivo: string}>  $recusados
     */
    private function registrarLinhaMae(
        Profissional $profissional,
        StatusAgendamento $status,
        array $dados,
        Collection $desmarcados,
        array $recusados,
    ): void {
        RegistroDeAuditoria::registrar($profissional, 'desmarque_em_lote', ['depois' => [
            'status_id' => $status->id,
            'status_nome' => $status->nome,
            'de' => $dados['de'],
            'ate' => $dados['ate'],
            'periodo' => $dados['periodo'],
            'motivo' => $dados['motivo'],
            'desmarcados' => $desmarcados->count(),
            'criancas' => $this->alcance->criancasDistintas($desmarcados),
            'recusados' => AplicadorDeStatusEmLote::paraTrilha($recusados),
        ]]);
    }

    /**
     * As famílias que ficam sem aviso quando o envio não acontece — para a recepção resolver
     * à mão em vez de descobrir depois, pela mãe ligando.
     *
     * @param  Collection<int, Agendamento>  $desmarcados
     * @return list<array{paciente_id: int|null, motivo: string}>
     */
    private function familiasSemAviso($desmarcados, bool $pedido, bool $temPermissao): array
    {
        if (! $pedido) {
            return [];
        }

        $motivo = $temPermissao ? 'aviso não enviado' : 'sem permissão para enviar mensagens';

        return $desmarcados->pluck('paciente_id')->filter()->unique()
            ->map(fn ($id) => ['paciente_id' => $id, 'motivo' => $motivo])
            ->values()->all();
    }

    /**
     * O aviso roda FORA de transação e depois do commit — uma falha de rede na Cloud API ou
     * um erro ao abrir conversa viraria 500 com o lote JÁ GRAVADO, e a recepcionista
     * concluiria que não funcionou e clicaria de novo (achado do gate). O desmarque já
     * aconteceu; a resposta tem de dizer isso, não estourar.
     *
     * @param  Collection<int, Agendamento>  $desmarcados
     * @return array{avisados: int, nao_avisados: list<array{paciente_id: int|null, motivo: string}>}
     */
    private function avisarSemDerrubarOLote($desmarcados, ?int $autorId): array
    {
        try {
            return $this->avisos->avisar($desmarcados, $autorId);
        } catch (\Throwable $erro) {
            Log::error('Falha ao avisar as famílias do desmarque em lote', [
                'erro' => $erro->getMessage(),
                'desmarcados' => $desmarcados->count(),
            ]);

            return [
                'avisados' => 0,
                'nao_avisados' => $this->familiasSemAviso($desmarcados, true, true),
            ];
        }
    }
}
