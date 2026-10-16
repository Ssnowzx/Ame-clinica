<?php

namespace App\Http\Controllers;

use App\Models\Convenio;
use App\Models\Especialidade;
use App\Models\LancamentoCaixa;
use App\Models\Paciente;
use App\Models\Profissional;
use App\Models\Tratamento;
use App\Support\Financeiro\SugestaoDeTratamento;
use App\Support\Financeiro\VinculoEmLote;
use App\Support\Rbac\EscopoDoProfissional;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

/**
 * O vínculo pagamento → tratamento conduzido (change `vincular-pagamentos-ao-tratamento`): a
 * SUGESTÃO para o formulário, a LISTA do que ficou sem tratamento e o LOTE. As permissões moram
 * nas rotas (E de várias, uma `permission:` por linha — `a|b` do Spatie é OU).
 */
class LancamentoVinculoController extends Controller
{
    /** Teto da lista do lote: um mês da clínica cabe com folga; acima disso, período menor. */
    public const TETO_DA_LISTA = 500;

    /** O teto é injetável (teste) — o mesmo molde dos relatórios, para o corte não exigir 501 registros. */
    public function __construct(
        private readonly SugestaoDeTratamento $sugestao,
        private readonly EscopoDoProfissional $escopos,
        private readonly int $tetoDaLista = self::TETO_DA_LISTA,
    ) {}

    /** `GET /lancamentos/sugestao-de-tratamento?paciente_id=` — sob `tratamentos.ver`. */
    public function sugestao(Request $request): JsonResponse
    {
        // só o FORMATO (SEC-VPT-01): com `exists`, o escopado distinguia "a criança não existe"
        // (422) de "existe e não é minha" (200 null). O escopo do eixo agenda já
        // respondem `null` aos três casos
        $dados = $request->validate(['paciente_id' => ['required', 'integer']]);

        return response()->json([
            'tratamento_id' => $this->sugestao->para((int) $dados['paciente_id'], $this->escopos->agenda($request->user())),
        ]);
    }

    /**
     * `GET /lancamentos/sem-tratamento?de&ate` — as receitas PAGAS no período (`pago_em`, a régua
     * do "Recebido por profissional") com a criança e sem sessão nem tratamento, cada uma com a
     * sugestão. Valor e nome da criança já são visíveis a quem tem `lancamentos.ver`.
     */
    public function semTratamento(Request $request): JsonResponse
    {
        $dados = $request->validate([
            'de' => ['required', 'date_format:Y-m-d'],
            'ate' => ['required', 'date_format:Y-m-d', 'after_or_equal:de'],
        ]);
        $dias = CarbonImmutable::parse($dados['de'])->diffInDays(CarbonImmutable::parse($dados['ate']));
        if ($dias > 365) {
            throw ValidationException::withMessages(['ate' => 'O período vai até um ano.']);
        }

        $brutas = LancamentoCaixa::query()
            ->where('tipo', 'receita')
            ->where('interessado_tipo', 'paciente')
            ->whereNull('agendamento_id')
            ->whereNull('tratamento_id')
            ->whereBetween('pago_em', ["{$dados['de']} 00:00:00", "{$dados['ate']} 23:59:59"])
            ->orderBy('pago_em')->orderBy('id')
            ->limit($this->tetoDaLista + 1)
            ->get(['id', 'tipo', 'valor', 'juros', 'multa', 'desconto', 'pago_em', 'interessado_id']);
        $truncado = $brutas->count() > $this->tetoDaLista;
        $linhas = $brutas->take($this->tetoDaLista);

        $pacienteIds = $linhas->pluck('interessado_id')->map(fn ($id): int => (int) $id)->unique()->values()->all();
        $escopo = $this->escopos->agenda($request->user());
        $sugestoes = $this->sugestao->paraVarias($pacienteIds, $escopo);
        $nomes = Paciente::whereIn('id', $pacienteIds)->pluck('nome', 'id');
        // os tratamentos de cada criança NA RESPOSTA (CR-VPT-07): a tela pedia `/tratamentos` uma
        // vez por criança sem sugestão, e a lista vai a 500 linhas num ano
        $daCrianca = $escopo->aplicar(Tratamento::query(), 'tratamentos.profissional_id')
            ->whereIn('paciente_id', $pacienteIds)
            ->orderBy('id')
            ->get(['id', 'paciente_id', 'especialidade_id', 'profissional_id', 'convenio_id', 'sessoes_total', 'sessoes_realizadas', 'data_inicio', 'validade_dias', 'status'])
            ->groupBy('paciente_id')
            ->map(fn ($tratamentos): array => $tratamentos->map(fn (Tratamento $t): array => [
                'id' => $t->id,
                'especialidade_id' => $t->especialidade_id,
                'profissional_id' => $t->profissional_id,
                'convenio_id' => $t->convenio_id,
                'sessoes_total' => $t->sessoes_total,
                'sessoes_saldo' => $t->sessoes_saldo,
                'vencido' => $t->vencido,
                'status' => $t->status,
            ])->values()->all());
        $detalhes = $this->detalhesDasSugestoes(array_values(array_filter($sugestoes)));

        return response()->json([
            'data' => $linhas->map(fn (LancamentoCaixa $l): array => [
                'id' => $l->id,
                'pago_em' => $l->pago_em?->format('Y-m-d H:i'),
                'liquido' => $l->liquido,
                'paciente' => ['id' => (int) $l->interessado_id, 'nome' => (string) ($nomes[$l->interessado_id] ?? '')],
                'sugestao' => $detalhes[$sugestoes[(int) $l->interessado_id] ?? 0] ?? null,
                'tratamentos_da_crianca' => $daCrianca[$l->interessado_id] ?? [],
            ])->values(),
            'contagem' => $linhas->count(),
            'truncado' => $truncado,
        ]);
    }

