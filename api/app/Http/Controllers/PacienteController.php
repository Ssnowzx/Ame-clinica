<?php

namespace App\Http\Controllers;

use App\Http\Requests\PacienteRequest;
use App\Models\Agendamento;
use App\Models\EnvioDeCadastro;
use App\Models\Paciente;
use App\Models\TermoConsentimento;
use App\Models\Tratamento;
use App\Support\CamposCadastro\CatalogoCamposCadastro;
use App\Support\CamposCadastro\ReguaDoCadastro;
use App\Support\Clinica\NomeNormalizado;
use App\Support\Configuracoes\ConfiguracaoService;
use App\Support\Http\ConcorrenciaOtimista;
use App\Support\Rbac\AncoraDaClinica;
use App\Support\Rbac\EscopoDoProfissional;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Pacientes (LGPD — MENORES): SEM rota de exclusão física (design D5) —
 * desativação preserva a trilha; exclusão pertence ao fluxo de direitos do
 * titular (change futura). Listagem paginada (cadastro cresce sem teto).
 */
class PacienteController extends Controller
{
    private const CAMPOS = [
        'id', 'nome', 'nome_social', 'nascimento', 'sexo', 'cpf',
        // Convênio VIGENTE (change convenio-no-cadastro-do-paciente). Só no DETALHE: a
        // `carteirinha` é identificador do menor junto à operadora, da classe do CPF, e a
        // listagem é minimalista por parecer (T-pac-01). Quem precisa do número abre o
        // cadastro; quem só escolhe uma criança precisa do nome.
        'convenio_id', 'plano', 'carteirinha', 'carteirinha_validade',
        'responsaveis_json', 'endereco_json', 'contatos_json', 'indicacao',
        'necessidade', 'estado_civil', 'profissao', 'obs', 'consentimentos_json', 'ativo',
        'updated_at', // token da concorrência otimista (If-Match)
    ];

    /**
     * Listagem MINIMALISTA (parecer T-pac-01): nunca expõe cpf/responsáveis/
     * contatos/endereço em massa — o cadastro completo só no detalhe.
     */
    private const CAMPOS_LISTAGEM = ['id', 'nome', 'nome_social', 'nascimento', 'necessidade', 'ativo'];

    /**
     * A única forma de aceite do v1 (FA-08 — "papel + marcação no sistema hoje").
     * `digital` nasce quando o TITULAR for quem aceita; até lá, dizer outra coisa
     * seria rotular a marcação da recepção como assinatura da família.
     */
    private const FORMA_PAPEL = 'papel';

    public function __construct(
        private readonly ConfiguracaoService $configuracoes,
        private readonly EscopoDoProfissional $escopos,
        private readonly AncoraDaClinica $ancora,
        private readonly ReguaDoCadastro $regua,
    ) {}

    public function index(Request $request): JsonResponse
    {
        $filtros = $request->validate([
            'busca' => ['sometimes', 'string', 'max:255'],
            'ativo' => ['sometimes', 'boolean'],
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:100'], // teto (abuse 14)
        ]);

        $busca = isset($filtros['busca'])
            ? addcslashes($filtros['busca'], '%_\\') // curinga vira literal (abuse 14)
            : null;

        // O SELECT é DERIVADO DA RÉGUA (design D6): só entram as colunas de que algum
        // campo obrigatório precisa. Clínica sem override → `CAMPOS_LISTAGEM + sexo`, que é
        // byte a byte a consulta de antes desta change; quem exigir `cidade` paga um
        // `endereco_json` a mais, e só ele. As colunas extras servem à derivação abaixo —
        // o `only()` as mantém FORA do payload (a listagem minimalista do T-pac-01 não muda).
        $obrigatorios = $this->regua->obrigatorios();
        $colunas = array_values(array_unique([
            ...self::CAMPOS_LISTAGEM,
            ...CatalogoCamposCadastro::colunasDe($obrigatorios),
        ]));

        $pacientes = Paciente::query()
            ->when($busca !== null && $busca !== '', fn ($q) => $q->where(
                fn ($sub) => $sub->where('nome', 'like', "%{$busca}%")
                    ->orWhere('nome_social', 'like', "%{$busca}%")
            ))
            ->when(isset($filtros['ativo']), fn ($q) => $q->where('ativo', $request->boolean('ativo')))
            ->orderBy('nome')
            ->paginate($filtros['per_page'] ?? 50, $colunas);

        // `cadastro_incompleto` é DERIVADO, nunca coluna (pre-cadastro-de-paciente, d.1):
        // completar a ficha cura sozinho. O que conta como "falta" passou a ser o que a
        // clínica declarou obrigatório — antes era a dupla fixa nascimento/necessidade (mais
        // `sexo`, que a carga da virada tornou nullable). Sem override a conta é idêntica;
        // com override, a lista para de acusar o que a clínica declarou opcional.
        $pacientes->getCollection()->transform(fn (Paciente $p): array => [
            ...collect($p->attributesToArray())->only(self::CAMPOS_LISTAGEM)->all(),
            'cadastro_incompleto' => $this->regua->faltaAlgum($p, $obrigatorios),
        ]);

        return response()->json($pacientes);
    }

