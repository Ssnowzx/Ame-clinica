<?php

use App\Models\Agendamento;
use App\Models\Atendimento;
use App\Models\Especialidade;
use App\Models\Evolucao;
use App\Models\Paciente;
use App\Models\Profissional;
use App\Models\StatusAgendamento;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * A seção Agendamentos da ficha (change agendamentos-na-ficha) — os PRÓXIMOS e os RECENTES.
 *
 * A change nasceu de um caso real (clínica, 2026-09-08): a presença foi registrada e a
 * evolução escrita, e a ficha seguia dizendo "sem agendamentos recentes" porque a sessão
 * daquele dia ainda não tinha chegado ao horário. O primeiro teste daqui é EXATAMENTE esse
 * caso; se ele passar por acidente um dia, a change perdeu o motivo.
 *
 * Dados 100% fictícios (LGPD — dados de MENORES nunca entram em teste).
 */

/** Agendamento do paciente num status e num momento — FKs fixas, sem as closures da factory. */
function agendamentoDaFicha(Paciente $paciente, ?StatusAgendamento $status, Carbon $quando, array $extra = []): Agendamento
{
    return Agendamento::factory()->create([
        'paciente_id' => $paciente->id,
        'status_id' => $status?->id,
        'inicio' => $quando->copy()->setSeconds(0),
        'fim' => $quando->copy()->setSeconds(0)->addMinutes(40),
        ...$extra,
    ]);
}

/**
 * RELÓGIO CONGELADO (achado bloqueante do gate): os cenários somam horas ao "agora", e a partir
 * das 21h da parede da clínica `agora+3h` cai no dia seguinte — o teste que prova o caso da
 * clínica deixaria de cobrir o caso, em silêncio. 09:00 mantém `+3h` sempre no mesmo dia.
 */
beforeEach(fn () => Carbon::setTestNow(Carbon::parse('2026-09-08 09:00:00', 'America/Sao_Paulo')));
afterEach(fn () => Carbon::setTestNow());

