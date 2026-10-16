<?php

namespace App\Http\Controllers;

use App\Models\Conversa;
use App\Models\Mensagem;
use App\Models\Paciente;
use App\Support\Clinica\ResumoDoPaciente;
use App\Support\Mensageria\ConexaoDaClinica;
use App\Support\Mensageria\EnvioDeMensagens;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

/**
 * A caixa de entrada (change mensageria-whatsapp).
 *
 * DA CRIANÇA SAI SÓ O NOME — `ResumoDoPaciente` nas duas camadas (o `select` do banco e o
 * mapeamento da resposta). Esta aba fica aberta o dia inteiro num balcão de recepção, à
 * vista de quem passa: nascimento, necessidade e CPF não têm o que fazer aqui.
 *
 * O TEOR das mensagens também não sai na LISTA — só na thread que alguém abriu de propósito.
 */
class ConversaController extends Controller
{
    /**
     * Janela da thread. 50 cobre com folga o que cabe numa tela rolada algumas vezes, e é
     * o mesmo teto que o centro de notificações usa por bloco.
     */
    private const MENSAGENS_POR_PAGINA = 50;

    /** Teto da lista de conversas por página — a clínica tem ~400 pacientes ativos. */
    private const CONVERSAS_POR_PAGINA = 50;

    public function __construct(private readonly EnvioDeMensagens $envio) {}

    public function index(Request $request): JsonResponse
    {
        $busca = trim((string) $request->query('busca', ''));
        $filtro = (string) $request->query('filtro', 'ativas');

        $conversas = Conversa::query()
            ->with(ResumoDoPaciente::relacao())
            ->when($filtro === 'arquivadas',
                fn ($q) => $q->whereNotNull('arquivada_em'),
                fn ($q) => $q->whereNull('arquivada_em'),
            )
            ->when($filtro === 'nao_lidas', fn ($q) => $q->where('nao_lidas', '>', 0))
            ->when($filtro === 'nao_vinculadas', fn ($q) => $q->whereNull('paciente_id'))
            ->when($busca !== '', function ($q) use ($busca) {
                $q->where(function ($interno) use ($busca) {
                    $interno->where('telefone_e164', 'like', '%'.$busca.'%')
                        ->orWhere('nome_perfil', 'like', '%'.$busca.'%')
                        ->orWhereHas('paciente', fn ($p) => $p->where('nome', 'like', '%'.$busca.'%'));
                });
            })
            ->orderByDesc('ultima_mensagem_em')
            // PAGINADA, não cortada em 200: com ~400 pacientes ativos, passar de 200
            // conversas é certeza — e um corte mudo esconderia famílias sem ninguém saber
            ->paginate(self::CONVERSAS_POR_PAGINA);

        $trechos = $this->trechosDaUltimaMensagem($conversas->getCollection()->pluck('id')->all());

        return response()->json([
            'conexao' => ConexaoDaClinica::atual()?->estado ?? 'nao_conectado',
            'conversas' => $conversas->getCollection()->map(
                fn (Conversa $conversa) => $this->resumir($conversa) + [
                    'trecho' => $trechos[$conversa->id] ?? null,
                ],
            ),
            'pagina' => $conversas->currentPage(),
            'ultima_pagina' => $conversas->lastPage(),
            'total' => $conversas->total(),
        ]);
    }

