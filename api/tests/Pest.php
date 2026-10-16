<?php

use App\Models\Agendamento;
use App\Models\Atendimento;
use App\Models\Categoria;
use App\Models\Clinica;
use App\Models\Configuracao;
use App\Models\Conta;
use App\Models\Convenio;
use App\Models\Conversa;
use App\Models\Especialidade;
use App\Models\FechamentoCiclo;
use App\Models\LancamentoCaixa;
use App\Models\MensagemTemplate;
use App\Models\Paciente;
use App\Models\Profissional;
use App\Models\Servico;
use App\Models\StatusAgendamento;
use App\Models\TermoConsentimento;
use App\Models\TipoPagamento;
use App\Models\Tratamento;
use App\Models\Usuario;
use App\Models\WhatsappConexao;
use App\Support\CadastroOnline\LinkPublico;
use App\Support\Ciclos\FechamentoDeCiclo;
use App\Support\Configuracoes\ConfiguracaoService;
use Carbon\CarbonImmutable;
use Illuminate\Database\Events\TransactionBeginning;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Spatie\Permission\Models\Role;
use Tests\Concorrencia\CasoDeConcorrencia;
use Tests\TestCase;

pest()->extend(TestCase::class)
    ->use(RefreshDatabase::class)
    ->in('Feature');

/*
 * Concorrência: o caso de teste COMMITA os dados (ver `CasoDeConcorrencia`) — sem isso, a
 * segunda conexão que prova o lock não enxergaria nada, e a prova seria encenação.
 */
pest()->extend(CasoDeConcorrencia::class)->in('Concorrencia');

/**
 * Usuário ESCOPADO: papel SEM as flags `*.ver_todos` (⇒ escopo por vínculo) e vinculado a `$prof`.
 *
 * Existe aqui, e não em cada arquivo de teste, porque o gate de 2026-08-31 mostrou o preço da
 * duplicação: havia QUATRO construtores do mesmo conceito (`usuarioEscopado`, `usuarioClinico`,
 * `escopadoComEspecialidade`, `usuarioSoDaPropriaAgenda`), cada um com uma lista de permissões
 * diferente — e foi a lista divergente que produziu um teste do encaixe que morria no middleware
 * do Spatie e passava sem tocar a trava que dizia provar.
 *
 * @param  list<string>  $extras  permissões além do mínimo de agenda
 */
function usuarioEscopadoEm(Profissional $prof, array $extras = []): Usuario
{
    $usuario = usuarioCom(
        [...['agenda.ver', 'agenda.criar', 'agenda.editar'], ...$extras],
        'Escopado '.$prof->id,
    );
    $usuario->update(['profissional_id' => $prof->id]);

    return $usuario;
}

/**
 * A clínica do teste (a linha única de `clinica`), criada pelo `TestCase` antes de todo teste
 * com banco — com ela nascem os defaults do `ClinicaObserver`.
 */
function clinica(): Clinica
{
    return Clinica::atual();
}

/**
 * Relógio de PAREDE da clínica (fuso default do catálogo) — a convenção da
 * agenda: todo datetime de payload é naive no fuso da clínica, e o now() do PHP
 * (UTC) fica ~3h no futuro da parede. Use para gerar datas de payload/factory.
 */
function agoraNaClinica(): Carbon\Carbon
{
    return now('America/Sao_Paulo');
}

/**
 * Cria um usuário com o nível "Administrador" (criado pelo ClinicaObserver).
 *
 * @param  array<string, mixed>  $atributos  sobrescreve colunas do usuário
 */
function admin(array $atributos = []): Usuario
{
    $usuario = Usuario::factory()->create($atributos);
    $usuario->syncRoles(['Administrador']);

    return $usuario;
}

/**
 * Especialidade (40min) + profissional vinculado + paciente. Vive AQUI (e não num arquivo de teste) porque quatro suites a usam:
 * definida dentro de um `*Test.php`, ela só existe quando a suite inteira roda —
 * e `php artisan test tests/Feature/XTest.php` morria com "undefined function"
 * exatamente quando alguém tentava depurar um teste vermelho isolado.
 *
 * @return array<string, mixed>
 */
