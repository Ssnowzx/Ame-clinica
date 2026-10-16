<?php

namespace App\Http\Controllers;

use App\Models\Agendamento;
use App\Models\Equipamento;
use App\Models\Especialidade;
use App\Models\Feriado;
use App\Models\Medico;
use App\Models\Paciente;
use App\Models\Profissional;
use App\Models\Sala;
use App\Models\StatusAgendamento;
use App\Models\Tratamento;
use App\Support\Clinica\ResumoDoPaciente;
use App\Support\Configuracoes\ConfiguracaoService;
use App\Support\Rbac\EscopoDoProfissional;
use Closure;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Catálogos para o FORMULÁRIO da agenda, sob a permissão da própria agenda
 * (parecer T-aes-08 / decisão P-01).
 *
 * Sem isto, marcar uma sessão exigiria `pacientes.ver` — que entrega CPF,
 * responsáveis, endereço e contatos de todo MENOR a quem só precisa escolher um
 * nome numa lista. Aqui cada recurso sai por WHITELIST de colunas: o mínimo para
 * escolher, nada além.
 */
class AgendaSelecaoController extends Controller
{
    // Nome e nada mais — nem `nascimento`, nem `necessidade` (dado de saúde). A lista vem
    // da FONTE ÚNICA (`ResumoDoPaciente::CAMPOS`): enquanto era literal aqui, esta cópia
    // podia erodir sozinha, em silêncio, sem que nenhum teste da fonte única percebesse.

    /**
     * O mínimo para ESCOLHER um profissional — serve a QUEM QUER QUE alcance esta rota,
     * inclusive quem só administra a FILA (`lista_espera.criar|editar`).
     */
    private const CAMPOS_PROFISSIONAL = ['id', 'nome'];

    /**
     * O que a GRADE precisa DESENHAR, e só ela vê: a `obs` do profissional.
     *
     * É a linha da lista lateral ("Atende só pela manhã", "Supervisão às sextas") — observação de
     * AGENDA. Mas é TEXTO LIVRE da clínica ("em licença até março"), e quem administra a fila não
     * tem por que lê-la: ela ficava do lado errado do `if` e saía para ele de brinde (gate). É o
     * privilege creep que o docblock desta classe (SEC-LE-07) existe para impedir.
     *
     * `atendimentos_simultaneos` entra pelo mesmo motivo que os horários: a grade decide COM ele
     * se a célula ainda convida a marcar. Sem esse número no payload, a tela e o servidor voltam
     * a ter frases diferentes sobre o que é horário ocupado — a tela recusaria o slot que a API
     * aceita, e cada lado passaria sozinho no seu teste (foi assim em 11/09). Não é dado
     * sensível: é quantos atendimentos o profissional sustenta de uma vez, a mesma informação
     * que a coluna já revela ao desenhar os cards empilhados.
     *
     * Conselho, CBO e contato continuam FORA: são CADASTRO, e exigem `profissionais.ver`.
     *
     * Os `horarios` (mapa por dia, da relação `profissional_horarios`) entram AQUI (não na base):
     * a grade precisa deles para pintar o dia/horário indisponível na coluna do profissional; quem
     * só administra a fila não desenha a grade. Não é dado sensível (horário não é saúde) — só
     * least-privilege. Vêm eager-loaded e serializados como mapa, não como coluna do `only`.
     */
    private const CAMPOS_PROFISSIONAL_DA_GRADE = [...self::CAMPOS_PROFISSIONAL, 'obs', 'atendimentos_simultaneos'];

    /** O suficiente para o formulário decidir/validar — sem valores nem convênio */
    private const CAMPOS_TRATAMENTO = ['id', 'paciente_id', 'especialidade_id', 'sessoes_total', 'sessoes_realizadas', 'status'];

