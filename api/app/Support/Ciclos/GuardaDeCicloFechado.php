<?php

namespace App\Support\Ciclos;

use App\Models\Atendimento;
use App\Models\Convenio;
use App\Models\FechamentoCiclo;
use App\Models\Tratamento;
use Carbon\CarbonImmutable;
use Closure;
use DateTimeInterface;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use LogicException;
use PDOException;

/**
 * "Este registro está em período fechado?" em UM lugar só (D3) — a fonte ÚNICA que
 * atendimento, evolução, lançamento, agendamento e tratamento consomem.
 *
 * Molde: `GuardaDeLimiteDoConvenio`. E o motivo de ser uma classe, e não uma checagem
 * copiada em cinco boundaries, é o mesmo: cinco cópias divergem em silêncio, e a divergência
 * aqui não é um aviso a menos — é produção já enviada à operadora sendo reescrita por um
 * módulo que aprendeu a regra errada. O teste CRUZADO (task 3.8) existe exatamente para
 * provar que os três módulos recusam O MESMO período; ele só é uma prova enquanto houver
 * uma implementação só.
 *
 * ## A competência de cada entidade (D3)
 *
 * - **atendimento** → seu `finalizado_em`;
 * - **evolução** → o `finalizado_em` do atendimento-mãe (ela não tem data própria);
 * - **lançamento** → sua `competencia` — a data da PRODUÇÃO, nunca `pago_em`. O ciclo do
 *   convênio é sobre o que foi atendido; com `pago_em`, a mesma sessão pularia de ciclo
 *   conforme o dia em que a operadora pagasse. O extrato de caixa segue em regime de caixa:
 *   são duas leituras do mesmo lançamento, e isso é deliberado.
 *
 * O convênio é alcançado pelo TRATAMENTO. **Sem tratamento (ou tratamento particular, sem
 * convênio) ⇒ `null`: nada trava** (fail-open do D5). O recorte do SEC-FC-16 é o que dá
 * sentido a esse fail-open: ele vale como AUSÊNCIA de vínculo, jamais como REMOÇÃO — quem
 * impede transformar registro congelado em "sem convênio" são as guardas do vínculo
 * (`AgendamentoService::guardasClinicas` e `TratamentoController`, tasks 3.5/3.6). Sem elas,
 * este `null` seria a própria porta de fuga.
 *
 * ## Por que o intervalo PERSISTIDO, e não o calendário (SEC-FC-17)
 *
 * A decisão lê `fechamentos_ciclo`, nunca `CalendarioDoCiclo`. Trocar o dia de corte do
 * convênio não pode mover a fronteira de um período JÁ fechado — senão `convenios.editar`
 * viraria chave-mestra por configuração, sem `ciclos.reabrir`, sem motivo e sem trilha.
 *
 * ## Por que a consulta dos fechamentos é uma leitura TRAVANTE (SEC-FC-10)
 *
 * Duas coisas distintas, e as duas são necessárias:
 *
 * 1. **O lock da linha do convênio** (`FechamentoDeCiclo::comLockDoConvenio`) serializa
 *    edição-vs-fechamento. O lock da linha do registro editado não serve: são tabelas
 *    diferentes, e o fechamento acontece noutra.
 * 2. **`lockForUpdate()` na consulta dos fechamentos.** Sob REPEATABLE READ, um `SELECT`
 *    comum lê o SNAPSHOT da transação — fixado na primeira leitura consistente dela, que
 *    num caminho de escrita real acontece bem antes (o `findOrFail` do controller). Sair do
 *    lock do convênio não desfaz isso: o `SELECT` comum seguinte continuaria cego ao
 *    fechamento que a outra sessão comitou enquanto esperávamos. Leitura TRAVANTE lê o
 *    último estado comitado, e é ela que fecha o TOCTOU de verdade. É por isso que a ordem
 *    de locks da casa termina em `convenios → fechamentos_ciclo`: os dois locks, nessa
 *    ordem. (Provado por mutação em `EdicaoEmCicloFechadoSobLockTest`.)
 *
 * O gap lock que essa leitura toma quando NÃO acha linha não deadlocka com o fechar: quem
 * insere em `fechamentos_ciclo` também segura o X-lock do convênio, e ninguém chega aqui
 * sem ele.
 *
 * ## Memo (e o que NÃO é memoizado)
 *
 * Memoizamos `tratamento → convenio` e o NOME do convênio: mapeamentos estáveis, e sem eles
 * uma edição em série faria N idas ao banco para reaprender a mesma coisa. Os FECHAMENTOS
 * **não** são memoizados, de propósito: memoizar uma leitura feita ANTES do lock devolveria
 * um estado pré-serialização e desfaria, por cache, exatamente o que o item 2 acima
 * conquista.
 */
