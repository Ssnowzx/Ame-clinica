<?php

namespace App\Http\Controllers;

use App\Models\Agendamento;
use App\Models\Paciente;
use App\Support\Configuracoes\ConfiguracaoService;
use App\Support\Rbac\Escopo;
use App\Support\Rbac\EscopoDoProfissional;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Http\JsonResponse;

/**
 * Agendamentos de um paciente para a FICHA (change agendamentos-na-ficha) — as PRÓXIMAS
 * sessões e os atendimentos RECENTES, na mesma leitura.
 *
 * Existe porque a seção reusava o `comparecimento-recente` do painel da agenda, que é
 * passado por definição (`inicio < agora`): a sessão de hoje, já com presença registrada e
 * evolução escrita, sumia da ficha até o relógio passar do horário, e o futuro nunca
 * aparecia (relato da clínica, 2026-09-08). Aquele endpoint segue como está — esta é a
 * leitura da FICHA, com o contrato dela.
 *
 * MINIMIZADO por construção: início (data E hora — duas sessões no mesmo dia precisam se
 * distinguir), especialidade, profissional e status. Nenhum campo clínico (obs, nota de
 * atendimento e evoluções ficam de fora) e nenhum nome de menor (a ficha já sabe de quem é).
 * Sob `agenda.ver`, com o portão por-id do D11 —
 * mesma classe das demais leituras de agenda de um menor (inventário do gatilho ENUM).
 */
class AgendamentosDoPacienteController extends Controller
{
    /** Janela do "recente" — a mesma do mini-histórico do painel (§ decisão 2 daquele design). */
    private const JANELA_DIAS = 90;

    /**
     * Tetos por bloco (design D2): separados de propósito. Com um teto único, o paciente com
     * muitos futuros esvaziaria os recentes em silêncio — a classe de bug que abriu a change.
     */
    private const TETO_PROXIMOS = 50;

    private const TETO_RECENTES = 200;

    /** Colunas mínimas — nada além do que o item devolve. */
    private const COLUNAS = ['id', 'paciente_id', 'especialidade_id', 'profissional_id', 'status_id', 'inicio', 'fim'];

    public function __construct(
        private readonly ConfiguracaoService $configuracoes,
        private readonly EscopoDoProfissional $escopos,
    ) {}

    public function index(int $pacienteId): JsonResponse
    {
        $paciente = Paciente::find($pacienteId);

        // D11 (eixo AGENDA): PORTÃO por-id, idêntico ao do comparecimento recente e ao da
        // presença — o escopado só abre a agenda de um paciente SEU (EXISTS agendamentos ∪
        // tratamentos); de outro → 403. POSSE ANTES DA EXISTÊNCIA (`SEC-VP-46`): inexistente
        // e alheia respondem 403 iguais.
        $this->escopos->assegurarPaciente($this->escopos->agenda(request()->user()), $paciente?->id);
        abort_if($paciente === null, 404); // inexistente → 404 (só para o plano)

        // O SINAL de evolução (change selo-de-evolucao-na-ficha) tem gate PRÓPRIO, de outro eixo:
        // `evolucoes.ver` (permissão) + escopo CLÍNICO (D11), independentes da `agenda.ver` que
        // abre esta rota. Quando NINGUÉM vai receber sinal — sem a permissão, ou escopo clínico
        // `nenhum` —, a subconsulta nem é montada. Para o escopado COM vínculo ela é calculada em
        // todas as linhas e descartada nas do colega (`sinalDeEvolucao`): o filtro é por linha, e
        // filtrar no SQL exigiria misturar os dois eixos numa consulta só.
        $usuario = request()->user();
        $escopoClinico = $this->escopos->clinico($usuario);
        // `nenhum` (sem vínculo e sem `clinico.ver_todos`) entra aqui: nenhuma linha receberá o
        // sinal, então nem a subconsulta se monta (nit N-03 do gate r2 — o comentário anterior
        // prometia "não se paga por dado que não sai" e só olhava a permissão).
        $alcancaAlgumaLinha = ! $this->escopos->ehNenhum($escopoClinico);
        $podeVerEvolucao = ($usuario?->can('evolucoes.ver') ?? false) && $alcancaAlgumaLinha;

        // parede da clínica (§13): as duas janelas contam no fuso da clínica, não no UTC do PHP
        $agora = now($this->configuracoes->get('clinica.timezone'));
        $de = $agora->copy()->subDays(self::JANELA_DIAS);
        $limite = $agora->format('Y-m-d H:i');

        // O `total` é o REAL da janela, contado ANTES do teto (achado ALTO do gate): com o
        // total já cortado, `total` virava sinônimo de `count(itens)`, o "M" nunca chegava à
        // tela e o front tinha de ESPELHAR os tetos do servidor para adivinhar o corte. A
        // convenção da casa é esta (`PresencaDoPacienteController`: total real, lista cortada).
        $baseProximos = $this->consulta($paciente->id, $podeVerEvolucao)->where('inicio', '>=', $limite);
        $baseRecentes = $this->consulta($paciente->id, $podeVerEvolucao)
            ->where('inicio', '>=', $de->format('Y-m-d H:i'))
            ->where('inicio', '<', $limite);

        $totalProximos = (clone $baseProximos)->count();
        $totalRecentes = (clone $baseRecentes)->count();

        // `id` como segundo critério: duas sessões no MESMO minuto (profissionais diferentes)
        // sairiam em ordem indefinida, e no teto o corte ficaria não determinístico.
        $proximos = $baseProximos->orderBy('inicio')->orderBy('id')
            ->limit(self::TETO_PROXIMOS)
            ->get();

        $recentes = $baseRecentes->orderByDesc('inicio')->orderByDesc('id')
            ->limit(self::TETO_RECENTES)
            ->get();

        return response()->json([
            // a tela NÃO recalcula datas: o servidor diz que janela respondeu, e a seção rotula
            // `ate` nulo nos próximos é a janela ABERTA declarada: tudo daqui para a frente,
            // até o teto — não é dado faltando
            'proximos' => [
                'janela' => ['de' => $agora->toDateString(), 'ate' => null],
                'total' => $totalProximos,
                'itens' => $this->itens($proximos, $podeVerEvolucao, $escopoClinico),
            ],
            'recentes' => [
                'janela' => ['de' => $de->toDateString(), 'ate' => $agora->toDateString()],
                'total' => $totalRecentes,
                'itens' => $this->itens($recentes, $podeVerEvolucao, $escopoClinico),
            ],
        ]);
    }