function baseDeAgenda(): array
{
    $especialidade = Especialidade::factory()->create(['tempo_sessao' => 40]);
    $profissional = Profissional::factory()->create();
    DB::table('profissional_especialidade')->insert([
        'profissional_id' => $profissional->id,
        'especialidade_id' => $especialidade->id,
    ]);

    return [
        'paciente_id' => Paciente::factory()->create()->id,
        'profissional_id' => $profissional->id,
        'especialidade_id' => $especialidade->id,
        'inicio' => now()->addDay()->format('Y-m-d').' 09:00',
    ];
}

/**
 * Base do DESMARQUE em lote: `baseDeAgenda()` + o status configurado do desmarque
 * (§13). Vive AQUI, e não em `DesmarqueEmLoteTest.php`, pela mesma razão do `baseDeAgenda()`:
 * `DesmarqueAvisoTest` a usa e morria com "undefined function" fora da suíte inteira
 * (gatilho `TEST-HELPER-CROSS-FILE`, fechado pela change `baixa-em-lote-por-status`).
 *
 * @return array<string, mixed>
 */
function baseDoDesmarque(): array
{
    $base = baseDeAgenda();
    app(ConfiguracaoService::class)->set(
        'agenda.status_desmarque_id',
        StatusAgendamento::where('nome', 'Desmarcado pelo Profissional')->firstOrFail()->id
    );

    return $base;
}

/**
 * Base da BAIXA em lote por status: `baseDeAgenda()` + os status da clínica lidos
 * pelas FLAGS novas (`em_aberto` / `aplicavel_em_lote`), nunca por nome — é a régua que a
 * operação usa: `inicial` (em aberto, onde todo agendamento nasce), `finalizado` (alvo que
 * desconta sessão) e `falta_justificada` (alvo que não desconta nem marca falta).
 *
 * @return array<string, mixed>
 */
function baseDaBaixa(): array
{
    $base = baseDeAgenda();
    $alvos = StatusAgendamento::where('aplicavel_em_lote', true)->orderBy('ordem');
    $base['status'] = [
        'inicial' => StatusAgendamento::inicialId(),
        'finalizado' => (clone $alvos)->where('desconta_sessao', true)->firstOrFail()->id,
        'falta_justificada' => (clone $alvos)->where('desconta_sessao', false)->where('marca_falta', false)->firstOrFail()->id,
    ];

    return $base;
}

/**
 * Um atendimento do profissional da base, no horário pedido, no status INICIAL da clínica —
 * direto no banco (sem a guarda de retroativo do serviço: a baixa olha o passado). Dados
 * FICTÍCIOS sempre (LGPD): nenhum paciente real entra em fixture.
 *
 * @param  array<string, mixed>  $base
 * @param  array<string, mixed>  $extra  sobrescreve colunas (`paciente_id`, `tratamento_id`, `status_id`…)
 */
function agendamentoDaBaixa(array $base, string $quando, array $extra = []): Agendamento
{
    $inicio = CarbonImmutable::parse($quando);

    return Agendamento::create([
        'tipo' => 'atendimento',
        'paciente_id' => $extra['paciente_id'] ?? $base['paciente_id'],
        'profissional_id' => $base['profissional_id'],
        'especialidade_id' => $base['especialidade_id'],
        'status_id' => StatusAgendamento::inicialId(),
        'inicio' => $inicio,
        'fim' => $inicio->addMinutes(40),
        ...collect($extra)->except('paciente_id')->all(),
    ]);
}

/**
 * Um PACOTE fictício da criança da base (ou de outra), com o profissional e a especialidade da
 * base, `$total` sessões e `$realizadas` já consumidas — a cena de saldo da baixa em lote por
 * status. `sessoes_realizadas` é server-set (fora do `$fillable`), daí o `forceFill`. Vive aqui
 * porque três suítes o usam (serviço, execução e concorrência da baixa).
 *
 * @param  array<string, mixed>  $base
 */
function pacoteDaBaixa(array $base, int $total, int $realizadas = 0, ?int $pacienteId = null): Tratamento
{
    $tratamento = Tratamento::create([
        ...payloadDeTratamento(),
        'paciente_id' => $pacienteId ?? $base['paciente_id'],
        'profissional_id' => $base['profissional_id'],
        'especialidade_id' => $base['especialidade_id'],
        'sessoes_total' => $total,
    ]);
    $tratamento->forceFill(['sessoes_realizadas' => $realizadas])->save();

    return $tratamento->refresh();
}

