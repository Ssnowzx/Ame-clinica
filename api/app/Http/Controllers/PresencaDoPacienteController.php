<?php

namespace App\Http\Controllers;

use App\Models\Agendamento;
use App\Models\Paciente;
use App\Support\Agenda\ContadorDeFaltasConsecutivas;
use App\Support\Configuracoes\ConfiguracaoService;
use App\Support\Rbac\EscopoDoProfissional;
use Illuminate\Http\JsonResponse;

/**
 * Assiduidade do paciente (change presenca-na-ficha) — a seção Presença da ficha.
 *
 * O SERVIDOR classifica (regra é DADO, §13 — nunca nome de status): falta =
 * `marca_falta` (mesmo que o status também desconte — falta cobrada continua
 * falta); compareceu = sessão consumida em status não-falta; outro = o resto.
 * A taxa sai calculada daqui (D2) e a sequência de faltas vem da FONTE ÚNICA
 * `ContadorDeFaltasConsecutivas` (D3) — o número da seção jamais diverge do
 * alerta do painel.
 *
 * MINIMIZADO: contagens, datas, o status das faltas e — desde a change
 * ficha-sessoes-por-profissional (pedido verbatim da clínica) — a quebra das
 * finalizadas por profissional×especialidade, com {id, nome} de PROFISSIONAL
 * (dado de equipe; NUNCA nome de menor nem nada clínico). Mesmo portão por-id
 * do comparecimento recente (D4): a superfície é da MESMA classe da 6ª do
 * gatilho ENUM, e está inventariada lá.
 */
class PresencaDoPacienteController extends Controller
{
    /** Janela da assiduidade — o teto estrutural do produto (não configurável). */
    private const JANELA_DIAS = 366;

    /** Teto de FALTAS itemizadas — o resto é contador (amostra declarada na tela). */
    private const TETO_FALTAS = 50;

    public function __construct(
        private readonly ConfiguracaoService $configuracoes,
        private readonly EscopoDoProfissional $escopos,
    ) {}

    public function index(int $pacienteId): JsonResponse
    {
        $paciente = Paciente::find($pacienteId);

        // D11 (eixo AGENDA): portão por-id — o escopado só abre a assiduidade de paciente SEU.
        // POSSE ANTES DA EXISTÊNCIA (`SEC-VP-46`): inexistente e alheia respondem 403 iguais.
        $this->escopos->assegurarPaciente($this->escopos->agenda(request()->user()), $paciente?->id);
        abort_if($paciente === null, 404); // inexistente → 404 (só para o plano)

        // parede da clínica (§13): a janela conta no fuso da clínica
        $agora = now($this->configuracoes->get('clinica.timezone'));
        $piso = $agora->copy()->subDays(self::JANELA_DIAS)->format('Y-m-d H:i');
        $ate = $agora->format('Y-m-d H:i');

        // uma passada, colunas mínimas: as flags decidem, nada além delas é hidratado
        // (profissional/especialidade entram SÓ como {id, nome} — a quebra da cliente)
        $passados = Agendamento::query()
            ->where('tipo', 'atendimento')
            ->where('paciente_id', $paciente->id)
            ->whereNotNull('status_id')
            ->where('inicio', '>=', $piso)
            // assiduidade é o que JÁ ACONTECEU — incluído o de HOJE cujo desfecho a clínica
            // já lançou (change agendamentos-na-ficha, D5). O predicado mora no model, e o
            // `ContadorDeFaltasConsecutivas` lê do MESMO lugar: a sequência da seção jamais
            // discorda dos totais dela.
            ->jaContabilizavel($ate)
            ->with([
                'status:id,nome,cor,cor_borda,tipo,marca_falta',
                'profissional:id,nome',
                'especialidade:id,nome',
            ])
            ->orderByDesc('inicio')
            ->get(['id', 'paciente_id', 'status_id', 'sessao_consumida_em', 'inicio', 'profissional_id', 'especialidade_id']);

        // precedência de falta (D1): falta-que-desconta é falta na assiduidade
        $faltas = $passados->filter(fn (Agendamento $a): bool => (bool) $a->status?->marca_falta);
        // a MESMA régua do "Compareceu" alimenta a quebra por profissional: uma
        // conta só (a soma da quebra BATE com o total por construção, não por sorte)
        $finalizadas = $passados->filter(
            fn (Agendamento $a): bool => $a->sessao_consumida_em !== null && ! (bool) $a->status?->marca_falta
        );
        $compareceu = $finalizadas->count();
        $totalFaltas = $faltas->count();
        $outros = $passados->count() - $compareceu - $totalFaltas;

        // o pedido verbatim da clínica: "quantas sessões fez COM CADA profissional…
        // e um filtro por especialidade" — linhas profissional×especialidade,
        // maiores primeiro (relevância, como nas quebras dos indicadores)
        $porProfissional = $finalizadas
            ->groupBy(fn (Agendamento $a): string => $a->profissional_id.'·'.($a->especialidade_id ?? 0))
            ->map(fn ($grupo): array => [
                'profissional' => $grupo->first()->profissional?->only(['id', 'nome']),
                'especialidade' => $grupo->first()->especialidade?->only(['id', 'nome']),
                'finalizadas' => $grupo->count(),
            ])
            ->sortByDesc('finalizadas')
            ->values();

        // base = compareceu + faltas ("outro" não é presença nem ausência); sem base → null,
        // nunca um "0%" fabricado (D2). String decimal — a tela só formata.
        $base = $compareceu + $totalFaltas;
        $taxa = $base === 0
            ? null
            : number_format($compareceu * 100 / $base, 1, '.', '');

        $limite = (int) $this->configuracoes->get('agenda.faltas_consecutivas_limite');
        $sequencia = ContadorDeFaltasConsecutivas::doPaciente($paciente->id, $ate, $limite, $piso);

        return response()->json([
            'janela' => [
                'de' => $agora->copy()->subDays(self::JANELA_DIAS)->toDateString(),
                'ate' => $agora->toDateString(),
            ],
            'totais' => [
                'compareceu' => $compareceu,
                'faltas' => $totalFaltas,
                'outros' => $outros,
                'total' => $passados->count(),
            ],
            'taxa_comparecimento' => $taxa,
            'sessoes_por_profissional' => $porProfissional,
            'faltas_consecutivas' => [
                'consecutivas' => $sequencia['consecutivas'],
                'limite' => $limite,
            ],
            // a última falta da JANELA (não da sequência): compareceu depois não a apaga
            'ultima_falta_em' => $faltas->first()?->inicio->format('Y-m-d'),
            'faltas' => $faltas->take(self::TETO_FALTAS)->map(fn (Agendamento $a): array => [
                'id' => $a->id,
                'data' => $a->inicio->format('Y-m-d'),
                'status' => $a->status?->only(['id', 'nome', 'cor', 'cor_borda', 'tipo']),
            ])->values()->all(),
        ]);
    }
}
