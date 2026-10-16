<?php

use App\Models\Agendamento;
use App\Models\Atendimento;
use App\Models\Convenio;
use App\Models\Evolucao;
use App\Models\Paciente;
use App\Models\Servico;
use App\Models\StatusAgendamento;
use App\Models\Tratamento;
use App\Support\Relatorios\CatalogoDeRelatorios;
use App\Support\Relatorios\Relatorio;
use Illuminate\Support\Facades\Artisan;

/**
 * TESTE DE CONTRATO da régua AP-09 (change `area-de-relatorios`, D3): a régua é um teste, não
 * uma revisão. Para CADA relatório do catálogo, com dados fictícios que atravessam o relatório,
 * o payload é varrido recursivamente: se o relatório se declara numérico, nenhuma chave
 * `paciente`/`nome`; em qualquer caso, nenhuma chave da lista proibida — e nenhum VALOR do
 * cadastro (telefone, CPF, responsável, endereço, e-mail, nascimento), porque chave com outro
 * nome vaza igual. A varredura por valor é NORMALIZADA (`CRR-04`): os literais em todos os
 * formatos de data, e telefone/CPF comparados só pelos DÍGITOS — antes ela era literal de
 * formato, e `"11999990000"` sem máscara passava com a suíte verde.
 *
 * A casa já teve superfícies que vazaram cadastro por esquecimento (gatilho ENUM ampliado):
 * um `with('paciente')` sem whitelist serializa o cadastro inteiro de um menor com a suíte
 * verde. Este teste é o que fica vermelho.
 */

/** Chaves que NENHUM relatório pode carregar, declarado ou não. */
const CHAVES_PROIBIDAS_NO_RELATORIO = [
    'telefone', 'celular', 'cpf', 'rg', 'endereco', 'logradouro', 'email',
    'responsavel', 'responsavel_nome', 'nascimento', 'data_nascimento',
];

/**
 * Os parâmetros mínimos de cada relatório — uma execução por variante. Relatório novo no
 * catálogo SEM entrada aqui REPROVA: a varredura não pode pular ninguém em silêncio.
 *
 * @return array<string, list<array<string, string>>>
 */
