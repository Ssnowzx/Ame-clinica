<?php

namespace App\Support\Agenda;

use App\Models\Agendamento;
use App\Models\LembreteEnviado;
use App\Support\Configuracoes\ConfiguracaoService;
use Illuminate\Support\Collection;

/**
 * O que o card mostra da resposta da família ao lembrete (change `lembrete-com-botoes-de-resposta`,
 * design D8): `aguardando`, `confirmado`, `pediu_desmarque` ou `nao_entregue` — ou nada. E, desde a
 * change `telefone-que-chega-no-whatsapp` (D4), `nao_enviado`: o lembrete daquela data NÃO saiu, por
 * um motivo que não é decisão (telefone inválido, sem telefone, teto…), com o motivo junto.
 *
 * Decidido AQUI, não na tela: a tela só escolhe o ícone. E só existe para a sessão que ainda está
 * MARCADA (ocupa o horário, não é reserva) e cujo lembrete é DAQUELA data — remarcar para outro dia
 * ou desmarcar apaga o estado sem escrita nenhuma (design D1).
 *
 * Lê o que o período já carregou (`lembretesEnviados.mensagem`): nenhuma consulta por card.
 */
class EstadoDaConfirmacao
{
    /**
     * Os estados que a clínica confirma pela família (change `confirmacao-pela-clinica`, D3). O pedido
     * de desmarque tem a saída própria ("Manter a sessão").
     */
    public const CONFIRMAVEIS_PELA_CLINICA = ['aguardando', 'nao_entregue', 'nao_enviado'];

    /**
     * As relações que o período carrega para este estado, sem N+1.
     *
     * @return array<string, callable>
     */
    public static function relacoes(): array
    {
        return [
            'lembretesEnviados' => fn ($lembretes) => $lembretes
                ->where('tipo', LembreteEnviado::TIPO_AGENDAMENTO)
                ->whereIn('status', [LembreteEnviado::ENVIADO, LembreteEnviado::NAO_ENVIADO])
                ->select(['id', 'agendamento_id', 'paciente_id', 'tipo', 'status', 'competencia', 'inicio_lembrado', 'mensagem_id', 'resposta', 'respondido_em', 'confirmado_por', 'motivo'])
                ->with('mensagem:id,status'),
        ];
    }

    /**
     * `confirmavel` vem só nos estados que a clínica confirma, e diz se a ação vale AGORA (gate r1,
     * CR-CC-04): a tela não decide sozinha, senão o botão aparecia na sessão que já começou e o
     * servidor sempre recusava.
     *
     * @return array{estado: string, em: string|null, motivo?: string, por?: string, confirmavel?: bool}|null
     */
    public static function de(Agendamento $agendamento): ?array
    {
        if ($agendamento->tipo === 'bloqueio') {
            return null;
        }

        $linha = self::linhaDoCard($agendamento, $agendamento->lembretesEnviados);
        if ($linha === null) {
            return null;
        }

        $estado = self::estadoDaLinha($linha);
        if (in_array($estado['estado'], self::CONFIRMAVEIS_PELA_CLINICA, true)) {
            $estado['confirmavel'] = self::aindaVaiAcontecer($agendamento);
        }

        return $estado;
    }

    /**
     * A sessão ainda vai acontecer, na hora de PAREDE da clínica — a mesma régua do toque da família
     * (`RespostaAoLembrete::aindaVale`). O `inicio` é a parede da clínica, sem fuso: comparar com
     * `now()` do servidor (UTC) recusaria a sessão de daqui a duas horas.
     */
    public static function aindaVaiAcontecer(Agendamento $agendamento): bool
    {
        $agora = now((string) app(ConfiguracaoService::class)->get('clinica.timezone'))->format('Y-m-d H:i');

        return $agendamento->inicio !== null && $agendamento->inicio->format('Y-m-d H:i') > $agora;
    }

    /**
     * A linha de lembrete que o card mostra — a regra ÚNICA do card e da confirmação pela clínica
     * (change `confirmacao-pela-clinica`, D2), para a tela e o servidor não discordarem do que é "sem
     * resposta":
     * - a ENVIADA que vale para a sessão (`LembreteEnviado::valeParaASessao`: mesma criança, mesmo
     *   horário, ainda marcada) — trocar a criança ou remarcar apaga o estado sem escrita nenhuma;
     * - sem ela, a NÃO enviada que fala da sessão e cujo motivo não é decisão (D4 da change
     *   telefone-que-chega-no-whatsapp): o motivo manda a recepção ao cadastro ou ao telefone.
     *
     * @param  Collection<int, LembreteEnviado>  $linhas
     */
    public static function linhaDoCard(Agendamento $agendamento, Collection $linhas): ?LembreteEnviado
    {
        $doLembrete = $linhas->where('tipo', LembreteEnviado::TIPO_AGENDAMENTO);

        return $doLembrete->first(fn (LembreteEnviado $linha): bool => $linha->valeParaASessao($agendamento))
            ?? $doLembrete->first(
                fn (LembreteEnviado $linha): bool => $linha->status === LembreteEnviado::NAO_ENVIADO
                    && ! in_array($linha->motivo, LembreteEnviado::MOTIVOS_DE_DECISAO, true)
                    && $linha->falaDaSessao($agendamento),
            );
    }

    /**
     * O estado de uma linha que `linhaDoCard` escolheu. A confirmação vem antes de tudo, inclusive da
     * linha NÃO enviada: a família que não recebeu o lembrete pode ter confirmado com a clínica por
     * telefone. `por` diz de quem veio — a coluna, nunca derivada (D1).
     *
     * @return array{estado: string, em: string|null, motivo?: string, por?: string}
     */
    public static function estadoDaLinha(LembreteEnviado $linha): array
    {
        if ($linha->resposta === LembreteEnviado::CONFIRMOU) {
            return [
                'estado' => 'confirmado',
                'em' => $linha->respondido_em?->toIso8601String(),
                'por' => $linha->confirmado_por === null ? 'familia' : 'clinica',
            ];
        }

        if ($linha->status === LembreteEnviado::NAO_ENVIADO) {
            return ['estado' => 'nao_enviado', 'em' => null, 'motivo' => (string) $linha->motivo];
        }

        return match (true) {
            $linha->resposta === LembreteEnviado::PEDIU_DESMARQUE => ['estado' => 'pediu_desmarque', 'em' => $linha->respondido_em?->toIso8601String()],
            $linha->mensagem?->status === 'falhou' => ['estado' => 'nao_entregue', 'em' => null],
            default => ['estado' => 'aguardando', 'em' => null],
        };
    }
}
