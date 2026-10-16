<?php

namespace App\Http\Controllers;

use App\Http\Controllers\Concerns\ProtegeExclusaoEmUso;
use App\Http\Requests\StatusAgendamentoRequest;
use App\Models\StatusAgendamento;
use App\Support\Agenda\GuardaDasFlagsDeDesfecho;
use App\Support\Agenda\GuardaDoStatusInicial;
use App\Support\Configuracoes\ConfiguracaoService;
use App\Support\Http\ConcorrenciaOtimista;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;

class StatusAgendamentoController extends Controller
{
    use ProtegeExclusaoEmUso;

    private const CAMPOS = ['id', 'nome', 'cor', 'cor_borda', 'desconta_sessao', 'ocupa_horario', 'marca_falta', 'marca_reserva',
        'em_aberto', 'aplicavel_em_lote', // origem e alvo da baixa em lote por status (D2)
        'tipo', 'ordem',
        'updated_at', // token da concorrência otimista (If-Match)
    ];

    public function __construct(
        private readonly GuardaDoStatusInicial $guarda,
        private readonly GuardaDasFlagsDeDesfecho $flags,
        private readonly ConfiguracaoService $configuracoes,
    ) {}

    public function index(): JsonResponse
    {
        // MESMA ordenação que define o inicial (`inicialId()`: ordem, id) — quem
        // consome a lista pode confiar que o primeiro é aquele com que o
        // agendamento nasce. `ordem` não é única: o desempate precisa bater.
        return response()->json(
            StatusAgendamento::orderBy('ordem')->orderBy('id')->get(self::CAMPOS)
        );
    }

    public function store(StatusAgendamentoRequest $request): JsonResponse
    {
        // a guarda roda DEPOIS da escrita, no estado final da clínica e dentro da
        // transação: criar um status pode promovê-lo a inicial (ele é o de menor ordem)
        $status = DB::transaction(function () use ($request) {
            $dados = $request->validated();

            // `ordem` ausente cairia no default 0 da coluna — e um status novo, sem
            // ninguém pedir, viraria o INICIAL da clínica em silêncio. Sem ordem
            // explícita, ele nasce no FIM da fila.
            if (! array_key_exists('ordem', $dados)) {
                // teto do Request (999): nascer acima dele deixaria o status
                // INEDITÁVEL pelo formulário, que valida o mesmo máximo
                $dados['ordem'] = min((int) StatusAgendamento::max('ordem') + 1, 999);
            }

            $status = StatusAgendamento::create($dados);
            $this->guarda->verificar();
            // depois do inicial, de propósito: um inicial descontante é recusado pela razão
            // do inicial, não pela das flags — a mensagem que a clínica lê é a do defeito maior
            $this->flags->verificar($status->id, $dados);

            return $status;
        });

        return response()->json($status->only(self::CAMPOS), 201);
    }

    public function show(int $id): JsonResponse
    {
        return response()->json(StatusAgendamento::findOrFail($id)->only(self::CAMPOS));
    }

    public function update(StatusAgendamentoRequest $request, int $id): JsonResponse
    {
        // mudar a ORDEM de um status promove OUTRO a inicial; mudar as FLAGS pode
        // quebrar o inicial. Guarda que olha só o payload não veria nem um nem outro.
        $status = DB::transaction(function () use ($request, $id) {
            $status = StatusAgendamento::findOrFail($id);
            ConcorrenciaOtimista::assegurar($status, $request);
            $dados = $request->validated();
            $status->update($dados);
            $this->guarda->verificar();
            $this->flags->verificar($status->id, $dados);

            return $status;
        });

        return response()->json($status->only(self::CAMPOS));
    }

    public function destroy(int $id): Response
    {
        DB::transaction(function () use ($id) {
            $this->excluirProtegido(
                StatusAgendamento::findOrFail($id),
                'status_agendamento',
                'Este status está vinculado a agendamentos e não pode ser excluído.'
            );

            // A configuração do encadeamento aponta para um status numa tabela
            // chave-valor SEM chave estrangeira: nada no banco impede a referência de
            // ficar pendurada, e a automação morreria em SILÊNCIO (o serviço relê o
            // alvo e desiste). Aqui ela é desligada explicitamente, na mesma transação.
            if ((int) $this->configuracoes->get('agenda.encadeamento_status_id') === $id) {
                $this->configuracoes->set('agenda.encadeamento_status_id', 0);
                $this->configuracoes->set('agenda.encadeamento_ativo', false);
            }

            // idem para o desmarque em lote: a referência pendurada faria a operação
            // recusar com "falta configurar" em vez de silenciar, mas o efeito para a
            // recepção é o mesmo — a manhã não desmarca e ninguém sabe por quê
            if ((int) $this->configuracoes->get('agenda.status_desmarque_id') === $id) {
                $this->configuracoes->set('agenda.status_desmarque_id', 0);
            }
            // e para o desmarque pela família (lembrete-com-botoes-de-resposta): ponteiro pendurado
            // faria o "Desmarcar" do card aplicar um status que não existe
            if ((int) $this->configuracoes->get('lembretes.status_desmarque_familia_id') === $id) {
                $this->configuracoes->set('lembretes.status_desmarque_familia_id', 0);
            }
            // e para a finalização pela evolução (evolucao-finaliza-a-sessao, gate SEC-EVO-03): a
            // releitura já falha fechado, mas a tela de Configurações mostraria um status órfão
            if ((int) $this->configuracoes->get('evolucoes.status_ao_salvar') === $id) {
                $this->configuracoes->set('evolucoes.status_ao_salvar', 0);
            }

            // sem status não há `inicialId()` e nenhum agendamento pode ser criado;
            // excluir o primeiro também PROMOVE outro a inicial — que pode ser um
            // status descontante ou que não ocupa horário
            $this->guarda->verificar();
        });

        return response()->noContent();
    }
}
