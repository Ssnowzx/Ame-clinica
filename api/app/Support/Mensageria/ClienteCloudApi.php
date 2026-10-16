<?php

namespace App\Support\Mensageria;

use App\Models\WhatsappConexao;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\PendingRequest;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;

/**
 * A Cloud API oficial da Meta, falada em HTTP puro (change mensageria-whatsapp, D2).
 *
 * Sem SDK de terceiro de propósito: a API é HTTP/JSON, e um SDK trocaria ~200 linhas por
 * uma caixa-preta que decide sozinha quando retentar — justamente a decisão que o Job
 * precisa controlar para o teto mensal fazer sentido.
 *
 * `->retry()` do cliente HTTP também fica de fora, pelo mesmo motivo: retentar nas duas
 * camadas multiplica as tentativas (5 do Job × 3 do HTTP = 15 chamadas para um número que
 * não existe) e some com o controle de custo.
 *
 * CLASSIFICAÇÃO DO ERRO — a única distinção que o resto do sistema consome:
 * - 429 e 5xx e queda de conexão → TEMPORÁRIO (instabilidade; retentar tem sentido)
 * - demais 4xx → PERMANENTE (número inválido, template inexistente, token recusado)
 */
class ClienteCloudApi implements ClienteWhatsApp
{
    public function __construct(private readonly WhatsappConexao $conexao) {}

    public function enviarTexto(string $paraE164, string $texto): string
    {
        return $this->idDaMensagem($this->postarMensagem([
            'type' => 'text',
            'to' => $this->destino($paraE164),
            'text' => ['preview_url' => false, 'body' => $texto],
        ]));
    }

    public function enviarMidia(
        string $paraE164,
        string $conteudoDoArquivo,
        string $nomeArquivo,
        string $mime,
        ?string $legenda = null,
    ): string {
        $idDaMidia = $this->subirMidia($conteudoDoArquivo, $nomeArquivo, $mime);
        $categoria = $this->categoriaDoMime($mime);

        $conteudo = ['id' => $idDaMidia];

        // áudio e sticker NÃO aceitam legenda na Cloud API — mandar mesmo assim é 400
        if ($legenda !== null && in_array($categoria, ['image', 'video', 'document'], true)) {
            $conteudo['caption'] = $legenda;
        }

        if ($categoria === 'document') {
            $conteudo['filename'] = $nomeArquivo;
        }

        return $this->idDaMensagem($this->postarMensagem([
            'type' => $categoria,
            'to' => $this->destino($paraE164),
            $categoria => $conteudo,
        ]));
    }

    public function enviarTemplate(string $paraE164, string $nome, string $idioma, array $variaveis = [], array $payloadsDosBotoes = []): string
    {
        $corpo = [
            'type' => 'template',
            'to' => $this->destino($paraE164),
            'template' => [
                'name' => $nome,
                'language' => ['code' => $idioma],
            ],
        ];

        if ($variaveis !== []) {
            // a Meta lê os parâmetros por POSIÇÃO ({{1}}, {{2}}…): a ordem das chaves é o
            // contrato, e por isso a montagem ordena antes de enviar
            ksort($variaveis, SORT_NATURAL);
            $corpo['template']['components'] = [[
                'type' => 'body',
                'parameters' => array_values(array_map(
                    fn (string $valor) => ['type' => 'text', 'text' => $valor],
                    $variaveis
                )),
            ]];
        }

        // cada botão de resposta rápida leva o PAYLOAD da sua posição: a Meta o devolve no toque,
        // e o texto do botão pode mudar sem mudar o significado (lembrete-com-botoes-de-resposta)
        foreach ($payloadsDosBotoes as $indice => $payload) {
            $corpo['template']['components'][] = [
                'type' => 'button',
                'sub_type' => 'quick_reply',
                'index' => (string) $indice,
                'parameters' => [['type' => 'payload', 'payload' => $payload]],
            ];
        }

        return $this->idDaMensagem($this->postarMensagem($corpo));
    }

