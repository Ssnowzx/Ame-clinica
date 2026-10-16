<?php

namespace App\Support\Clinica;

use App\Models\Paciente;

/**
 * Sinal MINIMIZADO de necessidade especial para o painel do agendamento (LGPD art. 11,
 * parecer SEC-NC-01). Fonte ÚNICA de DUAS coisas, para que nenhuma erode solta:
 *
 * 1. `RELACAO` — o eager-load restrito que o `show` usa para derivar o flag SEM hidratar
 *    o cadastro do menor na memória (camada 1 do `ResumoDoPaciente`). É um select PRÓPRIO
 *    (`id,necessidade`), distinto do whitelist de identidade — e por isso vive AQUI, não em
 *    `ResumoDoPaciente` (cuja lista o `WhitelistDoMenorTest` congela em id/nome/nome_social).
 *    O `id` acompanha por exigência da FK do eager-load; não é exposto.
 * 2. `flag()` — a derivação: um BOOLEANO (nunca o enum cru de saúde), verdadeiro SÓ para a
 *    categoria "necessidades especiais"; `null` quando não há paciente (bloqueio).
 *
 * O flag REBAIXA a minimização (`agenda.ver` passa a ler um bit de saúde por-agendamento) —
 * decisão gated pelo parecer. NUNCA expor via `cartao()` da grade: seria em massa (SEC-NC-02).
 */
final class NecessidadeEspecial
{
    /**
     * A ÚNICA categoria de `pacientes.necessidade` que o painel marca. Domínio FIXO
     * (`PacienteRequest::NECESSIDADES`), não configurável pela clínica — comparar ao literal
     * é seguro, desde que aqui e em nenhum outro lugar do backend.
     */
    private const CATEGORIA_MARCADA = 'necessidades_especiais';

    /** Eager-load restrito para o `show` — id (FK) + necessidade, nada do cadastro do menor. */
    public const RELACAO = 'paciente:id,necessidade';

    public static function flag(?Paciente $paciente): ?bool
    {
        return $paciente === null ? null : $paciente->necessidade === self::CATEGORIA_MARCADA;
    }
}
