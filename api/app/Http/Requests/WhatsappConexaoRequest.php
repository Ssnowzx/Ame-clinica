<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * A credencial da Meta, digitada na tela (change mensageria-whatsapp, D1).
 *
 * Os cinco campos são obrigatórios TODOS OS ENVIOS, inclusive na troca: gravar é substituir
 * a conexão por inteiro. Aceitar atualização parcial deixaria a clínica com token novo e
 * Phone Number ID velho — a combinação que "manda e não chega", sem erro em lugar nenhum.
 *
 * `estado`, `numero_exibicao` e `ultimo_erro` NÃO entram aqui: são fatos verificados contra
 * a Meta, não campos de formulário. Um cliente que pudesse declarar-se `conectado` faria o
 * sistema tentar enviar com credencial que ninguém validou.
 */
class WhatsappConexaoRequest extends FormRequest
{
    /** @return array<string, list<string>> */
    public function rules(): array
    {
        return [
            'phone_number_id' => ['required', 'string', 'max:40', 'regex:/^\d+$/'],
            'waba_id' => ['required', 'string', 'max:40', 'regex:/^\d+$/'],
            'access_token' => ['required', 'string', 'min:20', 'max:1000'],
            // App Secret da Meta é hex de 32; `min:8` aceitaria um valor digitado errado
            'app_secret' => ['required', 'string', 'min:32', 'max:255'],
            // o verify token é ESCOLHIDO pelo operador e testável na rota pública — um
            // valor curto é adivinhável por quem souber a URL do webhook (SEC-WA-14)
            'verify_token' => ['required', 'string', 'min:24', 'max:255'],
        ];
    }

    /** @return array<string, string> */
    public function messages(): array
    {
        return [
            'phone_number_id.regex' => 'O Phone Number ID da Meta é só de dígitos — copie o valor do painel, sem espaços.',
            'waba_id.regex' => 'O WABA ID da Meta é só de dígitos — copie o valor do painel, sem espaços.',
            'access_token.min' => 'O token parece incompleto; copie o valor inteiro do painel da Meta.',
            'app_secret.min' => 'O App Secret da Meta tem 32 caracteres — copie o valor inteiro.',
            'verify_token.min' => 'Escolha um verify token com pelo menos 24 caracteres: ele é testável por quem souber a URL do webhook.',
        ];
    }
}
