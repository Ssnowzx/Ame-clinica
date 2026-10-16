<?php

namespace App\Http\Controllers;

use App\Http\Requests\WhatsappConexaoRequest;
use App\Models\WhatsappConexao;
use App\Support\Mensageria\ConexaoDaClinica;
use App\Support\Mensageria\FabricaDeCliente;
use Illuminate\Http\JsonResponse;

/**
 * A tela de conexão do WhatsApp (change mensageria-whatsapp, D1).
 *
 * O que este controller NUNCA devolve: Access Token, App Secret ou Verify Token — em
 * nenhuma permissão, nem parcialmente. Sai o número de exibição, o estado e os 4 ÚLTIMOS
 * caracteres do token: o bastante para o operador confirmar QUAL credencial está em uso,
 * insuficiente para reconstruí-la.
 *
 * A `webhook_url` sai daqui de propósito: é o valor que a clínica cola no painel da Meta, e
 * pedir para alguém montá-lo à mão é o passo onde o go-live trava.
 */
class WhatsappConexaoController extends Controller
{
    public function __construct(private readonly FabricaDeCliente $fabrica) {}

    public function show(): JsonResponse
    {
        return response()->json($this->resumir(ConexaoDaClinica::atual()));
    }

    public function update(WhatsappConexaoRequest $request): JsonResponse
    {
        $conexao = ConexaoDaClinica::gravar($request->validated());

        return response()->json($this->resumir($conexao));
    }

    /**
     * "Testar conexão" — pergunta à Meta e grava o veredito. É o único caminho que promove
     * a conexão a `conectado`.
     */
    public function testar(): JsonResponse
    {
        $conexao = ConexaoDaClinica::atual();

        if ($conexao === null) {
            return response()->json([
                'message' => 'Nenhuma credencial gravada para testar.',
            ], 422);
        }

        return response()->json($this->resumir(ConexaoDaClinica::testar($conexao, $this->fabrica)));
    }

    /** @return array<string, mixed> */
    private function resumir(?WhatsappConexao $conexao): array
    {
        // APP_URL, não url(): esta URL é COLADA no painel da Meta, então precisa ser o
        // endereço público e estável — não o que o Laravel deduz do Host da requisição.
        // Atrás de proxy reverso o Host chega interno (127.0.0.1) e o esquema chega http,
        // e a Meta recusa webhook que não seja https no domínio real.
        $webhook = rtrim((string) config('app.url'), '/').'/api/webhooks/whatsapp';

        if ($conexao === null) {
            return [
                'estado' => 'nao_conectado',
                'phone_number_id' => null,
                'waba_id' => null,
                'numero_exibicao' => null,
                'token_final' => null,
                'ultimo_teste_em' => null,
                'ultimo_erro' => null,
                'webhook_url' => $webhook,
            ];
        }

        return [
            'estado' => $conexao->estado,
            'phone_number_id' => $conexao->phone_number_id,
            'waba_id' => $conexao->waba_id,
            'numero_exibicao' => $conexao->numero_exibicao,
            'token_final' => $conexao->tokenFinal(),
            'ultimo_teste_em' => $conexao->ultimo_teste_em?->toIso8601String(),
            'ultimo_erro' => $conexao->ultimo_erro,
            'webhook_url' => $webhook,
        ];
    }
}