function parametrosDeContratoDosRelatorios(): array
{
    return [
        'agendamentos' => [
            [],
            ['resultado' => 'sintetico', 'dividir_por' => 'status'],
            ['resultado' => 'sintetico', 'dividir_por' => 'profissional'],
            ['resultado' => 'sintetico', 'dividir_por' => 'convenio'],
            ['resultado' => 'sintetico', 'dividir_por' => 'especialidade'],
            ['resultado' => 'sintetico', 'dividir_por' => 'dia'],
        ],
        'movimentacao-da-agenda' => [
            [],
            ['tipo' => 'criado'],
            ['tipo' => 'remarcado'],
            ['tipo' => 'desmarcado'],
            ['tipo' => 'status'],
        ],
        'pacientes' => [
            [],
            ['situacao' => 'ativos'],
            ['situacao' => 'cadastrados_no_periodo', 'de' => agoraNaClinica()->toDateString(), 'ate' => agoraNaClinica()->toDateString()],
            ['situacao' => 'sem_atendimento'],
            ['situacao' => 'sem_atendimento', 'dias' => '30'],
            // a criança do contrato nasceu em MAIO (`2019-05-20`, no seed) — o mês pedido é o dela
            ['situacao' => 'aniversariantes', 'mes' => agoraNaClinica()->year.'-05'],
            ['resultado' => 'sintetico', 'dividir_por' => 'convenio'],
        ],
        // o id vem pelo NOME da criança do contrato: esta função não vê o seed, mas roda depois dele
        'extrato-do-paciente' => [
            ['paciente_id' => (string) Paciente::where('nome', 'Criança Fictícia do Contrato')->value('id')],
        ],
        'atendimentos' => [
            [],
            ['resultado' => 'sintetico', 'dividir_por' => 'profissional'],
            ['resultado' => 'sintetico', 'dividir_por' => 'convenio'],
            ['resultado' => 'sintetico', 'dividir_por' => 'especialidade'],
            ['resultado' => 'sintetico', 'dividir_por' => 'mes'],
        ],
        'lista-de-presenca' => [
            [],
        ],
        'evolucoes' => [
            [],
            ['situacao' => 'preenchida'],
            ['situacao' => 'pendente'],
            ['resultado' => 'sintetico'],
        ],
        'sessoes-dos-tratamentos' => [
            [],
            ['situacao' => 'em_andamento'],
            ['situacao' => 'finalizados'],
            ['situacao' => 'proximos_do_encerramento'],
        ],
        'tratamentos-sem-lancamento' => [
            [],
        ],
        'servicos' => [
            [],
            ['ordenar' => 'quantidade'],
            ['ordenar' => 'valor'],
        ],
        'recebido-por-profissional' => [
            [],
            ['resultado' => 'sintetico', 'dividir_por' => 'profissional'],
            ['resultado' => 'sintetico', 'dividir_por' => 'convenio'],
            ['resultado' => 'sintetico', 'dividir_por' => 'servico'],
        ],
        // os relatórios do caixa (change `relatorios-do-caixa`): cada Tipo e cada divisão
        'contas-em-aberto' => [
            [],
            ['tipo' => 'receber'],
            ['tipo' => 'pagar'],
            ['resultado' => 'sintetico', 'dividir_por' => 'categoria'],
            ['resultado' => 'sintetico', 'dividir_por' => 'pessoa'],
            ['resultado' => 'sintetico', 'dividir_por' => 'mes'],
        ],
        'recebido-e-pago' => [
            [],
            ['tipo' => 'recebido'],
            ['tipo' => 'pago'],
            ['resultado' => 'sintetico', 'dividir_por' => 'forma_de_pagamento'],
            ['resultado' => 'sintetico', 'dividir_por' => 'categoria'],
            ['resultado' => 'sintetico', 'dividir_por' => 'conta'],
            ['resultado' => 'sintetico', 'dividir_por' => 'dia'],
        ],
        'vendas-do-periodo' => [
            [],
            ['resultado' => 'sintetico', 'dividir_por' => 'servico'],
            ['resultado' => 'sintetico', 'dividir_por' => 'profissional'],
            ['resultado' => 'sintetico', 'dividir_por' => 'categoria'],
        ],
        'movimentacao-do-financeiro' => [
            [],
            ['tipo' => 'criado'],
            ['tipo' => 'alterado'],
            ['tipo' => 'pago'],
            ['tipo' => 'estornado'],
            ['tipo' => 'excluido'],
            ['resultado' => 'sintetico', 'dividir_por' => 'pessoa'],
            ['resultado' => 'sintetico', 'dividir_por' => 'tipo'],
        ],
        // o fechamento da gaveta (change `fechamento-de-caixa`): cada Tipo e cada divisão — o
        // admin vê o caixa da clínica, então a divisão por quem deu baixa é aceita
        // o DRE (change `dre-gerencial`): as duas bases e o recorte contábil
        'dre-gerencial' => [
            [],
            ['tipo' => 'competencia'],
            ['somente_contabeis' => '1'],
        ],
        'fechamento-de-caixa' => [
            [],
            ['tipo' => 'entradas'],
            ['tipo' => 'saidas'],
            ['resultado' => 'sintetico', 'dividir_por' => 'forma_de_pagamento'],
            ['resultado' => 'sintetico', 'dividir_por' => 'conta'],
            ['resultado' => 'sintetico', 'dividir_por' => 'quem_deu_baixa'],
        ],
    ];
}