    /**
     * Teto da busca e da página: a lista é para ESCOLHER, não para varrer o cadastro.
     *
     * **Espelhado no cliente** (`PACIENTES_POR_PAGINA` em `web/src/servicos/agenda.ts`), que
     * decide "veio página cheia ⇒ pode haver mais" — mudar este número sem mudar aquele faz
     * a tela parar de paginar EM SILÊNCIO, mostrando as primeiras N crianças como se fossem
     * o catálogo inteiro (achado CR-BPL-13).
     */
    private const TETO_BUSCA = 20;

    /** Busca exige 2+ caracteres: `?busca=a` viraria varredura do cadastro */
    private const MINIMO_DA_BUSCA = 2;

    /**
     * O marcador de "existe cadastro INATIVO que casa com o termo" (change
     * `paciente-inativo-com-saida`).
     *
     * Vive no CABEÇALHO e não no corpo porque esta rota devolve um array puro nos quatro modos, e
     * o cliente infere paginação por "página cheia": envelopar o corpo por causa de um booleano
     * quebraria os quatro. Um cliente que o ignore continua funcionando igual.
     *
     * É emitido **só quando verdadeiro** e **só para quem tem `pacientes.ver`** — quem já alcança
     * a lista de Pacientes no filtro Inativos, com a mesma busca. Para todos os outros a resposta
     * é byte a byte a de antes desta change, e é isso que mantém de pé a recusa cega do
     * `SEC-VP-33`: "existe inativo com esse nome" tem de ser indistinguível de "não existe
     * ninguém com esse nome".
     */
    private const CABECALHO_INATIVOS = 'X-Pacientes-Inativos';

    /**
     * Teto de páginas do modo LISTA. Sem ele, `?pagina=999999` é um OFFSET gigante que o
     * banco paga caro para devolver nada — e 200 páginas de 20 já cobrem 4 mil crianças,
     * muito além do cadastro inteiro da clínica.
     */
    private const TETO_DE_PAGINAS = 200;

    /**
     * A seção de RECENTES é um atalho, não um segundo catálogo: cabe na primeira tela da
     * lista e acaba ali. Quem não está nela continua a uma rolagem (ou duas letras) de
     * distância.
     */
    private const TETO_RECENTES = 8;

    /**
     * Janela do "recente": a mesma de `comparecimento-recente`. Sem janela, a consulta
     * agrupa a tabela inteira de agendamentos para devolver oito nomes.
     */
    private const JANELA_RECENTES_DIAS = 90;

    public function __construct(private readonly EscopoDoProfissional $escopos) {}

