<?php

namespace App\Http\Controllers;

use App\Support\Configuracoes\ConfiguracaoService;
use App\Support\Indicadores\PainelDaAgenda;
use App\Support\Indicadores\PainelDaEquipe;
use App\Support\Indicadores\PainelDoDinheiro;
use App\Support\Indicadores\PainelDosPacientes;
use App\Support\Indicadores\PeriodoComparado;
use App\Support\Rbac\EscopoDoProfissional;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Os PAINÉIS dos indicadores (change indicadores-profissionais, D1/D9) — um por frente, cada um sob
 * a permissão do módulo DONO na rota (T-not-13, sem guarda-chuva): a permissão decide antes de o
 * mês ser validado (403 antes de 422). Só agregados — nenhum nome de paciente sai daqui.
 *
 * As vistas antigas do `IndicadorController` continuam: as páginas de itens e os gráficos
 * financeiros as usam (D1 — estendê-las mudaria contratos que três páginas consomem).
 *
 * O controller só escolhe o escopo e o período; a conta inteira mora em `Support/Indicadores`.
 */
class PainelDeIndicadoresController extends Controller
{
    public function __construct(
        private readonly EscopoDoProfissional $escopos,
        private readonly ConfiguracaoService $configuracoes,
    ) {}

    /** Sob fluxo_caixa.ver: dinheiro da CLÍNICA, sem eixo por profissional. */
    public function dinheiro(Request $request, PainelDoDinheiro $painel): JsonResponse
    {
        return $this->resposta($painel->calcular($this->periodo($request)));
    }

    /** Sob agenda.ver, escopo D11 do eixo agenda: o escopado vê a PRÓPRIA agenda. */
    public function agenda(Request $request, PainelDaAgenda $painel): JsonResponse
    {
        $periodo = $this->periodo($request);

        return $this->resposta($painel->calcular($periodo, $this->escopos->agenda($request->user())));
    }

    /**
     * Sob pacientes.ver: contagens da clínica. O eixo agenda entra SÓ nos pacotes no fim — o
     * mesmo escopo que o bloco "Pacotes acabando" do sino aplica, para os dois números serem um.
     * Pacotes e fila são de outros módulos e só vêm com a permissão DELES (SEC-IND-01): a decisão
     * é tomada aqui, no boundary, como o sino decide os blocos.
     */
    public function pacientes(Request $request, PainelDosPacientes $painel): JsonResponse
    {
        $periodo = $this->periodo($request);
        $usuario = $request->user();

        return $this->resposta($painel->calcular(
            $periodo,
            $this->escopos->agenda($usuario),
            vePacotes: $usuario->can('tratamentos.ver'),
            veFila: $usuario->can('lista_espera.ver'),
        ));
    }

    /**
     * Sob agenda.ver E atendimentos.ver (encadeadas na rota): escopo pela INTERSEÇÃO dos eixos. O
     * total sem evolução é o do sino, então vai no eixo DELE, o clínico (CR-IND-04).
     */
    public function equipe(Request $request, PainelDaEquipe $painel): JsonResponse
    {
        $periodo = $this->periodo($request);
        $usuario = $request->user();

        return $this->resposta($painel->calcular(
            $periodo,
            $this->escopos->agendaEClinico($usuario),
            $this->escopos->clinico($usuario),
        ));
    }

    /**
     * Porcentagem é número de 0 a 1 (D9): `0.0` e `1.0` saem COM a casa decimal — sem a flag, o
     * `json_encode` os escreve como `0` e `1`, e o mesmo campo mudaria de tipo para quem lê com
     * tipagem (o PHP do teste, um cliente gerado).
     */
    private function resposta(array $painel): JsonResponse
    {
        return response()->json($painel, 200, [], JSON_PRESERVE_ZERO_FRACTION);
    }

    /** `mes=YYYY-MM` obrigatório; mês futuro ou anterior a 2000 → 422 (`PeriodoComparado`). */
    private function periodo(Request $request): PeriodoComparado
    {
        $filtros = $request->validate(['mes' => ['required', 'date_format:Y-m']]);

        return PeriodoComparado::doMes($filtros['mes'], (string) $this->configuracoes->get('clinica.timezone'));
    }
}