    public function store(PacienteRequest $request): JsonResponse
    {
        $dados = $request->validated();

        $paciente = $this->comAncoraDoAceite($dados['consentimentos_json'] ?? [], function () use ($dados): Paciente {
            $dados['consentimentos_json'] = $this->carimbar($dados['consentimentos_json'] ?? []);

            $paciente = Paciente::create($dados);

            $this->ligarAoEnvio($paciente, $dados['envio_de_cadastro_id'] ?? null);

            return $paciente;
        });

        return response()->json($this->serializar($paciente), 201);
    }

    /**
     * Fecha o vínculo com o envio que originou a ficha (change `cadastro-online-do-paciente`).
     *
     * Os DOIS lados, porque cada um responde a uma pergunta diferente: `pacientes.
     * envio_de_cadastro_id` diz de onde a ficha veio, e `envios_de_cadastro.paciente_id` é o que
     * faz o expurgo saber que aquele conteúdo já virou prontuário — sem ele, envio aceito e
     * abandonado guardaria payload e IP de MENOR para sempre, fora da fila e fora do expurgo.
     *
     * Roda dentro da mesma transação da criação: ficha sem vínculo e envio sem ficha são os dois
     * estados que a coluna existe para impedir.
     */
    private function ligarAoEnvio(Paciente $paciente, ?int $envioId): void
    {
        if ($envioId === null) {
            return;
        }

        /*
         * Zero linhas afetadas ABORTA a criação inteira.
         *
         * Ignorar o retorno produzia exatamente o estado que este método existe para impedir:
         * ficha apontando para um envio que não aponta de volta, com resposta 201 mentindo. Ele é
         * alcançável por concorrência — dois POSTs passam o `exists` e só um `update` vence — e
         * era alcançável de propósito antes de o `exists` ser endurecido (CR2-03).
         *
         * A exceção derruba a transação junto: sem vínculo, não há ficha.
         */
        $ligadas = EnvioDeCadastro::query()
            ->whereKey($envioId)
            ->whereNull('paciente_id')
            ->update(['paciente_id' => $paciente->id]);

        if ($ligadas !== 1) {
            throw ValidationException::withMessages([
                'envio_de_cadastro_id' => 'Este cadastro recebido já foi usado em outra ficha.',
            ]);
        }
    }

