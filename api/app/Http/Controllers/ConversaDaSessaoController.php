<?php

namespace App\Http\Controllers;

use App\Models\Agendamento;
use App\Models\Conversa;
use App\Support\Mensageria\CorrespondenciaDePaciente;
use App\Support\Mensageria\TelefoneE164;
use App\Support\Rbac\EscopoDoProfissional;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

/**
 * "Avisar no WhatsApp" do painel do agendamento (change `avisar-no-whatsapp-abre-a-conversa`): a
 * conversa da família daquela sessão, para a tela Mensagens abrir já nela.
 *
 * A conversa é a do celular de AGORA no cadastro (design D2), nunca a do número por onde o lembrete
 * saiu: corrigido o cadastro, aquele número pode ser de outra família. Quando a família nunca trocou
 * mensagem, a conversa nasce vazia — a mensageria só criava conversa ao enviar ou receber, e a
 * recepção não tinha por onde começar. Nada é enviado aqui.
 *
 * `POST` porque pode criar (D1): um `GET` com efeito seria repetível por qualquer leitor.
 */
class ConversaDaSessaoController extends Controller
{
    public function __construct(private readonly EscopoDoProfissional $escopos) {}

    public function abrir(Request $request, int $id): JsonResponse
    {
        $agendamento = Agendamento::query()->find($id);
        // posse ANTES da existência (`SEC-VP-40`): o par colega × inexistente não se separa por status
        $this->escopos->agenda($request->user())->assegurarPosse($agendamento?->profissional_id);
        abort_if($agendamento === null, 404);

        if ($agendamento->tipo !== 'atendimento' || $agendamento->paciente_id === null) {
            throw ValidationException::withMessages(['conversa' => 'Este horário não é de uma criança.']);
        }

        $pacienteId = (int) $agendamento->paciente_id;
        // na ordem do lembrete (WhatsApp, celular, fixo), só os celulares: fixo não tem WhatsApp
        $celulares = collect(CorrespondenciaDePaciente::telefonesDoPaciente($pacienteId))
            ->filter(fn (string $e164): bool => TelefoneE164::classificar($e164)['tipo'] === TelefoneE164::CELULAR)
            ->values();

        if ($celulares->isEmpty()) {
            throw ValidationException::withMessages(['conversa' => $this->semCelular($pacienteId)]);
        }

        // a família que já conversa por algum dos números: o preferido que tem conversa vence, com e
        // sem o nono dígito (a conversa antiga pode guardar o número de antes dele). O MESMO celular pode
        // ter duas conversas — o lembrete criou uma pelo cadastro, a resposta da família criou outra pelo
        // `wa_id` (gate r1, CR-WA-01): vence a de janela aberta, depois a mais recente, sem deixar a
        // escolha para a ordem do índice
        foreach ($celulares as $celular) {
            $existente = Conversa::query()
                ->whereIn('telefone_e164', TelefoneE164::variantes($celular))
                ->orderByRaw('(janela_expira_em IS NOT NULL AND janela_expira_em > ?) DESC', [now()])
                ->orderByDesc('ultima_mensagem_em')
                ->orderBy('id')
                ->first();

            if ($existente !== null) {
                return response()->json(['conversa_id' => $existente->id]);
            }
        }

        return response()->json(['conversa_id' => $this->criar($celulares->first())->id]);
    }

    /**
     * A conversa vazia do celular preferido, com a criança decidida como no disparo do lembrete
     * (`paraTelefone`: irmãos com o mesmo número deixam a conversa sem vínculo). Dois cliques ao mesmo
     * tempo batem no `unique(telefone_e164)`: quem perde relê a que ganhou.
     */
    private function criar(string $celular): Conversa
    {
        try {
            $conversa = new Conversa;
            $conversa->telefone_e164 = $celular;
            $conversa->paciente_id = CorrespondenciaDePaciente::paraTelefone($celular);
            $conversa->save();

            return $conversa;
        } catch (QueryException $erro) {
            if ((int) ($erro->errorInfo[1] ?? 0) !== 1062) {
                throw $erro;
            }

            return Conversa::query()->where('telefone_e164', $celular)->firstOrFail();
        }
    }

    /** Por que não há para onde abrir a conversa — a recepção vai a lugares diferentes do cadastro. */
    private function semCelular(int $pacienteId): string
    {
        return match (CorrespondenciaDePaciente::faltaDeTelefone([$pacienteId])[$pacienteId] ?? null) {
            CorrespondenciaDePaciente::SEM_TELEFONE => 'A criança não tem celular cadastrado.',
            CorrespondenciaDePaciente::TELEFONE_INVALIDO => 'O telefone do cadastro não é válido para WhatsApp.',
            // tem telefone que normaliza, mas nenhum é celular
            default => 'O telefone do cadastro é fixo e não tem WhatsApp.',
        };
    }
}
