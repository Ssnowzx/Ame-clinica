<?php

namespace App\Http\Controllers;

use App\Http\Requests\EncaixeRequest;
use App\Models\Agendamento;
use App\Models\ListaEspera;
use App\Support\Agenda\AgendamentoService;
use App\Support\Agenda\SerializadorDeAgendamento;
use App\Support\Clinica\ResumoDoPaciente;
use App\Support\Http\ConcorrenciaOtimista;
use App\Support\Mensageria\AvisoDoAgendamento;
use App\Support\Rbac\EscopoDoProfissional;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class ListaEsperaController extends Controller
{
    private const CAMPOS = [
        'id', 'paciente_id', 'especialidade_id', 'profissional_id', 'prioridade', 'obs',
        'created_at',
        'updated_at', // token da concorrência otimista — da ENTRADA, não do menor (C8)
    ];

    /** Paciente MINIMIZADO (LGPD) + os nomes que a tela precisa (design D4). */
    private const RELACOES = [
        'especialidade:id,nome',
        'profissional:id,nome',
    ];

    /** @return list<string> */
    private static function relacoes(): array
    {
        // o paciente vem da FONTE ÚNICA (camada banco→app): o cadastro do menor nem entra
        // na memória do processo, de onde vazaria para log, dump ou payload de exceção
        return [ResumoDoPaciente::relacao(), ...self::RELACOES];
    }

    public function __construct(
        private readonly AgendamentoService $servico,
        private readonly EscopoDoProfissional $escopos,
        private readonly AvisoDoAgendamento $avisos,
    ) {}

    /**
     * Uma forma só para a entrada — index, store e update.
     *
     * Sem isto, o POST/PUT devolveriam só os escalares enquanto o cliente tipa a
     * resposta como a entrada COMPLETA: um tipo prometendo o que a rota não manda
     * (parecer code-review §1).
     *
     * @return array<string, mixed>
     */
    private function serializar(ListaEspera $entrada): array
    {
        return [
            ...collect($entrada->attributesToArray())->only(self::CAMPOS)->all(),
            // camada app→HTTP da fonte única: mesmo com o model inteiro em mãos, só as três
            // chaves atravessam a resposta
            'paciente' => ResumoDoPaciente::deOuNulo($entrada->paciente),
            'especialidade' => $entrada->especialidade?->only(['id', 'nome']),
            'profissional' => $entrada->profissional?->only(['id', 'nome']),
        ];
    }

    public function index(): JsonResponse
    {
        // fila: prioridade desc, chegada asc (§6); paciente mínimo (parecer §1).
        // Especialidade e profissional vêm com NOME (design D4): sem isso a tela
        // resolveria os ids exigindo permissão de cadastro que quem administra a
        // fila não precisa ter. A fila é curta — dois joins, sem N+1.
        return response()->json(
            ListaEspera::with(self::relacoes())
                ->orderByDesc('prioridade')
                ->orderBy('created_at')
                ->get()
                ->map(fn (ListaEspera $entrada) => $this->serializar($entrada))
        );
    }

    public function store(Request $request): JsonResponse
    {
        $dados = $this->validar($request);
        $this->recusarParImpossivel($dados, null);
        $entrada = ListaEspera::create($dados);

        return response()->json($this->serializar($entrada->refresh()->load(self::relacoes())), 201);
    }

    public function update(Request $request, int $id): JsonResponse
    {
        $entrada = ListaEspera::findOrFail($id);
        // forma (422) antes da versão (409/428) — a ordem dos boundaries com FormRequest,
        // reproduzida aqui porque este é o único update com validação inline (nit N4 do gate)
        $dados = $this->validar($request);
        ConcorrenciaOtimista::assegurar($entrada, $request);
        $this->recusarParImpossivel($dados, $entrada);
        $entrada->update($dados);

        return response()->json($this->serializar($entrada->load(self::relacoes())));
    }

    /**
     * A fila NÃO guarda um desejo que a clínica não pode realizar.
     *
     * Escolher "Psicologia com a Carla" quando a Carla é de Terapia Ocupacional cria uma
     * entrada que o AGENDAMENTO sempre recusaria ("O profissional não atende a esta
     * especialidade"). A recepcionista descobre isso só na hora do encaixe — e tem de trocar
     * em silêncio o que a família pediu. É o mesmo defeito do botão que promete o que o
     * servidor nega, um nível abaixo: aqui é o DADO que promete.
     *
     * Avaliado no ESTADO FINAL: um `PUT` parcial (só a especialidade) burlaria uma checagem
     * feita apenas sobre o payload.
     *
     * @param  array<string, mixed>  $dados
     *
     * @throws ValidationException
     */
    private function recusarParImpossivel(array $dados, ?ListaEspera $atual): void
    {
        $especialidadeId = array_key_exists('especialidade_id', $dados)
            ? $dados['especialidade_id']
            : $atual?->especialidade_id;
        $profissionalId = array_key_exists('profissional_id', $dados)
            ? $dados['profissional_id']
            : $atual?->profissional_id;

        // Sem uma das duas pontas não há par para conferir. A fila aceita "qualquer
        // profissional" e "qualquer especialidade" DE PROPÓSITO: ela é uma ESPERA
        // ("fonoaudiologia, com quem der"), não um agendamento.
        if ($especialidadeId === null || $profissionalId === null) {
            return;
        }

        $atende = DB::table('profissional_especialidade')
            ->where('profissional_id', (int) $profissionalId)
            ->where('especialidade_id', (int) $especialidadeId)
            ->exists();

        if (! $atende) {
            // a recusa pousa no campo que o usuário MEXEU (re-review M-3). Pelo que MUDOU
            // em relação ao estado atual, nunca por presença de chave: a tela manda SEMPRE
            // as duas chaves, e a heurística de presença nunca disparava para o cliente
            // real (re-review rodada 3, importante)
            $mexeuProfissional = array_key_exists('profissional_id', $dados)
                && (int) $dados['profissional_id'] !== (int) ($atual?->profissional_id ?? 0);
            $mexeuEspecialidade = array_key_exists('especialidade_id', $dados)
                && (int) $dados['especialidade_id'] !== (int) ($atual?->especialidade_id ?? 0);
            $campo = $mexeuProfissional && ! $mexeuEspecialidade
                ? 'profissional_id'
                : 'especialidade_id';

            throw ValidationException::withMessages([
                $campo => 'O profissional não atende a esta especialidade — esta espera '
                    .'nunca poderia virar agendamento. Escolha outra especialidade, outro '
                    .'profissional, ou deixe o profissional em branco.',
            ]);
        }
    }

    public function destroy(int $id): Response
    {
        ListaEspera::findOrFail($id)->delete();

        return response()->noContent();
    }

    /**
     * Encaixe (§6): agendar e sair da fila são UMA operação (design D1/D2).
     *
     * O agendamento nasce pelo AgendamentoService — conflito, saldo/validade do
     * tratamento, retroativo e consumo continuam sendo dele. Qualquer recusa sobe
     * como ValidationException e derruba a transação inteira: o paciente CONTINUA
     * na fila. O lock resolve a corrida de duas recepcionistas encaixando a mesma
     * entrada em horários diferentes — sem ele, o paciente sairia agendado duas
     * vezes e a fila perderia a entrada uma só.
     */
    public function encaixar(EncaixeRequest $request, int $id): JsonResponse
    {
        $dados = $request->validated();
        // D11 (eixo AGENDA): o encaixe é criação de agenda — o escopado só encaixa para o PRÓPRIO
        // profissional (403 se `profissional_id` ≠ vínculo). `profissional_id` é required na
        // EncaixeRequest, então nunca é null aqui; fora da transação para não abrir lock à toa.
        $this->escopos->agenda($request->user())->assegurarPosse($dados['profissional_id'] ?? null);

        $agendamento = DB::transaction(function () use ($dados, $id): Agendamento {
            $entrada = ListaEspera::whereKey($id)->lockForUpdate()->firstOrFail();

            $criado = $this->servico->criar([
                ...$dados,
                'paciente_id' => $entrada->paciente_id, // vem da FILA, nunca do cliente
                'tipo' => 'atendimento',
                // a entrada é deletada: sem isto, o agendamento nascido de encaixe
                // ficaria indistinguível de um marcado à mão (parecer §12)
                'origem' => 'encaixe',
            ]);

            $entrada->delete(); // saída da fila auditada

            return $criado;
        });

        // MESMA forma do POST /agendamentos (um serializador só — parecer §7).
        // Os avisos da escrita acompanham também aqui — limite `avisar` do convênio
        // (limites-e-pedidos, D3) e paciente sobreposto (conflito-do-paciente, D4):
        // o encaixe É uma criação da agenda e herda as guardas por construção.
        $corpo = SerializadorDeAgendamento::escalares($agendamento);
        $aviso = $this->servico->avisoDeLimite();
        if ($aviso !== null) {
            $corpo = [...$corpo, 'alerta_limite' => $aviso];
        }
        $sobreposto = $this->servico->avisoDePacienteSobreposto();
        if ($sobreposto !== null) {
            $corpo = [...$corpo, 'alerta_paciente' => $sobreposto];
        }

        // DEPOIS do commit da transação do encaixe: a criança que entra pela fila também pode
        // estar ganhando o primeiro agendamento (avisos-do-agendamento-por-whatsapp)
        $confirmacao = $this->avisos->confirmar([$agendamento], $request->user()?->id);

        return response()->json(
            $confirmacao === null ? $corpo : [...$corpo, 'aviso_familia' => $confirmacao],
            201,
        );
    }

    /** @return array<string, mixed> */
    private function validar(Request $request): array
    {

        return $request->validate([
            'paciente_id' => [
                'required', 'integer',
                Rule::exists('pacientes', 'id'),
            ],
            'especialidade_id' => [
                'sometimes', 'nullable', 'integer',
                Rule::exists('especialidades', 'id'),
            ],
            'profissional_id' => [
                'sometimes', 'nullable', 'integer',
                Rule::exists('profissionais', 'id'),
            ],
            'prioridade' => ['sometimes', 'integer', 'min:0', 'max:10'],
            'obs' => ['sometimes', 'nullable', 'string', 'max:1000'],
        ]);
    }
}