    /**
     * Devolve ao `endereco_json` as chaves que a régua ESCONDEU e já estavam gravadas.
     *
     * Esconder um campo escalar preserva o valor: a chave é omitida do payload e o
     * `update()` não toca a coluna. Dentro do `endereco_json` era o contrário — o cliente
     * remonta o JSON inteiro sem as chaves escondidas, e o `update()` substitui a coluna
     * toda. A clínica que escondesse "Complemento" perdia, na próxima gravação de CADA
     * ficha, o complemento de todos os endereços: dado apagado por mudança de configuração,
     * sem ninguém ter tocado no campo (pareceres CR-I4 e SEC-RC-04).
     *
     * O servidor é o único lado que enxerga as duas versões, então a costura mora aqui.
     *
     * @param  array<string, mixed>  $dados
     * @return array<string, mixed>
     */
    private function preservarEnderecoEscondido(array $dados, Paciente $paciente): array
    {
        if (! array_key_exists('endereco_json', $dados)) {
            return $dados; // endereço não veio: a coluna nem é tocada
        }

        $gravado = $paciente->endereco_json ?? [];
        $escondidas = [];

        foreach ($this->regua->desabilitados() as $campo) {
            $caminho = CatalogoCamposCadastro::definicao($campo)['caminho'];
            [$raiz, $chave] = array_pad(explode('.', $caminho, 2), 2, null);

            if ($raiz === 'endereco_json' && $chave !== null && array_key_exists($chave, $gravado)) {
                $escondidas[$chave] = $gravado[$chave];
            }
        }

        if ($escondidas === []) {
            return $dados;
        }

        $dados['endereco_json'] = [...(array) ($dados['endereco_json'] ?? []), ...$escondidas];

        return $dados;
    }

    /**
     * Roda a escrita SOB A ÂNCORA DA CLÍNICA quando ela registra aceite — e só então.
     *
     * A imutabilidade da versão do termo é check-then-act do outro lado
     * (`TermoConsentimentoController::update/destroy` confere `temAceite()` e escreve):
     * sem as duas pontas na MESMA âncora, um aceite que nasça no meio deixa o texto ser
     * reescrito DEPOIS de assinado (parecer SEC-TR-01/CR-1). Salvar cadastro **sem**
     * aceite novo não toma lock nenhum — o caminho comum da recepção segue paralelo.
     *
     * @template TRetorno
     *
     * @param  array<int, mixed>  $novos
     * @param  callable(): TRetorno  $escrita
     * @return TRetorno
     */
    private function comAncoraDoAceite(array $novos, callable $escrita): mixed
    {
        // sem aceite não há âncora, mas a escrita continua precisando ser ATÔMICA: a criação da
        // ficha e o vínculo com o envio que a originou são um ato só (change
        // `cadastro-online-do-paciente`) — ficha sem origem e envio sem ficha são exatamente os
        // dois estados que a coluna existe para impedir
        return $novos === []
            ? DB::transaction(static fn (): mixed => $escrita())
            : $this->ancora->serializado($escrita);
    }

