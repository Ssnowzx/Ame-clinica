<?php

namespace App\Support\Mensageria;

use App\Jobs\BaixarMidiaJob;
use App\Models\Conversa;
use App\Models\Mensagem;
use App\Models\MensagemMidia;
use App\Models\WebhookEvento;
use Illuminate\Database\QueryException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * O que a Meta entrega vira conversa e mensagem (change mensageria-whatsapp, D3).
 *
 * TUDO AQUI É IDEMPOTENTE, e por índice único — não por consulta prévia. A Meta reentrega
 * eventos por desenho (é assim que ela garante entrega), e duas entregas em paralelo furam
 * qualquer `SELECT` antes do `INSERT`. Então a violação de unicidade é tratada como
 * SUCESSO, que é o que ela de fato significa: "isto já está registrado".
 *
 * O rastro do evento é gravado DENTRO da mesma transação do processamento: se algo falhar
 * no meio, o hash volta atrás junto e a reentrega da Meta encontra o caminho limpo. Gravar
 * o hash antes e fora seria transformar uma falha nossa em mensagem perdida para sempre.
 */
class RecepcaoDeMensagens
{
    /** Vocabulário da Meta → o nosso. */
    private const STATUS = [
        'sent' => 'enviada',
        'delivered' => 'entregue',
        'read' => 'lida',
        'failed' => 'falhou',
    ];

    /** @param array<string, mixed> $payload */
    public function processar(array $payload, string $corpoCru): void
    {
        $hash = hash('sha256', $corpoCru);

        DB::transaction(function () use ($payload, $hash): void {
            // reentrega do MESMO evento: já está registrado, e é isso que a Meta queria saber
            if (! $this->registrarEvento($payload, $hash)) {
                return;
            }

            // `entry` que não é lista nem chega aqui (sem ela não há conexão: 403); `changes` que não é
            // lista é ignorada, não percorrida — senão a exceção leva as outras entradas (CRL3-03)
            foreach ($payload['entry'] ?? [] as $entrada) {
                foreach ($this->lista($entrada['changes'] ?? null) as $mudanca) {
                    $this->processarMudanca((array) ($mudanca['value'] ?? []));
                }
            }
        });
    }

    /**
     * Grava o rastro do evento. `false` = já processado (reentrega).
     *
     * O `catch` de duplicidade fica AQUI, colado no `INSERT` que pode duplicar por desenho —
     * e não em volta da transação inteira. Envolvendo tudo, QUALQUER violação de unicidade
     * virava "reentrega": duas mensagens chegando em paralelo de um telefone NOVO colidiam
     * no unique de `conversas`, a transação inteira revertia, e o webhook respondia 200. A
     * Meta não reentrega o que foi confirmado — a mensagem da família sumia para sempre, sem
     * log e sem linha na thread (achado do gate de code review).
     *
     * @param  array<string, mixed>  $payload
     */
    private function registrarEvento(array $payload, string $hash): bool
    {
        try {
            WebhookEvento::create([
                'payload_hash' => $hash,
                // o `field` é só rótulo de diagnóstico: o que não for texto curto não entra (CRL3-03)
                'tipo' => $this->rotuloDoEvento($payload['entry'][0]['changes'][0]['field'] ?? null),
                'recebido_em' => now(),
            ]);

            return true;
        } catch (QueryException $erro) {
            if ($this->eDuplicidade($erro)) {
                return false;
            }

            throw $erro;
        }
    }

    /** @param array<string, mixed> $valor */
    private function processarMudanca(array $valor): void
    {
        $perfis = $this->perfis((array) ($valor['contacts'] ?? []));

        // lista que não é lista é ignorada, não percorrida: um `foreach` sobre string é exceção, e a
        // exceção desfaz o evento inteiro (SEC-CL2-01)
        foreach ($this->lista($valor['messages'] ?? null) as $bruta) {
            $this->receberMensagem((array) $bruta, $perfis);
        }

        foreach ($this->lista($valor['statuses'] ?? null) as $bruto) {
            $this->atualizarStatus((array) $bruto);
        }
    }