final class GuardaDeCicloFechado
{
    /** Chave única do 422 nos cinco boundaries — o front reconhece uma só. */
    public const CHAVE = 'ciclo_fechado';

    /** @var array<int, int|null> tratamento_id => convenio_id (memoiza o miss também) */
    private array $memoConvenioDoTratamento = [];

    /** @var array<int, string|null> convenio_id => nome */
    private array $memoNomeDoConvenio = [];

    /**
     * Recusa (422) se QUALQUER par (tratamento, competência) cair em período fechado.
     *
     * É assim que a **dupla verificação origem→destino** (D4/SEC-FC-15) se escreve: passe os
     * dois pares. Checar só o destino deixaria "arrastar para fora" de um ciclo fechado — o
     * contorno registrado no SEC-TE-01; checar só a origem deixaria "empurrar para dentro",
     * sujando um ciclo já enviado.
     *
     * @param  list<array{0: int|null, 1: mixed}>  $pares  (tratamento_id, competência)
     *
     * @throws ValidationException
     */
    public function assegurarPorTratamento(array $pares): void
    {
        $this->assegurarPorConvenio(array_map(
            fn (array $par): array => [$this->convenioDoTratamento($par[0]), $par[1]],
            $pares,
        ));
    }

    /**
     * O mesmo, quando o chamador JÁ tem o convênio em mãos — é o caso da troca de
     * `tratamentos.convenio_id` (task 3.6), em que origem e destino são dois convênios e não
     * dois tratamentos.
     *
     * @param  list<array{0: int|null, 1: mixed}>  $pares  (convenio_id, competência)
     *
     * @throws ValidationException
     */
    public function assegurarPorConvenio(array $pares): void
    {
        $pares = array_values(array_filter(
            $pares,
            fn (array $par): bool => $par[0] !== null && self::diaDaParede($par[1]) !== null,
        ));

        if ($pares === []) {
            return; // sem convênio alcançável ou sem competência: fail-open do D5
        }

        $this->assegurarTransacaoAberta();

        // DISTINTOS e em ordem CRESCENTE de id: um caminho pode envolver dois convênios
        // (origem e destino da troca de vínculo), e dois caminhos concorrentes que os
        // travassem em ordens opostas deadlockariam. A ordem entre convênios é a mesma
        // técnica do `sort($ids)` de `guardasClinicas`.
        $convenios = array_values(array_unique(array_map(
            fn (array $par): int => (int) $par[0],
            $pares,
        )));
        sort($convenios);

        try {
            $this->sobLockDosConvenios($convenios, function () use ($pares): void {
                foreach ($pares as [$convenioId, $competencia]) {
                    $fechamento = $this->fechamentoQueContem((int) $convenioId, $competencia, travando: true);
                    if ($fechamento !== null) {
                        throw ValidationException::withMessages([
                            self::CHAVE => $this->mensagem($fechamento, (int) $convenioId),
                        ]);
                    }
                }
            });
        } catch (PDOException $excecao) {
            $this->recusarCorridaDoCiclo($excecao);
        }
    }

    /**
     * SEC-FC-14 — a troca de `tratamentos.convenio_id` contra a produção JÁ congelada.
     *
     * Mora aqui, e não no `TratamentoController`, por duas razões que se somam:
     *
     * 1. **Fonte única de novo.** A competência do atendimento é `finalizado_em` (D3). Se o
     *    controller montasse a própria consulta, a definição passaria a existir em dois
     *    lugares — e um deles envelheceria. A evolução não precisa de consulta própria pelo
     *    mesmo motivo: a competência dela é a do atendimento-mãe, então este conjunto já a
     *    cobre.
     * 2. **`Atendimento` é model sensível.** Um controller que o importa nasce fora da
     *    varredura de escopo clínico (SEC-VP-07) e precisaria entrar em
     *    `CONTROLLERS_SENSIVEIS` com todas as suas rotas classificadas — o meta-teste
     *    `EscopoPorPadraoTest` reprova exatamente isso, e ele está certo: o cadastro de
     *    tratamentos não é superfície de leitura clínica, e não deve virar uma só para
     *    responder a esta pergunta. A leitura acontece na camada de domínio, agregada, e
     *    nenhum `finalizado_em` atravessa a fronteira HTTP.
     *
     * ORIGEM **E** DESTINO: o convênio novo pode ter o período correspondente também
     * fechado, e mover produção de um ciclo enviado para dentro de outro ciclo enviado suja
     * os dois.
     *
     * @throws ValidationException
     */
    public function assegurarTrocaDeConvenioDoTratamento(int $tratamentoId, ?int $origem, ?int $destino): void
    {
        if ($origem === $destino) {
            return; // reenviar o mesmo convênio não é troca
        }

        $competencias = Atendimento::query()
            ->whereHas('agendamento', fn ($a) => $a->where('tratamento_id', $tratamentoId))
            ->pluck('finalizado_em');

        $pares = [];
        foreach ($competencias as $competencia) {
            $pares[] = [$origem, $competencia];
            $pares[] = [$destino, $competencia];
        }

        $this->assegurarPorConvenio($pares);
    }

