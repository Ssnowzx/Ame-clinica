<?php

namespace App\Http\Controllers;

use App\Models\Agendamento;
use App\Models\Paciente;
use App\Support\Configuracoes\ConfiguracaoService;
use App\Support\Rbac\EscopoDoProfissional;
use Illuminate\Http\JsonResponse;

/**
 * Comparecimento recente de um paciente (change painel-enriquecido) — o
 * mini-histórico dos últimos 90 dias que o painel abre SOB DEMANDA (acordeão),
 * nunca ao carregar a grade (§16).
 *
 * MINIMIZADO por construção: só data · serviço · profissional · status — nenhum
 * campo clínico (a `obs`, a nota de atendimento e as evoluções ficam de fora).
 * Paciente inexistente → 404, e sob `agenda.ver` — é a leitura da agenda de UM menor, mesma classe do
 * que o painel já mostra. É a 6ª superfície de leitura da agenda de um menor sob
 * permissão de agenda (gatilho ENUM).
 */
class ComparecimentoRecenteController extends Controller
{
    /** Janela do "recente" (§ decisão 2 do design). */
    private const JANELA_DIAS = 90;

    /**
     * Teto de linhas: a janela é curta, mas a lista sai limitada de qualquer
     * forma — sem teto, um paciente com agenda cheia devolveria centenas de
     * linhas por requisição. O pior caso real (sessões diárias em 90 dias) fica
     * muito abaixo.
     */
    private const TETO_ITENS = 200;

    public function __construct(
        private readonly ConfiguracaoService $configuracoes,
        private readonly EscopoDoProfissional $escopos,
    ) {}

    public function index(int $pacienteId): JsonResponse
    {
        $paciente = Paciente::find($pacienteId);

        // D11 (eixo AGENDA): PORTÃO por-id. O escopado só abre o mini-histórico de um paciente
        // SEU (EXISTS agendamentos ∪ tratamentos); paciente de outro → 403. Barrado só o ACESSO —
        // uma vez dentro, o CONTEÚDO segue mostrando todos os profissionais (decisão do usuário),
        // porque a criança é multidisciplinar e o painel precisa da rotina inteira dela.
        // POSSE ANTES DA EXISTÊNCIA (`SEC-VP-46`): inexistente e alheia respondem 403 iguais.
        $this->escopos->assegurarPaciente($this->escopos->agenda(request()->user()), $paciente?->id);
        abort_if($paciente === null, 404); // inexistente → 404 (só para o plano)

        // parede da clínica (§13): a janela é contada no fuso da clínica, não no UTC do PHP
        $agora = now($this->configuracoes->get('clinica.timezone'));
        $piso = $agora->copy()->subDays(self::JANELA_DIAS)->format('Y-m-d H:i');
        $ate = $agora->format('Y-m-d H:i');

        $itens = Agendamento::query()
            ->where('tipo', 'atendimento')
            ->where('paciente_id', $paciente->id)
            ->where('inicio', '>=', $piso)
            ->where('inicio', '<', $ate) // comparecimento é passado; o futuro não é histórico
            ->with([
                'especialidade:id,nome,cor',
                'profissional:id,nome',
                'status:id,nome,cor,cor_borda,tipo',
            ])
            ->orderByDesc('inicio')
            ->limit(self::TETO_ITENS)
            ->get(['id', 'paciente_id', 'especialidade_id', 'profissional_id', 'status_id', 'inicio']);

        return response()->json([
            'itens' => $itens->map(fn (Agendamento $a): array => [
                'id' => $a->id,
                'data' => $a->inicio->format('Y-m-d'),
                'especialidade' => $a->especialidade?->only(['id', 'nome', 'cor']),
                'profissional' => $a->profissional?->only(['id', 'nome']),
                'status' => $a->status?->only(['id', 'nome', 'cor', 'cor_borda', 'tipo']),
            ])->all(),
        ]);
    }
}
