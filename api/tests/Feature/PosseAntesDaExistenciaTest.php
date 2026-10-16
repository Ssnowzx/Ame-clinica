<?php

use App\Models\Agendamento;
use App\Models\Anamnese;
use App\Models\AnamneseModelo;
use App\Models\Atendimento;
use App\Models\Evolucao;
use App\Models\Paciente;
use App\Models\Profissional;
use App\Models\Usuario;
use Illuminate\Support\Facades\Log;
use Monolog\Handler\TestHandler;

/**
 * POSSE ANTES DA EXISTÊNCIA nas portas CLÍNICAS e POR PACIENTE (`SEC-VP-46`/`SEC-VP-47`/`SEC-VP-48`,
 * rodada 4 do gate de `vinculo-previo-para-agendar`).
 *
 * O predicado é um só, e a lição da change é que o conserto tem de seguir o PREDICADO, não o
 * repro: "para o escopado, registro do colega e registro inexistente respondem IGUAL". Nas portas
 * da agenda e do pacote isso fechou nas rodadas 2–3 (`SEC-VP-33`/`SEC-VP-40`); nas portas abaixo o
 * `findOrFail` continuava ANTES da posse — colega 403, inexistente 404 —, e a diferença contava se
 * o id existe. Para as leituras por paciente é pior: a seleção esconde de propósito a criança que
 * recebeu alta (`SEC-BPL-04`), e o 403 da leitura por id era a única confirmação de que ela existe.
 *
 * Um teste por porta seria 14 cópias do mesmo arranjo; aqui a tabela é o teste, e cada linha
 * nomeia a porta e o id que a rodada 4 lhe deu.
 */
const ID_INEXISTENTE = 987654321;

/** A mensagem do portão de posse — a do middleware de permissão do Spatie é outra. */
const MENSAGEM_DO_PORTAO = 'Fora do seu escopo de profissional.';

/** A cena do COLEGA: sessão passada com atendimento, evolução e anamnese da criança dele. */
function cenaDoColegaParaPosse(): array
{
    $colega = Profissional::factory()->create();
    $crianca = Paciente::factory()->create();
    $inicio = agoraNaClinica()->copy()->subDay()->setTime(9, 0);
    $sessao = Agendamento::factory()->create([
        'tipo' => 'atendimento',
        'profissional_id' => $colega->id,
        'paciente_id' => $crianca->id,
        'inicio' => $inicio,
        'fim' => $inicio->copy()->addMinutes(40),
    ]);
    $atendimento = Atendimento::factory()->create([
        'agendamento_id' => $sessao->id,
        'finalizado_em' => agoraNaClinica()->copy()->subHour()->format('Y-m-d H:i'),
    ]);
    $evolucao = new Evolucao([
        'profissional_id' => $colega->id,
        'conteudo' => 'Evolução clínica fictícia da sessão.',
    ]);
    $evolucao->atendimento_id = $atendimento->id;
    $evolucao->preenchida_em = agoraNaClinica()->format('Y-m-d H:i');
    $evolucao->save();

    $modelo = AnamneseModelo::create([
        'titulo' => 'Ficha Fictícia '.fake()->unique()->numberBetween(1, 99999),
        'campos_json' => [['id' => 'queixa', 'tipo' => 'texto', 'rotulo' => 'Queixa', 'obrigatorio' => false]],
        'ativo' => true,
    ]);
    $anamnese = new Anamnese(['modelo_id' => $modelo->id, 'respostas_json' => ['queixa' => 'Fictícia.']]);
    $anamnese->paciente_id = $crianca->id;
    $anamnese->preenchida_em = agoraNaClinica()->format('Y-m-d H:i');
    $anamnese->save();

    return compact('colega', 'crianca', 'sessao', 'atendimento', 'evolucao', 'anamnese', 'modelo');
}

/** O profissional ESCOPADO com todas as permissões das portas — o 403 tem de vir do portão, não do middleware. */
function escopadoComAsPortasClinicas(Profissional $prof): Usuario
{
    return usuarioEscopadoEm($prof, [
        'pacientes.ver',
        'atendimentos.ver', 'atendimentos.criar', 'atendimentos.editar', 'atendimentos.excluir',
        'evolucoes.ver', 'evolucoes.criar', 'evolucoes.editar',
        'anamneses.ver', 'anamneses.criar', 'anamneses.editar',
    ]);
}

/**
 * As portas: [método, rota do colega, rota inexistente, payload].
 *
 * @return list<array{0: string, 1: string, 2: string, 3: array<string, mixed>}>
 */
