<?php

namespace App\Support\Mensageria;

use App\Models\WhatsappConexao;

/**
 * A porta que acha a conexão a partir do que a Meta manda no webhook (change
 * mensageria-whatsapp, D4).
 *
 * O webhook chega sem sessão e sem usuário: a conexão só é aceita se o identificador do
 * payload (ou o verify token do handshake) casar com a credencial gravada pela clínica.
 */
class ConexaoDoWebhook
{
    /**
     * A conexão dona do evento, achada pelo `phone_number_id` que vem no payload.
     *
     * Decodifica o JSON só para LER o identificador de roteamento — nenhuma decisão além
     * de escolher a chave de verificação é tomada com este dado, e nada é persistido antes
     * de a assinatura passar (D4).
     */
    public static function porPayload(string $corpoCru): ?WhatsappConexao
    {
        $payload = json_decode($corpoCru, true);

        if (! is_array($payload)) {
            return null;
        }

        $phoneNumberId = $payload['entry'][0]['changes'][0]['value']['metadata']['phone_number_id'] ?? null;

        if (! is_string($phoneNumberId) || $phoneNumberId === '') {
            return null;
        }

        return WhatsappConexao::query()
            ->where('phone_number_id', $phoneNumberId)
            ->first();
    }

    /**
     * A conexão cujo `verify_token` casa com o recebido no handshake `GET` da Meta.
     *
     * O handshake NÃO traz o `phone_number_id` — só o token. E `verify_token` é cifrado,
     * então não há como consultá-lo por índice.
     *
     * DELIBERADO: comparar em memória, e não guardar um hash do token para busca. Um
     * `sha256` de um verify token (que o operador digita, e por isso tende a ser curto)
     * seria quebrável offline por quem obtivesse o banco — e trocaria um O(n) que roda
     * UMA vez, na configuração, por uma exposição permanente.
     */
    public static function porVerifyToken(string $token): ?WhatsappConexao
    {
        if ($token === '') {
            return null;
        }

        return WhatsappConexao::query()
            ->get()
            ->first(fn (WhatsappConexao $conexao) => hash_equals((string) $conexao->verify_token, $token));
    }
}
