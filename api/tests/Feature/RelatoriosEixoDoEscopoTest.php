<?php

use App\Models\Agendamento;
use App\Models\Paciente;
use App\Models\Profissional;
use App\Models\StatusAgendamento;
use App\Models\Tratamento;

/**
 * O EIXO do escopo D11 de cada relatório, PAPEL A PAPEL, contra a porta dona do mesmo dado
 * (achado `SEC-REL-01`/`CRR-01` do gate da change `area-de-relatorios`).
 *
 * A guarda que faltava. Quatro relatórios declaravam eixo `clinico` sobre dado que a casa
 * inteira trata pelo eixo AGENDA (`TratamentoController::index`/`::show`, `PacienteController`,
 * `PacotesAcabando`, `RelatorioController::sessoesVendidasRealizadas`), e a suíte ficava verde
 * porque cada relatório era testado com usuários SEM flag nenhuma — a configuração em que os
 * dois eixos coincidem. Os dois defeitos que passavam por baixo:
 *
 *  (a) **Folha em branco para quem mais usa o relatório.** Secretaria e Faturista (AP-10) têm
 *      `agenda.ver_todos`, NÃO têm `clinico.ver_todos` e NÃO têm vínculo — no eixo clínico isso
 *      é `nenhum`, fail-closed. Quatro dos dez relatórios voltavam vazios, justamente os que a
 *      clínica nomeou como deles.
 *  (b) **A porta antiga contornada pelo relatório.** Um papel com `clinico.ver_todos` e sem
 *      `agenda.ver_todos` saía PLANO no relatório e escopado em `sessoes-vendidas-realizadas`
 *      — o `SEC-VP-45` fechou a porta e o relatório reabria a janela.
 *
 * A régua daqui é comparativa de propósito: não "o relatório devolve N linhas", e sim **o
 * relatório devolve o MESMO conjunto que a porta dona do dado devolve para aquele papel**. Um
 * eixo trocado quebra a igualdade; um eixo trocado nos DOIS lados quebraria a asserção de
 * conteúdo, que também está aqui.
 *
 * LGPD: crianças e profissionais 100% fictícios.
 */

/** O período de hoje, que é onde a cena inteira vive (tudo aberto/realizado hoje). */
function periodoDoEixo(): string
{
    $hoje = agoraNaClinica()->toDateString();

    return "de={$hoje}&ate={$hoje}";
}

/**
 * A cena: duas profissionais, uma criança de cada, cada dupla com pacote ABERTO hoje (sem
 * lançamento) e uma sessão REALIZADA hoje. Nada de terceiros: o conjunto completo é
 * {Bruna, Caio}, e qualquer escopo devolve um subconjunto dele.
 *
 * @return array{ana: Profissional, bruno: Profissional, bruna: Paciente, caio: Paciente}
 */
function cenaDoEixoDoEscopo(): array
{
    $hoje = agoraNaClinica()->toDateString();
    $realizado = StatusAgendamento::where('desconta_sessao', true)->where('marca_falta', false)->orderBy('ordem')->firstOrFail();

    $criar = function (string $nomeDoProfissional, string $nomeDaCrianca, string $hora) use ($hoje, $realizado): array {
        $profissional = Profissional::factory()->create(['nome' => $nomeDoProfissional]);
        $crianca = Paciente::factory()->create(['nome' => $nomeDaCrianca]);
        $pacote = Tratamento::factory()->create([
            'paciente_id' => $crianca->id,
            'profissional_id' => $profissional->id,
            'data_inicio' => $hoje,
            'sessoes_total' => 10,
        ]);
        Agendamento::factory()->create([
            'paciente_id' => $crianca->id,
            'profissional_id' => $profissional->id,
            'especialidade_id' => $pacote->especialidade_id,
            'tratamento_id' => $pacote->id,
            'status_id' => $realizado->id,
            'inicio' => "{$hoje} {$hora}",
            'fim' => "{$hoje} {$hora}",
        ]);

        return [$profissional, $crianca];
    };

    [$ana, $bruna] = $criar('Ana Fictícia', 'Bruna Fictícia', '09:00');
    [$bruno, $caio] = $criar('Bruno Fictício', 'Caio Fictício', '10:00');

    return ['ana' => $ana, 'bruno' => $bruno, 'bruna' => $bruna, 'caio' => $caio];
}

