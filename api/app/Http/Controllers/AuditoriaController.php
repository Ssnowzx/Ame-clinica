<?php

namespace App\Http\Controllers;

use App\Http\Resources\AuditoriaResource;
use App\Models\Auditoria;
use App\Support\Auditoria\RegistroDeAuditoria;
use App\Support\Auditoria\ResolvedorDeValores;
use App\Support\Configuracoes\ConfiguracaoService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class AuditoriaController extends Controller
{
    public function __construct(private readonly ConfiguracaoService $configuracoes) {}

    /**
     * Consulta SOMENTE-LEITURA da trilha, protegida por auditoria.ver (parecer
     * T-aud-01/T-aud-04). Não existem — e nunca devem existir — rotas de escrita
     * para auditoria.
     *
     * `entidade_id` exige `entidade` (senão o id 42 casaria agendamento E paciente).
     * Cada linha traz o NOME do autor ("Sistema" fora de request) e as alterações
     * com rótulo humano (spec auditoria) — a chave crua nunca sai.
     */
    public function index(Request $request): JsonResponse
    {
        // `entidade` sem `sometimes` de propósito: `required_with` é regra IMPLÍCITA e
        // precisa rodar mesmo quando o campo está ausente (com `sometimes`, o Laravel
        // pula tudo e o entidade_id órfão passaria).
        $filtros = $request->validate([
            'entidade' => ['required_with:entidade_id', 'string'],
            'entidade_id' => ['sometimes', 'integer'],
            'de' => ['sometimes', 'date'],
            'ate' => ['sometimes', 'date'],
            // igualdade simples (auditoria-tela): sem `exists` de propósito — id/ação
            // que não casa devolve página vazia, nunca oráculo de existência (D2)
            'usuario_id' => ['sometimes', 'integer'],
            'acao' => ['sometimes', 'string', 'max:60'],
            // lote (D11): igualdade exata com o uuid gravado pela fonte única. Mal formado é
            // 422 como os demais filtros da rota; desconhecido devolve página vazia —
            // nunca oráculo de existência
            'lote_id' => ['sometimes', 'string', 'size:36', 'uuid'],
        ]);

        $fuso = $this->configuracoes->get('clinica.timezone');

        $registros = Auditoria::query()
            ->with('usuario')
            ->when($filtros['entidade'] ?? null, fn ($q, $entidade) => $q->where('entidade', $entidade))
            ->when($filtros['entidade_id'] ?? null, fn ($q, $id) => $q->where('entidade_id', $id))
            ->when($filtros['de'] ?? null, fn ($q, $de) => $q->where('criado_em', '>=', $de))
            ->when($filtros['ate'] ?? null, fn ($q, $ate) => $q->whereDate('criado_em', '<=', $ate))
            // presença, não truthiness: `usuario_id=0`/`acao=0` são filtros que NÃO
            // casam nada (vazio) — o `when` truthy os ignoraria e devolveria TUDO (I3)
            ->when(($filtros['usuario_id'] ?? null) !== null, fn ($q) => $q->where('usuario_id', $filtros['usuario_id']))
            ->when(($filtros['acao'] ?? null) !== null, fn ($q) => $q->where('acao', $filtros['acao']))
            ->when(($filtros['lote_id'] ?? null) !== null, fn ($q) => $q->where('lote_id', $filtros['lote_id']))
            ->orderByDesc('criado_em')
            ->paginate(50);

        // Só a trilha de AGENDAMENTO resolve valores (FK→nome, data/booleano). O resolvedor
        // é montado UMA vez por página: catálogos pequenos da clínica + os pacientes que o diff
        // realmente cita. Outras entidades seguem com valor cru (resolvedor nulo).
        $resolvedor = ($filtros['entidade'] ?? null) === 'agendamentos'
            ? new ResolvedorDeValores(ResolvedorDeValores::pacienteIdsDe($registros->getCollection()))
            : null;

        // o saldo de abertura da conta é agregado do dinheiro da clínica (SEC-FIN-02): quem audita
        // sem `fluxo_caixa.ver` vê QUE mudou, não o valor — mascarado na LEITURA, e não na
        // gravação, para a prova da mudança continuar inteira na trilha
        $ocultarSaldo = $request->user()?->can('fluxo_caixa.ver') !== true;

        $registros->through(function (Auditoria $registro) use ($fuso, $resolvedor, $request, $ocultarSaldo): array {
            if ($ocultarSaldo && $registro->entidade === 'contas') {
                $registro->diff_json = self::semSaldoDeAbertura((array) $registro->diff_json);
            }

            return AuditoriaResource::make($registro)
                ->comFuso($fuso)
                ->comResolvedor($resolvedor)
                ->resolve($request);
        });

        return response()->json($registros);
    }

    /**
     * @param  array<string, mixed>  $diff
     * @return array<string, mixed>
     */
    private static function semSaldoDeAbertura(array $diff): array
    {
        foreach ($diff as $lado => $campos) {
            if (! is_array($campos)) {
                continue;
            }
            foreach (['saldo_inicial', 'saldo_inicial_em'] as $campo) {
                if (array_key_exists($campo, $campos)) {
                    $diff[$lado][$campo] = RegistroDeAuditoria::MASCARA;
                }
            }
        }

        return $diff;
    }
}
