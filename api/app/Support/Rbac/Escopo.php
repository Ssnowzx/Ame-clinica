<?php

namespace App\Support\Rbac;

use Illuminate\Contracts\Database\Query\Expression;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Log;

/**
 * O escopo de autorização de um usuário sobre um eixo (agenda ou clínico) — parecer SEC-VP-01.
 *
 * TRÊS estados EXPLÍCITOS (nunca `?int`: `null` fundiria "plano" e "nenhum", e o fail-closed
 * decairia para fail-open num refactor, sem teste vermelho — SEC-VP-03):
 *  - `plano()`  → enxerga/muta tudo (papel com a flag `ver_todos`, ou console/job sem usuário);
 *  - `de($id)`  → só os registros do profissional `$id` (usuário vinculado, papel sem a flag);
 *  - `nenhum()` → FAIL-CLOSED: leituras vazias, mutações 403 (papel sem a flag, usuário SEM vínculo).
 *
 * O sentinela do fail-closed vive AQUI, num método só — não espalhado pelos controllers.
 */
final class Escopo
{
    private function __construct(
        /** @var 'plano'|'de'|'nenhum' */
        private readonly string $tipo,
        private readonly ?int $profissionalId,
    ) {}

    public static function plano(): self
    {
        return new self('plano', null);
    }

    public static function de(int $profissionalId): self
    {
        return new self('de', $profissionalId);
    }

    public static function nenhum(): self
    {
        return new self('nenhum', null);
    }

    /**
     * Aplica o filtro à query: `plano` não toca; `de` filtra pela coluna; `nenhum` zera.
     *
     * A "coluna" pode ser uma EXPRESSÃO (`DB::raw`) quando o dono não é uma coluna só: em
     * `recebido-por-profissional` o dono é quem atendeu a sessão OU, sem sessão, o dono do
     * pacote — um `COALESCE`. Filtrar por uma das duas colunas entregaria a um o pagamento do
     * outro; é a MESMA expressão que atribui que tem de escopar. `NULL` nunca é igual ao id,
     * então o escopado não vê o que não tem dono.
     *
     * @template TModel of \Illuminate\Database\Eloquent\Model
     *
     * @param  Builder<TModel>  $query
     * @return Builder<TModel>
     */
    public function aplicar(Builder $query, string|Expression $coluna = 'profissional_id'): Builder
    {
        return match ($this->tipo) {
            'plano' => $query,
            'de' => $query->where($coluna, $this->profissionalId),
            'nenhum' => $query->whereRaw('0 = 1'),
        };
    }

    /**
     * Como `aplicar`, mas o dono está numa RELAÇÃO, não numa coluna da própria tabela.
     *
     * É o eixo CLÍNICO (SEC-VP-05): o dono do atendimento/evolução é o `profissional_id` do
     * agendamento-mãe, e a tabela consultada (`atendimentos`, `evolucoes`) não carrega essa
     * coluna. Um `whereHas` correlaciona sem `join` — nada de clobber de coluna na paginação.
     * O `match` mora AQUI (não no controller): `plano` não toca; `de` exige a relação do
     * próprio; `nenhum` zera (fail-closed), sem o controller nunca ver o `profissionalId` cru.
     *
     * @template TModel of \Illuminate\Database\Eloquent\Model
     *
     * @param  Builder<TModel>  $query
     * @return Builder<TModel>
     */
    public function aplicarNaRelacao(Builder $query, string $relacao, string $coluna = 'profissional_id'): Builder
    {
        return match ($this->tipo) {
            'plano' => $query,
            'de' => $query->whereHas($relacao, fn (Builder $q) => $q->where($coluna, $this->profissionalId)),
            'nenhum' => $query->whereRaw('0 = 1'),
        };
    }