    /**
     * Catálogos estáveis do formulário (cacheáveis no cliente).
     *
     * O payload é PROJETADO pela permissão (parecer lista-de-espera, SEC-LE-07):
     * a rota também atende quem administra a FILA (`lista_espera.criar|editar`),
     * cujo formulário precisa apenas de especialidades e profissionais. Devolver a
     * ele salas, equipamentos, médicos e status seria conceder de brinde quatro
     * catálogos que ele não tem permissão de ver — privilege creep contra o próprio
     * princípio que abriu esta rota.
     */
    public function index(Request $request): JsonResponse
    {
        // O FECHAMENTO do repasse inclui quem saiu no mês (CR-RPP-25): o último mês da terapeuta
        // desligada é justamente um repasse a fazer, e a faturista escolhe o profissional nesta
        // lista. Só sob `repasse.ver` e só a pedido — a grade e a fila continuam só com os ativos.
        // E o pedido é SEMPRE a projeção mínima (SEC-RPP-11): mesmo para quem vê a agenda, o filtro
        // do repasse só precisa de id, nome e se está ativo — a `obs` de quem saiu costuma dizer o
        // porquê da saída, e os horários não servem a fechamento nenhum.
        $comDesligados = $request->boolean('com_desligados') && ($request->user()?->can('repasse.ver') ?? false);
        $daAgenda = ! $comDesligados && ($request->user()?->canAny(['agenda.ver', 'agenda.criar']) ?? false);
        // a `obs` é da GRADE: quem só administra a fila escolhe o profissional, não o desenha
        $camposDoProfissional = $daAgenda ? self::CAMPOS_PROFISSIONAL_DA_GRADE : self::CAMPOS_PROFISSIONAL;

        // D11 (eixo AGENDA): o formulário do escopado só oferece o PRÓPRIO profissional — a coluna
        // dona aqui é o `id` do próprio (não `profissional_id`). Plano lista todos; escopado-sem-
        // vínculo (fail-closed) não lista ninguém, o default seguro de um papel novo/esquecido.
        $escopo = $this->escopos->agenda($request->user());

        $selecao = [
            'profissionais' => $escopo->aplicar(
                Profissional::query()
                    ->with($daAgenda ? ['especialidades:id,nome', 'horarios'] : ['especialidades:id,nome'])
                    ->when(! $comDesligados, fn ($consulta) => $consulta->where('ativo', true)),
                'id',
            )
                ->orderBy('nome')
                // a coluna da foto entra no SELECT mas não no JSON cru: sai como `foto_versao`
                ->get([...$camposDoProfissional, 'foto_atualizado_em', 'ativo'])
                ->map(fn (Profissional $profissional) => [
                    ...$profissional->only($camposDoProfissional),
                    ...($comDesligados ? ['ativo' => (bool) $profissional->ativo] : []),
                    'foto_versao' => $profissional->foto_atualizado_em?->format('YmdHis'),
                    'especialidades' => $profissional->especialidades->map->only(['id', 'nome']),
                    // horários só para a grade (mapa por dia); a fila não desenha, não recebe
                    ...($daAgenda ? ['horarios' => $profissional->mapaDeHorarios()] : []),
                ]),
            'especialidades' => Especialidade::orderBy('nome')->get(['id', 'nome', 'cor', 'tempo_sessao']),
        ];

        if (! $daAgenda) {
            return response()->json($selecao);
        }

        $statusDoDesmarque = (int) app(ConfiguracaoService::class)->get('agenda.status_desmarque_id');
        // o do desmarque PELA FAMÍLIA (lembrete-com-botoes-de-resposta): o "Desmarcar" do card que
        // pediu para desmarcar aplica este — sem ele, o card abre o menu de status
        $statusDaFamilia = (int) app(ConfiguracaoService::class)->get('lembretes.status_desmarque_familia_id');

        return response()->json([
            ...$selecao,
            // A GRADE precisa PINTAR o feriado. Enquanto isso vinha de `GET /feriados` (atrás de
            // `feriados.ver`), um nível com `agenda.ver` e nada mais recebia 403 e via "Não foi
            // possível carregar a agenda": a permissão que dá a TELA não dava o que a tela
            // precisa para EXIBIR. Sem os feriados, o dia da clínica fechada parece dia útil e a
            // recepção marca sessão nele.
            'feriados' => Feriado::where('ativo', true)
                ->orderBy('data')
                ->get(['id', 'nome', 'data', 'recorrente']),
            'salas' => Sala::where('ativo', true)->orderBy('nome')->get(['id', 'nome']),
            'equipamentos' => Equipamento::orderBy('nome')->get(['id', 'nome', 'especialidade_id']),
            'medicos' => Medico::orderBy('nome')->get(['id', 'nome']),
            // `desconta_sessao` é OBRIGATÓRIO aqui: sem a flag, a tela não sabe
            // quando confirmar a mudança de status (§2) — e adivinhar seria pior.
            // `marca_falta` acompanha (§13/Decisão 2b): o painel deriva dela que um
            // status de falta NÃO oferece "Iniciar atendimento" — regra é DADO, não if.
            // `aplicavel_em_lote` idem (baixa-em-lote-por-status, D13): o gesto "Dar baixa"
            // oferece exatamente os status que a clínica marcou, sem segunda leitura.
            // `desmarque_da_clinica` (avisos-do-agendamento-por-whatsapp, SEC-AV-02): é o status que
            // a clínica declarou como o do desmarque do profissional — escolhê-lo pelo card avisa a
            // família, então a tela pergunta ANTES, com a caixa já marcada. Derivado da config.
            // `sessao_marcada` (idem, rodada 3 — SEC-AV-16): ocupa o horário e não é reserva. A tela só
            // oferece o aviso de cancelamento a partir de uma sessão MARCADA — "cancelado pela
            // clínica" sobre sessão que a família já desmarcou é mensagem falsa.
            // `em_aberto` (evolucao-finaliza-a-sessao): a sessão sem desfecho é a que salvar a evolução
            // pode finalizar — o painel AVISA antes do clique; quem decide é o servidor.
            'status' => StatusAgendamento::orderBy('ordem')->orderBy('id')
                ->get(['id', 'nome', 'cor', 'cor_borda', 'tipo', 'ordem', 'desconta_sessao', 'marca_falta', 'aplicavel_em_lote', 'em_aberto', 'ocupa_horario', 'marca_reserva'])
                ->map(fn (StatusAgendamento $status): array => [
                    ...$status->only(['id', 'nome', 'cor', 'cor_borda', 'tipo', 'ordem', 'desconta_sessao', 'marca_falta', 'aplicavel_em_lote']),
                    'desconta_sessao' => (bool) $status->desconta_sessao,
                    'marca_falta' => (bool) $status->marca_falta,
                    'aplicavel_em_lote' => (bool) $status->aplicavel_em_lote,
                    'em_aberto' => (bool) $status->em_aberto,
                    'desmarque_da_clinica' => $status->id === $statusDoDesmarque,
                    // relê as flags: o ponteiro só é validado quando é gravado, e o status pode ter sido
                    // editado depois (N2-04) — fora da regra, o card abre o menu de status
                    'desmarque_da_familia' => $status->id === $statusDaFamilia && ! (bool) $status->desconta_sessao && ! (bool) $status->ocupa_horario,
                    'sessao_marcada' => $status->ehSessaoMarcada(),
                ])
                ->values(),
        ]);
    }