    /**
     * A thread. Abrir a conversa ZERA as não lidas — é a leitura que marca como lido, não
     * um botão: ninguém clica em "marcar como lida" depois de ler.
     *
     * CARREGA A JANELA MAIS RECENTE, não a conversa inteira. Uma família de dois anos de
     * acompanhamento acumula milhares de mensagens, e a tela relê a thread a cada 8 s
     * (polling): sem teto, cada ciclo arrastaria a conversa inteira pela rede e reconstruiria
     * a lista toda no DOM. `?antes=<id>` pagina para trás, sob demanda.
     */
    public function show(Request $request, int $id): JsonResponse
    {
        $conversa = Conversa::query()->with(ResumoDoPaciente::relacao())->findOrFail($id);
        $antes = (int) $request->query('antes', 0);

        $consulta = Mensagem::query()
            ->where('conversa_id', $conversa->id)
            ->with('midia:id,mensagem_id,mime,tamanho,caminho')
            ->when($antes > 0, fn ($q) => $q->where('id', '<', $antes));

        // busca DESC (as mais novas primeiro, que é o que se quer ver) e reordena para
        // exibição — `orderBy('id')` com `limit` traria as mais ANTIGAS, o oposto
        $mensagens = (clone $consulta)->orderByDesc('id')->limit(self::MENSAGENS_POR_PAGINA)->get()
            ->sortBy('id')->values();

        $maisAntigaCarregada = $mensagens->first()?->id;
        $temAnteriores = $maisAntigaCarregada !== null && Mensagem::query()
            ->where('conversa_id', $conversa->id)
            ->where('id', '<', $maisAntigaCarregada)
            ->exists();

        // paginar para trás é LEITURA de histórico: não mexe no contador de não lidas
        if ($antes === 0 && $conversa->nao_lidas > 0) {
            $conversa->forceFill(['nao_lidas' => 0])->save();
        }

        return response()->json([
            'conversa' => $this->resumir($conversa),
            'tem_anteriores' => $temAnteriores,
            'mensagens' => $mensagens->map(fn (Mensagem $mensagem) => [
                'id' => $mensagem->id,
                'direcao' => $mensagem->direcao,
                'tipo' => $mensagem->tipo,
                // o formato cru da Meta (`unsupported:edit`…) — nome de formato, não conteúdo: é
                // o que deixa a tela explicar O QUE o WhatsApp não entregou (CRL-02)
                'tipo_original' => $mensagem->tipo_original,
                'corpo' => $mensagem->corpo,
                'template_nome' => $mensagem->template_nome,
                'status' => $mensagem->status,
                'erro_motivo' => $mensagem->erro_motivo,
                'automatica' => $mensagem->automatica,
                'enviada_por' => $mensagem->enviada_por,
                'expurgada' => $mensagem->expurgada_em !== null,
                // montado pelo servidor a partir das coordenadas (que o expurgo apaga): o texto da
                // família nunca vira link
                'mapa_url' => $mensagem->mapaUrl(),
                'midia' => $mensagem->midia === null ? null : [
                    'id' => $mensagem->midia->id,
                    'mime' => $mensagem->midia->mime,
                    'tamanho' => $mensagem->midia->tamanho,
                    // `disponivel` em vez do caminho: o caminho é server-set e não sai daqui
                    'disponivel' => $mensagem->midia->caminho !== null,
                ],
                'em' => ($mensagem->recebida_em ?? $mensagem->enviada_em ?? $mensagem->created_at)?->toIso8601String(),
            ]),
        ]);
    }

    /**
     * Vincula a conversa a um paciente — o caminho manual para quando o sistema se recusou
     * a adivinhar (dois irmãos no mesmo telefone).
     */
    public function vincular(Request $request, int $id): JsonResponse
    {
        $dados = $request->validate([
            // `nullable` para DESvincular: quem vinculou errado precisa poder desfazer
            'paciente_id' => ['present', 'nullable', 'integer'],
        ]);

        $conversa = Conversa::query()->findOrFail($id);

        // `findOrFail`: id inexistente morre aqui, não vira vínculo
        $conversa->paciente_id = $dados['paciente_id'] === null
            ? null
            : Paciente::query()->findOrFail($dados['paciente_id'])->id;
        $conversa->save();

        return response()->json($this->resumir($conversa->load(ResumoDoPaciente::relacao())));
    }

    public function arquivar(int $id): JsonResponse
    {
        $conversa = Conversa::query()->findOrFail($id);
        $conversa->forceFill(['arquivada_em' => now()])->save();

        return response()->json($this->resumir($conversa));
    }

    public function desarquivar(int $id): JsonResponse
    {
        $conversa = Conversa::query()->findOrFail($id);
        $conversa->forceFill(['arquivada_em' => null])->save();

        return response()->json($this->resumir($conversa));
    }

    /**
     * O opt-out da família. Cala o disparo AUTOMÁTICO e não o atendimento humano: recusar
     * aviso automático não é recusar ser atendido.
     */
    public function lembretes(Request $request, int $id): JsonResponse
    {
        $dados = $request->validate(['sem_lembretes' => ['required', 'boolean']]);

        $conversa = Conversa::query()->findOrFail($id);
        $conversa->fill($dados)->save();

        return response()->json($this->resumir($conversa));
    }

