<?php

namespace App\Http\Controllers;

use App\Http\Resources\AprovacaoDeAcessoResource;
use App\Models\StatusAgendamento;
use App\Support\Configuracoes\CatalogoConfiguracoes;
use App\Support\Configuracoes\ConfiguracaoService;
use App\Support\Financeiro\MensagemDeCobranca;
use App\Support\Rbac\AprovacoesDeAcesso;
use App\Support\Rbac\GuardaUltimoAdmin;
use App\Support\Rbac\MutacoesDeAcesso;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

class ConfiguracaoController extends Controller
{
    public function __construct(
        private readonly ConfiguracaoService $configuracoes,
        private readonly MutacoesDeAcesso $mutacoes,
        private readonly AprovacoesDeAcesso $aprovacoes,
    ) {}

    /**
     * As SEÇÕES vêm ao lado das configurações, e não dentro de cada entrada, por dois
     * motivos: repetir o rótulo da seção em cada chave o repetiria dez vezes, e — o que
     * importa — a tela precisa da ORDEM das abas, que não existe dentro de uma entrada
     * isolada. É a mesma forma do `CamposCadastroController`.
     */
    public function index(): JsonResponse
    {
        return response()->json([
            'configuracoes' => $this->configuracoes->todasEfetivas(),
            'secoes' => collect(CatalogoConfiguracoes::SECOES)
                ->map(fn (string $rotulo, string $secao): array => ['secao' => $secao, 'rotulo' => $rotulo])
                ->values(),
            'blocos' => collect(CatalogoConfiguracoes::BLOCOS)
                ->map(fn (string $rotulo, string $bloco): array => ['bloco' => $bloco, 'rotulo' => $rotulo])
                ->values(),
        ]);
    }

    /**
     * Leitura de EXIBIÇÃO dos alvos elegíveis do encadeamento (SEC-ADM-05, fecha
     * CONFIG-SEM-FK): os status da clínica que NÃO descontam sessão — os únicos
     * que a automação pode consumir (T-not-09/10). Existe para a tela de configurações
     * validar o alvo NA LEITURA sem exigir `status_agendamento.ver` — o mesmo padrão de
     * leitura minimizada do `/agenda/selecao`. Whitelist fechada `{id, nome}`.
     */
    public function alvosEncadeamento(): JsonResponse
    {
        $alvos = StatusAgendamento::where('desconta_sessao', false)
            ->orderBy('ordem')
            ->orderBy('id')
            ->get(['id', 'nome', 'ocupa_horario'])
            ->map(fn (StatusAgendamento $status): array => [
                'id' => $status->id,
                'nome' => $status->nome,
                // os ponteiros de status da tela (formato `status`) filtram por aqui: o do desmarque
                // pela família só aceita status que libera o horário
                'ocupa_horario' => (bool) $status->ocupa_horario,
            ])
            ->values();

        // os que FINALIZAM a sessão (desconta, ocupa horário, não é falta): a lista do "status aplicado ao
        // salvar a evolução" (evolucao-finaliza-a-sessao). Os alvos acima são o oposto — não descontam
        $finalizam = StatusAgendamento::queFinalizaASessao()
            ->orderBy('ordem')
            ->orderBy('id')
            ->get(['id', 'nome'])
            ->map(fn (StatusAgendamento $status): array => ['id' => $status->id, 'nome' => $status->nome])
            ->values();

        return response()->json(['alvos' => $alvos, 'finalizam' => $finalizam]);
    }

