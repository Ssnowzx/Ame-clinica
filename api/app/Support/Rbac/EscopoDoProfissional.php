<?php

namespace App\Support\Rbac;

use App\Models\Agendamento;
use App\Models\Tratamento;
use App\Models\Usuario;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Log;

/**
 * Fonte ÚNICA do escopo por vínculo profissional (D11 · parecer SEC-VP-01).
 *
 * Traduz o usuário autenticado num `Escopo` por EIXO (agenda × clínico), pela regra
 * GATED-PELA-FLAG — o escopo é decidido pela AUSÊNCIA da flag no papel, não pela presença do
 * vínculo (SEC-VP-02: o contrário abriria fail-open quando falta o vínculo):
 *
 *   papel TEM a flag `ver_todos`            → plano   (o vínculo é irrelevante)
 *   papel NÃO tem, usuário TEM vínculo       → de(id)  (escopado ao próprio profissional)
 *   papel NÃO tem, usuário SEM vínculo       → nenhum  (FAIL-CLOSED — nunca "plano")
 *   sem usuário (console/job)                → plano
 *
 * A regra vive AQUI e em lugar nenhum mais — um controller que precise do escopo pede a esta
 * fonte (lição WHITELIST-do-menor / SEC-PD-04). A guarda de idioma reprova quem esquecer.
 */
final class EscopoDoProfissional
{
    public function agenda(?Usuario $usuario): Escopo
    {
        return $this->escopo($usuario, 'agenda.ver_todos');
    }

    public function clinico(?Usuario $usuario): Escopo
    {
        return $this->escopo($usuario, 'clinico.ver_todos');
    }

    private function escopo(?Usuario $usuario, string $flag): Escopo
    {
        if ($usuario === null || $usuario->can($flag)) {
            return Escopo::plano();
        }

        return $usuario->profissional_id !== null
            ? Escopo::de((int) $usuario->profissional_id)
            : Escopo::nenhum();
    }

    /**
     * A INTERSEÇÃO dos dois eixos — para a vista que mistura dado da agenda com dado clínico
     * (a produtividade do profissional: capacidade e marcações são da agenda; "realizado" é a
     * situação clínica da sessão). Quem é plano num eixo e escopado no outro enxerga SÓ o que os
     * dois permitem: `nenhum` em qualquer eixo → `nenhum` (fail-closed vence); `de(id)` em
     * qualquer eixo → `de(id)`; só os dois planos → plano. Os dois `de` carregam o MESMO id por
     * construção (vêm do mesmo `profissional_id`), então devolver o mais restrito basta.
     *
     * A composição mora AQUI, na fonte única, e não no chamador (SEC-VP-03/04): copiada no
     * controller, é onde o fail-closed decai para fail-open num refactor.
     */
    public function agendaEClinico(?Usuario $usuario): Escopo
    {
        $agenda = $this->agenda($usuario);
        $clinico = $this->clinico($usuario);

        if ($this->ehNenhum($agenda) || $this->ehNenhum($clinico)) {
            return Escopo::nenhum();
        }

        return $agenda->ehPlano() ? $clinico : $agenda;
    }

    /**
     * `nenhum` é o terceiro estado: nem plano, nem alvo — o sentinela do fail-closed.
     *
     * PÚBLICO desde a change `selo-de-evolucao-na-ficha` (achado do gate r3): o controller do
     * selo precisava saber se ALGUMA linha receberia o sinal e havia copiado
     * `ehPlano() || profissionalId() !== null` para dentro de si — exatamente a cópia que o
     * docblock de `agendaEClinico` proíbe ("copiada no controller, é onde o fail-closed decai
     * para fail-open num refactor"). O predicado mora aqui, e quem precisa dele pergunta.
     */
    public function ehNenhum(Escopo $escopo): bool
    {
        return ! $escopo->ehPlano() && $escopo->profissionalId() === null;
    }

    /**
     * Paciente é "do profissional" ⇔ EXISTS em `agendamentos` OU `tratamentos` com o mesmo
     * `profissional_id` (SEC-VP-04). Criança é multidisciplinar: não é "dono único". Agendamentos
     * cobre passado E futuro marcado (preparar a 1ª sessão); tratamentos cobre contrato sem agenda.
     */
    public function pacienteDoProfissional(int $profissionalId, int $pacienteId): bool
    {
        return Agendamento::where('profissional_id', $profissionalId)
            ->where('paciente_id', $pacienteId)
            ->exists()
            || Tratamento::where('profissional_id', $profissionalId)
                ->where('paciente_id', $pacienteId)
                ->exists();
    }