/**
 * A régua AP-09 DECLARADA, slug a slug — quem sai COM o nome da criança e quem sai SEM.
 *
 * `CRR-03`: sem esta tabela, o teste só CONSUMIA a declaração de cada classe — flipar
 * `Servicos::expoeNomeDaCrianca()` de `false` para `true` não derrubava nada, porque a
 * varredura passava a exigir menos. A régua tem de morar num lugar que o revisor lê e que o
 * autor precisa mexer de propósito, como já acontece com `parametrosDeContratoDosRelatorios()`.
 *
 * @return array<string, bool>
 */
function expoeNomeDaCriancaPorSlug(): array
{
    return [
        // CONFERÊNCIA — a recepção imprime, assina e arquiva; sem o nome o papel não serve
        'agendamentos' => true,
        'movimentacao-da-agenda' => true,
        'pacientes' => true,
        'extrato-do-paciente' => true,
        'atendimentos' => true,
        'lista-de-presenca' => true,
        'evolucoes' => true,
        'sessoes-dos-tratamentos' => true,
        'tratamentos-sem-lancamento' => true,
        // FECHAMENTO — a clínica confere pagamento a pagamento antes de acertar com o profissional
        'recebido-por-profissional' => true,
        // CAIXA (change `relatorios-do-caixa`) — cobrança, conferência do que entrou, venda do mês
        // e quem mexeu: cada linha é de uma pessoa, e a clínica precisa saber de quem
        'contas-em-aberto' => true,
        'recebido-e-pago' => true,
        'vendas-do-periodo' => true,
        'movimentacao-do-financeiro' => true,
        // CONFERÊNCIA da gaveta (change `fechamento-de-caixa`) — de quem é cada pagamento
        'fechamento-de-caixa' => true,
        // NUMÉRICO — o resultado da clínica por linha contábil; nome de criança não tem função
        'dre-gerencial' => false,
        // NUMÉRICO — ranking por serviço; nome de criança aqui não teria função nenhuma
        'servicos' => false,
    ];
}

/**
 * Todas as chaves de string do JSON, em qualquer profundidade.
 *
 * @param  list<string>  $chaves
 */
function chavesDoJsonDoRelatorio(mixed $valor, array &$chaves): void
{
    if (! is_array($valor)) {
        return;
    }
    foreach ($valor as $chave => $filho) {
        if (is_string($chave)) {
            $chaves[] = $chave;
        }
        chavesDoJsonDoRelatorio($filho, $chaves);
    }
}

/**
 * "Estes DÍGITOS não estão no JSON", com a pontuação de fora dos dois lados (`CRR-04`).
 *
 * A varredura por VALOR era literal de FORMATO: `"— 11 99999-0000"` caía, mas `"11999990000"`
 * passava, e a data de nascimento em `d/m/Y` passava também. Um relatório que normalize o
 * telefone (ou monte o CPF sem máscara) vazaria com a guarda verde — que é exatamente o modo
 * de falha que a casa já pagou (gatilho ENUM ampliado). Aqui o JSON inteiro perde tudo o que
 * não é dígito, e o valor procurado também: o formato deixa de importar.
 */