    /**
     * Pacientes para o formulário da agenda — só o nome, com teto.
     *
     * Duas leituras, um contrato: `?busca=` PROCURA pelo nome; `?id=` NOMEIA um paciente que a
     * tela já conhece pelo id — é assim que o modo retorno (vindo da fila de pendências) exibe de
     * quem é o horário que procura, porque nome de MENOR não pode viajar em query string (gatilho
     * `LOG`). Sem esta leitura, nomear a criança exigiria `pacientes.ver`, que entrega CPF,
     * responsáveis, endereço e contatos — o privilege creep que esta rota nasceu para impedir.
     *
     * QUATRO modos, mutuamente exclusivos: `?busca=` (por nome, 2+ letras), `?id=` (nomear quem
     * a tela já conhece), `?pagina=` (o catálogo A→Z, para quem prefere reconhecer a digitar) e
     * `?recentes=1` (quem teve movimento de agenda na janela recente — o atalho do caso comum).
     *
     * O regime é o MESMO nos quatro caminhos — whitelist única, `ativo`, teto, permissão da rota —,
     * e é por isso que eles compartilham a consulta em vez de cada um ter a sua: uma cópia
     * poderia perder o `ativo` ou a whitelist sozinha, em silêncio.
     *
     * Listar sem termo é decisão registrada (change `busca-de-paciente-com-lista`, gatilho ENUM):
     * não é capacidade nova — quem tem esta rota já varria a base com duas letras —, mas troca
     * varredura ATIVA por exposição PASSIVA, e por isso o teto por página e o teto de páginas
     * existem. Nome de MENOR continua fora da query string: o modo lista não tem termo.
     */
    public function pacientes(Request $request): JsonResponse
    {
        // `filled` NÃO é redundante com `prohibits`: `prohibits` só dispara com o outro campo
        // PREENCHIDO, então `?busca=ana&id=` (id vazio) atravessaria a exclusividade — e um
        // `isset('')` verdadeiro faria a ação abandonar a busca e consultar `whereKey('')`,
        // devolvendo 200-vazio para uma criança que EXISTE (a recepção leria "não encontrei" e
        // cadastraria de novo). Hoje o `ConvertEmptyStringsToNull` do stack converte antes e o
        // `integer` recusa — mas isso é middleware GLOBAL: o invariante desta rota não pode
        // depender de configuração que outra change pode mexer (achado CR-AR-01).
        //
        // São QUATRO modos agora, e a teia de exclusividade vale entre TODOS: uma rota que às
        // vezes é busca, às vezes leitura por id e às vezes catálogo, escolhendo em silêncio
        // qual vale, é uma rota que ninguém consegue auditar. Chamada NUA continua 422 — o modo
        // é sempre explícito, nunca um default que o cliente descobre por acidente.
        $filtros = $request->validate([
            'busca' => ['required_without_all:id,pagina,recentes', 'prohibits:id,pagina,recentes', 'filled', 'string', 'min:'.self::MINIMO_DA_BUSCA, 'max:255'],
            'id' => ['required_without_all:busca,pagina,recentes', 'prohibits:busca,pagina,recentes', 'filled', 'integer', 'min:1'],
            'pagina' => ['required_without_all:busca,id,recentes', 'prohibits:busca,id,recentes', 'filled', 'integer', 'min:1', 'max:'.self::TETO_DE_PAGINAS],
            // `in:1,true` e não `boolean`: o modo existe quando pedido, e só. `?recentes=0` não é
            // "me dê a lista" — é chamada ambígua, e ambiguidade aqui vira 422, não adivinhação.
            // (`accepted` seria o mais expressivo, mas ele reprova a AUSÊNCIA do campo — usá-lo
            // aqui derrubava com 422 os outros três modos, que não mandam `recentes` nenhum.)
            'recentes' => ['required_without_all:busca,id,pagina', 'prohibits:busca,id,pagina', 'filled', 'in:1,true'],
        ]);

        // `filled()` e não `isset()`: pergunta pelo valor PRESENTE E NÃO-VAZIO, que é a condição
        // que decide o caminho — a mesma que a validação acima exige.
        $porId = $request->filled('id');
        $porPagina = $request->filled('pagina');
        $porRecentes = $request->filled('recentes');
        $porBusca = ! $porId && ! $porRecentes && ! $porPagina;
        $busca = addcslashes($filtros['busca'] ?? '', '%_\\'); // curinga vira literal

        // O modo RECENTES resolve primeiro QUEM (na tabela de agendamentos) e só depois busca os
        // nomes — a whitelist e o `ativo` continuam sendo aplicados na mesma consulta de sempre,
        // porque quem some aqui é o filtro, nunca a proteção.
        $idsRecentes = $porRecentes ? $this->idsDeMovimentoRecente($request) : [];

        // ESCOPO D11 do eixo AGENDA nos QUATRO modos (`SEC-VP-36`, rodada 4). A caixa de paciente
        // oferecia, na seção plana TODOS, a criança que o servidor ia recusar como "não existe"
        // (a recusa cega é deliberada — `SEC-VP-33`); o defeito era a tela CONVIDAR para o gesto
        // impossível. A fonte única aplica o mesmo predicado da trava (`EXISTS` em agendamentos ∪
        // tratamentos): o escopado só vê as crianças que já atende; `plano` (a recepção) continua
        // vendo a base inteira; sem vínculo e sem flag, lista vazia. Ganho lateral: o escopado deixa
        // de varrer a base por duas letras (gatilho `ENUM` estreitado para `agenda.ver`).
        $escopo = $this->escopos->agenda($request->user());

        // A base é UMA construção (escopo D11 + `ativo`), parametrizada pela situação:
        // a busca consome `true`, o marcador de inativo consome `false`. Duas frases da mesma
        // regra é como a tela e o servidor passam a discordar do que é "o paciente que casa"
        // (lição de `a-tela-e-o-servidor-discordavam-do-que-e-horario-ocupado`).
        $base = fn (bool $ativo) => $this->escopos
            ->restringirAosPacientesDoEscopo($escopo, Paciente::query())
            // `ativo` vale para TODOS os modos: um link antigo — ou uma rolagem de catálogo — não
            // traz de volta à tela o nome de uma criança desligada.
            ->where('ativo', $ativo);

        $pacientes = $base(true)
            ->when($porId, fn ($consulta) => $consulta->whereKey($filtros['id']))
            ->when($porRecentes, fn ($consulta) => $consulta->whereIn('id', $idsRecentes))
            ->when($porBusca, fn ($consulta) => $consulta->where($this->casaComOTermo($busca)))
            ->orderBy('nome')
            // desempate ESTÁVEL: homônimos existem nesta clínica, e sem segunda chave o `offset`
            // do modo lista pode repetir uma criança numa página e pular outra na seguinte
            ->orderBy('id')
            ->when($porPagina, fn ($consulta) => $consulta->offset(((int) $filtros['pagina'] - 1) * self::TETO_BUSCA))
            ->limit($porRecentes ? self::TETO_RECENTES : self::TETO_BUSCA)
            ->get(ResumoDoPaciente::CAMPOS)
            ->map(fn (Paciente $paciente) => ResumoDoPaciente::de($paciente));

        // Recentes saem na ordem do MOVIMENTO (quem passou por último vem primeiro), não em
        // ordem alfabética: a seção existe justamente para o caso "é a criança de agora há pouco".
        if ($porRecentes) {
            $posicao = array_flip($idsRecentes);
            $pacientes = $pacientes
                ->sortBy(fn (array $paciente) => $posicao[$paciente['id']] ?? PHP_INT_MAX)
                ->values();
        }

        $resposta = response()->json($pacientes)
            // Dado de MENOR não fica no cache de disco de uma máquina de balcão compartilhada —
            // a mesma política do anexo da conversa (parecer SEC-PIS-08).
            ->header('Cache-Control', 'private, no-store');

        // O MARCADOR de cadastro inativo (change `paciente-inativo-com-saida`).
        //
        // A ORDEM destas condições é a proteção, não uma otimização: a permissão é avaliada
        // ANTES da consulta, e o `&&` do PHP curto-circuita. Quem não tem `pacientes.ver` não
        // dispara consulta nenhuma — sem isso, o TEMPO de resposta passaria a depender de o termo
        // casar com uma criança desligada, e a recusa cega do `SEC-VP-33` viraria oráculo pelo
        // relógio (parecer SEC-PIS-01).
        //
        // `can('pacientes.ver')` literal, e não `canAny([...])` de um elemento só: a lista de um
        // convida a ganhar um segundo item algum dia, e aí o portão deixa de ser o que a spec diz
        // (SEC-PIS-09).
        //
        // O cabeçalho só existe no caso VERDADEIRO — nunca `: 0`. Um valor falso marcaria quem tem
        // a permissão e quebraria a identidade byte a byte da resposta de quem não tem (SEC-PIS-03).
        if (
            $porBusca
            && $pacientes->isEmpty()
            && ($request->user()?->can('pacientes.ver') ?? false)
            && $base(false)->where($this->casaComOTermo($busca))->exists()
        ) {
            $resposta->header(self::CABECALHO_INATIVOS, '1');
        }

        return $resposta;
    }