/*
 * Os ajudantes da BAIXA em lote por status vivem aqui (e não em `BaixaEmLoteTest.php`) pelo
 * gatilho `TEST-HELPER-CROSS-FILE`: três suítes os usam (serviço, execução e concorrência), e
 * definidos num `*Test.php` só existiriam quando a suíte inteira rodasse.
 */

/** O dia de `$diasAtras` dias atrás na parede da clínica (`Y-m-d`) — a baixa nunca alcança o futuro. */
function diaDaBaixa(int $diasAtras = 1): string
{
    return agoraNaClinica()->subDays($diasAtras)->format('Y-m-d');
}

/**
 * O payload mínimo da prévia/execução da baixa para o profissional da base.
 *
 * @param  array<string, mixed>  $base
 * @return array<string, mixed>
 */
function alcanceDaBaixa(array $base, int $statusId, ?string $de = null, ?string $ate = null): array
{
    return [
        'profissional_id' => $base['profissional_id'],
        'status_id' => $statusId,
        'de' => $de ?? diaDaBaixa(),
        'ate' => $ate ?? $de ?? diaDaBaixa(),
    ];
}

/**
 * Um atendimento REGISTRADO sobre o agendamento (`agendamento_id` é server-set,
 * fora do `$fillable`). Sem evolução: é a forma da "evolução em aberto".
 *
 * @param  array<string, mixed>  $base
 */
function atendimentoRegistradoNaBaixa(array $base, int $agendamentoId, string $finalizadoEm): Atendimento
{
    $atendimento = new Atendimento(['iniciado_em' => $finalizadoEm, 'finalizado_em' => $finalizadoEm]);
    $atendimento->agendamento_id = $agendamentoId;
    $atendimento->save();

    return $atendimento;
}

/**
 * O agendamento do DESMARQUE tem a mesma forma do da baixa: um atendimento no status inicial.
 *
 * @param  array<string, mixed>  $base
 * @param  array<string, mixed>  $extra
 */
function agendamentoDoDesmarque(array $base, string $quando, array $extra = []): Agendamento
{
    return agendamentoDaBaixa($base, $quando, $extra);
}

/**
 * Publica uma versão do termo de consentimento da clínica (FA-08) e a
 * devolve como VIGENTE, aposentando as anteriores — o mesmo efeito do
 * `TermoConsentimentoController@store`, sem passar pela rota.
 *
 * Vive AQUI, e não num `*Test.php`, pela mesma razão do `baseDeAgenda()`: três suítes a
 * usam (pacientes, notificações e a do próprio catálogo). Chamar duas vezes produz v1
 * aposentada + v2 vigente, que é a cena de "aceitou a versão antiga".
 *
 * Texto FICTÍCIO (LGPD/§13): o documento real da clínica entra pela tela, no go-live.
 */
function termoVigente(string $titulo = 'Regulamento dos Atendimentos'): TermoConsentimento
{
    TermoConsentimento::query()->where('vigente', true)->get()
        ->each(function (TermoConsentimento $anterior): void {
            $anterior->vigente = false;
            $anterior->save();
        });

    return TermoConsentimento::factory()->create([
        'titulo' => $titulo,
        'versao' => ((int) TermoConsentimento::query()->max('versao')) + 1,
    ]);
}

/** Cria as 5 pontas do tratamento e devolve o payload base. */
function payloadDeTratamento(): array
{
    $convenio = Convenio::create(['nome' => 'Convênio '.fake()->unique()->word()]);
    $servico = new Servico(['procedimento' => 'Sessão '.fake()->unique()->word(), 'valor' => 150]);
    $servico->convenio_id = $convenio->id;
    $servico->save();

    return [
        'paciente_id' => Paciente::factory()->create()->id,
        'convenio_id' => $convenio->id,
        'especialidade_id' => Especialidade::factory()->create()->id,
        'profissional_id' => Profissional::factory()->create()->id,
        'servico_id' => $servico->id,
        'sessoes_total' => 10,
    ];
}

