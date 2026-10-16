<?php

namespace App\Http\Controllers;

use App\Models\LancamentoCaixa;
use App\Models\Paciente;
use App\Support\Auditoria\RegistroDeAuditoria;
use App\Support\Configuracoes\ConfiguracaoService;
use App\Support\Financeiro\LancamentosVisiveis;
use App\Support\Financeiro\MensagemDeCobranca;
use App\Support\Financeiro\UltimaCobranca;
use App\Support\Mensageria\TelefoneE164;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Response;
use Illuminate\Validation\ValidationException;

/**
 * Cobrar pelo WhatsApp (change `cobranca-pelo-whatsapp`): o servidor monta, por lançamento, os
 * responsáveis com telefone e a mensagem pronta; a tela abre o link de conversa e quem envia é a
 * pessoa. Os telefones saem só daqui — sob `lancamentos.ver` E `pacientes.ver` —, nunca da lista
 * de lançamentos: cem linhas com o telefone de cada família seriam exposição em massa (D1).
 */
class LancamentoCobrancaController extends Controller
{
    public function __construct(private readonly ConfiguracaoService $configuracoes) {}

    /** `GET /lancamentos/{id}/cobranca` */
    public function mostrar(int $id): JsonResponse
    {
        $lancamento = LancamentosVisiveis::encontrar($id); // inexistente, ou salário sem a folha → 404
        $crianca = $this->criancaCobravel($lancamento);

        $texto = (string) $this->configuracoes->get('financeiro.mensagem_cobranca');
        $valores = [
            'crianca' => (string) ($crianca->nome_social ?: $crianca->nome),
            'valor' => MensagemDeCobranca::emReais($lancamento->liquido),
            'vencimento' => $lancamento->vencimento->format('d/m/Y'),
            'clinica' => ((string) $this->configuracoes->get('clinica.nome')) ?: 'clínica',
        ];

        $responsaveis = collect($crianca->responsaveis_json ?? [])
            ->map(function (array $responsavel) use ($texto, $valores): ?array {
                $e164 = TelefoneE164::normalizar($responsavel['telefone'] ?? null);
                if ($e164 === null) {
                    return null; // telefone incompleto não vira link quebrado (D2)
                }
                $nome = trim((string) ($responsavel['nome'] ?? ''));

                return [
                    'nome' => $nome,
                    'parentesco' => (string) ($responsavel['parentesco'] ?? ''),
                    // o link do WhatsApp é o E.164 sem o `+`
                    'telefone' => ltrim($e164, '+'),
                    'mensagem' => MensagemDeCobranca::preencher($texto, [...$valores, 'responsavel' => $nome !== '' ? $nome : 'tudo bem']),
                ];
            })
            ->filter()
            ->values();

        return response()->json([
            'lancamento_id' => $lancamento->id,
            'responsaveis' => $responsaveis,
            'ultima_cobranca' => UltimaCobranca::de($lancamento),
        ]);
    }

    /** `POST /lancamentos/{id}/cobranca` — a conversa foi aberta; registra quem e quando, sem o texto (D3). */
    public function registrar(int $id): Response
    {
        $lancamento = LancamentosVisiveis::encontrar($id);
        $this->criancaCobravel($lancamento);
        RegistroDeAuditoria::registrar($lancamento, 'cobrou', []);

        return response()->noContent();
    }

    /** Só receita EM ABERTO de criança se cobra (422 com a razão no resto). */
    private function criancaCobravel(LancamentoCaixa $lancamento): Paciente
    {
        $razao = match (true) {
            $lancamento->tipo !== 'receita' => 'Só se cobra receita.',
            $lancamento->pago_em !== null => 'Este lançamento já foi pago.',
            $lancamento->interessado_tipo !== 'paciente' || $lancamento->interessado_id === null => 'A cobrança é para lançamento de uma criança.',
            default => null,
        };
        if ($razao !== null) {
            throw ValidationException::withMessages(['lancamento' => $razao]);
        }

        return Paciente::findOrFail($lancamento->interessado_id);
    }
}