describe('agendamentos do paciente na ficha', function () {
    it('deve rodar com o relógio CONGELADO (autoguarda do hook)', function () {
        // Sem isto, quebrar o `beforeEach` do relógio é SILENCIOSO neste arquivo: as fixturas e as
        // asserções derivam do mesmo `agoraNaClinica()`, então os cenários passam com ou sem hook
        // (achado `SEC-SE-13`). Aqui o hook responde por si, na suíte normal, a qualquer hora.
        expect(agoraNaClinica()->format('Y-m-d H:i'))->toBe('2026-09-08 09:00');
    });

    it('deve mostrar a sessão de HOJE que ainda não chegou ao horário', function () {
        // ARRANGE — o caso da clínica: sessão de hoje mais tarde, presença já lançada
        $this->actingAs(admin());
        $paciente = Paciente::factory()->create(['nome' => 'Paciente Fictício']);
        $finalizado = StatusAgendamento::where('nome', 'Finalizado')->firstOrFail();
        $daquiAPouco = agoraNaClinica()->addHours(3);
        agendamentoDaFicha($paciente, $finalizado, $daquiAPouco, [
            'sessao_consumida_em' => $daquiAPouco->copy()->format('Y-m-d H:i'),
        ]);

        // ACT
        $resposta = $this->getJson("/api/pacientes/{$paciente->id}/agendamentos")->assertOk();

        // ASSERT — está nos PRÓXIMOS, com o status lançado; a ficha nunca diz "não há nada"
        expect($resposta->json('proximos.total'))->toBe(1)
            ->and($resposta->json('proximos.itens.0.status.nome'))->toBe('Finalizado')
            ->and($resposta->json('proximos.itens.0.inicio'))->toBe($daquiAPouco->format('Y-m-d H:i'));
    });

    it('deve separar próximos e recentes, cada um na sua ordem', function () {
        // ARRANGE — dois futuros e dois passados, criados fora de ordem
        $this->actingAs(admin());
        $paciente = Paciente::factory()->create();
        $status = StatusAgendamento::where('nome', 'Em Aberto')->firstOrFail();
        agendamentoDaFicha($paciente, $status, agoraNaClinica()->addDays(9));
        agendamentoDaFicha($paciente, $status, agoraNaClinica()->addDays(2));
        agendamentoDaFicha($paciente, $status, agoraNaClinica()->subDays(30));
        agendamentoDaFicha($paciente, $status, agoraNaClinica()->subDays(3));

        // ACT
        $resposta = $this->getJson("/api/pacientes/{$paciente->id}/agendamentos")->assertOk();

        // ASSERT — futuros crescentes (o mais próximo primeiro), recentes decrescentes
        expect($resposta->json('proximos.itens.0.inicio'))->toStartWith(agoraNaClinica()->addDays(2)->toDateString())
            ->and($resposta->json('proximos.itens.1.inicio'))->toStartWith(agoraNaClinica()->addDays(9)->toDateString())
            ->and($resposta->json('recentes.itens.0.inicio'))->toStartWith(agoraNaClinica()->subDays(3)->toDateString())
            ->and($resposta->json('recentes.itens.1.inicio'))->toStartWith(agoraNaClinica()->subDays(30)->toDateString());
    });

    it('deve declarar a janela de cada bloco', function () {
        // ARRANGE
        $this->actingAs(admin());
        $paciente = Paciente::factory()->create();

        // ACT
        $resposta = $this->getJson("/api/pacientes/{$paciente->id}/agendamentos")->assertOk();

        // ASSERT — a tela rotula com o que o servidor mandou; próximos é janela ABERTA
        expect($resposta->json('recentes.janela.de'))->toBe(agoraNaClinica()->subDays(90)->toDateString())
            ->and($resposta->json('recentes.janela.ate'))->toBe(agoraNaClinica()->toDateString())
            ->and($resposta->json('proximos.janela.de'))->toBe(agoraNaClinica()->toDateString())
            ->and($resposta->json('proximos.janela.ate'))->toBeNull()
            ->and($resposta->json('proximos.itens'))->toBe([])
            ->and($resposta->json('recentes.itens'))->toBe([]);
    });

    it('deve deixar fora o que passou dos 90 dias', function () {
        // ARRANGE — dentro (89d) e fora (91d)
        $this->actingAs(admin());
        $paciente = Paciente::factory()->create();
        $status = StatusAgendamento::where('nome', 'Em Aberto')->firstOrFail();
        agendamentoDaFicha($paciente, $status, agoraNaClinica()->subDays(89));
        agendamentoDaFicha($paciente, $status, agoraNaClinica()->subDays(91));

        // ACT
        $resposta = $this->getJson("/api/pacientes/{$paciente->id}/agendamentos")->assertOk();

        // ASSERT
        expect($resposta->json('recentes.total'))->toBe(1)
            ->and($resposta->json('recentes.itens.0.inicio'))->toStartWith(agoraNaClinica()->subDays(89)->toDateString());
    });

    it('deve ignorar bloqueio nos dois blocos', function () {
        // ARRANGE — bloqueio (sem paciente na agenda real, aqui forçado com o paciente)
        $this->actingAs(admin());
        $paciente = Paciente::factory()->create();
        $status = StatusAgendamento::where('nome', 'Em Aberto')->firstOrFail();
        agendamentoDaFicha($paciente, $status, agoraNaClinica()->addDays(1), ['tipo' => 'bloqueio']);
        agendamentoDaFicha($paciente, $status, agoraNaClinica()->subDays(1), ['tipo' => 'bloqueio']);

        // ACT
        $resposta = $this->getJson("/api/pacientes/{$paciente->id}/agendamentos")->assertOk();

        // ASSERT
        expect($resposta->json('proximos.total'))->toBe(0)
            ->and($resposta->json('recentes.total'))->toBe(0);
    });

    it('deve cortar cada bloco no seu próprio teto e declarar o total REAL', function () {
        // ARRANGE — 60 futuros e 210 recentes: exercita os DOIS tetos (50 e 200) e prova que o
        // teto de um bloco não come o outro. Os recentes cabem em 90 dias com 3 por dia.
        $this->actingAs(admin());
        $paciente = Paciente::factory()->create();
        $status = StatusAgendamento::where('nome', 'Em Aberto')->firstOrFail();
        // FKs fixas: sem elas, 270 criações estouram o gerador de valores únicos do faker
        // dentro das closures da factory (profissional/especialidade por agendamento).
        $fks = [
            'profissional_id' => Profissional::factory()->create()->id,
            'especialidade_id' => Especialidade::factory()->create()->id,
        ];
        foreach (range(1, 60) as $dia) {
            agendamentoDaFicha($paciente, $status, agoraNaClinica()->addDays($dia), $fks);
        }
        foreach (range(0, 209) as $indice) {
            agendamentoDaFicha(
                $paciente,
                $status,
                agoraNaClinica()->subDays(intdiv($indice, 3) + 1)->setTime(8 + ($indice % 3), 0),
                $fks,
            );
        }

        // ACT
        $resposta = $this->getJson("/api/pacientes/{$paciente->id}/agendamentos")->assertOk();

        // ASSERT — lista cortada no teto, `total` REAL da janela (é o "M" do "N de M")
        expect($resposta->json('proximos.itens'))->toHaveCount(50)
            ->and($resposta->json('proximos.total'))->toBe(60)
            ->and($resposta->json('recentes.itens'))->toHaveCount(200)
            ->and($resposta->json('recentes.total'))->toBe(210);
    });

    it('deve devolver o item MINIMIZADO — nada clínico, nada do cadastro', function () {
        // ARRANGE — obs clínica no agendamento e cadastro sensível no paciente
        $this->actingAs(admin());
        $paciente = Paciente::factory()->create([
            'nome' => 'Paciente Fictício',
            'cpf' => '39053344705',
        ]);
        $especialidade = Especialidade::factory()->create(['nome' => 'Fonoaudiologia', 'cor' => '#448247']);
        $profissional = Profissional::factory()->create(['nome' => 'Profissional Fictício']);
        $status = StatusAgendamento::where('nome', 'Em Aberto')->firstOrFail();
        agendamentoDaFicha($paciente, $status, agoraNaClinica()->subDays(2), [
            'especialidade_id' => $especialidade->id,
            'profissional_id' => $profissional->id,
            'obs' => 'Segredo clínico que não pode vazar.',
        ]);

        // ACT
        $json = $this->getJson("/api/pacientes/{$paciente->id}/agendamentos")->assertOk()->json();

        // ASSERT — o que entra, e o que NUNCA entra
        expect(array_keys($json['recentes']['itens'][0]))
            ->toBe(['id', 'inicio', 'fim', 'especialidade', 'profissional', 'status', 'tem_evolucao'])
            ->and($json['recentes']['itens'][0]['especialidade']['nome'])->toBe('Fonoaudiologia')
            ->and($json['recentes']['itens'][0]['profissional']['nome'])->toBe('Profissional Fictício');
        semVazamento($json, 'Segredo clínico');
        semVazamento($json, 'Paciente Fictício');
        semVazamento($json, '39053344705');
        semVazamento($json, $paciente->nascimento->format('Y-m-d'));
        semVazamento($json, $paciente->necessidade); // art. 11 — a task prometia e o teste não fazia
    });

    it('deve exigir a permissão agenda.ver', function () {
        // ARRANGE
        $paciente = Paciente::factory()->create();
        $semAgenda = usuarioCom(['pacientes.ver'], 'Sem Agenda');

        // ACT + ASSERT
        $this->actingAs($semAgenda)
            ->getJson("/api/pacientes/{$paciente->id}/agendamentos")
            ->assertForbidden();
    });

    it('deve barrar o escopado no paciente que não é dele — e não vazar existência', function () {
        // ARRANGE — profissional escopado, paciente de um colega
        $this->actingAs(admin());
        $meu = Profissional::factory()->create();
        $doColega = Profissional::factory()->create();
        $status = StatusAgendamento::where('nome', 'Em Aberto')->firstOrFail();
        $pacienteMeu = Paciente::factory()->create();
        $pacienteAlheio = Paciente::factory()->create();
        agendamentoDaFicha($pacienteMeu, $status, agoraNaClinica()->subDays(2), ['profissional_id' => $meu->id]);
        agendamentoDaFicha($pacienteAlheio, $status, agoraNaClinica()->subDays(2), ['profissional_id' => $doColega->id]);
        $escopado = usuarioEscopadoEm($meu);

        // ACT + ASSERT — posse antes da existência: alheio e inexistente respondem igual
        $this->actingAs($escopado)->getJson("/api/pacientes/{$pacienteMeu->id}/agendamentos")->assertOk();
        $this->actingAs($escopado)->getJson("/api/pacientes/{$pacienteAlheio->id}/agendamentos")->assertForbidden();
        $this->actingAs($escopado)->getJson('/api/pacientes/99999999/agendamentos')->assertForbidden();
    });
});