    /**
     * O predicado do TERMO — escrito UMA vez, consumido pela busca e pelo marcador de inativo.
     *
     * O `$busca` já chega com o curinga escapado pelo chamador; escapar de novo aqui duplicaria
     * a contrabarra.
     *
     * @return Closure(Builder): Builder
     */
    private function casaComOTermo(string $busca): Closure
    {
        return fn ($sub) => $sub->where('nome', 'like', "%{$busca}%")
            ->orWhere('nome_social', 'like', "%{$busca}%");
    }

    /**
     * Quem teve agendamento na janela recente, do mais recente para o mais antigo.
     *
     * Devolve IDS, não pacientes: o nome sai da MESMA consulta que serve os outros modos
     * (mesma whitelist, mesmo `ativo`) — uma segunda consulta de pacientes aqui seria uma
     * segunda chance de esquecer uma das duas proteções.
     *
     * **ESCOPADO pelo eixo agenda (D11)**, diferente das outras pernas desta rota. Elas são
     * planas porque entregam NOME, e quem tem esta rota já alcança qualquer nome por duas
     * letras. Esta entrega outra coisa: MOVIMENTO — "esteve nesta clínica de
     * neurodesenvolvimento há menos tempo" é dado referente à saúde de um menor (a régua que
     * a linha ENUM fixou em SEC-PD-01), e o Profissional da matriz AP-10 é escopado
     * justamente para não ler isso das crianças dos colegas (parecer SEC-BPL-01). Sem vínculo
     * e sem `agenda.ver_todos`, a seção vem VAZIA — fail-closed, nunca plana.
     *
     * @return list<int>
     */
    private function idsDeMovimentoRecente(Request $request): array
    {
        $consulta = Agendamento::query()
            // bloqueio de agenda é evento SEM paciente — agrupar por `null` traria uma linha
            // fantasma que o `whereIn` depois ignoraria em silêncio, encurtando a seção
            ->whereNotNull('paciente_id')
            // o `ativo` entra AQUI, antes do teto: filtrar depois de cortar em 8 faria cada
            // criança desligada consumir um slot e sumir, encolhendo a seção sem explicação —
            // e o tamanho dela passaria a revelar quantas altas houve (parecer SEC-BPL-04).
            // Na base real são 402 ativos para 1308 cadastrados: alta é o caso comum.
            ->whereHas('paciente', fn ($paciente) => $paciente->where('ativo', true))
            ->where('inicio', '>=', now()->subDays(self::JANELA_RECENTES_DIAS));

        // o retorno é USADO (e não descartado confiando na mutabilidade do Builder): no dia
        // em que alguém clonar a query por segurança, descartar viraria fail-open em silêncio
        $consulta = $this->escopos->agenda($request->user())->aplicar($consulta);

        return $consulta
            ->select('paciente_id')
            ->groupBy('paciente_id')
            ->orderByRaw('MAX(inicio) DESC')
            ->limit(self::TETO_RECENTES)
            ->pluck('paciente_id')
            ->map(fn ($id) => (int) $id)
            ->all();
    }