/**
 * Captura as consultas COM O EPOCH DA TRANSAÇÃO em que rodaram — gatilho TEST-LOCK-EPOCH.
 *
 * `DB::transactionLevel() > $nivelBase` prova que EXISTE transação própria. Não prova que o
 * `for update` e a gravação estão na MESMA: travar as linhas numa `DB::transaction` curta e
 * gravar numa SEGUNDA transação sequencial solta o lock no commit da primeira e reabre a janela
 * TOCTOU entre os dois commits — com o sinal antigo, tudo verde.
 *
 * O epoch sobe UMA vez por transação de topo (`base → base+1`); savepoint aninhado não conta. Duas
 * transações sequenciais têm epochs DIFERENTES, e a asserção `lock.epoch === gravação.epoch`
 * reprova.
 *
 * (O `RefreshDatabase` já segura uma transação em torno de todo teste — daí a linha de base, e
 * não o zero. Foi essa a primeira tentativa de sinal, e era um proxy.)
 *
 * @return callable(): list<array{sql: string, epoch: int|null}> devolve o capturado
 */
function capturarConsultasComEpoch(): callable
{
    $nivelBase = DB::transactionLevel();
    $epoch = 0;
    $consultas = [];

    Event::listen(TransactionBeginning::class, function () use ($nivelBase, &$epoch): void {
        // só a transação de TOPO do código sob teste abre um epoch novo
        if (DB::transactionLevel() === $nivelBase + 1) {
            $epoch++;
        }
    });

    DB::listen(function ($consulta) use ($nivelBase, &$epoch, &$consultas): void {
        $consultas[] = [
            'sql' => strtolower($consulta->sql),
            // fora de transação própria não há epoch — e é isso que a asserção precisa distinguir
            'epoch' => DB::transactionLevel() > $nivelBase ? $epoch : null,
        ];
    });

    // `function () use (&$consultas)`, NUNCA `fn () => $consultas`: a arrow function captura por
    // VALOR, no momento da definição — devolveria o array VAZIO, e toda asserção de lock viraria
    // "não encontrei a consulta". Um helper de prova que não prova nada.
    return function () use (&$consultas): array {
        return $consultas;
    };
}

/**
 * O epoch da PRIMEIRA consulta que casa o filtro. **LANÇA** quando não há epoch — e é isso que
 * o torna uma prova.
 *
 * A primeira versão devolvia `null` em DOIS estados distintos: "não achei a consulta" e "achei,
 * mas ela rodou fora de transação própria". Com isso, apagar o `DB::transaction()` inteiro —
 * a regressão que o gatilho descreve — fazia os dois lados virarem `null`, e
 * `expect(null)->toBe(null)` **PASSAVA**. Um proxy dentro do helper anti-proxy (gate, F-02).
 *
 * Agora a ausência falha por CONSTRUÇÃO: quem chamar `epochDaConsulta()` numa suíte futura não
 * precisa lembrar de assertar `->not->toBeNull()` antes.
 *
 * @param  list<array{sql: string, epoch: int|null}>  $consultas
 * @param  list<string>  $fragmentos  todos precisam estar no SQL
 *
 * @throws RuntimeException
 */
function epochDaConsulta(array $consultas, array $fragmentos): int
{
    $descricao = implode(' + ', $fragmentos);

    foreach ($consultas as $consulta) {
        $casa = true;
        foreach ($fragmentos as $fragmento) {
            if (! str_contains($consulta['sql'], $fragmento)) {
                $casa = false;
                break;
            }
        }

        if (! $casa) {
            continue;
        }

        if ($consulta['epoch'] === null) {
            throw new RuntimeException(
                "A consulta [{$descricao}] rodou FORA de transação própria: em autocommit o InnoDB "
                .'solta o `for update` no fim do statement, e a guarda vira palpite.'
            );
        }

        return $consulta['epoch'];
    }

    throw new RuntimeException(
        "A consulta [{$descricao}] não foi emitida. Sem ela não há o que provar — a guarda que "
        .'este teste protege pode ter sido apagada.'
    );
}

/**
 * Troca de usuário DENTRO do mesmo teste: o guard cacheia o usuário do primeiro `actingAs`, e o
 * segundo viraria 401 sem este flush (é o que `usuarioCom` já faz ao criar — mas só na criação).
 */
