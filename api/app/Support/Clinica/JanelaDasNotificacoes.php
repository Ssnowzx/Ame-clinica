<?php

namespace App\Support\Clinica;

use App\Support\Configuracoes\ConfiguracaoService;

/**
 * O PISO das janelas do centro de notificações: `max(notificacoes.a_partir_de, hoje − 366 dias)`
 * na parede da clínica — a configuração aperta, NUNCA alarga (T-not-04).
 *
 * Saiu do `NotificacaoController` quando o painel do dinheiro passou a contar o MESMO "em atraso"
 * do sino (change indicadores-profissionais): duas cópias do piso seriam dois números diferentes
 * para a mesma conta atrasada.
 */
final class JanelaDasNotificacoes
{
    /** Janela máxima — a config `a_partir_de` aperta, NUNCA alarga (T-not-04). */
    public const JANELA_MAXIMA_DIAS = 366;

    public function __construct(private readonly ConfiguracaoService $configuracoes) {}

    /** O piso, "Y-m-d". */
    public function piso(): string
    {
        $tetoInferior = now($this->configuracoes->get('clinica.timezone'))
            ->subDays(self::JANELA_MAXIMA_DIAS)->toDateString();
        $aPartirDe = (string) $this->configuracoes->get('notificacoes.a_partir_de');

        return $aPartirDe !== '' && $aPartirDe > $tetoInferior ? $aPartirDe : $tetoInferior;
    }
}