it('deve devolver, em cada relatório e para cada papel do AP-10, o MESMO conjunto que a porta dona do dado', function () {
    // ARRANGE — a cena e os papéis. Todos nascem ANTES da primeira requisição: o `auth:sanctum`
    // troca o guard default e o `usuarioCom` passaria a procurar a permissão no guard errado.
    $administrador = admin();
    $cena = cenaDoEixoDoEscopo();
    $periodo = periodoDoEixo();

    // Secretaria (AP-10): `agenda.ver_todos`, SEM `clinico.ver_todos`, SEM vínculo
    $secretaria = usuarioCom(
        ['agenda.ver', 'agenda.ver_todos', 'pacientes.ver', 'tratamentos.ver', 'lancamentos.ver'],
        'Secretaria Fictícia',
    );
    // Faturista (AP-10): idem, e sem as ações de agenda — a flag ali é OPERACIONAL (`SEC-VP-37`)
    $faturista = usuarioCom(
        ['agenda.ver_todos', 'pacientes.ver', 'tratamentos.ver', 'lancamentos.ver'],
        'Faturista Fictícia',
    );
    // Terapeuta (AP-10): SEM as duas flags, COM vínculo. `pacientes` é NENHUMA para ele (AP-03)
    // e `lancamentos` também não é dele — os dois relatórios que as exigem respondem 403
    $terapeuta = usuarioEscopadoEm($cena['ana'], ['tratamentos.ver']);
    // NÃO é papel do AP-10: é a sonda do defeito (b). Só a flag clínica, sem a da agenda e sem
    // vínculo — no eixo agenda é `nenhum`; com o eixo clínico sairia PLANO
    $soClinico = usuarioCom(
        ['clinico.ver_todos', 'pacientes.ver', 'tratamentos.ver', 'lancamentos.ver'],
        'Só Clínico Fictício',
    );

    $todas = ['Bruna Fictícia', 'Caio Fictício'];
    $soDaAna = ['Bruna Fictícia'];

    $papeis = [
        'Administrador' => ['usuario' => $administrador, 'tem' => ['pacientes.ver', 'tratamentos.ver', 'lancamentos.ver'], 'espera' => $todas],
        'Secretaria' => ['usuario' => $secretaria, 'tem' => ['pacientes.ver', 'tratamentos.ver', 'lancamentos.ver'], 'espera' => $todas],
        'Faturista' => ['usuario' => $faturista, 'tem' => ['pacientes.ver', 'tratamentos.ver', 'lancamentos.ver'], 'espera' => $todas],
        'Terapeuta' => ['usuario' => $terapeuta, 'tem' => ['tratamentos.ver'], 'espera' => $soDaAna],
        'Só clínico' => ['usuario' => $soClinico, 'tem' => ['pacientes.ver', 'tratamentos.ver', 'lancamentos.ver'], 'espera' => []],
    ];

    // relatório → permissões exigidas · porta DONA do mesmo dado · como se lê o conjunto de cada lado
    $nomesDasLinhas = fn (array $json): array => collect($json['linhas'])->pluck('paciente')->sort()->values()->all();
    $relatorios = [
        'pacientes' => [
            'exige' => ['pacientes.ver'],
            'porta' => '/api/pacientes',
            // `GET /pacientes` é PLANO POR DECLARAÇÃO (`EscopoPorPadraoTest`: a recepção precisa
            // do cadastro inteiro), então a régua aqui é CONTIDO, não igual: o relatório nunca
            // pode devolver mais do que a porta — e nunca menos do que o AP-10 manda, que é o
            // que a segunda asserção fiscaliza
            'igualdade' => 'contida',
            'doRelatorio' => $nomesDasLinhas,
            'daPorta' => fn (array $json): array => collect($json['data'])->pluck('nome')->sort()->values()->all(),
        ],
        'sessoes-dos-tratamentos' => [
            'exige' => ['tratamentos.ver'],
            'porta' => '/api/relatorios/sessoes-vendidas-realizadas',
            'igualdade' => 'exata',
            'doRelatorio' => $nomesDasLinhas,
            'daPorta' => fn (array $json): array => collect($json['data'])->pluck('paciente.nome')->sort()->values()->all(),
        ],
        'tratamentos-sem-lancamento' => [
            'exige' => ['tratamentos.ver', 'lancamentos.ver'],
            'porta' => '/api/tratamentos',
            'igualdade' => 'exata',
            'doRelatorio' => $nomesDasLinhas,
            'daPorta' => fn (array $json): array => collect($json['data'])->pluck('paciente.nome')->sort()->values()->all(),
        ],
        // `servicos` é NUMÉRICO (AP-09): não tem nome para comparar, então a régua é a CONTAGEM
        // dos pacotes vendidos no período — que é exatamente o que a porta de tratamentos lista
        'servicos' => [
            'exige' => ['tratamentos.ver'],
            'porta' => '/api/tratamentos',
            'igualdade' => 'exata',
            'doRelatorio' => fn (array $json): array => array_fill(0, (int) $json['totais']['vendidos'], 'x'),
            'daPorta' => fn (array $json): array => array_fill(0, count($json['data']), 'x'),
        ],
    ];

    foreach ($relatorios as $slug => $relatorio) {
        foreach ($papeis as $nomeDoPapel => $papel) {
            $faltando = array_values(array_diff($relatorio['exige'], $papel['tem']));

            trocarDeUsuario();
            $this->actingAs($papel['usuario']);

            // ACT + ASSERT — quem não tem a permissão do módulo dono nem chega ao escopo
            if ($faltando !== []) {
                $this->getJson("/api/relatorios/{$slug}?{$periodo}")->assertForbidden(
                    "`{$slug}` deveria recusar {$nomeDoPapel}, que não tem ".implode(', ', $faltando).' (AP-10).',
                );

                continue;
            }

            $doRelatorio = ($relatorio['doRelatorio'])(
                $this->getJson("/api/relatorios/{$slug}?{$periodo}")->assertOk()->json(),
            );
            $daPorta = ($relatorio['daPorta'])(
                $this->getJson($relatorio['porta'])->assertOk()->json(),
            );

            // ...o relatório devolve o que a PORTA dona do dado devolve para o mesmo papel
            // (ou, quando a porta é plana por declaração, nunca MAIS do que ela)...
            $recado = "`{$slug}` e `{$relatorio['porta']}` discordam para o papel {$nomeDoPapel}: "
                .'o eixo do escopo do relatório não é o da porta dona do dado (SEC-REL-01).';
            if ($relatorio['igualdade'] === 'exata') {
                expect($doRelatorio)->toBe($daPorta, $recado);
            } else {
                expect(array_values(array_diff($doRelatorio, $daPorta)))->toBe([], $recado);
            }

            // ...e é o conjunto que o AP-10 manda — sem isto, "os dois vazios" passaria
            $esperado = $relatorio['doRelatorio'] === $nomesDasLinhas
                ? $papel['espera']
                : array_fill(0, count($papel['espera']), 'x');
            expect($doRelatorio)->toBe(
                $esperado,
                "`{$slug}` devolveu para {$nomeDoPapel} um conjunto diferente do que o AP-10 manda.",
            );
        }
    }
});