function trocarDeUsuario(): void
{
    test()->flushSession();
    app('auth')->forgetGuards();
}

/**
 * Uma clínica com o auto-cadastro público LIGADO, e o endereço dela.
 *
 * Mora aqui, e não no arquivo de teste que a usa primeiro, por causa do gatilho
 * `TEST-HELPER-CROSS-FILE`: função definida dentro de um `*Test.php` só existe quando a suíte
 * inteira roda — rodar o arquivo sozinho quebra, e sob execução em paralelo os arquivos caem em
 * processos diferentes e quebram também.
 */
function clinicaComLinkLigado(string $nome = 'Clínica Fictícia'): string
{
    admin();
    Configuracao::create(['chave' => 'cadastro_online.ativo', 'valor' => true]);
    Configuracao::create(['chave' => 'clinica.nome', 'valor' => $nome]);

    return app(LinkPublico::class)->rotacionar();
}

/**
 * Um envio público válido — dados 100% FICTÍCIOS (LGPD: nunca dado real de paciente).
 *
 * Mora aqui, e não no arquivo de teste do envio, porque ajudante declarado dentro de um
 * `*Test.php` não existe quando OUTRO arquivo roda sozinho (gatilho `TEST-HELPER-CROSS-FILE`).
 */
function envioValido(array $sobrescritas = []): array
{
    return [
        'nome' => 'Criança Fictícia do Envio',
        'nascimento' => '2018-03-15',
        'sexo' => 'feminino',
        'responsaveis_json' => [['nome' => 'Responsável Fictícia', 'parentesco' => 'Mãe']],
        ...$sobrescritas,
    ];
}

/**
 * Reproduz a resposta de PRODUÇÃO nas negativas.
 *
 * Com `APP_DEBUG` ligado, o corpo de um 404 carrega rastro de pilha — e o rastro traz o número da
 * linha de quem chamou, o que faz duas negativas idênticas parecerem diferentes. A propriedade que
 * a spec exige é sobre o que a clínica publica, não sobre o modo de depuração.
 */
function comoEmProducao(): void
{
    config(['app.debug' => false]);
}

/**
 * Usuário com um nível de permissões recortado.
 *
 * @param  list<string>  $permissoes
 */
function usuarioCom(array $permissoes, string $nivel): Usuario
{
    $papel = Role::create(['name' => $nivel]);
    $papel->givePermissionTo($permissoes);
    $usuario = Usuario::factory()->create();
    $usuario->syncRoles([$papel]);

    test()->flushSession();
    app('auth')->forgetGuards();

    return $usuario;
}

/**
 * "Este texto NÃO está no JSON" — a guarda de vazamento, sem o buraco do escape.
 *
 * `json_encode` escapa não-ASCII por padrão: `Observação clínica` vira
 * `Observação clínica`. Todo `->not->toContain('<texto acentuado>')` sobre
 * `json_encode()` cru **NUNCA FALHA** — e seis guardas desta base estavam assim, entre elas a que
 * promete que a observação clínica de uma CRIANÇA não vaza na listagem e não vai crua na
 * auditoria (re-review r11). Guarda de LGPD que não pode falhar é pior que guarda nenhuma: ela
 * dá a sensação de estar protegido.
 *
 * @param  mixed  $json  o payload (array/objeto) da resposta
 */
function semVazamento(mixed $json, string $texto): void
{
    // UNESCAPED_SLASHES junto: `json_encode` também vira `/` em `\/`, e o dia em que alguém
    // passar uma URL para cá a guarda morreria do mesmo jeito, em silêncio.
    expect(json_encode($json, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES))->not->toContain($texto);
}