function portasDaPosse(array $cena, Profissional $autor, bool $assinaPorOutro = false): array
{
    $c = $cena;
    $anamnesePayload = ['modelo_id' => $c['modelo']->id, 'respostas_json' => ['queixa' => 'x']];
    // quem não tem vínculo assina EM NOME DE OUTRO (FA-04) e a Request exige o motivo — sem ele o
    // par de controle do administrador morreria em 422 antes de chegar à existência
    $evolucaoPayload = ['profissional_id' => $autor->id, 'conteudo' => 'x', ...($assinaPorOutro ? ['motivo_assinatura' => 'Controle fictício.'] : [])];

    return [
        ['post', "/api/agendamentos/{$c['sessao']->id}/atendimento", '/api/agendamentos/'.ID_INEXISTENTE.'/atendimento', []],
        ['get', "/api/atendimentos/{$c['atendimento']->id}", '/api/atendimentos/'.ID_INEXISTENTE, []],
        ['put', "/api/atendimentos/{$c['atendimento']->id}", '/api/atendimentos/'.ID_INEXISTENTE, ['observacoes' => 'x']],
        ['delete', "/api/atendimentos/{$c['atendimento']->id}", '/api/atendimentos/'.ID_INEXISTENTE, []],
        ['post', "/api/atendimentos/{$c['atendimento']->id}/evolucao", '/api/atendimentos/'.ID_INEXISTENTE.'/evolucao', $evolucaoPayload],
        ['get', "/api/evolucoes/{$c['evolucao']->id}", '/api/evolucoes/'.ID_INEXISTENTE, []],
        ['put', "/api/evolucoes/{$c['evolucao']->id}", '/api/evolucoes/'.ID_INEXISTENTE, ['conteudo' => 'x']],
        ['get', "/api/pacientes/{$c['crianca']->id}/anamneses", '/api/pacientes/'.ID_INEXISTENTE.'/anamneses', []],
        ['post', "/api/pacientes/{$c['crianca']->id}/anamneses", '/api/pacientes/'.ID_INEXISTENTE.'/anamneses', $anamnesePayload],
        ['get', "/api/anamneses/{$c['anamnese']->id}", '/api/anamneses/'.ID_INEXISTENTE, []],
        ['put', "/api/anamneses/{$c['anamnese']->id}", '/api/anamneses/'.ID_INEXISTENTE, ['respostas_json' => ['queixa' => 'x']]],
        ['get', "/api/pacientes/{$c['crianca']->id}/comparecimento-recente", '/api/pacientes/'.ID_INEXISTENTE.'/comparecimento-recente', []],
        ['get', "/api/pacientes/{$c['crianca']->id}/presenca", '/api/pacientes/'.ID_INEXISTENTE.'/presenca', []],
        ['get', "/api/pacientes/{$c['crianca']->id}/resumo", '/api/pacientes/'.ID_INEXISTENTE.'/resumo', []],
    ];
}

it('deve responder IGUAL (403) ao registro do colega e ao inexistente nas 14 portas clínicas e por paciente', function () {
    // ARRANGE
    admin();
    $cena = cenaDoColegaParaPosse();
    $proprio = Profissional::factory()->create();
    $escopado = escopadoComAsPortasClinicas($proprio);

    // ACT — o 403 tem de ser o do PORTÃO (re-review da rodada 4, CR4b-06): o middleware de
    // permissão também responde 403, com outra mensagem, e um teste que só olha o status ficaria
    // verde com a permissão da rota renomeada e o portão nunca tocado.
    $divergentes = [];
    foreach (portasDaPosse($cena, $proprio) as [$metodo, $doColega, $inexistente, $payload]) {
        $chamada = $metodo.'Json';
        $colega = $this->actingAs($escopado)->{$chamada}($doColega, $payload);
        $naoExiste = $this->actingAs($escopado)->{$chamada}($inexistente, $payload);
        $doPortao = fn ($resposta): bool => $resposta->status() === 403
            && $resposta->json('message') === MENSAGEM_DO_PORTAO;
        if (! $doPortao($colega) || ! $doPortao($naoExiste)) {
            $divergentes[] = strtoupper($metodo)." {$doColega}: colega={$colega->status()} "
                .json_encode($colega->json('message'))." inexistente={$naoExiste->status()} "
                .json_encode($naoExiste->json('message'));
        }
    }

    // ASSERT — a lista vazia é o predicado inteiro; a linha que aparecer nomeia a porta que abriu
    expect($divergentes)->toBe([]);
});