    /**
     * O escopo ENXERGA este paciente? — o predicado, sem abortar.
     *
     * A composição `ehPlano()` + `profissionalId()` + `pacienteDoProfissional()` mora AQUI, na
     * fonte única, e não copiada em cada chamador (SEC-VP-03/04: cópia do branching é onde o
     * fail-closed decai para fail-open num refactor). `plano` passa; `de(id)` exige que o paciente
     * seja do profissional (EXISTS agendamentos ∪ tratamentos); `nenhum` nunca enxerga.
     *
     * Existe separado do `assegurarPaciente` porque nem todo chamador quer 403: o eixo PACIENTE
     * do conflito da agenda (change `conflito-do-paciente`, D8) precisa **calar**, não recusar —
     * recusar seria o mesmo oráculo com outra roupa. O branching é um só; o que muda é a reação.
     */
    public function enxergaPaciente(Escopo $escopo, ?int $pacienteId): bool
    {
        if ($escopo->ehPlano()) {
            return true;
        }

        // `null` é criança INEXISTENTE (o id da rota não resolveu). Para o escopado a resposta é a
        // mesma da criança alheia — 403 — e é isso que fecha o oráculo `403 × 404` das leituras por
        // paciente (`SEC-VP-46`): o `findOrFail` antes do portão contava se a criança existe, e para
        // criança com alta (que a seleção esconde de propósito) isso era a única confirmação.
        $profissionalId = $escopo->profissionalId();

        return $pacienteId !== null
            && $profissionalId !== null
            && $this->pacienteDoProfissional($profissionalId, $pacienteId);
    }

    /**
     * Restringe uma consulta de PACIENTES ao que o escopo enxerga — a versão em lista do
     * `enxergaPaciente`, com o mesmo predicado (`EXISTS` em agendamentos ∪ tratamentos).
     *
     * Nasceu para a seleção de pacientes da agenda (`SEC-VP-36`): a caixa oferecia, na seção
     * plana, a criança que o servidor ia recusar como inexistente — a cegueira da recusa estava
     * certa, o convite é que estava errado. `plano` não toca; `de(id)` exige o vínculo; `nenhum`
     * zera (fail-closed).
     *
     * @template TModel of \Illuminate\Database\Eloquent\Model
     *
     * @param  Builder<TModel>  $consulta  consulta sobre `pacientes`
     * @return Builder<TModel>
     */
    public function restringirAosPacientesDoEscopo(Escopo $escopo, Builder $consulta): Builder
    {
        if ($escopo->ehPlano()) {
            return $consulta;
        }

        $profissionalId = $escopo->profissionalId();

        if ($profissionalId === null) {
            return $consulta->whereRaw('0 = 1');
        }

        return $consulta->where(fn (Builder $q) => $q
            ->whereHas('agendamentos', fn (Builder $a) => $a->where('profissional_id', $profissionalId))
            ->orWhereHas('tratamentos', fn (Builder $t) => $t->where('profissional_id', $profissionalId)));
    }

    /**
     * O usuário pode VINCULAR-SE a este paciente? — o predicado da trava de vínculo prévio.
     *
     * Difere de `enxergaPaciente` em dois pontos, e os dois vieram do gate (rodada 1):
     *
     * 1. **Consulta os DOIS eixos, não só o da agenda** (SEC-VP-12). As flags `agenda.ver_todos`
     *    e `clinico.ver_todos` são aditivas e INDEPENDENTES por desenho: existe papel plano na
     *    agenda e escopado no clínico. Perguntando só à agenda, esse papel escapava da trava e
     *    ganhava, pela escrita, a leitura clínica (anamnese, resumo — art. 11). Medido:
     *    `/resumo` 403 → `POST /agendamentos` 201 → `/resumo` 200.
     * 2. **Só o escopo `de(id)` restringe.** `plano` não constrange (é a recepção, que é quem
     *    marca na clínica) e `nenhum` também não — ali quem barra é o portão do controller, e
     *    tratar `nenhum` como recusa aqui reprovaria a recepção SEM vínculo no eixo clínico, que
     *    é a configuração normal dela. Fail-closed continua morando onde sempre morou.
     */
    public function podeVincularPaciente(?Usuario $usuario, int $pacienteId): bool
    {
        foreach ([$this->agenda($usuario), $this->clinico($usuario)] as $escopo) {
            $profissionalId = $escopo->profissionalId();

            if ($profissionalId !== null && ! $this->pacienteDoProfissional($profissionalId, $pacienteId)) {
                return false;
            }
        }

        return true;
    }