    /**
     * @param  array<string, mixed>  $bruta
     * @param  array<string, string>  $perfis
     */
    private function receberMensagem(array $bruta, array $perfis): void
    {
        $waId = $bruta['id'] ?? null;
        $de = $bruta['from'] ?? null;

        // o id é a idempotência (`wa_message_id` varchar 80): um maior não cabe, estourava o INSERT e
        // levava o lote junto — e o id da Meta tem ~60 (SEC-CL2-01)
        if (! is_string($waId) || $waId === '' || strlen($waId) > 80 || ! is_string($de)) {
            return;
        }

        // a Meta manda o DDI completo, sem o `+`: lido como internacional, a família de fora do país
        // ganha conversa e criança, e o brasileiro casa como sempre (change telefone-estrangeiro)
        $telefone = TelefoneE164::daMeta($de);

        // sem forma canônica não há conversa possível — e inventar uma criaria uma linha
        // que nunca casaria com o cadastro nem com uma resposta
        if ($telefone === null) {
            return;
        }

        $recebidaEm = $this->momento($bruta['timestamp'] ?? null);
        $conversa = $this->conversaDe($telefone, $perfis[ltrim($telefone, '+')] ?? null);

        [$tipo, $corpo, $midia, $detalhes] = $this->conteudo($bruta);
        $tipoOriginal = $this->tipoOriginal($bruta);

        $mensagem = new Mensagem(['corpo' => $corpo, 'tipo' => $tipo]);
        $mensagem->tipo_original = $tipoOriginal;
        $mensagem->detalhes_json = $detalhes;
        $mensagem->conversa_id = $conversa->id;
        $mensagem->direcao = Mensagem::DIRECAO_RECEBIDA;
        $mensagem->status = 'recebida';
        $mensagem->wa_message_id = $waId;
        $mensagem->recebida_em = $recebidaEm;

        try {
            $mensagem->save();
        } catch (QueryException $erro) {
            // já recebida: NÃO reincrementa não lidas nem reabre a janela — o efeito
            // visível de uma reentrega tem de ser exatamente zero
            if ($this->eDuplicidade($erro)) {
                return;
            }

            throw $erro;
        }

        if ($midia !== null) {
            $registro = new MensagemMidia;
            $registro->mensagem_id = $mensagem->id;
            $registro->wa_media_id = $midia['id'];
            $registro->mime = $midia['mime'];
            $registro->save();

            // o download é assíncrono: a Meta dá 5 minutos de janela para a URL, e segurar
            // o webhook baixando arquivo é o caminho para a Meta considerar a entrega falha
            BaixarMidiaJob::dispatch($registro->id);
        }

        // ATÔMICO, não read-modify-write: duas mensagens distintas chegando em paralelo na
        // mesma conversa liam `nao_lidas = 0` e escreviam 1 — um não lido sumia. E os
        // carimbos só AVANÇAM: o evento mais velho que commita por último não pode puxar a
        // janela de 24h para trás (achado do gate).
        Conversa::query()->whereKey($conversa->id)->update([
            'nao_lidas' => DB::raw('nao_lidas + 1'),
            'janela_expira_em' => DB::raw(sprintf(
                "GREATEST(COALESCE(janela_expira_em, '1970-01-01'), '%s')",
                $recebidaEm->copy()->addHours(Conversa::JANELA_HORAS)->format('Y-m-d H:i:s'),
            )),
            'ultima_mensagem_em' => DB::raw(sprintf(
                "GREATEST(COALESCE(ultima_mensagem_em, '1970-01-01'), '%s')",
                $recebidaEm->format('Y-m-d H:i:s'),
            )),
            // conversa arquivada volta à lista quando a família escreve de novo: arquivar é
            // "resolvido por ora", não "não quero mais falar"
            'arquivada_em' => null,
            'updated_at' => now(),
        ]);

        // o toque num botão pode responder a um lembrete: DEPOIS do commit (design D5) — a resposta
        // automática despacha job, e o toque só existe de verdade quando a transação fecha
        // só o `button` CRU: o `interactive` também vira `botao` na conversa, mas não carrega payload
        // nosso e não responde lembrete nenhum (change conversa-legivel, D1)
        if ($tipoOriginal === 'button') {
            $toqueId = (int) $mensagem->id;
            $conversaId = (int) $conversa->id;
            $contexto = is_string($bruta['context']['id'] ?? null) ? $bruta['context']['id'] : null;
            $payload = is_string($bruta['button']['payload'] ?? null) ? $bruta['button']['payload'] : null;

            $textoDoBotao = $corpo;

            DB::afterCommit(fn () => app(RespostaAoLembrete::class)->processar($toqueId, $conversaId, $contexto, $payload, $textoDoBotao, $recebidaEm));
        }
    }

