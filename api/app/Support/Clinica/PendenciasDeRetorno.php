<?php

namespace App\Support\Clinica;

use App\Models\Agendamento;
use App\Models\Paciente;
use App\Models\Tratamento;
use App\Support\Configuracoes\ConfiguracaoService;
use App\Support\Rbac\Escopo;
use Carbon\Carbon;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Relations\Relation;

/**
 * Pendência de RETORNO — o paciente que parou de ser agendado (change
 * protocolo-de-pendencias, pedido verbatim da clínica em PR-09).
 *
 * A REGRA em UM lugar só: dois consumidores dependem da MESMA definição — o bloco
 * `pendencias_de_retorno` do centro de notificações e a fila `/pendencias`. Contador e
 * lista nunca podem divergir (o contrato está na spec).
 *
 * **Nada é persistido** (design D1): o estado é calculado por leitura, como os demais
 * blocos do centro. A pendência MORRE sozinha quando o agendamento nasce — a resolução é
 * exatamente o ato que a clínica quer que aconteça. Uma tabela criaria uma segunda fonte
 * da verdade capaz de discordar da agenda ("resolvida" sem agendamento nenhum), que é o
 * pior modo de falhar para uma feature cujo propósito é não deixar paciente para trás.
 *
 * **O colapso que torna a consulta barata** (design D8): "não tem agendamento futuro" E
 * "o último passado foi há mais de N dias" são, juntas, UMA condição só — *não existe
 * ocorrência do corte para cá*. Uma ocorrência depois do corte ou é futura (protege) ou é
 * recente demais (protege). Por isso não há laço por paciente em PHP: diferente do bloco
 * de faltas consecutivas — onde a SEQUÊNCIA não cabe num agregado (gate r1, CR-01) —,
 * aqui a decisão inteira é ancorada no SQL e a paginação é a do banco.
 *
 * Escopo: eixo AGENDA do D11 (design D6), pela coluna `tratamentos.profissional_id` — o
 * escopado vê só os pacientes dos SEUS tratamentos; sem vínculo, nada (fail-closed).
 */
class PendenciasDeRetorno
{
    public function __construct(private readonly ConfiguracaoService $configuracoes) {}

    /**
     * Dias sem agendamento que caracterizam a pendência (§13,
     * `agenda.pendencia_retorno_dias`) com clamp defensivo na LEITURA: a faixa 7..180 vale
     * na escrita do catálogo E aqui — um valor adulterado direto no banco nunca alarga a
     * janela nem a estreita a ponto de listar a base inteira. (Mesma guarda de
     * `PedidosMedicos::antecedenciaDias()`.)
     */
    public function janelaDias(): int
    {
        $valor = (int) $this->configuracoes->get('agenda.pendencia_retorno_dias');

        return min(max($valor, 7), 180);
    }

    /**
     * Base ÚNICA da fila: pacientes ativos com tratamento em andamento, com saldo e não
     * vencido, sem nenhuma ocorrência do corte para cá — do mais esquecido para o menos.
     *
     * @return Builder<Paciente>
     */
    public function consulta(Escopo $escopo, string $hoje): Builder
    {
        $corte = Carbon::createFromFormat('Y-m-d', $hoje)
            ->subDays($this->janelaDias())
            ->toDateString();

        return Paciente::query()
            ->where('ativo', true)
            ->whereHas('tratamentos', fn (Builder $t) => $this->tratamentosAtivos($t, $escopo, $hoje))
            // (2) o COLAPSO: nenhuma ocorrência em [corte, ∞) — cobre "sem próxima sessão"
            //     e "a última foi há mais de N dias" de uma vez
            ->whereDoesntHave(
                'agendamentos',
                fn (Builder $a) => $this->ocorrencias($a)->where('inicio', '>=', $corte.' 00:00:00'),
            )
            // (3) precisa haver ÂNCORA antiga: ou já houve sessão (necessariamente anterior
            //     ao corte, por (2)), ou o pacote começou antes do corte. Sem âncora nenhuma
            //     (pacote sem data_inicio e sem sessão) não se afirma nada — o silêncio é o
            //     erro conservador.
            ->where(fn (Builder $q) => $q
                ->whereHas('agendamentos', fn (Builder $a) => $this->ocorrencias($a))
                ->orWhereHas('tratamentos', fn (Builder $t) => $this
                    ->tratamentosAtivos($t, $escopo, $hoje)
                    ->where('data_inicio', '<=', $corte)))
            // (4) pacote NOVO nunca alarma — o MAX(data_inicio) da D4 em termos de EXISTS.
            //     Fica FORA do `or` de (3) de propósito (achado do gate, r1): dentro dele, o
            //     ramo "já teve sessão" curto-circuitava a guarda, e duas crianças com o MESMO
            //     sinal de engajamento (pacote vendido ontem) tinham destinos opostos — a que
            //     nunca foi agendada saía da fila, a que teve uma sessão há 200 dias entrava no
            //     TOPO dizendo "200 dias". Vender um pacote é a família na recepção; o alarme
            //     espera a janela, qualquer que seja o histórico.
            ->whereDoesntHave('tratamentos', fn (Builder $t) => $this
                ->tratamentosAtivos($t, $escopo, $hoje)
                ->where('data_inicio', '>', $corte))
            // camada 1 da minimização (banco → app): o cadastro do menor nunca entra na
            // memória do processo — de onde vazaria para log, dump ou payload de exceção
            ->select(ResumoDoPaciente::CAMPOS)
            ->withMax(
                ['agendamentos as ultima_ocorrencia' => fn (Builder $a) => $this->ocorrencias($a)],
                'inicio',
            )
            ->withMax(
                ['tratamentos as inicio_tratamento' => fn (Builder $t) => $this->tratamentosAtivos($t, $escopo, $hoje)],
                'data_inicio',
            )
            ->with(['tratamentos' => fn ($t) => $this
                ->tratamentosAtivos($t, $escopo, $hoje)
                ->select(['id', 'paciente_id', 'especialidade_id'])
                ->with('especialidade:id,nome')])
            // do mais esquecido para o menos; o id desempata para a paginação ser estável
            ->orderByRaw('COALESCE(ultima_ocorrencia, inicio_tratamento) asc')
            ->orderBy('id');
    }