    /** Garante posse de UM registro cujo dono é `$donoId`; aborta 403 se fora do escopo. */
    public function assegurarPosse(?int $donoId): void
    {
        if ($this->permite($donoId)) {
            return;
        }

        // A TENTATIVA DE ESCALADA HORIZONTAL DEIXA RASTRO (`SEC-VP-34`, rodada 3 do gate).
        // Com a posse decidida no `authorize()`, um escopado pedindo o profissional de um colega
        // passou a levar 403 daqui — e daqui não saía registro nenhum: **nenhuma** tentativa de
        // escalada horizontal aparecia no canal `seguranca`, só a recusa por vínculo da criança
        // (`vinculo_previo.bloqueado`, e só quando ela também não era dele). O que a change
        // vendia como "a recusa é auditada" deixava de fora justamente a recusa que interessa.
        //
        // `$donoId === null` é registro INEXISTENTE, não tentativa de escalada: o id que o
        // escopado digitou não existe, e depois do `SEC-VP-40` ele recebe 403 igual ao do colega —
        // ou seja, não aprende nada e não está sondando dono nenhum. Registrar isso encheria o
        // canal com typo (`SEC-VP-43`). A mesma regra vale na perna clínica de
        // `EscopoDoProfissional::assegurarPosseDoProfissional` e em `assegurarAlgum` abaixo — a
        // rodada 4 achou as duas gravando o typo (CR4-02, SEC-VP-47).
        if ($donoId === null) {
            abort(403, 'Fora do seu escopo de profissional.');
        }

        $this->registrarPosseNegada($donoId);

        abort(403, 'Fora do seu escopo de profissional.');
    }

    /**
     * O registro no canal `seguranca` — um só lugar para a whitelist de campos.
     *
     * Nenhum id de criança entra: aqui só trafega id de PROFISSIONAL, que não é dado de menor.
     */
    private function registrarPosseNegada(int $donoTentadoId): void
    {
        Log::channel('seguranca')->warning('escopo.posse_negada', [
            'usuario_id' => Auth::id(),
            'profissional_do_escopo_id' => $this->profissionalId(),
            'profissional_tentado_id' => $donoTentadoId,
            'ip' => request()->ip(),
        ]);
    }

    /**
     * Garante que o escopo alcança PELO MENOS UM dos donos (evolução: autor/RT/atendente — SEC-VP-05).
     *
     * @param  list<int|null>  $donoIds
     */
    public function assegurarAlgum(array $donoIds): void
    {
        $donos = array_values(array_map('intval', array_filter($donoIds, fn ($d) => $d !== null)));

        $ok = match ($this->tipo) {
            'plano' => true,
            'de' => in_array($this->profissionalId, $donos, true),
            'nenhum' => false,
        };
        if ($ok) {
            return;
        }

        // Mesmo contrato de `assegurarPosse` (`SEC-VP-47`, rodada 4): a recusa do prontuário do
        // colega deixa rastro; a de registro INEXISTENTE (lista de donos vazia) não — é typo.
        // O `profissional_tentado_id` é o PRIMEIRO dono da lista — o autor da evolução, na ordem
        // que `EvolucaoController::donos()` fixa (autor, RT, atendente). Com RT ≠ autor, o canal
        // registra o autor; a lista inteira não entra porque o campo é um id, e a whitelist do
        // canal é fechada por teste.
        if ($donos !== []) {
            $this->registrarPosseNegada($donos[0]);
        }

        abort(403, 'Fora do seu escopo de profissional.');
    }

    /** Verdadeiro se o escopo alcança um registro do dono `$donoId` (sem abortar). */
    public function permite(?int $donoId): bool
    {
        return match ($this->tipo) {
            'plano' => true,
            'de' => $donoId !== null && $donoId === $this->profissionalId,
            'nenhum' => false,
        };
    }

    public function ehPlano(): bool
    {
        return $this->tipo === 'plano';
    }

    /** O `profissional_id` alvo quando escopado; `null` em plano/nenhum. */
    public function profissionalId(): ?int
    {
        return $this->profissionalId;
    }
}