// ── O selo de evolução (change selo-de-evolucao-na-ficha) ────────────────────

/**
 * O item diz SE existe evolução, nunca o que ela diz — e só para quem pode lê-la. TRÊS estados:
 * `true`, `false` e `null` ("não posso saber"). Servir `false` no lugar do `null` transformaria
 * a ausência do selo em duas coisas diferentes.
 */

/** Marca o agendamento como atendido, com ou sem evolução escrita. */
function comEvolucao(Agendamento $agendamento, bool $escrita): void
{
    $atendimento = Atendimento::factory()->create([
        'agendamento_id' => $agendamento->id,
        'finalizado_em' => $agendamento->inicio->copy()->addMinutes(40)->format('Y-m-d H:i'),
    ]);

    if ($escrita) {
        $evolucao = new Evolucao(['conteudo' => 'Conteúdo clínico fictício que não pode vazar.']);
        $evolucao->atendimento_id = $atendimento->id;
        $evolucao->profissional_id = $agendamento->profissional_id;
        $evolucao->preenchida_em = now();
        $evolucao->save();
    }
}

describe('selo de evolução no item', function () {
    it('deve dizer true e false para quem pode ler evoluções', function () {
        // ARRANGE — duas sessões passadas: uma evoluída, outra não
        $this->actingAs(admin());
        $paciente = Paciente::factory()->create();
        $status = StatusAgendamento::where('nome', 'Finalizado')->firstOrFail();
        $comTexto = agendamentoDaFicha($paciente, $status, agoraNaClinica()->subDays(2));
        $semTexto = agendamentoDaFicha($paciente, $status, agoraNaClinica()->subDays(1));
        comEvolucao($comTexto, escrita: true);
        comEvolucao($semTexto, escrita: false);

        // ACT
        $json = $this->getJson("/api/pacientes/{$paciente->id}/agendamentos")->assertOk()->json();

        // ASSERT — o sinal existe, e o CONTEÚDO clínico não
        $porId = collect($json['recentes']['itens'])->keyBy('id');
        expect($porId[$comTexto->id]['tem_evolucao'])->toBeTrue()
            ->and($porId[$semTexto->id]['tem_evolucao'])->toBeFalse();
        semVazamento($json, 'Conteúdo clínico fictício');
        // e nada dos METADADOS do registro clínico: nem o responsável técnico, nem quando foi
        // preenchida — o sinal é a EXISTÊNCIA, e só (nit N-07)
        semVazamento($json, 'preenchida_em');
        semVazamento($json, 'responsavel_tecnico');
        // (não dá para asseverar a ausência da palavra "evolucao": a própria chave do sinal,
        // `tem_evolucao`, a contém — o que se prova é a ausência dos METADADOS acima)
    });

    it('deve devolver null — nunca false — para quem não pode ler evoluções', function () {
        // ARRANGE — usuário só com a agenda; a sessão TEM evolução
        $this->actingAs(admin());
        $paciente = Paciente::factory()->create();
        $status = StatusAgendamento::where('nome', 'Finalizado')->firstOrFail();
        comEvolucao(agendamentoDaFicha($paciente, $status, agoraNaClinica()->subDays(2)), escrita: true);
        // PLANO na agenda (senão o portão por-id barra por falta de vínculo, e o teste passaria
        // pelo motivo errado), mas SEM `evolucoes.ver` — é esse recorte que a asserção mede
        $soAgenda = usuarioCom(['agenda.ver', 'agenda.ver_todos'], 'Só Agenda');

        // ACT
        $itens = $this->actingAs($soAgenda)
            ->getJson("/api/pacientes/{$paciente->id}/agendamentos")->assertOk()
            ->json('recentes.itens');

        // ASSERT — "não posso saber" não pode ser servido como "não existe"
        expect($itens[0]['tem_evolucao'])->toBeNull();
    });

    it('NÃO deve introduzir N+1: o número de consultas não cresce com as linhas', function () {
        // ARRANGE — o mesmo cenário em dois tamanhos; o sinal sai de EXISTS na MESMA consulta
        $this->actingAs(admin());
        $status = StatusAgendamento::where('nome', 'Finalizado')->firstOrFail();
        $fks = [
            'profissional_id' => Profissional::factory()->create()->id,
            'especialidade_id' => Especialidade::factory()->create()->id,
        ];

        $medir = function (int $quantas) use ($status, $fks): int {
            $paciente = Paciente::factory()->create();
            foreach (range(1, $quantas) as $dia) {
                comEvolucao(
                    agendamentoDaFicha($paciente, $status, agoraNaClinica()->subDays($dia), $fks),
                    escrita: true,
                );
            }

            // AQUECE antes de medir: a primeira requisição do processo popula caches de
            // permissão/configuração, e sem isto a medição compara cache frio com cache quente
            // (a 1ª versão deste teste "provou" 13 × 8 consultas e não media N+1 nenhum).
            $this->getJson("/api/pacientes/{$paciente->id}/agendamentos")->assertOk();

            DB::enableQueryLog();
            DB::flushQueryLog();
            $this->getJson("/api/pacientes/{$paciente->id}/agendamentos")->assertOk();
            $total = count(DB::getQueryLog());
            DB::disableQueryLog();

            return $total;
        };

        // ACT
        $com3 = $medir(3);
        $com30 = $medir(30);

        // ASSERT — dez vezes mais linhas, o MESMO número de consultas, e um TETO absoluto:
        // sem ele, uma regressão de +40 consultas CONSTANTES passaria batido (nit N-06)
        expect($com30)->toBe($com3)
            ->and($com3)->toBeLessThan(12); // o real medido é 8
    });

    it('deve devolver o término REAL de cada sessão, para a tela dizer "08:40 às 09:30"', function () {
        // ARRANGE — change horario-de-termino-no-card: sessões do mesmo tratamento podem ter
        // durações diferentes, e a altura de um card não diz o término na lista
        $this->actingAs(admin());
        $paciente = Paciente::factory()->create();
        $status = StatusAgendamento::where('nome', 'Em Aberto')->firstOrFail();
        $inicio = agoraNaClinica()->addDay()->setTime(8, 40);
        // 50 minutos, e não os 40 do ajudante: prova que o término é o gravado, não um cálculo
        agendamentoDaFicha($paciente, $status, $inicio, ['fim' => $inicio->copy()->setTime(9, 30)]);

        // ACT
        $json = $this->getJson("/api/pacientes/{$paciente->id}/agendamentos")->assertOk()->json();

        // ASSERT
        expect($json['proximos']['itens'][0]['inicio'])->toEndWith('08:40')
            ->and($json['proximos']['itens'][0]['fim'])->toEndWith('09:30');
    });

    it('deve manter a whitelist de colunas TAMBÉM no caminho com evolucoes.ver', function () {
        // ARRANGE — o `withExists` faz `addSelect` e, sem `select()` explícito, o Eloquent
        // injeta `agendamentos.*`: a linha inteira (com `obs`, texto livre onde cabe conteúdo
        // clínico) passava a ser hidratada só para quem tem `evolucoes.ver` (`SEC-SE-02`).
        $this->actingAs(admin());
        $paciente = Paciente::factory()->create();
        $status = StatusAgendamento::where('nome', 'Finalizado')->firstOrFail();
        comEvolucao(agendamentoDaFicha($paciente, $status, agoraNaClinica()->subDays(2)), escrita: true);

        // ACT
        DB::enableQueryLog();
        DB::flushQueryLog();
        $this->getJson("/api/pacientes/{$paciente->id}/agendamentos")->assertOk();
        $consultas = collect(DB::getQueryLog())->pluck('query');
        DB::disableQueryLog();

        // ASSERT — nenhuma leitura de `agendamentos` traz a linha inteira
        $daTabela = $consultas->filter(fn (string $sql): bool => str_contains($sql, 'from `agendamentos`'));
        expect($daTabela)->not->toBeEmpty();
        foreach ($daTabela as $sql) {
            expect($sql)->not->toContain('`agendamentos`.*');
            expect($sql)->not->toContain('`obs`');
        }
    });

    it('NÃO deve hidratar a evolução: nenhuma consulta às tabelas do prontuário', function () {
        // ARRANGE — a decisão D1 do selo recusa `with('atendimento.evolucao')` porque hidratar a
        // evolução decifra o `conteudo` na memória do processo. O teste de N+1 NÃO protege isso
        // (com eager-load o número de consultas fica constante e ele passa — `SEC-SE-01`): a
        // guarda é a AUSÊNCIA de leitura das tabelas do prontuário.
        $this->actingAs(admin());
        $paciente = Paciente::factory()->create();
        $status = StatusAgendamento::where('nome', 'Finalizado')->firstOrFail();
        comEvolucao(agendamentoDaFicha($paciente, $status, agoraNaClinica()->subDays(2)), escrita: true);

        // ACT
        DB::enableQueryLog();
        DB::flushQueryLog();
        $this->getJson("/api/pacientes/{$paciente->id}/agendamentos")->assertOk();
        $consultas = collect(DB::getQueryLog())->pluck('query');
        DB::disableQueryLog();

        // ASSERT — `atendimentos`/`evolucoes` só podem aparecer DENTRO do EXISTS da consulta de
        // agendamentos; nunca como leitura própria (que é o que hidrata o registro clínico)
        // pela tabela do `from` de NÍVEL SUPERIOR (achado `SEC-SE-11`): três `str_starts_with`
        // deixavam escapar uma leitura com colunas escolhidas (`select id, conteudo from
        // evolucoes ...`), que hidrata o texto cifrado do mesmo jeito. Os parênteses são
        // removidos antes de olhar o `from`, senão o próprio EXISTS (cujo primeiro `from` é
        // `atendimentos`) seria acusado.
        $tabelaPrincipal = function (string $sql): string {
            do {
                $anterior = $sql;
                $sql = preg_replace('/\([^()]*\)/', ' ', $sql) ?? $sql;
            } while ($sql !== $anterior);

            preg_match('/ from `(\w+)`/', $sql, $tabela);

            return $tabela[1] ?? '';
        };
        $hidratacoes = $consultas->filter(
            fn (string $sql): bool => in_array($tabelaPrincipal($sql), ['atendimentos', 'evolucoes'], strict: true)
        );
        expect($hidratacoes->all())->toBe([]);
    });

    it('deve calar para quem tem a permissão mas NENHUM vínculo clínico (fail-closed)', function () {
        // ARRANGE — papel PLANO na agenda (alcança a ficha) e com `evolucoes.ver`, mas sem
        // `clinico.ver_todos` e sem `profissional_id`: o escopo clínico é `nenhum`. A perna
        // fail-closed estava registrada como testada e não tinha teste (`SEC-SE-05`).
        $this->actingAs(admin());
        $paciente = Paciente::factory()->create();
        $status = StatusAgendamento::where('nome', 'Finalizado')->firstOrFail();
        comEvolucao(agendamentoDaFicha($paciente, $status, agoraNaClinica()->subDays(2)), escrita: true);
        $semVinculo = usuarioCom(['agenda.ver', 'agenda.ver_todos', 'evolucoes.ver'], 'Sem Vínculo Clínico');

        // ACT
        $itens = $this->actingAs($semVinculo)
            ->getJson("/api/pacientes/{$paciente->id}/agendamentos")->assertOk()
            ->json('recentes.itens');

        // ASSERT — sem vínculo, o sinal não sai: `null`, nunca `false`
        expect($itens[0]['tem_evolucao'])->toBeNull();
    });

    it('NÃO deve nem montar a subconsulta quando ninguém vai receber o sinal', function () {
        // ARRANGE — a poda (escopo clínico `nenhum` → nem monta o EXISTS) estava sem guarda: o
        // mutante que a anula sobrevivia à suíte inteira (achado IMPORTANTE do gate r3). O
        // portão continua sendo o `permite()` por linha; o que faltava rede era a otimização.
        $this->actingAs(admin());
        $paciente = Paciente::factory()->create();
        $status = StatusAgendamento::where('nome', 'Finalizado')->firstOrFail();
        comEvolucao(agendamentoDaFicha($paciente, $status, agoraNaClinica()->subDays(2)), escrita: true);
        $semVinculo = usuarioCom(['agenda.ver', 'agenda.ver_todos', 'evolucoes.ver'], 'Sem Vínculo Clínico 2');

        // ACT
        DB::enableQueryLog();
        DB::flushQueryLog();
        $this->actingAs($semVinculo)->getJson("/api/pacientes/{$paciente->id}/agendamentos")->assertOk();
        $consultas = collect(DB::getQueryLog())->pluck('query');
        DB::disableQueryLog();

        // ASSERT — nenhuma consulta carrega o subselect do sinal
        expect($consultas->filter(fn (string $sql): bool => str_contains($sql, 'tem_evolucao'))->all())->toBe([]);
    });

    it('deve calar sobre a evolução do COLEGA para o escopado no eixo clínico', function () {
        // ARRANGE — paciente atendido por dois profissionais, ambas as sessões evoluídas
        $this->actingAs(admin());
        $meu = Profissional::factory()->create();
        $doColega = Profissional::factory()->create();
        $paciente = Paciente::factory()->create();
        $status = StatusAgendamento::where('nome', 'Finalizado')->firstOrFail();
        $minha = agendamentoDaFicha($paciente, $status, agoraNaClinica()->subDays(2), ['profissional_id' => $meu->id]);
        $doOutro = agendamentoDaFicha($paciente, $status, agoraNaClinica()->subDays(1), ['profissional_id' => $doColega->id]);
        comEvolucao($minha, escrita: true);
        comEvolucao($doOutro, escrita: true);
        $escopado = usuarioEscopadoEm($meu, ['evolucoes.ver']);

        // ACT
        $itens = collect(
            $this->actingAs($escopado)
                ->getJson("/api/pacientes/{$paciente->id}/agendamentos")->assertOk()
                ->json('recentes.itens')
        )->keyBy('id');

        // ASSERT — o conteúdo da seção continua multidisciplinar; o SINAL, não
        expect($itens[$minha->id]['tem_evolucao'])->toBeTrue()
            ->and($itens[$doOutro->id]['tem_evolucao'])->toBeNull();
    });
});