/**
 * A CENA DO CICLO, 100% fictícia (LGPD): convênio com calendário `dia_fixo` 15 (o da
 * Unimed), tratamento nele, agendamento apontando esse tratamento e atendimento finalizado
 * em 01/07/2026 — dentro da janela **16/06–15/07/2026**, que os testes fecham quando querem.
 *
 * Vive AQUI, e não num arquivo de teste, pela mesma razão do `baseDeAgenda()`: quatro suítes
 * a usam (imutabilidade, vínculo, guarda e o teste cruzado), e definida dentro de um
 * `*Test.php` ela só existiria quando a suíte inteira rodasse — `php artisan test
 * tests/Feature/XTest.php` morreria com "undefined function" exatamente quando alguém
 * tentasse depurar um teste vermelho isolado.
 *
 * As datas são FIXAS e passadas de propósito: `finalizado_em` no futuro é recusado pelo
 * `validarTempos`, e uma janela derivada de `now()` mudaria de mês no meio do ano e levaria
 * junto a asserção da mensagem 422.
 *
 * @return array{convenio: Convenio, tratamento: Tratamento, agendamento: Agendamento, atendimento: Atendimento}
 */
function cenaDeCiclo(string $finalizadoEm = '2026-07-01 10:00'): array
{
    $convenio = Convenio::create([
        'nome' => 'Operadora Fictícia '.fake()->unique()->word(),
        'ciclo_tipo_corte' => 'dia_fixo',
        'ciclo_dia_corte' => 15,
    ]);

    $agendamento = Agendamento::factory()->create();
    $tratamento = Tratamento::factory()->create([
        'convenio_id' => $convenio->id,
        'paciente_id' => $agendamento->paciente_id,
        'especialidade_id' => $agendamento->especialidade_id,
        'profissional_id' => $agendamento->profissional_id,
    ]);
    // `tratamento_id` é fillable, mas o forceFill evita passar pelo serviço de agenda —
    // a cena é o ESTADO, não o caminho que levou até ele
    $agendamento->forceFill(['tratamento_id' => $tratamento->id])->save();

    $atendimento = Atendimento::factory()->create([
        'agendamento_id' => $agendamento->id,
        'finalizado_em' => $finalizadoEm,
    ]);

    return [
        'convenio' => $convenio,
        'tratamento' => $tratamento->refresh(),
        'agendamento' => $agendamento->refresh(),
        'atendimento' => $atendimento->refresh(),
    ];
}

/**
 * Fecha a janela 16/06–15/07/2026 do convênio pelo caminho REAL (`comLockDoConvenio` +
 * `fechar`) — nunca por INSERT direto: um fechamento inserido na mão passaria por cima da
 * validação de janela derivável, e os testes de recusa provariam algo que a API não produz.
 */
function fecharJanelaDeJulho(Convenio $convenio, Usuario $por): FechamentoCiclo
{
    return FechamentoDeCiclo::comLockDoConvenio(
        $convenio->id,
        fn (Convenio $travado) => FechamentoDeCiclo::fechar($travado, '2026-06-16', '2026-07-15', $por->id),
    );
}

/**
 * Lançamento de RECEITA amarrado a um tratamento — o caminho pelo qual o dinheiro alcança o
 * convênio (`lancamento → tratamento → convenio`).
 *
 * `tratamento_id` é server-set (fora do `$fillable`, T-fin-10), então ele é atribuído aqui
 * na mão. O lançamento MANUAL só alcança convênio quando alguém o vincula a um tratamento
 * (change `recebido-por-profissional`); sem vínculo, nunca é travado por ciclo (fail-open do D5).
 *
 * Mora no Pest.php pelo mesmo motivo das demais: três suítes de ciclo a usam.
 */
function lancamentoDoTratamento(int $tratamentoId, string $competencia): LancamentoCaixa
{
    $lancamento = new LancamentoCaixa([
        'tipo' => 'receita',
        'competencia' => $competencia,
        'vencimento' => $competencia,
        'valor' => '150.00',
        'contabil' => true,
        'categoria_id' => Categoria::create([
            'nome' => 'Receita Fictícia '.fake()->unique()->numberBetween(1, 99999),
            'tipo' => 'receita',
        ])->id,
        'tipo_pagamento_id' => TipoPagamento::create([
            'nome' => 'Pgto Fictício '.fake()->unique()->numberBetween(1, 99999),
        ])->id,
        'conta_id' => Conta::create([
            'nome' => 'Caixa Fictício '.fake()->unique()->numberBetween(1, 99999),
        ])->id,
    ]);
    $lancamento->tratamento_id = $tratamentoId;
    $lancamento->save();

    return $lancamento->refresh();
}