it('deve continuar respondendo 404 ao inexistente para quem é PLANO — a cegueira é do escopado, não do sistema', function () {
    // ARRANGE — o par de controle: se o 403 do inexistente vier de outra coisa (validação,
    // middleware), o admin também o veria. Ele precisa ver 404.
    $administrador = admin();
    $cena = cenaDoColegaParaPosse();

    // ACT
    $naoDeram404 = [];
    foreach (portasDaPosse($cena, $cena['colega'], assinaPorOutro: true) as [$metodo, $doColega, $inexistente, $payload]) {
        $status = $this->actingAs($administrador)->{$metodo.'Json'}($inexistente, $payload)->status();
        if ($status !== 404) {
            $naoDeram404[] = strtoupper($metodo)." {$inexistente}: {$status}";
        }
    }

    // ASSERT
    expect($naoDeram404)->toBe([]);
});

it('deve decidir a AUTORIA da evolução antes da validação: colega e inexistente dão 403, nunca 422 (SEC-VP-48)', function () {
    // ARRANGE — no atendimento PRÓPRIO, assinar com o `profissional_id` do colega dava 422 "só
    // registra em nome próprio" e com um id inexistente 422 "não existe": o quadro de
    // profissionais enumerado pela mensagem. Decidida no `authorize()` pelo eixo clínico, as duas
    // viram 403 iguais — e a invariante do controller continua como rede.
    admin();
    $proprio = Profissional::factory()->create();
    $colega = Profissional::factory()->create();
    $crianca = Paciente::factory()->create();
    $inicio = agoraNaClinica()->copy()->subDay()->setTime(9, 0);
    $sessaoPropria = Agendamento::factory()->create([
        'tipo' => 'atendimento',
        'profissional_id' => $proprio->id,
        'paciente_id' => $crianca->id,
        'inicio' => $inicio,
        'fim' => $inicio->copy()->addMinutes(40),
    ]);
    $atendimentoProprio = Atendimento::factory()->create([
        'agendamento_id' => $sessaoPropria->id,
        'finalizado_em' => agoraNaClinica()->copy()->subHour()->format('Y-m-d H:i'),
    ]);
    $escopado = escopadoComAsPortasClinicas($proprio);

    // ACT
    $comOColega = $this->actingAs($escopado)
        ->postJson("/api/atendimentos/{$atendimentoProprio->id}/evolucao", ['profissional_id' => $colega->id, 'conteudo' => 'x']);
    $comInexistente = $this->actingAs($escopado)
        ->postJson("/api/atendimentos/{$atendimentoProprio->id}/evolucao", ['profissional_id' => ID_INEXISTENTE, 'conteudo' => 'x']);
    $emNomeProprio = $this->actingAs($escopado)
        ->postJson("/api/atendimentos/{$atendimentoProprio->id}/evolucao", ['profissional_id' => $proprio->id, 'conteudo' => 'Evolução fictícia.']);

    // ASSERT
    $comOColega->assertForbidden();
    $comInexistente->assertForbidden();
    $emNomeProprio->assertCreated();
});

it('deve registrar no canal a recusa do PRONTUÁRIO do colega, e não a do inexistente (CR4b-03)', function () {
    // ARRANGE — `assegurarAlgum` (a evolução tem três donos: autor, RT, atendente) recusava sem
    // rastro; a rodada 4 o pôs no mesmo contrato de `assegurarPosse` — e a re-review mediu que a
    // mudança estava sem teste: removido o registro, 83 testes seguiam verdes.
    admin();
    $cena = cenaDoColegaParaPosse();
    $proprio = Profissional::factory()->create();
    $escopado = escopadoComAsPortasClinicas($proprio);
    $handler = new TestHandler;
    Log::channel('seguranca')->getLogger()->pushHandler($handler);

    // ACT
    $this->actingAs($escopado)->getJson("/api/evolucoes/{$cena['evolucao']->id}")->assertForbidden();
    $registrosAposOColega = count($handler->getRecords());
    $this->actingAs($escopado)->getJson('/api/evolucoes/'.ID_INEXISTENTE)->assertForbidden();

    // ASSERT — um registro, com o autor da evolução como profissional tentado; o inexistente cala
    expect($registrosAposOColega)->toBe(1)
        ->and(count($handler->getRecords()))->toBe(1);
    $contexto = $handler->getRecords()[0]['context'];
    expect($handler->getRecords()[0]['message'])->toBe('escopo.posse_negada')
        ->and($contexto['profissional_tentado_id'])->toBe($cena['colega']->id)
        ->and($contexto['profissional_do_escopo_id'])->toBe($proprio->id);
});