    /**
     * Pré-cadastro pelo balcão (change pre-cadastro-de-paciente): a recepção põe a
     * criança na FILA com o que tem ao telefone — nome, sexo e um telefone. O
     * boundary COMPLETO (PacienteRequest) não afrouxa: esta é a única porta que
     * dispensa nascimento/necessidade, com contrato explícito e mínimo. A guarda de
     * menor-sem-responsável não se aplica sem nascimento — volta a valer no PUT
     * completo, que continua exigindo tudo.
     */
    public function preCadastro(Request $request): JsonResponse
    {
        // `sexo` é exigido no balcão SÓ enquanto a clínica não o escondeu do cadastro
        // (capability `campos-do-cadastro`): exigir ao telefone um dado que a clínica
        // declarou que nem aparece no formulário deixaria a recepção sem saída. `nome` e
        // `telefone` continuam sempre exigidos — são o mínimo para achar a criança depois.
        // Tornar o conjunto inteiro configurável é a change do Cadastro Rápido.
        $sexoEscondido = $this->regua->desabilitado('sexo');

        $dados = $request->validate([
            'nome' => ['required', 'string', 'max:255'],
            'sexo' => $sexoEscondido
                ? ['missing']
                : ['required', Rule::in(PacienteRequest::SEXOS)],
            'telefone' => ['required', 'string', 'max:255'],
            // decisão humana, não campo do cadastro: libera a criação quando o nome idêntico É
            // outra criança (irmãos homônimos existem)
            'confirmar_homonimo' => ['sometimes', 'boolean'],
        ], [
            // sem isto, a recusa saía como "O campo sexo não pode estar presente." — texto
            // de máquina para a recepção, e sobre um campo que ela nem vê (parecer CR-B2)
            'sexo.missing' => 'A clínica não usa o campo "Sexo" no cadastro.',
        ], [
            'nome' => 'nome',
            'sexo' => 'sexo',
            'telefone' => 'telefone de contato',
        ]);

        // GUARDA DE HOMÔNIMO — por igualdade, nunca por semelhança.
        //
        // Semelhança gritaria em irmãos (Maria × Marina), que numa clínica infantil é a norma; e
        // aviso que grita demais é aviso que a recepção aprende a ignorar (o modo de falha da
        // decisão D2 de `protocolo-de-pendencias`). O que produz duplicata de verdade é o MESMO
        // nome digitado outra vez — e isso a igualdade pega.
        //
        // A checagem vive AQUI, e não numa rota de leitura: quem pré-cadastra tem
        // `pacientes.criar` e pode NÃO ter `pacientes.ver`. A recusa revela apenas que o nome que o
        // próprio chamador acabou de digitar já existe — nunca id, lista ou qualquer outro campo.
        // `$request->boolean()` e NÃO `$dados[...] !== true`: a regra `boolean` do Laravel aceita
        // `true|false|0|1|'0'|'1'`, e o `validated()` devolve o valor CRU — um cliente
        // form-encoded manda `'1'`, que a API declara válido e a comparação estrita recusava. O
        // resultado era 409 eterno: a única saída que esta guarda oferece ficava inalcançável
        // (achado CR-FX-01 do gate). É o mesmo idioma que a ação de situação usa.
        if (! $request->boolean('confirmar_homonimo') && $this->existeHomonimo($dados['nome'])) {
            return response()->json([
                'message' => 'Já existe um paciente com este nome. Se for outra criança, confirme para criar.',
                'homonimo' => true,
            ], 409);
        }

        $paciente = Paciente::create([
            'nome' => $dados['nome'],
            // ausente quando a clínica escondeu o campo — a coluna é nullable desde a
            // carga da virada, e o cadastro segue "incompleto" apenas se a régua o exigir
            'sexo' => $dados['sexo'] ?? null,
            // o telefone do balcão entra na MESMA estrutura do cadastro (contatos_json)
            'contatos_json' => [['tipo' => 'celular', 'valor' => $dados['telefone']]],
            'responsaveis_json' => [],
            'consentimentos_json' => [],
        ]);

        return response()->json($this->serializar($paciente), 201);
    }

    public function show(int $id): JsonResponse
    {
        // `with('convenio')`: a ficha precisa do NOME, não do id — resolver no servidor
        // evita que cada abertura de ficha baixe o catálogo inteiro de convênios só para
        // traduzir um rótulo. Mesmo padrão do card da agenda, que já devolve
        // `convenio{nome,particular}`.
        return response()->json($this->serializar(Paciente::with('convenio')->findOrFail($id)));
    }