    public function baixarMidia(string $waMediaId): MidiaBaixada
    {
        // a Meta entrega a mídia em DOIS passos: primeiro a URL temporária, depois o
        // arquivo — e a URL também exige o Bearer (não é link público)
        $metadados = $this->tratar($this->requisicao()->get($this->url($waMediaId)));
        $url = $metadados['url'] ?? null;

        if (! is_string($url) || $url === '') {
            throw ErroDeEnvio::permanente('A Meta não devolveu a URL da mídia.');
        }

        // A URL vem da RESPOSTA anterior, e nós mandamos o Bearer do WABA para ela. Sem
        // allowlist, um upstream comprometido (ou um redirect) aponta o token para um host
        // de terceiro: SSRF de confiança transitiva (SEC-WA-11).
        if (! $this->hostConfiavel($url)) {
            throw ErroDeEnvio::permanente('A Meta devolveu a mídia num host não confiável.');
        }

        try {
            $arquivo = $this->requisicao()->get($url);
        } catch (ConnectionException $erro) {
            throw ErroDeEnvio::temporario('Falha de rede ao baixar a mídia: '.$erro->getMessage());
        }

        if (! $arquivo->successful()) {
            throw $this->erroDaResposta($arquivo);
        }

        $conteudo = $arquivo->body();

        return new MidiaBaixada(
            conteudo: $conteudo,
            // declaração da Meta; quem grava revalida pelo CONTEÚDO
            mime: (string) ($metadados['mime_type'] ?? $arquivo->header('Content-Type')),
            tamanho: strlen($conteudo),
        );
    }

    public function listarTemplates(): array
    {
        $resposta = $this->tratar(
            $this->requisicao()->get($this->url($this->conexao->waba_id.'/message_templates'), ['limit' => 200])
        );

        return array_map(function (array $bruto): array {
            $corpo = null;
            $botoes = [];

            foreach ($bruto['components'] ?? [] as $componente) {
                if (($componente['type'] ?? null) === 'BODY') {
                    $corpo = $componente['text'] ?? null;
                }
                // a ORDEM é a da Meta e é o índice do toque — nada de reordenar
                if (($componente['type'] ?? null) === 'BUTTONS') {
                    foreach ($componente['buttons'] ?? [] as $botao) {
                        $botoes[] = ['tipo' => (string) ($botao['type'] ?? ''), 'texto' => (string) ($botao['text'] ?? '')];
                    }
                }
            }

            return [
                'nome' => (string) ($bruto['name'] ?? ''),
                'idioma' => (string) ($bruto['language'] ?? 'pt_BR'),
                'categoria' => $bruto['category'] ?? null,
                'corpo' => $corpo,
                'variaveis' => $this->variaveisDoCorpo($corpo),
                'botoes' => $botoes,
                'status' => (string) ($bruto['status'] ?? 'PENDING'),
            ];
        }, $resposta['data'] ?? []);
    }

    public function verificarCredencial(): string
    {
        $resposta = $this->tratar($this->requisicao()->get(
            $this->url($this->conexao->phone_number_id),
            ['fields' => 'display_phone_number,verified_name']
        ));

        return (string) ($resposta['display_phone_number'] ?? '');
    }

    /**
     * As chaves `{{n}}` do corpo, em ordem — é isso que a tela cobra do usuário antes
     * de deixar enviar.
     *
     * @return list<string>
     */
    public static function variaveisDoCorpo(?string $corpo): array
    {
        if ($corpo === null || ! preg_match_all('/\{\{(\d+)\}\}/', $corpo, $achados)) {
            return [];
        }

        $variaveis = array_values(array_unique($achados[1]));
        sort($variaveis, SORT_NATURAL);

        return $variaveis;
    }

    /** @param array<string, mixed> $corpo */
    private function postarMensagem(array $corpo): array
    {
        try {
            return $this->tratar($this->requisicao()->post(
                $this->url($this->conexao->phone_number_id.'/messages'),
                array_merge(['messaging_product' => 'whatsapp', 'recipient_type' => 'individual'], $corpo),
            ));
        } catch (ConnectionException $erro) {
            // sem isto, o timeout escapava da classificação e chegava ao `erro_motivo` que a
            // recepção lê como texto cru de infraestrutura
            throw ErroDeEnvio::temporario('Falha de rede ao enviar: '.$erro->getMessage());
        }
    }

