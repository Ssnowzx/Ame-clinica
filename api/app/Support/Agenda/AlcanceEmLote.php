<?php

namespace App\Support\Agenda;

use App\Models\Agendamento;
use App\Models\Atendimento;
use App\Support\Configuracoes\ConfiguracaoService;
use Carbon\CarbonImmutable;
use Closure;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Collection;
use Illuminate\Validation\ValidationException;

/**
 * A espinha de LEITURA das operações em lote da agenda de um profissional (change
 * `baixa-em-lote-por-status`, D1): o alcance de atendimentos num intervalo, o período
 * manhã/tarde/dia, o teto de linhas, os atendimentos registrados e as crianças distintas.
 *
 * Nasceu EXTRAÍDA do `DesmarqueEmLote`, não copiada: o desmarque e a baixa por status leem a
 * agenda do mesmo jeito e diferem só no que fazem com ela. Duas cópias da mesma régua é como o
 * gate já achou o teto de dias decorativo uma vez — a régua vive num lugar só.
 *
 * Esta classe NÃO escreve e NÃO classifica: quem decide o que é elegível é cada operação.
 *
 * `$sobLock` é a diferença entre a prévia e a execução (D7): na execução, as linhas de
 * `agendamentos` e depois as de `atendimentos` são travadas em `id` crescente — a ordem da casa
 * (`AgendamentoService::guardasClinicas`) — ANTES de qualquer loop, para que um atendimento
 * registrado por outra conexão durante o lote não vire falta por baixo dele.
 */
class AlcanceEmLote
{
    public const PERIODOS = ['manha', 'tarde', 'dia'];

    public function __construct(private readonly ConfiguracaoService $configuracoes) {}

    /** @throws ValidationException período fora de `PERIODOS` */
    public function assegurarPeriodo(string $periodo): void
    {
        if (! in_array($periodo, self::PERIODOS, true)) {
            throw ValidationException::withMessages([
                'periodo' => 'Período inválido: use manha, tarde ou dia.',
            ]);
        }
    }

    /**
     * O intervalo fechado do alcance, do começo do primeiro dia ao fim do último.
     *
     * @return array{0: CarbonImmutable, 1: CarbonImmutable}
     *
     * @throws ValidationException intervalo invertido
     */
    public function intervalo(string $de, string $ate): array
    {
        $inicio = CarbonImmutable::parse($de)->startOfDay();
        $fim = CarbonImmutable::parse($ate)->endOfDay();

        if ($fim->lessThan($inicio)) {
            throw ValidationException::withMessages([
                'ate' => 'A data final não pode ser anterior à inicial.',
            ]);
        }

        return [$inicio, $fim];
    }

    /**
     * Os ATENDIMENTOS do profissional no intervalo e no período, na ordem `inicio, id` — a
     * mesma em que a execução vai percorrê-los. Bloqueios ficam fora pelo TIPO: não têm status
     * nem paciente, e desmarcar um bloqueio seria desfazer o que o próprio desmarque produz.
     *
     * A operação pode estreitar o alcance de duas formas que andam JUNTAS: `$refinar` (SQL) só
     * ESTREITA a leitura; `$aceita` (PHP, sobre a linha lida) DECIDE — é aplicado sempre, nas
     * duas trilhas, e é a última palavra sobre quem entra. Se um dia as duas formas divergirem,
     * quem manda é `$aceita`; a SQL nunca deixa entrar quem o PHP recusaria.
     *
     * Sob lock, a leitura é em DOIS passos, ANCORADA NA PK — como `guardasClinicas` faz:
     * primeiro os ids do alcance pelo índice, sem lock; depois `whereIn('id', ids)` em `id`
     * crescente (ordem estável entre transações concorrentes → sem deadlock) com `FOR UPDATE`
     * e NENHUM outro predicado — e o predicado inteiro é reaplicado em memória sobre a linha
     * travada (a versão mais recente comitada), para que quem mudou entre os dois passos
     * (status virou não-aberto, horário saiu do intervalo) caia fora sob lock.
     *
     * Por que a consulta travante tem SÓ a PK (achado PERF-02 do gate): com o predicado da
     * faixa e o `status_id IN (subconsulta)` na mesma consulta `FOR UPDATE`, o plano do
     * otimizador dependia do tamanho da tabela — até ~10 linhas ia pelo índice do profissional;
     * de 12 a 15 varria a PK inteira; de 18 em diante entrava pelo índice de `status_id` — e
     * nos dois últimos travava agendamentos de OUTROS profissionais pela
     * duração do lote (medido: um UPDATE de outro profissional esperando 1,2 s com 102 linhas).
     * Só com a PK, o lote trava exatamente o que vai escrever. O que se PERDE, de propósito: os
     * next-key locks da faixa — um agendamento inserido no intervalo DURANTE a transação não
     * espera e simplesmente fica de fora do lote, como já ficaria se nascesse depois do commit.
     *
     * @param  Closure(Builder<Agendamento>): void|null  $refinar  estreita a LEITURA (SQL)
     * @param  Closure(Agendamento): bool|null  $aceita  decide quem ENTRA (PHP), na linha lida
     * @return Collection<int, Agendamento>
     */
    public function atendimentosDoProfissional(
        int $profissionalId,
        CarbonImmutable $inicio,
        CarbonImmutable $fim,
        string $periodo,
        bool $sobLock,
        ?Closure $refinar = null,
        ?Closure $aceita = null,
    ): Collection {
        $predicado = function (Builder $consulta) use ($profissionalId, $inicio, $fim, $refinar): Builder {
            $consulta
                ->where('profissional_id', $profissionalId)
                ->where('tipo', 'atendimento')
                ->whereBetween('inicio', [$inicio, $fim]);

            if ($refinar !== null) {
                $refinar($consulta);
            }

            return $consulta;
        };

        $alcancados = $sobLock
            ? $this->travadosPelaPk($predicado)
            : $predicado(Agendamento::query())->orderBy('inicio')->orderBy('id')->get();

        return $alcancados
            ->filter(fn (Agendamento $a) => (int) $a->profissional_id === $profissionalId
                && $a->tipo === 'atendimento'
                && $a->inicio->betweenIncluded($inicio, $fim)
                && ($aceita === null || $aceita($a))
                && $this->dentroDoPeriodo($a, $periodo))
            ->sortBy([['inicio', 'asc'], ['id', 'asc']])
            ->values();
    }