    /**
     * Resumo AGREGADO read-only do paciente para o Painel da ficha (change
     * ficha-do-paciente, capability `pacientes`): profissional atual, situação do
     * contrato, primeira/próxima sessão e sessões realizadas.
     *
     * NÃO recompõe coluna do menor: não devolve nome/CPF/nascimento — a ficha já
     * tem a identidade pela leitura de cadastro (fonte única); nenhum caminho de escrita.
     */
    public function resumo(int $id): JsonResponse
    {
        $paciente = Paciente::find($id);
        // D11 (eixo AGENDA — era o clínico até a rodada 4, `SEC-VP-52`): o conteúdo do resumo é
        // profissional atual, situação do contrato, primeira/próxima sessão e sessões realizadas —
        // dado de agenda e de pacote, que `agenda.ver`/`tratamentos.ver` já entregam; nada de
        // art. 11 (anamnese/evolução) sai daqui. No eixo clínico, a Secretaria e a Faturista da
        // matriz AP-10 (`agenda.ver_todos`, sem `clinico.ver_todos`, sem vínculo) eram `nenhum` e
        // o painel da ficha respondia 403 para TODA criança — o balcão inteiro sem painel no dia 1.
        // Defesa em profundidade continua: plano passa; escopado só o paciente SEU; sem vínculo →
        // 403. POSSE ANTES DA EXISTÊNCIA (`SEC-VP-46`): inexistente e alheia respondem 403 iguais.
        $this->escopos->assegurarPaciente($this->escopos->agenda(request()->user()), $paciente?->id);
        abort_if($paciente === null, 404); // inexistente → 404 (só para o plano)

        $agora = now($this->configuracoes->get('clinica.timezone'))->format('Y-m-d H:i');

        // "contrato atual": o tratamento em andamento mais recente; sem nenhum em
        // andamento, o mais recente de qualquer estado (para mostrar a situação).
        $contrato = Tratamento::query()
            ->where('paciente_id', $paciente->id)
            ->with('profissional:id,nome')
            ->orderByRaw("status = 'andamento' desc")
            ->orderByDesc('data_inicio')
            ->orderByDesc('id')
            ->first();

        $sessoes = fn () => Agendamento::query()
            ->where('paciente_id', $paciente->id)
            ->where('tipo', 'atendimento');

        $primeira = (clone $sessoes())->orderBy('inicio')->first(['inicio']);
        $proxima = (clone $sessoes())->where('inicio', '>=', $agora)
            ->orderBy('inicio')->first(['inicio']);

        return response()->json([
            'profissional_atual' => $contrato?->profissional?->only(['id', 'nome']),
            'contrato' => $contrato === null ? null : [
                'id' => $contrato->id,
                'status' => $contrato->status,
                'sessoes_total' => $contrato->sessoes_total,
                'sessoes_realizadas' => $contrato->sessoes_realizadas,
                'sessoes_saldo' => $contrato->sessoes_saldo,
                'vencido' => $contrato->vencido,
            ],
            'primeira_sessao' => $primeira?->inicio->format('Y-m-d H:i'),
            'proxima_sessao' => $proxima?->inicio->format('Y-m-d H:i'),
            // consumo é do atendimento (design D3): a soma das sessões já realizadas nos contratos
            'sessoes_realizadas' => (int) Tratamento::query()
                ->where('paciente_id', $paciente->id)->sum('sessoes_realizadas'),
        ]);
    }

    public function update(PacienteRequest $request, int $id): JsonResponse
    {
        $paciente = Paciente::findOrFail($id);
        ConcorrenciaOtimista::assegurar($paciente, $request);
        $dados = $request->validated();

        $dados = $this->preservarEnderecoEscondido($dados, $paciente);

        // Consentimento é APPEND-ONLY no servidor (gate cadastros-pessoas,
        // SEC-01/SEC-02): o payload traz só os NOVOS aceites, e eles são anexados
        // aos existentes. Enquanto o cliente mandava a lista inteira, um `PUT`
        // montado sobre cache velho apagava, em silêncio, o consentimento que
        // outra aba tinha acabado de registrar — prova legal do aceite de um MENOR
        // destruída por uma corrida de duas recepcionistas.
        $this->comAncoraDoAceite($dados['consentimentos_json'] ?? [], function () use (&$dados, $paciente): void {
            if (array_key_exists('consentimentos_json', $dados)) {
                $dados['consentimentos_json'] = [
                    ...$paciente->consentimentos_json ?? [],
                    ...$this->carimbar($dados['consentimentos_json']),
                ];
            }

            $paciente->update($dados);
        });

        return response()->json($this->serializar($paciente));
    }

