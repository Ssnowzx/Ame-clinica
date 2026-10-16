<?php

namespace App\Support\Mensageria;

use App\Models\WhatsappConexao;
use Illuminate\Database\QueryException;
use Illuminate\Validation\ValidationException;

/**
 * A conexão de WhatsApp da clínica (change mensageria-whatsapp, D1).
 *
 * Porta única de leitura e gravação da credencial. Os segredos são atribuídos aqui
 * EXPLICITAMENTE — estão fora do `$fillable`, e é isso que impede um payload de tela
 * de escrever no que o `$auditExclude` protege.
 *
 * Gravar SUBSTITUI a conexão por inteiro e devolve o estado a `nao_conectado`: credencial
 * meio trocada (token novo com Phone Number ID velho) é a origem silenciosa de "manda e não
 * chega", e um estado `conectado` herdado de uma credencial anterior faria o sistema tentar
 * enviar com o que ninguém validou.
 */
class ConexaoDaClinica
{
    public static function atual(): ?WhatsappConexao
    {
        return WhatsappConexao::query()->first();
    }

    /**
     * @param  array{phone_number_id: string, waba_id: string, access_token: string, app_secret: string, verify_token: string}  $dados
     */
    public static function gravar(array $dados): WhatsappConexao
    {
        $conexao = self::atual() ?? new WhatsappConexao;

        $conexao->fill([
            'phone_number_id' => $dados['phone_number_id'],
            'waba_id' => $dados['waba_id'],
        ]);

        // atribuição direta, NUNCA fill(): os três estão fora do $fillable de propósito
        $conexao->access_token = $dados['access_token'];
        $conexao->app_secret = $dados['app_secret'];
        $conexao->verify_token = $dados['verify_token'];

        // credencial nova é credencial não verificada — sempre
        $conexao->estado = 'nao_conectado';
        $conexao->numero_exibicao = null;
        $conexao->ultimo_erro = null;
        $conexao->ultimo_teste_em = null;

        try {
            $conexao->save();
        } catch (QueryException $erro) {
            // `phone_number_id` é unique. A colisão virava 500 — erro feio no go-live.
            // Vira recusa de validação.
            if ((int) ($erro->errorInfo[1] ?? 0) === 1062) {
                throw ValidationException::withMessages([
                    'phone_number_id' => 'Este número já está conectado. Confira o Phone Number ID no painel da Meta.',
                ]);
            }

            throw $erro;
        }

        return $conexao;
    }

    /**
     * Pergunta à Meta se a credencial vale, e grava o veredito. É o ÚNICO caminho que
     * promove a conexão a `conectado` — o formulário não escolhe o próprio estado.
     */
    public static function testar(WhatsappConexao $conexao, FabricaDeCliente $fabrica): WhatsappConexao
    {
        try {
            $numero = $fabrica->paraVerificacao($conexao)->verificarCredencial();

            $conexao->estado = 'conectado';
            $conexao->numero_exibicao = $numero !== '' ? $numero : $conexao->numero_exibicao;
            $conexao->ultimo_erro = null;
        } catch (ErroDeEnvio $erro) {
            $conexao->estado = 'invalido';
            // a mensagem da Meta é o diagnóstico (token expirado ≠ número errado ≠ webhook
            // não configurado); ela não carrega segredo, e sem ela o operador fica no escuro
            $conexao->ultimo_erro = $erro->getMessage();
        }

        $conexao->ultimo_teste_em = now();
        $conexao->save();

        return $conexao;
    }
}