    /**
     * A leitura TRAVANTE do alcance: ids pelo predicado (sem lock), depois `whereIn` na PK +
     * `FOR UPDATE` em `id` crescente, sem outro predicado — o plano é sempre a PK, e o filtro
     * fica com quem chamou, em memória. Vazio ⇒ nenhuma consulta travante.
     *
     * @param  Closure(Builder<Agendamento>): Builder<Agendamento>  $predicado
     * @return Collection<int, Agendamento>
     */
    private function travadosPelaPk(Closure $predicado): Collection
    {
        $ids = $predicado(Agendamento::query())->orderBy('inicio')->orderBy('id')->pluck('id');

        if ($ids->isEmpty()) {
            return collect();
        }

        return Agendamento::whereIn('id', $ids)->orderBy('id')->lockForUpdate()->get();
    }

    /**
     * O teto de LINHAS da operação, lido da chave §13 de cada operação e comparado no SERVIDOR:
     * é o único freio contra o gesto que alcança um semestre, e guarda que mora só no cliente
     * não é guarda. O número comparado tem de ser o MAIOR número que a operação grava.
     *
     * @param  Closure(int, int): string|null  $mensagem  recebe (total, teto); cada operação
     *                                                    nomeia suas dimensões (o desmarque conta bloqueios)
     *
     * @throws ValidationException em `ate`, acima do teto
     */
    public function assegurarTeto(int $total, string $chave, ?Closure $mensagem = null): void
    {
        $teto = (int) $this->configuracoes->get($chave);
        if ($total <= $teto) {
            return;
        }

        throw ValidationException::withMessages([
            'ate' => $mensagem !== null
                ? $mensagem($total, $teto)
                : "A operação alcançaria {$total} agendamentos e o máximo por operação é {$teto}. Estreite as datas.",
        ]);
    }

    /**
     * Os atendimentos registrados sobre o lote, em UMA consulta (nada de N+1 por linha),
     * indexados pelo id do agendamento. Sob lock, leitura TRAVANTE em `id` crescente —
     * `->exists()` não serve, o Eloquent o embrulha em `select exists(...)` e o lock se perde.
     *
     * @param  Collection<int, Agendamento>  $agendamentos
     * @return Collection<int, Atendimento>
     */
    public function atendimentosRegistrados(Collection $agendamentos, bool $sobLock): Collection
    {
        $consulta = Atendimento::whereIn('agendamento_id', $agendamentos->pluck('id'))->orderBy('id');

        if ($sobLock) {
            $consulta->lockForUpdate();
        }

        return $consulta->get(['id', 'agendamento_id', 'finalizado_em'])->keyBy('agendamento_id');
    }

    /**
     * CRIANÇAS distintas, não agendamentos: "8 agendamentos" esconde que são 5 famílias, e é o
     * número de famílias que dimensiona o estrago de um engano.
     *
     * @param  Collection<int, Agendamento>  $agendamentos
     */
    public function criancasDistintas(Collection $agendamentos): int
    {
        return $agendamentos->pluck('paciente_id')->filter()->unique()->count();
    }

    /** A fronteira manhã/tarde em minutos é regra da CLÍNICA (§13), nunca meio-dia hardcoded. */
    public function corte(): int
    {
        return self::minutos((string) $this->configuracoes->get('agenda.corte_manha_tarde'));
    }

    /** `HH:MM` → minutos desde a meia-noite. */
    public static function minutos(string $hora): int
    {
        [$h, $m] = array_pad(explode(':', $hora), 2, '0');

        return ((int) $h) * 60 + (int) $m;
    }

    private function dentroDoPeriodo(Agendamento $agendamento, string $periodo): bool
    {
        if ($periodo === 'dia') {
            return true;
        }

        $minutos = $agendamento->inicio->hour * 60 + $agendamento->inicio->minute;

        return $periodo === 'manha' ? $minutos < $this->corte() : $minutos >= $this->corte();
    }
}