    /**
     * Existe paciente com o nome IDÊNTICO na clínica?
     *
     * A normalização é a régua da igualdade e vive AQUI, num lugar só: caixa e espaços em excesso
     * desconsiderados (`Ana  SILVA` == `ana silva`). Comparar no PHP, e não com `LOWER()` no SQL,
     * mantém a régua visível e testável — e o volume é o do cadastro de uma clínica, não de um
     * catálogo. `ativo` NÃO entra: um duplicado inativo continua sendo o mesmo duplicado, e criar
     * um segundo cadastro porque o primeiro foi desativado é exatamente o engano a evitar.
     *
     * Custo declarado: uma leitura da coluna `nome` dos pacientes por chamada. O pré-cadastro é caminho
     * de ESCRITA raro (alguns por dia, no balcão) e o cadastro de uma clínica é de milhares, não de
     * milhões. Se um dia doer, o passo seguinte é coluna normalizada com índice — não é o de hoje.
     */
    private function existeHomonimo(string $nome): bool
    {
        $procurado = $this->nomeNormalizado($nome);

        return Paciente::query()
            ->pluck('nome')
            ->contains(fn (string $existente) => $this->nomeNormalizado($existente) === $procurado);
    }

    /**
     * A régua da igualdade de nomes: sem caixa, sem espaço repetido, sem borda — e sem ACENTO.
     *
     * Dobrar diacrítico (`Andréa` == `Andrea`) foi decidido no gate (CR-FX-09/SEC-FX-03): é a
     * variância de digitação mais comum em pt-BR e é exatamente "o mesmo nome digitado outra vez",
     * que é o caso que a guarda existe para pegar. E **não** reintroduz o falso-positivo que a
     * decisão D5 recusa: dobrar acento não aproxima *Maria* de *Marina*.
     *
     * O `Cf` (formato/invisíveis, como o zero-width space) sai junto — era o contorno mais barato
     * da guarda: colar `Ana\u{200B}Silva` criava a duplicata sem aviso.
     *
     * O que a régua AINDA não pega está registrado como escopo aceito em `docs/GATILHOS.md`
     * (`HOMONIMO-REGUA`): grafia diferente (`Ana Silva` × `Ana da Silva`), hífen e homoglifo de
     * outro alfabeto. Nenhum deles é "o mesmo nome digitado de novo".
     */
    private function nomeNormalizado(string $nome): string
    {
        // fonte única desde a carga da virada (SEC-IV-06/15): a chave de idempotência
        // do `virada:importar` usa a MESMA régua — duas cópias divergiriam em silêncio
        return NomeNormalizado::aplicar($nome);
    }

    /**
     * SITUAÇÃO (ativo/inativo) fora do PUT-inteiro.
     *
     * Existe porque desfazer um PRÉ-CADASTRO errado era impossível sem inventar dado clínico: o
     * `PUT` é o boundary COMPLETO (exige `nascimento` e `necessidade`), e um pré-cadastrado não tem
     * nenhum dos dois — então desativar respondia 422 até a recepção FABRICAR uma data de
     * nascimento e uma necessidade, que é dado de saúde de um MENOR, para corrigir um erro de
     * digitação. Aqui nada disso é pedido, e nada é preenchido por default: "cadastro incompleto"
     * segue DERIVADO, e o pré-cadastrado desativado continua incompleto — que é a verdade.
     *
     * O payload é de UMA chave. Aceitar mais faria deste endpoint um `PUT` paralelo, com as guardas
     * do `PacienteRequest` (menor sem responsável, entre outras) contornadas por fora.
     *
     * A gravação é por `update()` do model, nunca update de query builder: é o que dispara os
     * eventos do `Auditavel` e põe a mudança de `ativo` na trilha com autor e valores.
     */
    public function situacao(Request $request, int $id): JsonResponse
    {
        $paciente = Paciente::findOrFail($id);
        // a versão é conferida DEPOIS de posse/escopo (404 sempre vence — o token não é oráculo
        // de existência), como no `update()`
        ConcorrenciaOtimista::assegurar($paciente, $request);

        // `validate()` IGNORA o que não está nas regras — ignorar não é recusar. Sem esta checagem,
        // um `PATCH {ativo:false, nascimento:'2020-01-01'}` responderia 200 e o chamador ficaria
        // convencido de que gravou o nascimento (o "salvo com sucesso" falso). A comparação é por
        // chave PRESENTE, não por lista de campos proibidos: coluna nova nasce recusada por
        // omissão, e não há como esquecer de acrescentá-la aqui.
        // `_method` fora: é chave do FRAMEWORK (spoof de verbo em form), não campo do cliente —
        // recusá-la daria 422 chaveado em `_method` a um integrador que não errou nada
        $forasteiros = array_keys($request->except(['ativo', '_method']));
        if ($forasteiros !== []) {
            throw ValidationException::withMessages([
                $forasteiros[0] => 'Este endpoint muda apenas a situação (ativo). Use a edição do cadastro para o resto.',
            ]);
        }

        $dados = $request->validate([
            'ativo' => ['required', 'boolean'],
        ]);

        $paciente->update(['ativo' => $dados['ativo']]);

        // Resposta MÍNIMA: escrever um booleano não pode ecoar o cadastro do menor. O
        // `serializar()` traz CPF, responsáveis, endereço, contatos e `necessidade` — que esta casa
        // já reclassificou como art. 11 e mascara na trilha (SEC-APS-01) —, e o consumidor lê
        // exatamente um campo. Minimização no propósito (achado SEC-FX-01 do gate).
        return response()->json([
            'id' => $paciente->id,
            'ativo' => $paciente->ativo,
            'updated_at' => $paciente->updated_at?->toJSON(),
        ]);
    }