    /**
     * Configurações de EXIBIÇÃO da grade, sob `agenda.ver` (T-sag-02): a agenda
     * não pode empurrar `configuracoes.ver` — que dá o catálogo INTEIRO
     * (financeiro, encadeamento…) — para a recepção só para desenhar a grade.
     */
    public function agenda(): JsonResponse
    {
        /*
         * WHITELIST FECHADA `{chave, tipo, valor}`, montada a partir das chaves de exibição —
         * não uma projeção do catálogo inteiro com três campos removidos.
         *
         * A versão anterior lia `todasEfetivas()` e apagava `rotulo`/`secao`/`bloco` depois.
         * Três defeitos num gesto (pareceres SEC-SDC-01 e CR-IMPORTANTE-1):
         *
         * 1. **Raio de explosão.** `todasEfetivas()` chama `metadados()` nas 37 chaves, e
         *    `metadados()` lança se alguma estiver incompleta. Um `rotulo` faltando numa chave
         *    de financeiro — que a grade nunca lê — derrubava este endpoint, e a recepção via
         *    "Não foi possível carregar a agenda". A grade é essencial; o metadado não.
         * 2. **Lista de negação.** Proteger removendo TRÊS NOMES libera por omissão o quarto
         *    metadado de apresentação que alguém acrescentar. Foi assim que o dicionário do
         *    front ficou para trás em 2026-08-21: a lista que precisa ser lembrada.
         * 3. **Custo.** Eram 37 consultas para devolver 8 chaves.
         *
         * É o mesmo padrão de `alvosEncadeamento()`, logo abaixo.
         */
        $exibicao = collect(CatalogoConfiguracoes::CHAVES_EXIBICAO_AGENDA)
            ->map(fn (string $chave): array => [
                'chave' => $chave,
                'tipo' => CatalogoConfiguracoes::tipo($chave),
                'valor' => $this->configuracoes->get($chave),
            ])
            ->values();

        return response()->json(['configuracoes' => $exibicao]);
    }