    /** @param array<string, mixed> $bruto */
    private function atualizarStatus(array $bruto): void
    {
        $waId = $bruto['id'] ?? null;
        $status = $bruto['status'] ?? null;
        $novo = is_string($status) ? (self::STATUS[$status] ?? null) : null;

        if (! is_string($waId) || $novo === null) {
            return;
        }

        $mensagem = Mensagem::query()->where('wa_message_id', $waId)->first();

        if ($mensagem === null) {
            return;
        }

        $momento = $this->momento($bruto['timestamp'] ?? null);

        if ($novo === 'falhou') {
            $titulo = $bruto['errors'][0]['title'] ?? null;
            $motivo = is_string($titulo) && $titulo !== '' ? Str::limit($titulo, 500) : 'A Meta não conseguiu entregar.';

            $mensagem->avancarEntrega(function (Mensagem $alvo) use ($motivo): void {
                $alvo->status = 'falhou';
                $alvo->erro_motivo = $motivo;
            });

            return;
        }

        $mensagem->avancarEntrega(function (Mensagem $alvo) use ($novo, $momento): void {
            // carimbo de cada etapa: chega mesmo quando o status não avança (evento
            // atrasado), porque o INSTANTE do fato é verdadeiro independentemente da
            // ordem de chegada
            match ($novo) {
                'enviada' => $alvo->enviada_em ??= $momento,
                'entregue' => $alvo->entregue_em ??= $momento,
                'lida' => $alvo->lida_em ??= $momento,
            };

            $atual = Mensagem::posicaoDoStatus((string) $alvo->status);

            // a escala SÓ SOBE: um `enviada` que chega depois de `lida` é normal na Meta,
            // e deixá-lo rebaixar o estado mostraria à recepção que a mãe não leu o que
            // ela leu
            if ($atual === null || Mensagem::posicaoDoStatus($novo) > $atual) {
                $alvo->status = $novo;
            }
        });
    }

    private function conversaDe(string $telefone, ?string $nomePerfil): Conversa
    {
        $conversa = Conversa::query()->where('telefone_e164', $telefone)->first();

        if ($conversa !== null) {
            // o nome do perfil muda quando a pessoa o troca; acompanhar é gratuito
            if ($nomePerfil !== null && $conversa->nome_perfil !== $nomePerfil) {
                $conversa->nome_perfil = $nomePerfil;
            }

            // conversa que nasceu sem paciente pode ganhar um quando o cadastro é corrigido
            $conversa->paciente_id ??= CorrespondenciaDePaciente::paraTelefone($telefone);

            // grava AQUI: os contadores da conversa são atualizados adiante por `update`
            // atômico (que não enxerga estas mudanças de model), então deixá-las para lá
            // as perderia em silêncio
            if ($conversa->isDirty()) {
                $conversa->save();
            }

            return $conversa;
        }

        $nova = new Conversa(['nome_perfil' => $nomePerfil]);
        $nova->telefone_e164 = $telefone;
        $nova->paciente_id = CorrespondenciaDePaciente::paraTelefone($telefone);

        try {
            $nova->save();
        } catch (QueryException $erro) {
            if (! $this->eDuplicidade($erro)) {
                throw $erro;
            }

            // outro processo criou a conversa entre a nossa leitura e a nossa escrita — a
            // família mandou duas mensagens seguidas de um número novo, e a Meta entregou
            // as duas em paralelo. Reler é o certo; deixar estourar perderia a mensagem.
            return Conversa::query()->where('telefone_e164', $telefone)->firstOrFail();
        }

        return $nova;
    }

    /**
     * O que a família mandou, em quatro partes: o tipo nosso, o corpo (as palavras DELA, ou nulo),
     * a mídia a baixar e os detalhes estruturados (cifrados).
     *
     * O corpo nunca leva palavra nossa: "Reagiu com", "Enviou uma localização" são rótulos da tela
     * e do trecho da lista, montados na leitura (change conversa-legivel, D1).
     *
     * @param  array<string, mixed>  $bruta
     * @return array{0: string, 1: ?string, 2: ?array{id: string, mime: string}, 3: ?array<string, float>}
     */
    private function conteudo(array $bruta): array
    {
        // o formato é lido UMA vez, e só como string: um `type` que não é texto derrubava o evento
        // inteiro com 500 — e com ele as outras mensagens do mesmo lote (SEC-CL-01)
        $tipo = is_string($bruta['type'] ?? null) ? $bruta['type'] : '';

        return match ($tipo) {
            'text' => ['texto', $this->texto($bruta['text']['body'] ?? null), null, null],
            'image' => ['imagem', $this->legenda($bruta, 'image'), $this->midia($bruta, 'image'), null],
            'video' => ['video', $this->legenda($bruta, 'video'), $this->midia($bruta, 'video'), null],
            'audio' => ['audio', null, $this->midia($bruta, 'audio'), null],
            'document' => ['documento', $this->legenda($bruta, 'document'), $this->midia($bruta, 'document'), null],
            // o toque num botão de resposta rápida (lembrete-com-botoes-de-resposta): o corpo é o
            // TEXTO do botão — foi o que a família tocou, não uma palavra nossa
            'button' => ['botao', $this->texto($bruta['button']['text'] ?? null), null, null],
            'interactive' => $this->interativo($bruta),
            // sem emoji = a família TIROU a reação; o corpo nulo é o fato, não uma falta
            'reaction' => ['reacao', $this->textoCurto($bruta['reaction']['emoji'] ?? null, 20), null, null],
            // a figurinha é uma imagem webp — o mesmo caminho de download, e a whitelist já a aceita
            'sticker' => ['figurinha', null, $this->midia($bruta, 'sticker'), null],
            'location' => ['localizacao', $this->enderecoDaLocalizacao($bruta), null, $this->coordenadas($bruta)],
            'contacts' => ['contato', $this->contatos($bruta), null, null],
            // `unsupported` (edição, enquete, visualização única…), `order`, `system`…: o conteúdo
            // não chega à API — o tipo cru, guardado à parte, é o que diz o que foi
            default => ['nao_suportado', null, null, null],
        };
    }

