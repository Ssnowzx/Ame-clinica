<?php

namespace App\Support\Mensageria;

use App\Jobs\EnviarMensagemJob;
use App\Models\Conversa;
use App\Models\Mensagem;
use App\Models\MensagemTemplate;
use App\Support\Configuracoes\ConfiguracaoService;
use Illuminate\Validation\ValidationException;

/**
 * A porta de saída de mensagem (change mensageria-whatsapp, D5/D8/D9).
 *
 * TUDO é verificado AQUI, antes de qualquer chamada externa: canal conectado, janela de 24h,
 * template aprovado, teto do mês. A tela pode estar desatualizada — ela carrega um relógio
 * de janela que corre no cliente — e transformar "janela fechada" em erro cru da Meta é o
 * que faz a recepção achar que o sistema quebrou.
 *
 * O envio em si é ASSÍNCRONO: a mensagem nasce `pendente`, o Job leva adiante com backoff.
 * Um "Salvar" nunca espera a rede de um terceiro.
 */
class EnvioDeMensagens
{
    public function __construct(private readonly ConfiguracaoService $configuracoes) {}

    /**
     * `automatica`: a resposta que a clínica manda sozinha (ex.: ao toque num botão do lembrete —
     * `lembrete-com-botoes-de-resposta`), marcada na conversa como a do lembrete.
     */
    public function enviarTexto(Conversa $conversa, string $texto, ?int $autorId, bool $automatica = false): Mensagem
    {
        $this->exigirCanalConectado();
        $this->exigirJanelaAberta($conversa);

        return $this->despachar($conversa, [
            'tipo' => 'texto',
            'corpo' => $texto,
            'enviada_por' => $autorId,
            'automatica' => $automatica,
        ]);
    }

    /**
     * @param  array<string, string>  $variaveis
     */
    public function enviarTemplate(
        Conversa $conversa,
        string $nome,
        array $variaveis,
        ?int $autorId,
        bool $automatica = false,
    ): Mensagem {
        $this->exigirCanalConectado();

        $template = MensagemTemplate::query()->where('nome', $nome)->first();

        if ($template === null || ! $template->estaAprovado()) {
            throw ValidationException::withMessages([
                'template' => 'Este template não está aprovado na Meta. Sincronize a lista e tente de novo.',
            ]);
        }

        $faltando = array_diff($template->variaveis_json ?? [], array_keys($variaveis));

        if ($faltando !== []) {
            throw ValidationException::withMessages([
                'variaveis' => 'Preencha todas as variáveis do template antes de enviar.',
            ]);
        }

        $this->exigirTetoDisponivel();

        // As variáveis e o idioma vão para a MENSAGEM, e o Job os lê de lá — a carga da
        // fila fica VAZIA de propósito (SEC-WA-07): o payload de `jobs`/`failed_jobs` está
        // fora de toda retenção, e as variáveis do lembrete carregam o NOME da criança e o
        // horário da sessão dela. Persistir também conserta o reenvio, que antes
        // reenfileirava sem elas e degradava o template para texto puro.
        return $this->despachar($conversa, [
            'tipo' => 'template',
            'corpo' => $this->montarPrevia($template, $variaveis),
            'template_nome' => $nome,
            'template_idioma' => $template->idioma,
            'variaveis_json' => $variaveis,
            'enviada_por' => $autorId,
            'automatica' => $automatica,
        ]);
    }

    /**
     * Mídia é enviada em DOIS passos, e não por gosto: o arquivo precisa de uma mensagem
     * dona (`mensagem_id`) para ser gravado, e a mensagem só pode ser despachada depois de
     * o arquivo passar pela validação de conteúdo. Um passo só faria o Job sair antes de
     * existir arquivo para ele mandar.
     */
    public function iniciarMidia(Conversa $conversa, ?string $legenda, ?int $autorId): Mensagem
    {
        $this->exigirCanalConectado();
        $this->exigirJanelaAberta($conversa);

        return $this->criar($conversa, [
            'tipo' => 'documento',
            'corpo' => $legenda,
            'enviada_por' => $autorId,
        ]);
    }

    public function despacharMidia(Mensagem $mensagem, int $midiaId): void
    {
        EnviarMensagemJob::dispatch($mensagem->id, ['midia_id' => $midiaId]);
    }

