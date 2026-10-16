<?php

namespace App\Support\Agenda;

use App\Models\Agendamento;
use Illuminate\Support\Collection;
use Illuminate\Validation\ValidationException;

/**
 * A espinha de ESCRITA das operações em lote (change `baixa-em-lote-por-status`, D1): aplica um
 * status a cada agendamento do lote pelo caminho de sempre — `AgendamentoService::atualizar` —
 * para que o lote seja um CHAMADOR A MAIS das guardas do agendamento individual, nunca um atalho
 * em volta delas. Guardas sob lock, reconciliação de sessão por estado final e trilha por linha
 * acontecem lá dentro, não aqui fora.
 *
 * A recusa de UMA linha é RESULTADO da operação, não falha dela (requisito "a recusa de um não
 * impede os outros"): o gate do desmarque provou o beco de um lote de 6 recusado inteiro por um
 * único tratamento sem saldo, com a mensagem sem dizer qual. Tudo-ou-nada protege contra estado
 * parcial na falha de um PASSO; a linha que o domínio recusa vira `recusado` com o motivo.
 *
 * O encadeamento é suprimido por PARÂMETRO (D9), não pelo contexto de auditoria: 40 finalizados
 * puxariam 40 "próximos do dia" — inclusive fora do alcance que a prévia mostrou.
 */
class AplicadorDeStatusEmLote
{
    public function __construct(private readonly AgendamentoService $agendamentos) {}

    /**
     * Chamar DENTRO da transação do lote, com o alcance já travado.
     *
     * `inicio` e `profissional_id` vão junto porque o serviço os lê SEM fallback
     * (`resolverAtributos` e `verificarConflitos`); reenviar os ATUAIS é o jeito de dizer "não
     * move nada" — e `inicio` igual não acorda a guarda de retroativo. Sala, equipamento e
     * duração são preservados pelo próprio serviço. `paciente_id` e `tratamento_id` NUNCA são
     * reenviados: no `atualizar`, a PRESENÇA da chave é o que sinaliza troca de vínculo e acorda
     * guardas que não têm nada a ver com mudar o status.
     *
     * @param  iterable<Agendamento>  $agendamentos
     * @return array{
     *     aplicados: Collection<int, Agendamento>,
     *     recusados: list<array{agendamento: Agendamento, motivo: string}>
     * }
     */
    public function aplicar(iterable $agendamentos, int $statusId): array
    {
        $aplicados = collect();
        $recusados = [];

        foreach ($agendamentos as $agendamento) {
            try {
                $this->agendamentos->atualizar($agendamento, [
                    'status_id' => $statusId,
                    'inicio' => $agendamento->inicio->format('Y-m-d H:i'),
                    'profissional_id' => $agendamento->profissional_id,
                ], aplicarNaSerie: false, encadear: false);
            } catch (ValidationException $erro) {
                $recusados[] = ['agendamento' => $agendamento, 'motivo' => self::primeiraMensagem($erro)];

                continue;
            }

            $aplicados->push($agendamento);
        }

        return ['aplicados' => $aplicados, 'recusados' => $recusados];
    }

    /**
     * O shape da RESPOSTA: `{id, inicio, motivo}` — sem nome nem id de criança (D17).
     *
     * @param  list<array{agendamento: Agendamento, motivo: string}>  $recusados
     * @return list<array{id: int, inicio: string, motivo: string}>
     */
    public static function serializar(array $recusados): array
    {
        return array_map(fn (array $item) => [
            'id' => $item['agendamento']->id,
            'inicio' => $item['agendamento']->inicio->format('Y-m-d H:i'),
            'motivo' => $item['motivo'],
        ], $recusados);
    }

    /**
     * O shape da LINHA-MÃE da trilha (D11): `{agendamento_id, motivo}` — o id do agendamento
     * basta para reconstituir; quem precisa do nome segue pela trilha do agendamento.
     *
     * @param  list<array{agendamento: Agendamento, motivo: string}>  $recusados
     * @return list<array{agendamento_id: int, motivo: string}>
     */
    public static function paraTrilha(array $recusados): array
    {
        return array_map(fn (array $item) => [
            'agendamento_id' => $item['agendamento']->id,
            'motivo' => $item['motivo'],
        ], $recusados);
    }

    /** A primeira mensagem do domínio (já em pt-BR); a tela traduz as constantes e mostra a frase crua como fallback. */
    private static function primeiraMensagem(ValidationException $erro): string
    {
        return (string) (collect($erro->errors())->flatten()->first() ?? 'recusado pelo servidor');
    }
}