    private function subirMidia(string $conteudo, string $nomeArquivo, string $mime): string
    {
        try {
            $resposta = Http::withToken($this->conexao->access_token)
                ->timeout((int) config('mensageria.timeout'))
                ->attach('file', $conteudo, $nomeArquivo, ['Content-Type' => $mime])
                ->post($this->url($this->conexao->phone_number_id.'/media'), [
                    'messaging_product' => 'whatsapp',
                    'type' => $mime,
                ]);
        } catch (ConnectionException $erro) {
            throw ErroDeEnvio::temporario('Falha de rede ao subir a mídia: '.$erro->getMessage());
        }

        $dados = $this->tratar($resposta);
        $id = $dados['id'] ?? null;

        if (! is_string($id) || $id === '') {
            throw ErroDeEnvio::permanente('A Meta não devolveu o id da mídia enviada.');
        }

        return $id;
    }

    private function requisicao(): PendingRequest
    {
        // sem ->retry(): a retentativa é do Job (D8), com backoff e teto
        return Http::withToken($this->conexao->access_token)
            ->timeout((int) config('mensageria.timeout'))
            ->acceptJson();
    }

    private function url(string $recurso): string
    {
        return rtrim((string) config('mensageria.base_url'), '/')
            .'/'.config('mensageria.versao_graph')
            .'/'.$recurso;
    }

    /**
     * A Cloud API quer o número SEM o `+`.
     */
    private function destino(string $e164): string
    {
        return ltrim($e164, '+');
    }

    /** @param array<string, mixed> $resposta */
    private function idDaMensagem(array $resposta): string
    {
        $id = $resposta['messages'][0]['id'] ?? null;

        if (! is_string($id) || $id === '') {
            // sem id não há idempotência possível: melhor falhar visível que gravar
            // uma mensagem que nenhum status futuro vai conseguir alcançar
            throw ErroDeEnvio::permanente('A Meta aceitou o envio sem devolver o id da mensagem.');
        }

        return $id;
    }

    /** @return array<string, mixed> */
    private function tratar(Response $resposta): array
    {
        if (! $resposta->successful()) {
            throw $this->erroDaResposta($resposta);
        }

        return (array) $resposta->json();
    }

    private function erroDaResposta(Response $resposta): ErroDeEnvio
    {
        $erro = (array) $resposta->json('error', []);
        $texto = (string) ($erro['message'] ?? 'A Meta recusou a operação.');
        $codigo = isset($erro['code']) ? (string) $erro['code'] : (string) $resposta->status();

        // 429 (limite de taxa) e 5xx são instabilidade: esperar e voltar resolve.
        // Todo o resto dos 4xx é decisão da Meta que não muda sozinha.
        $temporario = $resposta->status() === 429 || $resposta->serverError();

        return $temporario
            ? ErroDeEnvio::temporario($texto, $codigo)
            : ErroDeEnvio::permanente($texto, $codigo);
    }

    /** Hosts de que aceitamos baixar mídia — nada de IP literal, nada de `http://`. */
    private function hostConfiavel(string $url): bool
    {
        $partes = parse_url($url);
        $host = strtolower((string) ($partes['host'] ?? ''));

        if (($partes['scheme'] ?? '') !== 'https' || $host === '' || filter_var($host, FILTER_VALIDATE_IP) !== false) {
            return false;
        }

        foreach (['graph.facebook.com', 'lookaside.fbsbx.com', '.fbcdn.net', '.facebook.com'] as $permitido) {
            if ($host === ltrim($permitido, '.') || str_ends_with($host, $permitido)) {
                return true;
            }
        }

        return false;
    }

    private function categoriaDoMime(string $mime): string
    {
        return match (true) {
            str_starts_with($mime, 'image/') => 'image',
            str_starts_with($mime, 'video/') => 'video',
            str_starts_with($mime, 'audio/') => 'audio',
            default => 'document',
        };
    }
}
