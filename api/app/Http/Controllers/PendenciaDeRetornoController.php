<?php

namespace App\Http\Controllers;

use App\Models\Paciente;
use App\Support\Clinica\PendenciasDeRetorno;
use App\Support\Configuracoes\ConfiguracaoService;
use App\Support\Rbac\EscopoDoProfissional;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * A fila de RETORNOS (change protocolo-de-pendencias): quem parou de ser agendado.
 *
 * O controller não tem regra nenhuma — a definição inteira vive em `PendenciasDeRetorno`,
 * a MESMA fonte que o bloco `pendencias_de_retorno` do centro de notificações consome. É
 * isso que faz contador e lista nunca divergirem (contrato na spec).
 *
 * Permissão: `agenda.ver` (middleware na rota) — a pendência é fato da AGENDA (a ausência
 * de horário) e quem age é a recepção. Escopo: eixo AGENDA do D11, aplicado DENTRO da
 * fonte única pela coluna `tratamentos.profissional_id`.
 */
class PendenciaDeRetornoController extends Controller
{
    public function __construct(
        private readonly PendenciasDeRetorno $pendencias,
        private readonly ConfiguracaoService $configuracoes,
        private readonly EscopoDoProfissional $escopos,
    ) {}

    public function index(Request $request): JsonResponse
    {
        $filtros = $request->validate([
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:100'],
        ]);

        $hoje = now($this->configuracoes->get('clinica.timezone'))->toDateString();
        $fila = $this->pendencias
            ->consulta($this->escopos->agenda($request->user()), $hoje)
            ->paginate($filtros['per_page'] ?? 50);

        $fila->getCollection()->transform(
            fn (Paciente $paciente) => $this->pendencias->item($paciente, $hoje)
        );

        // a janela acompanha a fila: a tela explica "sem agendamento há mais de N dias"
        // sem ler a configuração crua (mesma disciplina de CHAVES_EXIBICAO_AGENDA)
        return response()->json([
            ...$fila->toArray(),
            'janela_dias' => $this->pendencias->janelaDias(),
        ]);
    }
}
