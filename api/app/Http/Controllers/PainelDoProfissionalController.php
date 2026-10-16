<?php

namespace App\Http\Controllers;

use App\Models\Profissional;
use App\Models\Usuario;
use App\Support\Configuracoes\ConfiguracaoService;
use App\Support\Indicadores\PainelDoProfissional;
use App\Support\Indicadores\PeriodoComparado;
use App\Support\Rbac\EscopoDoProfissional;
use App\Support\Relatorios\RecebidoPorProfissional;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * `GET /api/profissionais/{id}/painel?mes=AAAA-MM` (change painel-do-profissional, D3/D4/D7).
 *
 * O controller é o boundary: decide QUAIS blocos quem pede pode ver, e só depois valida o mês — a
 * ordem é 403 → 404 → 422. A conta inteira mora em `Support/Indicadores/PainelDoProfissional`.
 *
 * - **Porta da rota:** `profissionais.ver` OU o próprio vinculado (`usuario.profissional_id === id`)
 *   — a mesma da ficha (`ProfissionalController@show`). Fora disso, 403, que vence o 422 do `mes`.
 * - **Cada bloco** exige a permissão do módulo DONO e o eixo do escopo D11: quem pede passa no eixo
 *   se ele for plano ou `de({id})`; com `de(outro)` ou `nenhum`, o bloco é OMITIDO (a chave nem vem).
 *   Zero blocos é 403 — é onde cai sempre o escopado que pede o painel de um colega.
 * - **O financeiro** tem as duas portas estreitas do D4 (`veOFinanceiro`).
 *
 * Profissional inexistente é 404 — nunca 403.
 */
class PainelDoProfissionalController extends Controller
{
    public function __construct(
        private readonly EscopoDoProfissional $escopos,
        private readonly ConfiguracaoService $configuracoes,
    ) {}

    public function show(Request $request, int $id, PainelDoProfissional $painel): JsonResponse
    {
        $usuario = $request->user();
        abort_unless($usuario->can('profissionais.ver') || $this->ehOProprio($usuario, $id), 403);

        $blocos = $this->blocos($usuario, $id);
        // nenhum bloco é nenhuma informação: responder 200 com o nome e mais nada diria "não há
        // números" a quem simplesmente não pode vê-los (D3)
        abort_if($blocos === [], 403, 'Você não tem acesso ao painel deste profissional.');

        $profissional = Profissional::query()->findOrFail($id, ['id', 'nome', 'foto_atualizado_em']);
        $periodo = $this->periodo($request);

        // porcentagem é número de 0 a 1: `0.0` e `1.0` saem com a casa decimal (como nos painéis)
        return response()->json($painel->calcular($profissional, $periodo, $blocos), 200, [], JSON_PRESERVE_ZERO_FRACTION);
    }

    /**
     * Os blocos que quem pede pode ver neste profissional — a régua do D3/D7, decidida aqui e em
     * nenhum outro lugar.
     *
     * @return list<string> os blocos que `PainelDoProfissional::calcular` sabe montar
     */
    private function blocos(Usuario $usuario, int $id): array
    {
        $eixoDaAgenda = $this->escopos->agenda($usuario)->permite($id);
        $eixoClinico = $this->escopos->clinico($usuario)->permite($id);
        $veAgenda = $eixoDaAgenda && $usuario->can('agenda.ver');
        // produtividade e equipe misturam agenda e dado clínico: as duas permissões e os dois eixos,
        // como `/indicadores/produtividade` e `/indicadores/painel/equipe`
        $veProducao = $veAgenda && $eixoClinico && $usuario->can('atendimentos.ver');
        // o bloco de pacientes do painel só tem os pacotes no fim, que são de OUTRO módulo (SEC-IND-01):
        // a régua do painel de pacientes (`pacientes.ver`) E a do bloco do sino (`tratamentos.ver`).
        // Sem a segunda, o bloco seria vazio — e vazio não vem (gate r1, I2)
        $vePacientes = $eixoDaAgenda && $usuario->can('pacientes.ver') && $usuario->can('tratamentos.ver');

        return array_keys(array_filter([
            'agenda' => $veAgenda,
            'produtividade' => $veProducao,
            'equipe' => $veProducao,
            'pacientes' => $vePacientes,
            'financeiro' => $this->veOFinanceiro($usuario, $id, ['agenda' => $eixoDaAgenda, 'clinico' => $eixoClinico]),
        ]));
    }

    /**
     * As duas portas do financeiro (D4), as duas estreitas:
     *
     * - **própria:** `repasse.ver_proprio` + vínculo IGUAL ao id. É igualdade no servidor, não o
     *   `Escopo` — que a flag `agenda.ver_todos` alargaria para a clínica inteira: com ela, a
     *   permissão própria abriria o recebido de todo colega;
     * - **de gestão:** a régua do relatório "Recebido por profissional" — as permissões DELE
     *   (`permissoes()`) e o eixo DELE (`eixo()`, hoje o da agenda), lidos do relatório e não
     *   copiados. A ficha mostra um profissional por vez, como o relatório de quem não vê o fluxo
     *   de caixa — e, como lá, quem não alcança a agenda do profissional não lê o dinheiro dele.
     *
     * @param  array{agenda: bool, clinico: bool}  $eixos  quem pede alcança o profissional em cada eixo?
     */
    private function veOFinanceiro(Usuario $usuario, int $id, array $eixos): bool
    {
        if ($usuario->can('repasse.ver_proprio') && $this->ehOProprio($usuario, $id)) {
            return true;
        }

        $relatorio = new RecebidoPorProfissional;
        $noEixo = $relatorio->eixo() === null || $eixos[$relatorio->eixo()];

        return $noEixo
            && collect($relatorio->permissoes())->every(fn (string $permissao): bool => $usuario->can($permissao));
    }

    /** O usuário está VINCULADO a este profissional? Sem vínculo, nunca. */
    private function ehOProprio(Usuario $usuario, int $id): bool
    {
        return $usuario->profissional_id !== null && (int) $usuario->profissional_id === $id;
    }

    /** `mes=YYYY-MM`, default o mês corrente da clínica; futuro ou antes de 2000 → 422. */
    private function periodo(Request $request): PeriodoComparado
    {
        $fuso = (string) $this->configuracoes->get('clinica.timezone');
        $filtros = $request->validate(['mes' => ['sometimes', 'date_format:Y-m']]);

        return PeriodoComparado::doMes($filtros['mes'] ?? now($fuso)->format('Y-m'), $fuso);
    }
}