    /**
     * A PROVA do aceite é montada pelo SERVIDOR — o cliente só diz quem aceitou.
     *
     * O instante nunca veio do relógio do balcão (SEC-10). A partir da change
     * `aceite-do-regulamento` (FA-08), a RÉGUA também não: o aceite aponta para a
     * versão VIGENTE do termo da clínica, com título e número gravados como SNAPSHOT
     * — a prova continua legível mesmo que a linha do catálogo mude de nome ou suma.
     * Sem versão vigente publicada, o aceite é RECUSADO: registrar que alguém aceitou
     * um texto que ninguém consegue exibir depois é registrar prova de nada.
     *
     * O IP NÃO é gravado, e isso é decisão, não esquecimento (design D5): enquanto a
     * assinatura é colhida em PAPEL e a recepção apenas a marca, o endereço capturado
     * seria o do balcão — um dado que *parece* provar que a família aceitou dali. É o
     * mesmo erro de rótulo que o carimbo de instante corrigiu. Quem marcou, quando e de
     * onde já está na trilha (`auditoria.ip`, RegistroDeAuditoria) — e o registro passa
     * a dizer a FORMA (`papel`) e o usuário que a marcou. O IP entra junto do aceite
     * DIGITAL, quando o titular for quem aceita.
     *
     * @param  array<int, array<string, string>>  $novos
     * @return list<array<string, mixed>>
     */
    private function carimbar(array $novos): array
    {
        if ($novos === []) {
            return [];
        }

        $termo = TermoConsentimento::emVigor();

        if ($termo === null) {
            throw ValidationException::withMessages([
                'consentimentos_json' => 'Nenhum termo de consentimento está vigente. '
                    .'Publique o termo antes de registrar o aceite.',
            ]);
        }

        $agora = now()->toIso8601String();

        return array_values(array_map(fn (array $consentimento) => [
            'termo_id' => $termo->id,
            'versao' => $termo->versao,
            'termo' => $termo->titulo, // snapshot: a prova não depende do catálogo
            'responsavel' => $consentimento['responsavel'],
            'forma' => self::FORMA_PAPEL,
            'registrado_por' => Auth::id(),
            'aceito_em' => $agora,
        ], $novos));
    }

    /**
     * attributesToArray() aplica os casts — only() cru devolvia nascimento como
     * Carbon ISO/UTC no detalhe e Y-m-d na lista (gate r1, I1).
     */
    private function serializar(Paciente $paciente): array
    {
        $projetado = collect($paciente->attributesToArray())->only(self::CAMPOS)->all();

        // o convênio VIGENTE resolvido (id + nome + a flag que distingue particular). Fica
        // ao lado do `convenio_id`, que continua sendo o que a tela ESCREVE de volta.
        $projetado['convenio'] = $paciente->relationLoaded('convenio') && $paciente->convenio !== null
            ? $paciente->convenio->only(['id', 'nome', 'particular'])
            : null;

        return $projetado;
    }
}