    /**
     * POSSE DE UM PROFISSIONAL, pelos DOIS eixos — e a assimetria entre eles é o ponto.
     *
     * `Escopo::assegurarPosse` responde por UM eixo. Usá-lo só com o da agenda deixou aberto o
     * `SEC-VP-31` (rodada 3): quem é **plano na agenda** e **escopado no clínico** criava pacote
     * em nome de um COLEGA e, com isso, destrancava o prontuário da criança para ele — dado de
     * saúde de MENOR (art. 11) concedido a terceiro sem passar pela recepção, que é justamente o
     * controle que a clínica declarou.
     *
     * A armadilha, nomeada pelo gate antes de alguém cair nela: **trocar cru para `clinico()`
     * quebra a recepção.** Um papel com `agenda.ver_todos`, sem `clinico.ver_todos` e sem vínculo
     * é `nenhum` no eixo clínico — e `nenhum` reprova em `assegurarPosse`. A recepção pararia de
     * cadastrar pacote.
     *
     * Daí a forma: o eixo da **agenda** decide como sempre (plano passa, `de(id)` exige, `nenhum`
     * barra — é ele que fecha o `SEC-VP-21(ii)`); o eixo **clínico** só acrescenta restrição
     * quando devolve `de(id)`. Plano e `nenhum` no clínico não constrangem, como em
     * `podeVincularPaciente`.
     *
     * QUANDO chamar (rodada 4, `SEC-VP-44`): só sobre o profissional que a operação VINCULA a uma
     * criança — criar agendamento/pacote, trocar a criança ou trocar o dono. A posse do registro
     * que JÁ EXISTE (ler, remarcar, mudar status, apagar) é do eixo da agenda sozinho, via
     * `agenda()->assegurarPosse()`: remarcar não concede vínculo a ninguém. A rodada 3 aplicou os
     * dois eixos também ao id da rota, e quem é plano na agenda e escopado no clínico perdeu a
     * remarcação da sessão do colega — sobrou-lhe só apagar, que é a pior das escritas.
     */
    public function assegurarPosseDoProfissional(?Usuario $usuario, int $donoId): void
    {
        $this->agenda($usuario)->assegurarPosse($donoId);

        $clinico = $this->clinico($usuario)->profissionalId();

        if ($clinico === null || $clinico === $donoId) {
            return;
        }

        // `int`, não `?int` (CR4-02, rodada 4): enquanto o id da ROTA passava por aqui, um `PUT`
        // sobre agendamento inexistente chegava com `null`, a perna da agenda pulava o registro
        // (`SEC-VP-43`) e esta gravava `profissional_tentado_id: null` — o typo virava "escalada".
        // Com a posse do registro existente no eixo da agenda (`SEC-VP-44`), só chega aqui o id
        // que o payload INFORMOU — e id informado que não é o próprio é sondagem, não typo.

        // A PERNA CLÍNICA TAMBÉM REGISTRA (`SEC-VP-41`). A da agenda já registrava, por dentro do
        // `Escopo::assegurarPosse`; esta abortava cru — ou seja, o caminho que acabou de ser
        // fechado, o do art. 11, era justamente o que NÃO aparecia no canal. Medido pelo gate:
        // recusa pelo eixo clínico = 0 registros, pelo eixo agenda = 1.
        Log::channel('seguranca')->warning('escopo.posse_negada', [
            'usuario_id' => Auth::id(),
            'profissional_do_escopo_id' => $clinico,
            'profissional_tentado_id' => $donoId,
            'ip' => request()->ip(),
        ]);

        abort(403, 'Fora do seu escopo de profissional.');
    }

    /**
     * PORTÃO por-id da leitura de UM paciente (anamnese, comparecimento, resumo — art. 11).
     *
     * `plano` passa; `de(id)` exige que o paciente seja do profissional; `nenhum` sempre barra.
     * O branching vive em `enxergaPaciente`; aqui fica só a reação (403).
     */
    public function assegurarPaciente(Escopo $escopo, ?int $pacienteId): void
    {
        if (! $this->enxergaPaciente($escopo, $pacienteId)) {
            abort(403, 'Fora do seu escopo de profissional.');
        }
    }
}