    /**
     * O item — a whitelist EXATA da spec, nada além dela: NUNCA nascimento, CPF,
     * responsáveis, contatos, endereço, necessidade, observação ou dado clínico.
     *
     * @return array<string, mixed>
     */
    public function item(Paciente $paciente, string $hoje): array
    {
        $ultima = $this->soData($paciente->ultima_ocorrencia ?? null);
        $inicio = $this->soData($paciente->inicio_tratamento ?? null);
        $ancora = $ultima ?? $inicio;

        return [
            'paciente' => ResumoDoPaciente::de($paciente),
            'dias_sem_agendamento' => $ancora === null ? null : $this->diasEntre($ancora, $hoje),
            'ultima_ocorrencia_em' => $ultima,
            'inicio_tratamento_em' => $inicio,
            'especialidades' => $paciente->tratamentos
                ->map(fn ($tratamento) => $tratamento->especialidade?->only(['id', 'nome']))
                ->filter()
                ->unique('id')
                ->values()
                ->all(),
        ];
    }

    /**
     * Tratamento que ainda pede sessão: em andamento, com saldo e não vencido — e, quando
     * o usuário é escopado, do PRÓPRIO profissional (D11, eixo agenda).
     *
     * `sessoes_saldo` e `vencido` são acessores PHP, não colunas: em SQL viram a comparação
     * de colunas e o mesmo `DATE_ADD` que o `PedidosMedicos` usa (o clamp do MariaDB e o do
     * Carbon casam). Sem âncora de validade, nunca vence.
     *
     * Aceita `Relation` além de `Builder` porque `with()` entrega a relação e `whereHas()`
     * entrega o builder — e a MESMA definição precisa valer nos dois, senão o escopado
     * filtraria a fila pelos seus tratamentos mas leria a especialidade do colega.
     *
     * @param  Builder<Tratamento>|Relation<Tratamento, Paciente, *>  $consulta
     * @return Builder<Tratamento>
     */
    private function tratamentosAtivos(Builder|Relation $consulta, Escopo $escopo, string $hoje): Builder
    {
        return $escopo->aplicar(
            ($consulta instanceof Relation ? $consulta->getQuery() : $consulta)
                ->where('status', 'andamento')
                ->whereColumn('sessoes_realizadas', '<', 'sessoes_total')
                ->where(fn (Builder $validade) => $validade
                    ->whereNull('data_inicio')
                    ->orWhereNull('validade_dias')
                    ->orWhereRaw('DATE_ADD(data_inicio, INTERVAL validade_dias DAY) >= ?', [$hoje])),
        );
    }

    /**
     * O que conta como OCORRÊNCIA na régua da pendência: atendimento cujo status OCUPA
     * horário — a FLAG, nunca o nome (design D3, mesma disciplina de `marca_falta`).
     *
     * Não existe status "cancelado" no produto. Um futuro com `ocupa_horario = false` (o
     * desmarcado) deixa o horário LIVRE: ninguém vai atender aquele paciente, então ele
     * NÃO pode protegê-lo de estar pendente — é o caso mais comum do mundo real (a sessão
     * foi desmarcada e ninguém remarcou). Bloqueio fica fora por construção (não tem menor).
     *
     * @param  Builder<Agendamento>  $consulta
     * @return Builder<Agendamento>
     */
    private function ocorrencias(Builder $consulta): Builder
    {
        return $consulta
            ->where('tipo', 'atendimento')
            ->whereHas('status', fn (Builder $status) => $status->where('ocupa_horario', true));
    }

    /** `withMax` devolve datetime no agendamento e date no tratamento; a fila só usa o dia. */
    private function soData(?string $valor): ?string
    {
        return $valor === null ? null : substr($valor, 0, 10);
    }

    private function diasEntre(string $de, string $ate): int
    {
        return (int) Carbon::createFromFormat('Y-m-d', $de)
            ->diffInDays(Carbon::createFromFormat('Y-m-d', $ate));
    }
}