it('deve manter o extrato do paciente no MESMO eixo das demais leituras por criança', function () {
    // ARRANGE — o extrato é por-id, então a régua dele é o portão, não o conjunto: quem enxerga
    // a criança na porta dona (`GET /api/tratamentos` a lista) tem de conseguir lê-la, e quem
    // não enxerga leva 403 nos dois lugares
    admin();
    $cena = cenaDoEixoDoEscopo();
    $periodo = periodoDoEixo();
    $terapeuta = usuarioEscopadoEm($cena['ana'], ['tratamentos.ver', 'lancamentos.ver']);

    // ACT + ASSERT — a criança dele
    $this->actingAs($terapeuta)
        ->getJson("/api/relatorios/extrato-do-paciente?{$periodo}&paciente_id={$cena['bruna']->id}")
        ->assertOk();
    trocarDeUsuario();

    // ...e a do colega, que a porta dona também não lista para ele
    $this->actingAs($terapeuta)
        ->getJson("/api/relatorios/extrato-do-paciente?{$periodo}&paciente_id={$cena['caio']->id}")
        ->assertForbidden();
    trocarDeUsuario();
    $daPorta = $this->actingAs($terapeuta)->getJson('/api/tratamentos')->assertOk()->json();
    expect(collect($daPorta['data'])->pluck('paciente.nome')->all())->toBe(['Bruna Fictícia']);
});
