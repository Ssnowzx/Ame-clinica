<?php

namespace App\Support\Mensageria;

use App\Models\WhatsappConexao;

/**
 * Quem decide COM QUEM se fala (change mensageria-whatsapp, D2).
 *
 * A escolha é pelo ESTADO DA CONEXÃO da clínica, nunca por flag de ambiente. Esse detalhe é
 * a decisão inteira: hoje, sem credencial, a clínica resolve o simulado; no dia em que a
 * clínica colar o token na tela, o MESMO caminho de código passa a falar com a Meta. Sem
 * `if (app()->environment())` espalhado, e sem um segundo caminho que só a produção percorre.
 *
 * O simulado nunca é alcançado por engano em produção: o serviço de envio recusa ANTES,
 * com "WhatsApp não conectado" (spec mensageria). Ele existe para que o resto do sistema
 * não precise saber que a credencial ainda não chegou.
 *
 * O `bound()` é a costura de TESTE: uma suíte registra o simulado no container e todo o
 * caminho real passa a rodar sem rede.
 */
class FabricaDeCliente
{
    /**
     * O cliente da clínica — **fail-closed** (SEC-WA-03).
     *
     * A versão anterior caía no simulado sempre que a conexão não estava `conectado`, e
     * isso é seguro no instante do REQUEST (o serviço recusa antes) e falso no instante do
     * JOB, que é outro processo e outro relógio. A janela é rotineira: rotar o token devolve
     * o estado a `nao_conectado`, e toda mensagem já enfileirada passava a ser "enviada"
     * pelo simulador — `status = enviada`, carimbo de hora, `wamid.SIMULADO1`, thread
     * mostrando entregue — **sem a família ter recebido nada**. Registro falso num histórico
     * que a clínica usa como prova. O gêmeo era pior: a mídia RECEBIDA de uma família seria
     * substituída pelo PNG 1×1 fictício, cifrada e gravada, sem volta.
     *
     * Agora isso lança. O Job trata como erro TEMPORÁRIO: a mensagem fica `pendente`,
     * visível na thread, e sai quando a clínica reconectar.
     *
     * @throws ErroDeEnvio
     */
    public function paraClinica(): ClienteWhatsApp
    {
        if ($this->duploDeTeste() !== null) {
            return $this->duploDeTeste();
        }

        $conexao = ConexaoDaClinica::atual();

        if ($conexao === null || ! $conexao->estaConectada()) {
            throw ErroDeEnvio::temporario('O WhatsApp da clínica não está conectado.');
        }

        return new ClienteCloudApi($conexao);
    }

    /**
     * Cliente para VERIFICAR uma credencial que ainda não foi promovida a `conectado` —
     * o "Testar conexão" da tela. Precisa existir separado: `paraConexao()` devolveria o
     * simulado (a conexão ainda está `nao_conectado`), e o teste diria "tudo certo" sem
     * ter falado com ninguém. Um botão que sempre aprova é pior que botão nenhum.
     */
    public function paraVerificacao(WhatsappConexao $conexao): ClienteWhatsApp
    {
        return $this->duploDeTeste() ?? new ClienteCloudApi($conexao);
    }

    /**
     * A costura de TESTE — e só ela.
     *
     * O `bound()` era lido em produção: qualquer binding futuro de `ClienteWhatsApp` no
     * container trocaria o canal inteiro sem uma linha de log. Preso a
     * `runningUnitTests()`, ele volta a ser o que sempre quis ser.
     */
    private function duploDeTeste(): ?ClienteWhatsApp
    {
        return app()->runningUnitTests() && app()->bound(ClienteWhatsApp::class)
            ? app(ClienteWhatsApp::class)
            : null;
    }
}