    /**
     * Grava um override da clínica (parecer T-cfg-01). Validação sempre contra o catálogo (T-cfg-02).
     */
    public function update(Request $request): JsonResponse
    {
        // `seguranca.*` é de quem administra acesso (change `trava-de-usuarios-e-niveis`, D5): com só
        // `configuracoes.editar`, a recepção pedia para desligar a aprovação dupla. Antes da validação
        // e da pendência — a chave crua basta para decidir
        $chave = $request->input('chave');
        abort_if(
            is_string($chave) && str_starts_with($chave, 'seguranca.') && ! $request->user()->can(GuardaUltimoAdmin::PERMISSAO),
            403,
            'As configurações de segurança são de quem administra o acesso da clínica.',
        );

        $dados = $request->validate([
            'chave' => ['required', 'string'],
            'valor' => ['present'],
        ]);

        if (! CatalogoConfiguracoes::existe($dados['chave'])) {
            throw ValidationException::withMessages([
                'chave' => 'Configuração desconhecida.',
            ]);
        }

        // a marca desconhecida é nomeada (change `cobranca-pelo-whatsapp`): "valor incompatível"
        // não diz à Mariana que `{paciente}` era `{crianca}`
        if ($dados['chave'] === 'financeiro.mensagem_cobranca' && is_string($dados['valor'])
            && ($desconhecidas = MensagemDeCobranca::marcasDesconhecidas($dados['valor'])) !== []) {
            throw ValidationException::withMessages([
                'valor' => 'Marca desconhecida: '.implode(', ', array_map(fn (string $m): string => '{'.$m.'}', $desconhecidas))
                    .'. Use '.implode(', ', array_map(fn (string $m): string => '{'.$m.'}', MensagemDeCobranca::MARCAS)).'.',
            ]);
        }

        $dados['valor'] = CatalogoConfiguracoes::normalizarVazio($dados['chave'], $dados['valor']);

        if (! CatalogoConfiguracoes::valorEValido($dados['chave'], $dados['valor'])) {
            throw ValidationException::withMessages([
                'valor' => CatalogoConfiguracoes::motivoDaRecusa($dados['chave'], $dados['valor']),
            ]);
        }

        // o alvo do encadeamento é semântico (T-not-09/10): status da clínica
        // que NÃO desconta sessão — automação jamais consome (0 desliga)
        if ($dados['chave'] === 'agenda.encadeamento_status_id' && $dados['valor'] !== 0) {
            $valido = StatusAgendamento::whereKey($dados['valor'])
                ->where('desconta_sessao', false)->exists();
            if (! $valido) {
                throw ValidationException::withMessages([
                    'valor' => 'O status-alvo do encadeamento deve ser um status da clínica que não desconta sessão.',
                ]);
            }
        }

        // o status do DESMARQUE EM LOTE segue a mesma régua semântica do encadeamento
        // (SEC — desmarcar por imprevisto do profissional não pode consumir a sessão da
        // criança), e a validação mora AQUI para o erro aparecer quando alguém configura,
        // não quando a recepcionista precisa desmarcar uma manhã inteira
        if ($dados['chave'] === 'agenda.status_desmarque_id' && $dados['valor'] !== 0) {
            $valido = StatusAgendamento::whereKey($dados['valor'])
                ->where('desconta_sessao', false)->exists();
            if (! $valido) {
                throw ValidationException::withMessages([
                    'valor' => 'O status do desmarque deve ser um status da clínica que não desconta sessão.',
                ]);
            }
        }

        // o status aplicado ao salvar a evolução (evolucao-finaliza-a-sessao, D3): FINALIZA a sessão —
        // desconta, ocupa o horário e não é falta. Um status que libera o horário seria um desmarque
        // escondido atrás de "salvar a evolução"; um de falta marcaria ausente a criança que foi atendida
        if ($dados['chave'] === 'evolucoes.status_ao_salvar' && $dados['valor'] !== 0) {
            $valido = StatusAgendamento::queFinalizaASessao()->whereKey($dados['valor'])->exists();
            if (! $valido) {
                throw ValidationException::withMessages([
                    'valor' => 'O status aplicado ao salvar a evolução deve ser um status da clínica que desconta a sessão, ocupa o horário e não marca falta.',
                ]);
            }
        }

        // o status do desmarque PELA FAMÍLIA (lembrete-com-botoes-de-resposta): não consome a sessão
        // e LIBERA o horário — é o que faz "Desmarcar" do card devolver a vaga para outra criança
        if ($dados['chave'] === 'lembretes.status_desmarque_familia_id' && $dados['valor'] !== 0) {
            $valido = StatusAgendamento::whereKey($dados['valor'])
                ->where('desconta_sessao', false)
                ->where('ocupa_horario', false)
                ->exists();
            if (! $valido) {
                throw ValidationException::withMessages([
                    'valor' => 'O status do desmarque pela família deve ser um status da clínica que não desconta sessão e libera o horário.',
                ]);
            }
        }

        $this->validarJanelaPadrao($dados['chave'], $dados['valor']);

        // maker-checker (AP-13/SEC-SD-08): DESLIGAR uma flag `seguranca.*` com a dupla
        // ligada é mudança sensível — vira pendência (desligar-mutar-religar é o bypass
        // que este gate fecha); ligar e o resto do catálogo seguem diretos
        if ($this->aprovacoes->configuracaoExigeAprovacao($dados['chave'], $dados['valor'])) {
            if ($dados['chave'] === 'seguranca.aprovacao_dupla') {
                $this->mutacoes->assegurarQueADuplaPodeDesligar();
            }
            $aprovacao = $this->aprovacoes->abrir('configurar_seguranca', 0, $dados['chave'], [
                'chave' => $dados['chave'],
                'valor' => $dados['valor'],
            ], $request->user());

            return (new AprovacaoDeAcessoResource($aprovacao))->response()->setStatusCode(202);
        }

        // a fonte única aplica as PRÉ-CONDIÇÕES de ligar (dupla exige ≥2 admins;
        // segregação exige zero níveis violadores) e grava
        $this->mutacoes->aplicarConfiguracao($dados['chave'], $dados['valor']);

        return response()->json([
            'chave' => $dados['chave'],
            'valor' => $this->configuracoes->get($dados['chave']),
        ]);
    }

    /**
     * A janela padrão da grade é uma invariante de PAR (início < fim), mas a
     * escrita é chave a chave: valida contra o ESTADO FINAL — o valor que entra
     * somado ao valor efetivo do irmão (T-sag-06).
     */
    private function validarJanelaPadrao(string $chave, mixed $valor): void
    {
        $irmaos = [
            'agenda.janela_padrao_inicio' => 'agenda.janela_padrao_fim',
            'agenda.janela_padrao_fim' => 'agenda.janela_padrao_inicio',
        ];

        if (! array_key_exists($chave, $irmaos)) {
            return;
        }

        $outro = $this->configuracoes->get($irmaos[$chave]);
        [$inicio, $fim] = $chave === 'agenda.janela_padrao_inicio'
            ? [$valor, $outro]
            : [$outro, $valor];

        if ($inicio >= $fim) {
            throw ValidationException::withMessages([
                'valor' => 'A janela padrão da agenda deve começar antes de terminar.',
            ]);
        }
    }
}
