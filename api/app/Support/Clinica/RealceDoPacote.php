<?php

namespace App\Support\Clinica;

use App\Models\Tratamento;
use App\Support\Configuracoes\ConfiguracaoService;
use Illuminate\Database\Eloquent\Builder;

/**
 * O realce do fim de pacote — **a regra inteira, e ela é DADO** (§13).
 *
 * Decide QUAL dos dois fatos um tratamento carrega, e é o servidor que decide porque:
 *
 * 1. **§13 manda.** O limiar é regra de negócio configurável, e os três blocos irmãos do mesmo
 *    centro de notificações já são chaves de `configuracoes`
 *    (`agenda.faltas_consecutivas_limite`, `agenda.pendencia_retorno_dias`,
 *    `tratamentos.pedido_aviso_antecedencia_dias`). Este era o único hardcoded — e, pior,
 *    hardcoded em DOIS runtimes, com um teste que abria o arquivo `.php` a partir da suíte do
 *    front e comparava por regex. Aquilo funcionava, e era o sintoma: só se precisa de uma
 *    guarda assim quando a regra virou código em vez de dado.
 * 2. **Quem decide tem de ver TUDO.** O card recebia `sessoes_saldo` e `sessoes_total`, e não
 *    o `status`. Um tratamento `parado` com saldo baixo ficava realçado na grade enquanto o
 *    contador dizia "nenhum" — a divergência que a spec jurava não existir. Aqui o status está
 *    à mão.
 * 3. **Uma decisão, quatro telas.** Card da grade, item da lista do celular, painel e fila do
 *    centro leem o MESMO veredito. Não há como divergirem, porque não há segunda conta.
 *
 * A tela recebe o veredito pronto e só escolhe a pele (âmbar avisa, vermelho bloqueia).
 */
class RealceDoPacote
{
    /** Ainda dá para atender, e é hora de oferecer o próximo pacote. */
    public const ACABANDO = 'acabando';

    /** O saldo acabou: a criança não pode ser atendida até renovar. */
    public const SEM_SALDO = 'sem-saldo';

    public const NENHUM = 'nenhum';

    /**
     * Piso e teto do limiar, aplicados na ESCRITA (catálogo) **e** na LEITURA.
     *
     * O clamp defensivo na leitura é o padrão da casa (`PedidosMedicos::antecedenciaDias`,
     * registro SEC-LP-16): valor adulterado direto no banco nunca alarga o alerta para a
     * agenda inteira nem o desliga.
     */
    public const MINIMO = 1;

    public const MAXIMO = 20;

    public function __construct(private readonly ConfiguracaoService $configuracoes) {}

    /** O limiar da clínica (§13, `tratamentos.saldo_alerta_sessoes`), com clamp na leitura. */
    public function saldoDeAlerta(): int
    {
        $valor = (int) $this->configuracoes->get('tratamentos.saldo_alerta_sessoes');

        return min(max($valor, self::MINIMO), self::MAXIMO);
    }

    /**
     * O recorte de "PRÓXIMO DO ENCERRAMENTO" em CONSULTA — a mesma decisão do `de()`, na
     * linguagem do banco.
     *
     * Existe porque a fila do centro (`PacotesAcabando::consulta`) e o relatório
     * `sessoes-dos-tratamentos` faziam a MESMA conta em dois lugares (`CRR-08`), enquanto o
     * docblock desta classe promete o contrário: *"uma decisão, quatro telas, não há segunda
     * conta"*. Duplicada, a divergência nasce no dia em que só uma das duas for corrigida — e
     * o contador diria 3 com o relatório listando 5.
     *
     * O `status = andamento` NÃO entra aqui: os dois chamadores já o aplicam, e o relatório
     * ainda o combina com o retrato da data final do período.
     *
     * SOMA, e não subtração: `sessoes_total`/`sessoes_realizadas` são UNSIGNED, e uma única
     * linha com `realizadas > total` faz a subtração estourar em ERROR 1690 — o que na fila do
     * centro derruba `/api/notificacoes` inteiro, para toda a clínica.
     *
     * @template TModel of \Illuminate\Database\Eloquent\Model
     *
     * @param  Builder<TModel>  $consulta  consulta sobre `tratamentos`
     * @return Builder<TModel>
     */
    public function escopoDoFimDePacote(Builder $consulta): Builder
    {
        return $consulta
            // pacote é mais de uma sessão — sessão única não tem fim de pacote a anunciar
            ->where('tratamentos.sessoes_total', '>', 1)
            ->whereRaw('tratamentos.sessoes_total <= tratamentos.sessoes_realizadas + ?', [$this->saldoDeAlerta()]);
    }

    /**
     * O veredito para um tratamento — ou `null` quando não há tratamento (bloqueio, avulso).
     *
     * **Pacote é MAIS DE UMA sessão.** Sessão única não tem fim de pacote a anunciar, e
     * alertá-la desde o primeiro dia (saldo 1 está sempre no limiar) é ruído em cima de quem
     * nunca comprou pacote. Foi o recorte que o usuário nomeou ao pedir a feature.
     *
     * **Só em ANDAMENTO:** pacote finalizado é histórico e parado é decisão já tomada —
     * nenhum dos dois pede cobrança.
     */
    public function de(?Tratamento $tratamento): string
    {
        if ($tratamento === null
            || $tratamento->status !== 'andamento'
            || $tratamento->sessoes_total === null
            || $tratamento->sessoes_total <= 1
        ) {
            return self::NENHUM;
        }

        $saldo = $tratamento->sessoes_saldo;

        if ($saldo > $this->saldoDeAlerta()) {
            return self::NENHUM;
        }

        // `<= 0` e não `=== 0`: linha inconsistente não pode virar "ainda dá para atender"
        return $saldo <= 0 ? self::SEM_SALDO : self::ACABANDO;
    }
}