function semVazamentoDeDigitos(mixed $json, string $valor, string $onde): void
{
    $digitosDoValor = preg_replace('/\D+/', '', $valor);
    if ($digitosDoValor === '' || strlen($digitosDoValor) < 6) {
        throw new InvalidArgumentException("Valor `{$valor}` curto demais para a varredura por dígitos — daria falso positivo.");
    }

    $digitosDoJson = preg_replace('/\D+/', '', (string) json_encode($json, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

    expect(str_contains((string) $digitosDoJson, (string) $digitosDoValor))->toBeFalse(
        "{$onde}: os dígitos de `{$valor}` aparecem no payload mesmo sem a pontuação (AP-09).",
    );
}

/**
 * As formas em que uma DATA pode aparecer sem parecer a data: `Y-m-d`, `d/m/Y`, `d/m/y` — e,
 * pelo `semVazamentoDeDigitos`, qualquer uma delas sem separador nenhum.
 *
 * O que a régua NÃO proíbe, por decisão declarada: o `dia` "dd/mm" sozinho do relatório de
 * aniversariantes. Ele é a coluna do papel, e junto com `idade_que_fara` a data é
 * RECONSTRUÍVEL — está registrado como `ANIVERSARIANTES-RECONSTROEM-NASCIMENTO` em
 * `docs/GATILHOS.md`, esperando decisão de produto (faixa etária ou aceitar).
 *
 * @return list<string>
 */
function formatosDaDataDoContrato(string $iso): array
{
    $data = Carbon\Carbon::createFromFormat('Y-m-d', $iso);

    return [$iso, $data->format('d/m/Y'), $data->format('d/m/y')];
}

it('deve manter todo relatório do catálogo dentro da régua AP-09 e fora da lista proibida', function () {
    // ARRANGE — uma criança FICTÍCIA com cadastro completo (o que NÃO pode sair), num agendamento
    // com pacote e convênio (o que os relatórios leem). Nomes com marcador próprio para a
    // varredura por VALOR não confundir com o resto do payload.
    $this->actingAs(admin());
    $paciente = Paciente::factory()->create([
        'nome' => 'Criança Fictícia do Contrato',
        'nascimento' => '2019-05-20',
        // CPF e e-mail PLANTADOS (`CRR-04`): as CHAVES já eram proibidas, mas nenhum VALOR
        // desses dois era semeado — um relatório que os servisse sob outro nome de chave
        // passava pela varredura inteira
        'cpf' => '52998224725', // a coluna guarda só dígitos; a varredura compara sem pontuação
        'responsaveis_json' => [['nome' => 'Responsável Fictício do Contrato', 'parentesco' => 'mãe']],
        'contatos_json' => [
            ['tipo' => 'celular', 'valor' => '11 99999-0000'],
            ['tipo' => 'email', 'valor' => 'responsavel.ficticio@exemplo-do-contrato.invalid'],
        ],
        'endereco_json' => ['logradouro' => 'Rua Fictícia do Contrato', 'numero' => '10'],
    ]);
    $hoje = agoraNaClinica()->toDateString();
    $agendamento = Agendamento::factory()->create([
        'paciente_id' => $paciente->id,
        'inicio' => "{$hoje} 09:00",
        'fim' => "{$hoje} 09:40",
    ]);
    $tratamento = Tratamento::factory()->create([
        'paciente_id' => $paciente->id,
        'convenio_id' => Convenio::create(['nome' => 'Operadora Fictícia do Contrato'])->id,
        'especialidade_id' => $agendamento->especialidade_id,
        'profissional_id' => $agendamento->profissional_id,
    ]);
    $agendamento->forceFill(['tratamento_id' => $tratamento->id])->save();
    // movimentação da agenda (task 2.4): um SEGUNDO horário da criança, remarcado, com status trocado e
    // depois desmarcado (status que NÃO ocupa horário) — as variantes de `tipo` atravessam sem tocar o principal
    $movimentado = Agendamento::factory()->create(['paciente_id' => $paciente->id, 'inicio' => "{$hoje} 10:00", 'fim' => "{$hoje} 10:40"]);
    $movimentado->forceFill(['inicio' => "{$hoje} 11:00", 'fim' => "{$hoje} 11:40"])->save();
    $movimentado->forceFill(['status_id' => StatusAgendamento::where('nome', 'Finalizado')->value('id')])->save();
    $movimentado->forceFill(['status_id' => StatusAgendamento::where('ocupa_horario', false)->value('id')])->save();
    // pacientes (task 2.5): uma segunda criança FICTÍCIA sem sessão nenhuma garante `sem_atendimento` ≥ 1
    // mesmo que outro relatório precise da criança do contrato com sessão realizada
    Paciente::factory()->create(['nome' => 'Criança Fictícia Sem Atendimento do Contrato']);
    // extrato do paciente (task 2.9): um lançamento em nome da criança, vencendo hoje
    lancamentoDoTratamento($tratamento->id, $hoje)->update(['interessado_tipo' => 'paciente', 'interessado_id' => $paciente->id]);
    // recebido por profissional: a sessão faturada e PAGA hoje, e o pacote pago hoje — as duas
    // origens que levam o nome da criança ao papel
    lancamentoDoTratamento($tratamento->id, $hoje)->forceFill([
        'interessado_tipo' => 'paciente', 'interessado_id' => $paciente->id,
        'agendamento_id' => $agendamento->id, 'pago_em' => agoraNaClinica()->format('Y-m-d H:i'),
    ])->save();
    lancamentoDoTratamento($tratamento->id, $hoje)->forceFill([
        'interessado_tipo' => 'paciente', 'interessado_id' => $paciente->id,
        'pago_em' => agoraNaClinica()->format('Y-m-d H:i'),
    ])->save();
    // relatórios do caixa: uma devolução em aberto e uma paga (Tipo "Pagar" e "Pago"), um
    // pagamento estornado e um lançamento excluído (a movimentação por "estornado" e "excluído")
    // — todos da criança, vencendo hoje, para o nome dela atravessar cada variante
    $daCriancaDoContrato = ['interessado_tipo' => 'paciente', 'interessado_id' => $paciente->id, 'competencia' => $hoje, 'vencimento' => $hoje];
    lancamentoNoCaixa('20.00', ['tipo' => 'despesa', ...$daCriancaDoContrato]);
    lancamentoNoCaixa('25.00', ['tipo' => 'despesa', ...$daCriancaDoContrato], ['pago_em' => agoraNaClinica()->format('Y-m-d H:i')]);
    lancamentoNoCaixa('30.00', $daCriancaDoContrato, ['pago_em' => agoraNaClinica()->format('Y-m-d H:i')])
        ->forceFill(['pago_em' => null])->save();
    lancamentoNoCaixa('35.00', $daCriancaDoContrato)->delete();

    // os relatórios de ATENDIMENTO (tasks 2.1/2.3) leem os REALIZADOS (status pelas FLAGS:
    // desconta a sessão e não é falta): um com registro clínico e evolução (variante
    // `preenchida`) e um sem nada (variante `pendente`) — da mesma criança, no mesmo pacote
    $statusRealizadoDoContrato = StatusAgendamento::where('desconta_sessao', true)->where('marca_falta', false)->orderBy('ordem')->value('id');
    $realizadoDoContrato = Agendamento::factory()->create([
        'paciente_id' => $paciente->id,
        'profissional_id' => $agendamento->profissional_id,
        'especialidade_id' => $agendamento->especialidade_id,
        'tratamento_id' => $tratamento->id,
        'status_id' => $statusRealizadoDoContrato,
        'inicio' => "{$hoje} 10:00",
        'fim' => "{$hoje} 10:40",
    ]);
    $evolucaoDoContrato = new Evolucao(['profissional_id' => $agendamento->profissional_id, 'conteudo' => 'Evolução fictícia do contrato.']);
    $evolucaoDoContrato->atendimento_id = Atendimento::factory()->create(['agendamento_id' => $realizadoDoContrato->id, 'finalizado_em' => "{$hoje} 10:40"])->id;
    $evolucaoDoContrato->preenchida_em = "{$hoje} 10:45";
    $evolucaoDoContrato->save();
    Agendamento::factory()->create([
        'paciente_id' => $paciente->id,
        'profissional_id' => $agendamento->profissional_id,
        'especialidade_id' => $agendamento->especialidade_id,
        'status_id' => $statusRealizadoDoContrato,
        'inicio' => "{$hoje} 11:00",
        'fim' => "{$hoje} 11:40",
    ]);

    // os relatórios de TRATAMENTO (tasks 2.6–2.8) precisam de cena própria para atravessar: um
    // pacote com serviço PRECIFICADO no fim (saldo 1 ≤ limiar default 2) e um FINALIZADO hoje —
    // da mesma criança, abertos hoje na parede da clínica (`data_inicio` explícito)
    $servicoDoContrato = new Servico(['procedimento' => 'Sessão Fictícia do Contrato', 'valor' => '150.00']);
    $servicoDoContrato->convenio_id = $tratamento->convenio_id;
    $servicoDoContrato->save();
    Tratamento::factory()->create([
        'paciente_id' => $paciente->id,
        'convenio_id' => $tratamento->convenio_id,
        'especialidade_id' => $agendamento->especialidade_id,
        'profissional_id' => $agendamento->profissional_id,
        'servico_id' => $servicoDoContrato->id,
        'sessoes_total' => 3,
        'data_inicio' => $hoje,
    ])->forceFill(['sessoes_realizadas' => 2])->save();
    Tratamento::factory()->create([
        'paciente_id' => $paciente->id,
        'convenio_id' => $tratamento->convenio_id,
        'especialidade_id' => $agendamento->especialidade_id,
        'profissional_id' => $agendamento->profissional_id,
        'data_inicio' => $hoje,
        'status' => 'finalizado',
    ]);

    // LITERAIS (nome, endereço, e-mail) + a data em todos os formatos que ela toma na tela
    $valoresDoCadastro = [
        'Responsável Fictício do Contrato',
        'Rua Fictícia do Contrato',
        'responsavel.ficticio@exemplo-do-contrato.invalid',
        ...formatosDaDataDoContrato('2019-05-20'),
    ];
    // DÍGITOS (telefone, CPF): comparados sem pontuação dos dois lados — formato não protege
    $digitosDoCadastro = ['11 99999-0000', '529.982.247-25'];
    $parametrosPorSlug = parametrosDeContratoDosRelatorios();
    $catalogo = app(CatalogoDeRelatorios::class)->todos();
    expect($catalogo)->not->toBeEmpty();

    foreach ($catalogo as $relatorio) {
        $slug = $relatorio->slug();
        expect(array_key_exists($slug, $parametrosPorSlug))->toBeTrue(
            "Relatório `{$slug}` entrou no catálogo sem parâmetros em parametrosDeContratoDosRelatorios(): "
            .'a varredura AP-09 não pode pulá-lo em silêncio.',
        );

        foreach ($parametrosPorSlug[$slug] as $variante) {
            $periodo = $relatorio->usaPeriodo() ? ['de' => $hoje, 'ate' => $hoje] : [];

            // ACT
            $json = $this->getJson("/api/relatorios/{$slug}?".http_build_query([...$periodo, ...$variante]))
                ->assertOk()
                ->json();

            // ASSERT — a cena ATRAVESSOU o relatório (varredura sobre payload vazio não prova nada)...
            expect($json['contagem'])->toBeGreaterThanOrEqual(1, "`{$slug}` devolveu vazio para a cena do contrato — a varredura não viu dado nenhum.");

            // ...nenhuma chave proibida em profundidade nenhuma...
            $chaves = [];
            chavesDoJsonDoRelatorio($json, $chaves);
            expect(array_values(array_intersect(array_unique($chaves), CHAVES_PROIBIDAS_NO_RELATORIO)))
                ->toBe([], "`{$slug}` expõe chave proibida (AP-09).");

            // ...nenhum VALOR do cadastro, com qualquer nome de chave e em qualquer formato...
            foreach ($valoresDoCadastro as $valor) {
                semVazamento($json, $valor);
            }
            foreach ($digitosDoCadastro as $valor) {
                semVazamentoDeDigitos($json, $valor, "`{$slug}`");
            }

            // ...e o nome da criança SÓ se o relatório se declara de conferência
            if (! $relatorio->expoeNomeDaCrianca()) {
                expect(array_values(array_intersect(array_unique($chaves), ['paciente', 'nome'])))
                    ->toBe([], "`{$slug}` é numérico e traz chave de nome (AP-09).");
                semVazamento($json, 'Criança Fictícia do Contrato');
            }
        }
    }
});

it('deve manter cada slug do catálogo igual ao slug que a classe declara, com a régua AP-09 batendo com a tabela', function () {
    // ARRANGE + ACT — o índice publicado é a chave do catálogo; a classe é quem responde
    $indice = app(CatalogoDeRelatorios::class)->indice();
    $reguaDeclarada = expoeNomeDaCriancaPorSlug();

    // ASSERT — um por um, e cada um com as declarações que a tela precisa
    foreach (app(CatalogoDeRelatorios::class)->todos() as $relatorio) {
        $slug = $relatorio->slug();
        expect($relatorio)->toBeInstanceOf(Relatorio::class)
            ->and($relatorio->permissoes())->not->toBeEmpty("`{$slug}` sem permissão declarada — não existe relatório sem módulo dono.")
            ->and($relatorio->eixo())->toBeIn(['agenda', 'clinico', null])
            // `CRR-03`: a régua AP-09 é comparada com a TABELA acima, não só consumida — mudar
            // `expoeNomeDaCrianca()` sem mudar a tabela reprova, nos dois sentidos
            ->and(array_key_exists($slug, $reguaDeclarada))->toBeTrue(
                "Relatório `{$slug}` entrou no catálogo sem entrada em expoeNomeDaCriancaPorSlug(): a régua AP-09 dele não foi decidida por ninguém.",
            )
            ->and($relatorio->expoeNomeDaCrianca())->toBe(
                $reguaDeclarada[$slug],
                "`{$slug}` mudou de régua AP-09 sem que a tabela de expoeNomeDaCriancaPorSlug() concordasse.",
            );
    }
    expect(collect($indice)->pluck('slug')->all())->toBe(collect($indice)->pluck('slug')->unique()->values()->all())
        // e a tabela não pode ter entrada órfã, que daria a impressão de cobrir um relatório morto
        ->and(array_values(array_diff(array_keys($reguaDeclarada), collect($indice)->pluck('slug')->all())))->toBe([]);
});

it('deve exportar pelo artisan o MESMO índice que GET /api/relatorios, e o mesmo que está na fixture do web', function () {
    // ARRANGE — a guarda de contrato do web lê a fixture gravada por este comando (task 1.7)
    $this->actingAs(admin());
    $daApi = $this->getJson('/api/relatorios')->assertOk()->json();

    // ACT
    Artisan::call('relatorios:catalogo', ['--json' => true]);

    // ASSERT — byte a byte o mesmo índice; e nada de dado de negócio em nenhum dos dois
    expect(json_decode(Artisan::output(), true))->toBe($daApi)
        ->and($daApi)->toHaveKey('relatorios')
        ->and($daApi)->not->toHaveKeys(['linhas', 'grupos', 'totais']);

    /*
     * ...e a FIXTURE do web tem de estar em dia (`CRR-13`).
     *
     * A guarda web × API comparava o catálogo da tela contra uma fixture COMMITADA, e nada do
     * lado da API obrigava a regerá-la: mexer nas `permissoes()` de um relatório deixava as
     * duas suítes verdes com o cartão apontando para uma permissão que o servidor já não
     * exige — ou escondido de quem podia ver o dado. Comparando aqui, o lado que MUDA é o
     * lado que reprova.
     */
    $fixture = dirname(base_path()).'/web/src/lib/relatorios/catalogo-da-api.json';
    $comoRegerar = 'Regere com: cd api && php artisan relatorios:catalogo --json > ../web/src/lib/relatorios/catalogo-da-api.json'
        .' (e ajuste `web/src/lib/relatorios/catalogo.ts`, que é comparado com ela).';
    expect(is_file($fixture))->toBeTrue("Fixture do web ausente em `{$fixture}`. {$comoRegerar}");
    expect(json_decode((string) file_get_contents($fixture), true))->toBe($daApi, "A fixture do web está desatualizada. {$comoRegerar}");
});

/**
 * Os relatórios do caixa (change `relatorios-do-caixa`) e o que cada um declara FORA da régua
 * "a coluna de dinheiro é a chave do total" — de propósito e com o porquê:
 *   - `dinheiro_sem_total`: coluna de dinheiro que NÃO se soma (a movimentação lista o valor de
 *     cada ação; criar e excluir o mesmo lançamento somariam duas vezes o mesmo dinheiro);
 *   - `total_fora_da_tabela`: total que não é coluna nem dinheiro (a contagem do recorte da
 *     movimentação, como na da agenda — o papel já diz "N linhas").
 *
 * @return array<string, array{dinheiro_sem_total: list<string>, total_fora_da_tabela: list<string>}>
 */
function reguaDoTotalDoCaixa(): array
{
    $nenhuma = ['dinheiro_sem_total' => [], 'total_fora_da_tabela' => []];

    return [
        'contas-em-aberto' => $nenhuma,
        'recebido-e-pago' => $nenhuma,
        'vendas-do-periodo' => $nenhuma,
        'movimentacao-do-financeiro' => ['dinheiro_sem_total' => ['valor'], 'total_fora_da_tabela' => ['quantidade']],
        'fechamento-de-caixa' => $nenhuma,
    ];
}

it('deve pôr cada total de dinheiro dos relatórios do caixa numa coluna de mesma chave, em toda variante', function () {
    // ARRANGE — a tela só desenha na linha de totais a chave que também é coluna: um total com
    // outro nome some do papel em silêncio, com as duas suítes verdes (achado real do
    // `recebido-por-profissional`, 2026-09-24). Uma cena mínima de hoje: receita em aberto e
    // paga, despesa em aberto e paga — cada Tipo com o que somar
    $this->actingAs(admin());
    $hoje = agoraNaClinica()->toDateString();
    $deHoje = ['competencia' => $hoje, 'vencimento' => $hoje];
    $agora = ['pago_em' => agoraNaClinica()->format('Y-m-d H:i')];
    lancamentoNoCaixa('100.00', $deHoje);
    lancamentoNoCaixa('150.00', $deHoje, $agora);
    lancamentoNoCaixa('40.00', ['tipo' => 'despesa', ...$deHoje]);
    lancamentoNoCaixa('60.00', ['tipo' => 'despesa', ...$deHoje], $agora)->delete();
    $parametros = parametrosDeContratoDosRelatorios();

    foreach (reguaDoTotalDoCaixa() as $slug => $excecoes) {
        foreach ($parametros[$slug] as $variante) {
            // ACT
            $json = $this->getJson("/api/relatorios/{$slug}?".http_build_query(['de' => $hoje, 'ate' => $hoje, ...$variante]))
                ->assertOk()
                ->json();

            // ASSERT — nos dois sentidos: toda coluna de dinheiro tem o seu total (salvo a
            // declarada), e todo total tem a sua coluna (salvo o declarado)
            $colunas = collect($json['colunas']);
            $dinheiro = $colunas->where('tipo', 'dinheiro')->pluck('chave')->all();
            $totais = array_keys($json['totais']);
            $rotulo = "`{$slug}` ".json_encode($variante);
            expect(array_values(array_diff($dinheiro, $totais, $excecoes['dinheiro_sem_total'])))
                ->toBe([], "{$rotulo}: coluna de dinheiro sem o total de mesma chave.")
                ->and(array_values(array_diff($totais, $colunas->pluck('chave')->all(), $excecoes['total_fora_da_tabela'])))
                ->toBe([], "{$rotulo}: total sem coluna — a tela não o desenha.");
        }
    }
});