    /**
     * O `type` cru da Meta, para diagnóstico. No `unsupported` a Meta diz O QUE não entregou
     * (`unsupported.type`: `edit`, `poll_creation`, `pin`…) — é o subtipo que responde "o que foi
     * aquilo?", então ele vai junto: `unsupported:edit` (CRL-02).
     *
     * @param  array<string, mixed>  $bruta
     */
    private function tipoOriginal(array $bruta): ?string
    {
        $tipo = $bruta['type'] ?? null;

        if (! is_string($tipo)) {
            return null;
        }

        // o nome do formato é minúsculo com `_` — o que não for isso não é nome de formato, é lixo, e
        // não vai para a tela nem para o diagnóstico (SEC-CL2-02)
        if (preg_match('/^[a-z_]{1,30}$/', $tipo) !== 1) {
            return null;
        }

        $subtipo = $bruta[$tipo]['type'] ?? null;

        // no `system` o subtipo diz, por exemplo, que a família TROCOU DE NÚMERO
        // (`user_changed_number`); o corpo, que traz os dois números, não é guardado (CRL2-06)
        if (in_array($tipo, ['unsupported', 'system'], true) && is_string($subtipo) && preg_match('/^[a-z_]{1,30}$/', $subtipo) === 1) {
            $tipo .= ':'.$subtipo;
        }

        return Str::limit($tipo, 40, '');
    }

    /**
     * Só a resposta a botão ou a lista é um toque com título. Os outros subtipos (`nfm_reply` de
     * formulário…) não têm o que mostrar e ficam como não suportados (CRL-03).
     *
     * @param  array<string, mixed>  $bruta
     * @return array{0: string, 1: ?string, 2: null, 3: null}
     */
    private function interativo(array $bruta): array
    {
        $interativo = is_array($bruta['interactive'] ?? null) ? $bruta['interactive'] : [];

        foreach (['button_reply', 'list_reply'] as $subtipo) {
            if (is_array($interativo[$subtipo] ?? null)) {
                return ['botao', $this->textoCurto($interativo[$subtipo]['title'] ?? null, 200), null, null];
            }
        }

        return ['nao_suportado', null, null, null];
    }

    /** @param array<string, mixed> $bruta */
    private function enderecoDaLocalizacao(array $bruta): ?string
    {
        $local = is_array($bruta['location'] ?? null) ? $bruta['location'] : [];
        $linhas = array_filter([
            $this->textoCurto($local['name'] ?? null, 200),
            $this->textoCurto($local['address'] ?? null, 300),
        ]);

        return $linhas === [] ? null : implode("\n", $linhas);
    }

    /**
     * Só dois números na faixa do planeta — o que não for isso não vira coordenada, e sem
     * coordenada a tela não oferece o mapa.
     *
     * @param  array<string, mixed>  $bruta
     * @return array{latitude: float, longitude: float}|null
     */
    private function coordenadas(array $bruta): ?array
    {
        $latitude = $bruta['location']['latitude'] ?? null;
        $longitude = $bruta['location']['longitude'] ?? null;

        if (! is_numeric($latitude) || ! is_numeric($longitude)) {
            return null;
        }

        $latitude = (float) $latitude;
        $longitude = (float) $longitude;

        if (! is_finite($latitude) || ! is_finite($longitude) || abs($latitude) > 90 || abs($longitude) > 180) {
            return null;
        }

        return ['latitude' => $latitude, 'longitude' => $longitude];
    }