/*
|--------------------------------------------------------------------------
| Mensageria (change mensageria-whatsapp)
|--------------------------------------------------------------------------
|
| Vivem AQUI, e não dentro de um `*Test.php`, pela mesma razão do `baseDeAgenda()`:
| quatro suítes as usam (conexão, webhook, envio e lembretes), e definidas dentro de um
| arquivo de teste elas só existiriam quando a suíte inteira rodasse — `php artisan test
| tests/Feature/XTest.php` morreria com "undefined function" exatamente quando alguém
| tentasse depurar um teste vermelho isolado.
|
| Credenciais e números 100% FICTÍCIOS (LGPD).
*/

/** 32 hex — o tamanho que a Meta emite (o piso da validação é 32). */
const SEGREDO_FICTICIO = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

const PHONE_ID_FICTICIO = '111222333444555';

/** Canal da clínica já VERIFICADO (`conectado`) — o estado pós-go-live. */
function canalConectado(string $phoneNumberId = PHONE_ID_FICTICIO): WhatsappConexao
{
    $conexao = new WhatsappConexao([
        'phone_number_id' => $phoneNumberId,
        'waba_id' => '999888777666555',
        'numero_exibicao' => '+55 11 3333-4444',
    ]);
    $conexao->access_token = 'EAAF_TOKEN_FICTICIO_PARA_TESTE_WXYZ';
    $conexao->app_secret = SEGREDO_FICTICIO;
    $conexao->verify_token = 'verify-ficticio-para-teste-1234567890';
    $conexao->estado = 'conectado';
    $conexao->save();

    return $conexao;
}

/**
 * Conversa com a janela de 24h ABERTA (ou fechada, para provar a recusa do texto livre).
 * `telefone_e164` é server-set (fora do `$fillable`), daí a atribuição direta.
 */
function conversaAberta(bool $janelaAberta = true): Conversa
{
    $conversa = new Conversa(['nome_perfil' => 'Perfil Fictício']);
    $conversa->telefone_e164 = '+5511987654321';
    $conversa->janela_expira_em = $janelaAberta ? now()->addHours(20) : now()->subHour();
    $conversa->save();

    return $conversa;
}

/** Template APROVADO na Meta, espelhado na clínica. */
function templateAprovado(string $nome = 'lembrete_agendamento'): MensagemTemplate
{
    return MensagemTemplate::create([
        'nome' => $nome,
        'idioma' => 'pt_BR',
        'categoria' => 'UTILITY',
        'corpo_previa' => 'Olá {{1}}, lembrando da sua sessão em {{2}}.',
        'variaveis_json' => ['1', '2'],
        'status_meta' => 'APPROVED',
    ]);
}

/**
 * O paciente mínimo que o cadastro aceita — menor, com um responsável.
 *
 * Mora aqui, e não dentro de um arquivo de teste, por causa de um achado do gate
 * (TETO-SEC-05): enquanto ele vivia em `PacientesTest.php`, o teste que prova a igualdade
 * "teto da régua == teto que o servidor recusa" dava `undefined function` para quem abrisse
 * o arquivo e o rodasse sozinho — que é o gesto natural de quem for mexer nele.
 *
 * Dados 100% FICTÍCIOS (LGPD).
 *
 * @return array<string, mixed>
 */
function pacienteMenorValido(): array
{
    return [
        'nome' => 'Paciente Fictício Menor',
        'nascimento' => now()->subYears(7)->toDateString(),
        'sexo' => 'feminino',
        'necessidade' => 'sem',
        'responsaveis_json' => [
            ['nome' => 'Responsável Fictícia', 'parentesco' => 'mãe', 'telefone' => '48999990000'],
        ],
    ];
}

/**
 * Agendamento de HOJE já CONSUMIDO (marcador da etapa 6) com tratamento
 * precificado por serviço de convênio; catálogo do caixa pronto. O convênio
 * nasce SEM a flag particular (fail-closed §14) — cada teste liga o que precisa.
 *
 * Mora aqui desde a change `caixa-do-dia-a-dia` (faturar já pago): duas suítes a usam, e
 * ajudante declarado num `*Test.php` não existe quando o OUTRO arquivo roda sozinho (gatilho
 * `TEST-HELPER-CROSS-FILE`).
 */