    /**
     * O booleano DERIVADO que vai no payload de DETALHE (D7b/SEC-FC-09), para o front sumir
     * com as afordâncias de editar/excluir.
     *
     * Um booleano por registro — nunca a lista de fechamentos, nunca o calendário: a
     * afordância informa sobre o registro que o ator já pode ler, e não vira oráculo do
     * cadastro de convênios de quem não tem `convenios.ver`.
     *
     * Leitura pura: sem lock e sem exigir transação. Um `show` não serializa com nada.
     */
    public function emCicloFechado(?int $tratamentoId, mixed $competencia): bool
    {
        $convenioId = $this->convenioDoTratamento($tratamentoId);

        return $convenioId !== null
            && $this->fechamentoQueContem($convenioId, $competencia, travando: false) !== null;
    }

    /**
     * A corrida que o MOTOR recusa — traduzida em 409, jamais em 500 (SEC-FC-10/11).
     *
     * A lista de códigos, a descida pela CADEIA de causas (o savepoint de `comLockDoConvenio`
     * embrulha o erro num `DeadlockException` sem `errorInfo`) e o porquê de cada código vivem
     * em `CorridaDoMotor` — a fonte única partilhada com a espinha dos lotes
     * (`ContextoDoLote::executar`), que toma os locks ANTERIORES da ordem da casa. Duas cópias
     * da mesma lista divergiam em silêncio (achado CR-06 do gate).
     *
     * O 409 sai com CHAVE no corpo (`CorridaDoCicloException`), e não como `abort(409, ...)`:
     * o outro 409 do produto é o da concorrência otimista, e a recuperação dele é a oposta
     * ("seus dados estão velhos", releia). Indistinguíveis, o cliente teria de adivinhar pela
     * string da mensagem — que é copy, e muda sem aviso.
     *
     * **Fail-closed em todos os casos:** a exceção sobe, a transação inteira desfaz, nada é
     * gravado. O que NÃO é corrida do ciclo (um `NOT NULL` violado, por exemplo) sobe intacto:
     * erro de verdade não vira 409 por conveniência.
     */
    private function recusarCorridaDoCiclo(PDOException $excecao): never
    {
        throw CorridaDoMotor::traduzir($excecao);
    }

    /**
     * Trava os convênios um a um, na ordem recebida, e só então roda `$fn`.
     *
     * Usa `FechamentoDeCiclo::comLockDoConvenio` — o MESMO método do fechar/reabrir, como o
     * docblock daquela classe exige. Um `lockForUpdate` próprio aqui seria o segundo
     * call-site da mesma intenção, e é assim que as duas metades de uma invariante divergem.
     *
     * Cada chamada aninhada vira um SAVEPOINT (a transação de topo é do chamador), então os
     * locks acumulam e só caem no commit externo — que é precisamente o que se quer: eles
     * têm de sobreviver até a gravação.
     *
     * @param  list<int>  $convenios
     */
    private function sobLockDosConvenios(array $convenios, Closure $fn): void
    {
        if ($convenios === []) {
            $fn();

            return;
        }

        $primeiro = array_shift($convenios);
        FechamentoDeCiclo::comLockDoConvenio(
            $primeiro,
            function () use ($convenios, $fn): void {
                $this->sobLockDosConvenios($convenios, $fn);
            },
        );
    }

    /**
     * O fechamento ABERTO cuja janela contém a competência, ou `null`.
     *
     * `travando: true` no caminho de escrita — ver o docblock da classe: sem a leitura
     * travante, o snapshot de REPEATABLE READ esconderia o fechamento comitado por outra
     * sessão e a guarda gravaria dentro de um ciclo fechado.
     */
    private function fechamentoQueContem(int $convenioId, mixed $competencia, bool $travando): ?FechamentoCiclo
    {
        $dia = self::diaDaParede($competencia);
        if ($dia === null) {
            return null;
        }

        return FechamentoCiclo::query()
            ->where('convenio_id', $convenioId)
            ->whereNull('reaberto_em') // reaberto é histórico, não congelamento
            ->where('periodo_inicio', '<=', $dia)
            ->where('periodo_fim', '>=', $dia)
            ->when($travando, fn ($q) => $q->lockForUpdate())
            ->first();
    }