    /**
     * Um contato por linha, `Nome — telefone`. Até cinco: um cartão com a agenda inteira de
     * alguém não é o que a clínica precisa ler na conversa.
     *
     * @param  array<string, mixed>  $bruta
     */
    private function contatos(array $bruta): ?string
    {
        $linhas = [];

        foreach (array_slice(is_array($bruta['contacts'] ?? null) ? $bruta['contacts'] : [], 0, 5) as $contato) {
            if (! is_array($contato)) {
                continue;
            }

            $nome = $this->textoCurto($contato['name']['formatted_name'] ?? null, 100);
            $telefone = $this->textoCurto($contato['phones'][0]['phone'] ?? null, 40);
            $linha = implode(' — ', array_filter([$nome, $telefone]));

            if ($linha !== '') {
                $linhas[] = $linha;
            }
        }

        return $linhas === [] ? null : implode("\n", $linhas);
    }

    /** O texto como veio, ou vazio: `(string)` de um array é exceção, não texto (SEC-CL-01). */
    private function texto(mixed $valor): string
    {
        return is_string($valor) ? $valor : '';
    }

    private function textoCurto(mixed $valor, int $limite): ?string
    {
        if (! is_string($valor)) {
            return null;
        }

        $valor = trim($valor);

        return $valor === '' ? null : Str::limit($valor, $limite);
    }

    /** @param array<string, mixed> $bruta */
    private function legenda(array $bruta, string $chave): ?string
    {
        $legenda = $bruta[$chave]['caption'] ?? null;

        return is_string($legenda) && $legenda !== '' ? $legenda : null;
    }

    /**
     * @param  array<string, mixed>  $bruta
     * @return array{id: string, mime: string}|null
     */
    private function midia(array $bruta, string $chave): ?array
    {
        $id = $bruta[$chave]['id'] ?? null;
        $mime = $bruta[$chave]['mime_type'] ?? null;

        // o id cabe na coluna (`wa_media_id` varchar 80) ou não há mídia: um id maior estourava o
        // INSERT e derrubava o lote inteiro (SEC-CL-01). O mime declarado é só dica — quem decide é
        // o conteúdo baixado (`GravadorDeMidia`) —, então o que não for texto curto vira o genérico
        if (! is_string($id) || $id === '' || strlen($id) > 80) {
            return null;
        }

        return [
            'id' => $id,
            'mime' => is_string($mime) && $mime !== '' && strlen($mime) <= 120 ? $mime : 'application/octet-stream',
        ];
    }

    /**
     * @param  list<mixed>  $contatos
     * @return array<string, string>
     */
    private function perfis(array $contatos): array
    {
        $perfis = [];

        foreach ($contatos as $contato) {
            $waId = $contato['wa_id'] ?? null;
            $nome = $contato['profile']['name'] ?? null;

            // `nome_perfil` é varchar 120: o nome escolhido pela pessoa no WhatsApp não pode derrubar o
            // lote por ser comprido (SEC-CL2-01)
            if (is_string($waId) && is_string($nome)) {
                $perfis[$waId] = Str::limit($nome, 120, '');
            }
        }

        return $perfis;
    }

    private function momento(mixed $timestamp): Carbon
    {
        // a Meta manda epoch em segundos, string de dígitos; ausente, lixo ou fora de uma faixa
        // plausível → agora (o evento chegou). `is_numeric` aceitava `1e30`, que o Carbon recusa com
        // exceção, e um epoch fora da faixa do TIMESTAMP do banco estourava o INSERT (SEC-CL2-01)
        // inteiro de verdade, ou nada: `(int)` de um float fora da faixa é indefinido no PHP
        $instante = is_string($timestamp) || is_int($timestamp) ? filter_var($timestamp, FILTER_VALIDATE_INT) : false;

        if ($instante === false) {
            return now();
        }

        // de 2015 (a Cloud API não existia antes) até amanhã: a Meta reentrega por dias, não por anos
        return $instante >= 1420070400 && $instante <= now()->addDay()->getTimestamp()
            ? Carbon::createFromTimestamp($instante)
            : now();
    }

    private function rotuloDoEvento(mixed $campo): ?string
    {
        return is_string($campo) && preg_match('/^[a-z_]{1,30}$/', $campo) === 1 ? $campo : null;
    }

    /** @return list<mixed> */
    private function lista(mixed $valor): array
    {
        return is_array($valor) ? array_values($valor) : [];
    }

    private function eDuplicidade(QueryException $erro): bool
    {
        return (int) ($erro->errorInfo[1] ?? 0) === 1062;
    }
}
