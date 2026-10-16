<?php

namespace App\Support\Clinica;

use App\Models\Tratamento;
use App\Support\Rbac\Escopo;
use Illuminate\Database\Eloquent\Builder;

/**
 * Pacotes no FIM — a regra em UM lugar só (change alerta-de-fim-de-pacote, D2/D4).
 *
 * Existe porque a clínica esquece de cobrar quando o pacote termina. O realce no card já
 * existia, e só funcionava se alguém estivesse olhando aquele card naquele dia — quem não abre
 * a agenda daquela criança não via nada, e o pacote acabava sem ninguém oferecer o próximo.
 * Tudo o mais que a clínica não pode esquecer já tem contador; o fim de pacote, que é o que
 * gera receita, era o único dessa classe sem fila.
 *
 * **Nada é persistido:** o estado é calculado por leitura, como os demais blocos do centro. E
 * deriva das MESMAS colunas que a grade e o painel leem (`sessoes_total`, `sessoes_saldo`), de
 * modo que contador, card e painel não possam divergir — se houvesse segunda fonte, o contador
 * diria 3 e a grade mostraria 5.
 *
 * **O limiar é DADO** (`tratamentos.saldo_alerta_sessoes`), lido pelo `RealceDoPacote`.
 *
 * **Pacote é MAIS DE UMA sessão.** Tratamento de sessão única não tem fim de pacote a
 * anunciar, e alertá-lo desde o primeiro dia (saldo 1 é `<= 2`) é ruído em cima de quem nunca
 * comprou pacote. Foi o recorte que o usuário nomeou ao pedir a feature.
 *
 * **Só em ANDAMENTO:** o que se cobra é a renovação de quem segue em atendimento. Pacote
 * finalizado é histórico, e parado é decisão que já foi tomada.
 *
 * Escopo: eixo AGENDA do D11, pela coluna `tratamentos.profissional_id` — o escopado vê só os
 * seus, sem vínculo vê nada (fail-closed).
 */
class PacotesAcabando
{
    public function __construct(private readonly RealceDoPacote $realce) {}

    /**
     * Base ÚNICA: tratamentos em andamento, de pacote com mais de uma sessão, cujo saldo
     * chegou ao limiar — do mais urgente (menor saldo) para o menos.
     *
     * @param  Escopo  $escopo  eixo AGENDA do D11
     * @return Builder<Tratamento>
     */
    public function consulta(Escopo $escopo): Builder
    {
        $consulta = $this->realce->escopoDoFimDePacote(Tratamento::query())
            /*
             * `ResumoDoPaciente::relacao()`, NUNCA `'paciente'` cru: carregar a relação sem
             * whitelist traz o cadastro INTEIRO do menor para a memória — CPF, nascimento,
             * responsáveis, endereço e `necessidade`, que é dado de saúde (art. 11). Foi a
             * guarda `WhitelistDoMenorTest` da própria base que pegou isto aqui.
             */
            ->with([ResumoDoPaciente::relacao(), 'convenio:id,nome,particular', 'especialidade:id,nome'])
            ->where('status', 'andamento')
            /*
             * O recorte de "no fim" vem da FONTE ÚNICA (`RealceDoPacote::escopoDoFimDePacote`):
             * pacote de mais de uma sessão E saldo no limiar, com o limiar lido de
             * `configuracoes`. Estava copiado aqui e no relatório `sessoes-dos-tratamentos`
             * (`CRR-08`) — e o `RealceDoPacote` promete no próprio docblock que não há segunda
             * conta. O `ORDER BY` continua com CAST pelo mesmo motivo do `whereRaw` de lá:
             * `sessoes_total`/`sessoes_realizadas` são UNSIGNED e a subtração estoura em
             * ERROR 1690, o que aqui derruba `/api/notificacoes` INTEIRO — os onze blocos somem
             * para toda a clínica, e o sino repete a chamada a cada 60s.
             */
            ->orderByRaw('CAST(sessoes_total AS SIGNED) - CAST(sessoes_realizadas AS SIGNED) asc')
            ->orderBy('id');

        // D11: o escopado vê só os tratamentos dele; sem vínculo, `nenhum` zera (fail-closed),
        // e o controller nunca vê o id cru do profissional
        return $escopo->aplicar($consulta);
    }

    /**
     * O item do bloco — paciente MINIMIZADO, e nada além do que a fila precisa.
     *
     * Sem nascimento, sem CPF, sem carteirinha, sem observação: quem vai cobrar precisa saber
     * QUEM, de QUE pacote e quanto FALTA. O resto está na ficha, atrás da permissão dela.
     *
     * @return array<string, mixed>
     */
    public function item(Tratamento $tratamento): array
    {
        return [
            'tratamento_id' => $tratamento->id,
            'paciente' => ResumoDoPaciente::deOuNulo($tratamento->paciente),
            'convenio' => $tratamento->convenio?->only(['id', 'nome', 'particular']),
            'especialidade' => $tratamento->especialidade?->only(['id', 'nome']),
            'sessoes_total' => $tratamento->sessoes_total,
            'sessoes_saldo' => $tratamento->sessoes_saldo,
        ];
    }
}
