<?php

namespace App\Http\Controllers;

use App\Models\Agendamento;
use App\Models\LembreteEnviado;
use App\Support\Agenda\EstadoDaConfirmacao;
use App\Support\Auditoria\RegistroDeAuditoria;
use App\Support\Rbac\EscopoDoProfissional;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * "Manter a sessão (a família desistiu)" (change `lembrete-com-botoes-de-resposta`, rodada 1 do gate,
 * CRB-08): a família tocou em "Preciso desmarcar" por engano e confirmou por telefone — sem isto, o
 * alerta vermelho ficava no card e no sino da profissional até a sessão passar.
 *
 * A resposta vira "confirmou" com a hora da recepção: foi a família que confirmou, por outro canal.
 * O elo com o TOQUE da família (`resposta_mensagem_id`) fica — é a evidência de que ela pediu — e a
 * pessoa que manteve entra na TRILHA do agendamento (rodada 2 do gate, CRB2-03/SEC-BT-06): se a
 * sessão depois virar falta que desconta, a clínica sabe quem decidiu manter.
 *
 * "Marcar como confirmada" (change `confirmacao-pela-clinica`): a família não tocou em botão nenhum —
 * ou o lembrete nem chegou — e confirmou por telefone ou mensagem. Os dois atos gravam QUEM da clínica
 * confirmou (`confirmado_por`, D1), e o card passa a dizer "pela clínica".
 */
class ConfirmacaoDoLembreteController extends Controller
{
    /** O estado de antes, em palavras, para a trilha. */
    private const EM_PALAVRAS = [
        'aguardando' => 'Lembrete enviado, sem resposta da família',
        'nao_entregue' => 'Lembrete não entregue',
        'nao_enviado' => 'Lembrete não enviado',
    ];

    public function __construct(private readonly EscopoDoProfissional $escopos) {}

    public function manter(Request $request, int $id): JsonResponse
    {
        $agendamento = Agendamento::query()->with('status')->find($id);
        // posse ANTES da existência (`SEC-VP-40`): o par colega × inexistente não se separa por status
        $this->escopos->agenda($request->user())->assegurarPosse($agendamento?->profissional_id);
        abort_if($agendamento === null, 404);

        DB::transaction(function () use ($agendamento, $request): void {
            $linhas = LembreteEnviado::query()
                ->where('agendamento_id', $agendamento->id)
                ->where('resposta', LembreteEnviado::PEDIU_DESMARQUE)
                ->lockForUpdate()
                ->get();
            // a sessão RELIDA sob trava, na mesma ordem do desmarque automático (lembrete, depois
            // agendamento — sem deadlock): um desmarque que gravou entre a leitura de fora e aqui não
            // pode ser coberto por "Mantida" (rodada 3 do gate, CRB3-02)
            $sessao = Agendamento::query()->with('status')->lockForUpdate()->findOrFail($agendamento->id);
            // a posse de novo, sob trava (gate r1, SEC-CC-01): a sessão pode ter ido para a agenda de
            // uma colega entre a checagem de fora e aqui
            $this->escopos->agenda($request->user())->assegurarPosse($sessao->profissional_id);
            $pedido = $linhas->first(fn (LembreteEnviado $linha): bool => $linha->valeParaASessao($sessao));

            if ($pedido === null) {
                throw ValidationException::withMessages([
                    'confirmacao' => 'O pedido de desmarque já não vale para esta sessão.',
                ]);
            }

            $pedido->forceFill([
                'resposta' => LembreteEnviado::CONFIRMOU,
                'respondido_em' => now(),
                // um toque da família mais VELHO que chegue depois não desfaz a decisão da recepção
                'ultimo_toque_em' => now(),
                'confirmado_por' => $request->user()->id,
            ])->save();

            RegistroDeAuditoria::registrar($sessao, 'manteve_sessao', [
                'antes' => ['confirmacao' => 'A família pediu para desmarcar'],
                'depois' => ['confirmacao' => 'Mantida: a família desistiu do pedido'],
            ]);
        });

        return response()->json([
            'confirmacao' => EstadoDaConfirmacao::de($agendamento->load(EstadoDaConfirmacao::relacoes())),
        ]);
    }

    /**
     * A família confirmou por outro canal (D3). A linha é a que o CARD mostra (`linhaDoCard`), relida
     * sob trava na ordem do "Manter" e do toque (lembrete, depois agendamento — sem deadlock): um
     * toque, uma remarcação ou uma volta do disparo entre a tela e aqui decide de novo.
     *
     * Nenhuma mensagem sai: a família acabou de falar com a clínica. E `ultimo_toque_em = agora` faz o
     * toque mais velho que chegar atrasado perder, e o mais novo vencer, como no "Manter" (D4).
     */
    public function confirmar(Request $request, int $id): JsonResponse
    {
        $agendamento = Agendamento::query()->find($id);
        // posse ANTES da existência (`SEC-VP-40`): o par colega × inexistente não se separa por status
        $this->escopos->agenda($request->user())->assegurarPosse($agendamento?->profissional_id);
        abort_if($agendamento === null, 404);

        DB::transaction(function () use ($agendamento, $request): void {
            $linhas = LembreteEnviado::query()
                ->where('agendamento_id', $agendamento->id)
                ->where('tipo', LembreteEnviado::TIPO_AGENDAMENTO)
                ->with('mensagem:id,status')
                ->lockForUpdate()
                ->get();
            $sessao = Agendamento::query()->with('status')->lockForUpdate()->findOrFail($agendamento->id);
            // a posse de novo, sob trava (gate r1, SEC-CC-01): a sessão pode ter mudado de agenda
            $this->escopos->agenda($request->user())->assegurarPosse($sessao->profissional_id);
            $linha = EstadoDaConfirmacao::linhaDoCard($sessao, $linhas);
            $antes = $linha === null ? null : EstadoDaConfirmacao::estadoDaLinha($linha)['estado'];

            if ($linha === null || ! in_array($antes, EstadoDaConfirmacao::CONFIRMAVEIS_PELA_CLINICA, true)) {
                throw ValidationException::withMessages(['confirmacao' => $this->recusa($antes)]);
            }

            if (! EstadoDaConfirmacao::aindaVaiAcontecer($sessao)) {
                throw ValidationException::withMessages(['confirmacao' => 'A sessão já começou.']);
            }

            $linha->forceFill([
                'resposta' => LembreteEnviado::CONFIRMOU,
                'respondido_em' => now(),
                'ultimo_toque_em' => now(),
                'confirmado_por' => $request->user()->id,
            ])->save();

            RegistroDeAuditoria::registrar($sessao, 'confirmou_pela_clinica', [
                'antes' => ['confirmacao' => self::EM_PALAVRAS[$antes]],
                'depois' => ['confirmacao' => 'Confirmada pela clínica: a família confirmou por outro canal'],
            ]);
        });

        return response()->json([
            'confirmacao' => EstadoDaConfirmacao::de($agendamento->load(EstadoDaConfirmacao::relacoes())),
        ]);
    }

    /** Por que a sessão não se confirma por aqui, em palavras — o toast diz isto à recepção. */
    private function recusa(?string $estado): string
    {
        return match ($estado) {
            'confirmado' => 'A sessão já está confirmada.',
            'pediu_desmarque' => 'A família pediu para desmarcar. Use "Manter a sessão" se ela desistiu.',
            default => 'Esta sessão não tem lembrete esperando confirmação.',
        };
    }
}