    /** `POST /lancamentos/vincular-tratamentos` — tudo ou nada (ver `VinculoEmLote`). */
    public function vincular(Request $request, VinculoEmLote $lote): JsonResponse
    {
        // SÓ FORMATO (CR-VPT-02): com `exists` aqui, a validação respondia antes da posse — 422 ao
        // tratamento inexistente, 403 ao do colega, e o escopado enumerava os tratamentos da clínica
        // (o oráculo que o SEC-RPP-05 fechou no PUT). Sem ele, o inexistente vira dono `null` na
        // posse: o MESMO 403 do alheio; para quem vê tudo, a coerência do item recusa com 422
        $dados = $request->validate([
            'vinculos' => ['required', 'array', 'min:1', 'max:200'],
            'vinculos.*.lancamento_id' => ['required', 'integer', 'distinct'],
            'vinculos.*.tratamento_id' => ['required', 'integer'],
        ]);

        return response()->json($lote->vincular(array_values($dados['vinculos']), $request->user()));
    }

    /**
     * Os nomes que a tela mostra ao lado da sugestão — especialidade, profissional e convênio —,
     * em lote, sem hidratar cadastro.
     *
     * @param  list<int>  $tratamentoIds
     * @return array<int, array{tratamento_id: int, especialidade: string, profissional: string, convenio: string}>
     */
    private function detalhesDasSugestoes(array $tratamentoIds): array
    {
        if ($tratamentoIds === []) {
            return [];
        }
        $tratamentos = Tratamento::whereIn('id', $tratamentoIds)->get(['id', 'especialidade_id', 'profissional_id', 'convenio_id']);
        $especialidades = Especialidade::whereIn('id', $tratamentos->pluck('especialidade_id'))->pluck('nome', 'id');
        $profissionais = Profissional::whereIn('id', $tratamentos->pluck('profissional_id'))->pluck('nome', 'id');
        $convenios = Convenio::whereIn('id', $tratamentos->pluck('convenio_id'))->pluck('nome', 'id');

        return $tratamentos->mapWithKeys(fn (Tratamento $t): array => [$t->id => [
            'tratamento_id' => $t->id,
            'especialidade' => (string) ($especialidades[$t->especialidade_id] ?? ''),
            'profissional' => (string) ($profissionais[$t->profissional_id] ?? ''),
            'convenio' => (string) ($convenios[$t->convenio_id] ?? ''),
        ]])->all();
    }
}