    /**
     * Tratamentos de UM paciente — o formulário só oferece os dele.
     *
     * CALA para criança fora do escopo (`SEC-VP-36`): o escopado recebe lista vazia, não 403 —
     * recusar seria o mesmo oráculo com outra roupa (`SEC-CP-01`). Era o resíduo "plano" da
     * família da seleção; sai junto com a seção TODOS.
     */
    public function tratamentos(Request $request): JsonResponse
    {
        $filtros = $request->validate([
            'paciente_id' => ['required', 'integer'],
        ]);

        if (! $this->escopos->enxergaPaciente($this->escopos->agenda($request->user()), (int) $filtros['paciente_id'])) {
            return response()->json([]);
        }

        $tratamentos = Tratamento::query()
            ->where('paciente_id', $filtros['paciente_id'])
            ->orderByDesc('id')
            ->get(self::CAMPOS_TRATAMENTO)
            ->map(fn (Tratamento $tratamento) => [
                'id' => $tratamento->id,
                'especialidade_id' => $tratamento->especialidade_id,
                'status' => $tratamento->status,
                'sessoes_total' => $tratamento->sessoes_total,
                'sessoes_saldo' => $tratamento->sessoes_saldo,
                'vencido' => $tratamento->vencido,
            ]);

        return response()->json($tratamentos);
    }
}
