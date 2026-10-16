<?php

namespace App\Support\Relatorios;

/**
 * O CATÁLOGO: slug → classe do relatório (change `area-de-relatorios`, D1/D4).
 *
 * É a lista que o controller despacha, que `GET /api/relatorios` publica (o índice sem dado)
 * e que `relatorios:catalogo --json` exporta para a guarda de contrato do web — dois
 * catálogos que divergem é o link morto. Relatório novo = UMA classe + UMA linha aqui.
 *
 * As classes são resolvidas pelo container (não `new`): é o que permite ao teste do corte
 * de linhas injetar um limite baixo em vez de criar 2001 registros.
 */
final class CatalogoDeRelatorios
{
    /** @var array<string, class-string<Relatorio>> */
    private const CLASSES = [
        'agendamentos' => Agendamentos::class,
        'movimentacao-da-agenda' => MovimentacaoDaAgenda::class,
        'pacientes' => Pacientes::class,
        'extrato-do-paciente' => ExtratoDoPaciente::class,
        'atendimentos' => Atendimentos::class,
        'lista-de-presenca' => ListaDePresenca::class,
        'evolucoes' => Evolucoes::class,
        'sessoes-dos-tratamentos' => SessoesDosTratamentos::class,
        'tratamentos-sem-lancamento' => TratamentosSemLancamento::class,
        'servicos' => Servicos::class,
        'recebido-por-profissional' => RecebidoPorProfissional::class,
        'fechamento-de-caixa' => FechamentoDeCaixa::class,
        'dre-gerencial' => DreGerencial::class,
        // os relatórios do caixa (change `relatorios-do-caixa`): uma pergunta, uma base de data
        'contas-em-aberto' => ContasEmAberto::class,
        'recebido-e-pago' => RecebidoEPago::class,
        'vendas-do-periodo' => VendasDoPeriodo::class,
        'movimentacao-do-financeiro' => MovimentacaoDoFinanceiro::class,
    ];

    public function porSlug(string $slug): ?Relatorio
    {
        $classe = self::CLASSES[$slug] ?? null;

        return $classe === null ? null : app($classe);
    }

    /** @return list<Relatorio> */
    public function todos(): array
    {
        return array_map(fn (string $classe): Relatorio => app($classe), array_values(self::CLASSES));
    }

    /**
     * O índice publicado — SEM dado de negócio: só o que a tela precisa para montar o
     * catálogo (slug, título, permissões para esconder o cartão, eixo e a régua AP-09).
     *
     * @return list<array{slug: string, titulo: string, permissoes: list<string>, eixo: string|null, expoe_nome: bool}>
     */
    public function indice(): array
    {
        return array_map(fn (Relatorio $relatorio): array => [
            'slug' => $relatorio->slug(),
            'titulo' => $relatorio->titulo(),
            'permissoes' => $relatorio->permissoes(),
            'eixo' => $relatorio->eixo(),
            'expoe_nome' => $relatorio->expoeNomeDaCrianca(),
        ], $this->todos());
    }
}