    /**
     * Quantas conversas a clínica INICIOU no mês corrente.
     *
     * Conta template enviado — que é o único jeito de iniciar conversa fora da janela, e
     * portanto o que a Meta cobra. É uma aproximação DELIBERADAMENTE conservadora: dois
     * templates para a mesma família dentro das mesmas 24h são uma cobrança só e contam
     * dois aqui. Errar para o lado de parar cedo é o lado certo de errar num teto que
     * existe para proteger a fatura da clínica.
     */
    public function iniciadasNoMes(): int
    {
        return Mensagem::query()
            ->where('direcao', Mensagem::DIRECAO_ENVIADA)
            ->whereNotNull('template_nome')
            ->where('created_at', '>=', now()->startOfMonth())
            ->count();
    }

    public function tetoDoMes(): int
    {
        return (int) $this->configuracoes->get('whatsapp.limite_mensal');
    }

    /**
     * As mesmas três guardas do envio, para o REENVIO — que antes as pulava inteiras
     * (SEC-WA-10). Não é o vetor de estourar a fatura (a Meta não cobra o que falhou), mas
     * é laço batendo na Meta com credencial recusada, e a reputação do número é o ativo
     * mais frágil deste canal (gatilho WA-QUALIDADE).
     */
    public function exigirPodeReenviar(Conversa $conversa, bool $ehTemplate): void
    {
        $this->exigirCanalConectado();

        if ($ehTemplate) {
            $this->exigirTetoDisponivel();

            return;
        }

        $this->exigirJanelaAberta($conversa);
    }

    private function exigirCanalConectado(): void
    {
        $conexao = ConexaoDaClinica::atual();

        if ($conexao === null || ! $conexao->estaConectada()) {
            throw ValidationException::withMessages([
                'conexao' => 'O WhatsApp da clínica não está conectado. Fale com o administrador.',
            ]);
        }
    }

    private function exigirJanelaAberta(Conversa $conversa): void
    {
        if ($conversa->janelaAberta()) {
            return;
        }

        // regra do canal, não nossa: fora das 24h desde a última mensagem recebida, a Meta
        // só aceita template aprovado
        throw ValidationException::withMessages([
            'janela' => 'Passaram-se mais de 24h desde a última mensagem da família. '
                .'Para retomar o contato, envie um template aprovado.',
        ]);
    }

    private function exigirTetoDisponivel(): void
    {
        $teto = $this->tetoDoMes();

        if ($this->iniciadasNoMes() < $teto) {
            return;
        }

        throw ValidationException::withMessages([
            'limite' => "O limite de {$teto} conversas iniciadas neste mês foi atingido. "
                .'Responder famílias que escreveram continua liberado.',
        ]);
    }

    /**
     * @param  array<string, mixed>  $atributos
     * @param  array<string, mixed>  $carga  o que o Job precisa e a mensagem não guarda
     */
    private function despachar(Conversa $conversa, array $atributos, array $carga = []): Mensagem
    {
        $mensagem = $this->criar($conversa, $atributos);

        EnviarMensagemJob::dispatch($mensagem->id, $carga);

        return $mensagem;
    }

    /** @param array<string, mixed> $atributos */
    private function criar(Conversa $conversa, array $atributos): Mensagem
    {
        $mensagem = new Mensagem(['corpo' => $atributos['corpo'] ?? null, 'tipo' => $atributos['tipo']]);
        $mensagem->conversa_id = $conversa->id;
        $mensagem->direcao = Mensagem::DIRECAO_ENVIADA;
        $mensagem->status = 'pendente';
        $mensagem->template_nome = $atributos['template_nome'] ?? null;
        $mensagem->template_idioma = $atributos['template_idioma'] ?? null;
        $mensagem->variaveis_json = $atributos['variaveis_json'] ?? null;
        $mensagem->enviada_por = $atributos['enviada_por'] ?? null;
        $mensagem->automatica = (bool) ($atributos['automatica'] ?? false);
        $mensagem->save();

        $conversa->ultima_mensagem_em = now();
        $conversa->save();

        return $mensagem;
    }

    /**
     * O texto que a família vai ler, montado a partir do corpo do template.
     *
     * Guardar a prévia (e não só o nome do template) é o que faz a thread ficar legível:
     * sem ela, a recepção veria "template lembrete_agendamento" onde a mãe leu uma frase.
     *
     * @param  array<string, string>  $variaveis
     */
    private function montarPrevia(MensagemTemplate $template, array $variaveis): string
    {
        $corpo = (string) $template->corpo_previa;

        foreach ($variaveis as $chave => $valor) {
            $corpo = str_replace('{{'.$chave.'}}', $valor, $corpo);
        }

        return $corpo;
    }
}