    /** A base comum dos dois blocos: um atendimento daquele paciente, com o mínimo hidratado. */
    private function consulta(int $pacienteId, bool $comSinalDeEvolucao): Builder
    {
        return Agendamento::query()
            // SELECT EXPLÍCITO, e não só o `get(self::COLUNAS)` lá embaixo (achado bloqueante
            // `SEC-SE-02`): `withExists` com chave string faz um `addSelect` e, com `columns`
            // ainda nulo, o Eloquent injeta `agendamentos.*` — o argumento do `get()` passa a ser
            // IGNORADO. Resultado: no caminho de quem tem `evolucoes.ver`, a consulta trazia a
            // linha inteira, `obs` (texto livre onde cabe conteúdo clínico) incluído, em silêncio.
            ->select(self::COLUNAS)
            ->where('tipo', 'atendimento') // bloqueio não é agendamento de paciente
            ->where('paciente_id', $pacienteId)
            ->with([
                'especialidade:id,nome,cor',
                'profissional:id,nome',
                'status:id,nome,cor,cor_borda,tipo',
            ])
            // EXISTS, nunca `with('atendimento.evolucao')`: hidratar a evolução para depois
            // descartá-la faria o texto clínico da criança (cast `encrypted`, decifrado na
            // hidratação) passar pela memória do processo por preguiça de escrever a subconsulta.
            ->when($comSinalDeEvolucao, fn (Builder $q) => $q->withExists([
                'atendimento as tem_evolucao' => fn ($atendimento) => $atendimento->whereHas('evolucao'),
            ]));
    }

    /**
     * @param  Collection<int, Agendamento>  $agendamentos
     * @return list<array<string, mixed>>
     */
    private function itens(Collection $agendamentos, bool $podeVerEvolucao, Escopo $escopoClinico): array
    {
        return $agendamentos->map(fn (Agendamento $a): array => [
            'id' => $a->id,
            // com HORA: sem ela, duas sessões do mesmo dia ficam indistinguíveis na ficha
            'inicio' => $a->inicio->format('Y-m-d H:i'),
            // o TÉRMINO (change horario-de-termino-no-card): "08:40 às 09:20" na ficha e no detalhe
            // do agendamento — sessões do mesmo tratamento podem ter durações diferentes
            'fim' => $a->fim->format('Y-m-d H:i'),
            'especialidade' => $a->especialidade?->only(['id', 'nome', 'cor']),
            'profissional' => $a->profissional?->only(['id', 'nome']),
            'status' => $a->status?->only(['id', 'nome', 'cor', 'cor_borda', 'tipo']),
            'tem_evolucao' => $this->sinalDeEvolucao($a, $podeVerEvolucao, $escopoClinico),
        ])->all();
    }

    /**
     * TRÊS estados, e `null` é um deles (design D2 do selo): `true`/`false` só para quem pode
     * ler evoluções E alcança AQUELA linha no eixo clínico; `null` é "não posso saber".
     *
     * Servir `false` no lugar do `null` criaria um oráculo mudo — a ausência do selo passaria a
     * significar duas coisas diferentes, e a tela responderia "não tem evolução" a quem, na
     * verdade, não tem permissão para saber. O gate é POR LINHA porque a criança é
     * multidisciplinar: na mesma ficha há sessões do próprio profissional e as do colega.
     */
    private function sinalDeEvolucao(Agendamento $agendamento, bool $podeVerEvolucao, Escopo $escopoClinico): ?bool
    {
        if (! $podeVerEvolucao || ! $escopoClinico->permite($agendamento->profissional_id)) {
            return null;
        }

        return (bool) $agendamento->tem_evolucao;
    }
}
