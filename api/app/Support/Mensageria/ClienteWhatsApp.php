<?php

namespace App\Support\Mensageria;

/**
 * A única porta de saída para a Meta (change mensageria-whatsapp, D2).
 *
 * Duas implementações: `ClienteCloudApi` (real) e `ClienteSimulado` (sem rede). A escolha
 * é do `FabricaDeCliente`, pelo ESTADO DA CONEXÃO da clínica — não por flag de ambiente.
 * Isso é o que faz o sistema rodar completo hoje, sem credencial, e passar a operar de
 * verdade no dia em que a clínica colar o token na tela: o mesmo caminho de código, sem
 * um segundo caminho que só é exercitado em produção.
 *
 * Todo método que fala com a rede lança `ErroDeEnvio` — e quem chama só precisa saber se
 * o erro é permanente.
 */
interface ClienteWhatsApp
{
    /**
     * @return string o `wa_message_id` devolvido pela Meta
     *
     * @throws ErroDeEnvio
     */
    public function enviarTexto(string $paraE164, string $texto): string;

    /**
     * Recebe o CONTEÚDO em claro, não o caminho: a mídia é guardada cifrada em repouso
     * (é documento de menor), e quem decifra é quem tem contexto para isso — passar o
     * caminho aqui faria a Meta receber o ciphertext, e o erro só apareceria na tela da
     * família, como um arquivo corrompido.
     *
     * @throws ErroDeEnvio
     */
    public function enviarMidia(
        string $paraE164,
        string $conteudo,
        string $nomeArquivo,
        string $mime,
        ?string $legenda = null,
    ): string;

    /**
     * @param  array<string, string>  $variaveis  valores posicionais do corpo do template
     * @param  array<int, string>  $payloadsDosBotoes  índice do botão de resposta rápida → payload
     *
     * @throws ErroDeEnvio
     */
    public function enviarTemplate(string $paraE164, string $nome, string $idioma, array $variaveis = [], array $payloadsDosBotoes = []): string;

    /**
     * @throws ErroDeEnvio
     */
    public function baixarMidia(string $waMediaId): MidiaBaixada;

    /**
     * @return list<array{nome: string, idioma: string, categoria: ?string, corpo: ?string, variaveis: list<string>, status: string}>
     *
     * @throws ErroDeEnvio
     */
    public function listarTemplates(): array;

    /**
     * Confirma que a credencial vale — o "Testar conexão" da tela.
     *
     * @return string o número de exibição confirmado pela Meta
     *
     * @throws ErroDeEnvio
     */
    public function verificarCredencial(): string;
}