    /**
     * O teto da 422 (SEC-FC-07/D7b): **período + estado + caminho**.
     *
     * O NOME do convênio só entra para quem tem `convenios.ver`. Quem tem
     * `lancamentos.editar` não tem, por construção, `convenios.ver`/`tratamentos.ver`:
     * nomear a operadora ali ensinaria o vínculo paciente↔convênio — dado pessoal de menor e
     * proxy de condição de saúde. (Não contradiz o SEC-LP-01, onde o ator escolheu o
     * tratamento no próprio formulário.)
     *
     * Nunca entram: quem fechou, quando, motivos de reaberturas anteriores, contagens, ids.
     */
    private function mensagem(FechamentoCiclo $fechamento, int $convenioId): string
    {
        $periodo = sprintf(
            '%s–%s',
            $fechamento->periodo_inicio->format('d/m/Y'),
            $fechamento->periodo_fim->format('d/m/Y'),
        );

        $nome = Auth::user()?->can('convenios.ver') === true
            ? $this->nomeDoConvenio($convenioId)
            : null;

        return $nome === null
            ? sprintf('A produção deste período (%s) já foi fechada; a reabertura é do administrador.', $periodo)
            : sprintf(
                'A produção do convênio %s neste período (%s) já foi fechada; a reabertura é do administrador.',
                $nome,
                $periodo,
            );
    }

    /**
     * O convênio alcançável pelo tratamento — `null` quando não há tratamento, quando ele
     * não existe ou quando é particular.
     */
    private function convenioDoTratamento(?int $tratamentoId): ?int
    {
        if ($tratamentoId === null) {
            return null;
        }

        // `array_key_exists`, não `??=`: o miss precisa ser memoizado também — com `??=`,
        // um tratamento inexistente seria reconsultado a cada chamada (lição da irmã
        // GuardaDeLimiteDoConvenio)
        if (! array_key_exists($tratamentoId, $this->memoConvenioDoTratamento)) {
            $convenioId = Tratamento::whereKey($tratamentoId)->value('convenio_id');
            $this->memoConvenioDoTratamento[$tratamentoId] = $convenioId === null ? null : (int) $convenioId;
        }

        return $this->memoConvenioDoTratamento[$tratamentoId];
    }

    private function nomeDoConvenio(int $convenioId): ?string
    {
        if (! array_key_exists($convenioId, $this->memoNomeDoConvenio)) {
            $this->memoNomeDoConvenio[$convenioId] = Convenio::whereKey($convenioId)->value('nome');
        }

        return $this->memoNomeDoConvenio[$convenioId];
    }

    /**
     * A guarda de escrita SÓ vale dentro de uma transação do chamador.
     *
     * `comLockDoConvenio` abre a sua própria: chamada de fora de qualquer transação, ela
     * COMITA ao voltar — e solta o lock antes da gravação que ele deveria proteger. A janela
     * TOCTOU voltaria inteira, e todos os testes de recusa continuariam verdes, porque
     * recusa sequencial não depende de lock nenhum. Falha alto, com nome.
     *
     * (Em teste de feature o `RefreshDatabase` já segura uma transação, então esta checagem
     * não é o que prova o lock — quem prova são os testes de duas conexões da suíte
     * `Concorrencia` e a asserção de epoch dos testes de feature.)
     */
    private function assegurarTransacaoAberta(): void
    {
        if (DB::transactionLevel() > 0) {
            return;
        }

        throw new LogicException(
            'GuardaDeCicloFechado: caminho de escrita sem transação aberta. O lock do convênio '
            .'(SEC-FC-10) seria comitado e solto antes da gravação que ele protege — abra a '
            .'transação no chamador, como fazem os demais caminhos de escrita.'
        );
    }

    /**
     * A competência como DIA na parede da clínica (§13): as janelas do ciclo são datas do
     * calendário da clínica, e nenhuma conversão de fuso acontece aqui — os datetimes deste
     * produto já vivem nesse frame (convenção da agenda).
     */
    private static function diaDaParede(mixed $competencia): ?string
    {
        if ($competencia === null || $competencia === '') {
            return null;
        }

        if ($competencia instanceof DateTimeInterface) {
            return $competencia->format('Y-m-d');
        }

        return CarbonImmutable::parse((string) $competencia)->format('Y-m-d');
    }
}