function cenarioDeFaturamento(string $hora = '00:00'): array
{
    app(ConfiguracaoService::class)->set('agenda.permitir_retroativo', true);

    $especialidade = Especialidade::factory()->create(['tempo_sessao' => 40]);
    $profissional = Profissional::factory()->create();
    DB::table('profissional_especialidade')->insert([
        'profissional_id' => $profissional->id,
        'especialidade_id' => $especialidade->id,
    ]);
    $paciente = Paciente::factory()->create();
    $convenio = Convenio::create(['nome' => 'Convênio Fictício '.fake()->unique()->numberBetween(1, 99999)]);
    $servico = new Servico(['procedimento' => 'Sessão Fictícia', 'valor' => '180.00']);
    $servico->convenio_id = $convenio->id; // fora do fillable — vem da rota aninhada
    $servico->save();
    $tratamento = Tratamento::factory()->create([
        'paciente_id' => $paciente->id,
        'especialidade_id' => $especialidade->id,
        'profissional_id' => $profissional->id,
        'convenio_id' => $convenio->id,
        'servico_id' => $servico->id,
        'sessoes_total' => 10,
    ]);

    $finalizado = StatusAgendamento::where('nome', 'Finalizado')->firstOrFail();
    $agendamento = test()->postJson('/api/agendamentos', [
        'paciente_id' => $paciente->id,
        'profissional_id' => $profissional->id,
        'especialidade_id' => $especialidade->id,
        'tratamento_id' => $tratamento->id,
        'inicio' => agoraNaClinica()->format('Y-m-d').' '.$hora,
        'status_id' => $finalizado->id, // consome na criação (etapa 6)
    ])->assertCreated()->json('id');

    $payloadFaturamento = [
        'categoria_id' => Categoria::create(['nome' => 'Receita Clínica '.fake()->unique()->numberBetween(1, 99999), 'tipo' => 'receita'])->id,
        'tipo_pagamento_id' => TipoPagamento::create(['nome' => 'PIX Fat '.fake()->unique()->numberBetween(1, 99999)])->id,
        'conta_id' => Conta::create(['nome' => 'Caixa Fat '.fake()->unique()->numberBetween(1, 99999)])->id,
    ];

    return [$agendamento, $payloadFaturamento, $convenio, $tratamento];
}

/**
 * Um lançamento no estado em que o caixa o deixa, para os RELATÓRIOS DO CAIXA (change
 * `relatorios-do-caixa`): setembro de 2026, catálogo fictício da clínica (uma categoria
 * por natureza, "PIX Fictício", "Caixa Fictício"). `pago_em`, `agendamento_id` e `tratamento_id`
 * são do servidor (fora do `$fillable`), então entram por `forceFill` em `$doServidor`.
 *
 * Mora aqui, e não num `*Test.php`, pelo gatilho `TEST-HELPER-CROSS-FILE`: os quatro relatórios
 * do caixa e o teste de contrato o usam. Dados 100% FICTÍCIOS (LGPD).
 *
 * @param  array<string, mixed>  $atributos  fillable a sobrescrever (tipo, vencimento, interessado…)
 * @param  array<string, mixed>  $doServidor  pago_em, agendamento_id, tratamento_id
 */
function lancamentoNoCaixa(string $valor, array $atributos = [], array $doServidor = []): LancamentoCaixa
{
    $tipo = $atributos['tipo'] ?? 'receita';
    $lancamento = new LancamentoCaixa([
        'tipo' => $tipo,
        'competencia' => '2026-09-10',
        'vencimento' => '2026-09-10',
        'valor' => $valor,
        'contabil' => true,
        'categoria_id' => Categoria::firstOrCreate(['nome' => "Categoria Fictícia {$tipo}", 'tipo' => $tipo])->id,
        'tipo_pagamento_id' => TipoPagamento::firstOrCreate(['nome' => 'PIX Fictício'])->id,
        'conta_id' => Conta::firstOrCreate(['nome' => 'Caixa Fictício'])->id,
        ...$atributos,
    ]);
    $lancamento->forceFill($doServidor)->save();

    return $lancamento->refresh();
}