    /**
     * O TRECHO da última mensagem de cada conversa, numa consulta só.
     *
     * É o que faz uma caixa de entrada ser uma caixa de entrada: sem ele, a recepção abre
     * conversa por conversa para descobrir qual espera resposta. A spec de tela o exige.
     *
     * O trecho fica SÓ AQUI — na lista, atrás de `mensagens.ver`, que é a tela de trabalho
     * de quem atende. O centro de notificações continua sem teor nenhum (ele fica aberto em
     * painel compartilhado, e é outra régua).
     *
     * @param  list<int>  $conversaIds
     * @return array<int, string|null>
     */
    private function trechosDaUltimaMensagem(array $conversaIds): array
    {
        if ($conversaIds === []) {
            return [];
        }

        // a última mensagem de CADA conversa: subconsulta de máximo por grupo — uma ida ao
        // banco para a página inteira, nunca uma por linha
        $ultimas = Mensagem::query()
            ->whereIn('conversa_id', $conversaIds)
            ->whereIn('id', function ($sub) use ($conversaIds): void {
                $sub->selectRaw('MAX(id)')
                    ->from('mensagens')
                    ->whereIn('conversa_id', $conversaIds)
                    ->groupBy('conversa_id');
            })
            ->get(['id', 'conversa_id', 'corpo', 'tipo', 'tipo_original', 'erro_motivo', 'expurgada_em']);

        return $ultimas->mapWithKeys(fn (Mensagem $mensagem) => [
            $mensagem->conversa_id => $this->trechoDe($mensagem),
        ])->all();
    }

    /** Rótulo curto do que veio por último — nunca o corpo inteiro. */
    private function trechoDe(Mensagem $mensagem): ?string
    {
        if ($mensagem->expurgada_em !== null) {
            return null;
        }

        $corpo = $mensagem->corpo ?? '';

        // cada tipo diz o que foi, como a conversa o mostra (N2; conversa-legivel, D1) — a lista
        // não pode dizer "Anexo" de uma figurinha nem "não suportada" de um 👍
        return match (true) {
            $mensagem->tipo === 'botao' => $corpo !== '' ? Str::limit('Tocou em: '.$corpo, 80) : 'Tocou num botão da mensagem',
            $mensagem->tipo === 'reacao' => $corpo !== '' ? 'Reagiu com '.$corpo : 'Tirou a reação',
            $mensagem->tipo === 'figurinha' => 'Enviou uma figurinha',
            $mensagem->tipo === 'localizacao' => 'Enviou uma localização',
            $mensagem->tipo === 'contato' => 'Enviou um contato',
            $mensagem->tipo === 'nao_suportado' => $this->trechoDoNaoSuportado($mensagem),
            $corpo !== '' => Str::limit($corpo, 80),
            default => 'Anexo',
        };
    }

    /**
     * "Não suportado" tem duas origens, e dizer uma pela outra é mentir (CRL-01): a Meta que não
     * entregou o conteúdo (`unsupported`, com o subtipo) ou NÓS que recusamos o arquivo que chegou
     * (`GravadorDeMidia::recusar`, que grava o motivo).
     */
    private function trechoDoNaoSuportado(Mensagem $mensagem): string
    {
        if ($mensagem->erro_motivo !== null) {
            return 'Enviou um arquivo que o sistema não aceita';
        }

        return match ($mensagem->tipo_original) {
            'unsupported:edit' => 'Editou uma mensagem',
            'unsupported:poll_creation' => 'Enviou uma enquete',
            'system:user_changed_number' => 'Trocou de número no WhatsApp',
            default => 'Mensagem que o WhatsApp não mostra',
        };
    }

    /** @return array<string, mixed> */
    private function resumir(Conversa $conversa): array
    {
        return [
            'id' => $conversa->id,
            'telefone' => $conversa->telefone_e164,
            'nome_perfil' => $conversa->nome_perfil,
            'paciente' => ResumoDoPaciente::deOuNulo($conversa->paciente),
            'nao_lidas' => $conversa->nao_lidas,
            'sem_lembretes' => $conversa->sem_lembretes,
            'arquivada' => $conversa->arquivada_em !== null,
            'janela_expira_em' => $conversa->janela_expira_em?->toIso8601String(),
            'janela_aberta' => $conversa->janelaAberta(),
            'ultima_mensagem_em' => $conversa->ultima_mensagem_em?->toIso8601String(),
        ];
    }
}
