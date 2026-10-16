<?php

use App\Models\Agendamento;
use App\Models\Conversa;
use App\Models\LembreteEnviado;
use App\Models\Mensagem;
use App\Models\Paciente;
use App\Models\Profissional;
use App\Models\StatusAgendamento;
use App\Models\Usuario;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;

/*
 * "Avisar no WhatsApp" do painel do agendamento (change avisar-no-whatsapp-abre-a-conversa): a
 * conversa da família daquela sessão, achada pelo celular de AGORA no cadastro ou criada vazia. Nada
 * é enviado. Dados 100% FICTÍCIOS.
 */

/** Uma sessão de amanhã de uma criança com os contatos dados. */
function sessaoDaConversa(array $contatos = [['tipo' => 'celular', 'valor' => '(11) 98765-4321']]): Agendamento
{
    $base = baseDeAgenda();
    Paciente::query()->whereKey($base['paciente_id'])->firstOrFail()->update(['contatos_json' => $contatos]);
    $agendamento = Agendamento::factory()->create([
        'paciente_id' => $base['paciente_id'],
        'profissional_id' => $base['profissional_id'],
        'especialidade_id' => $base['especialidade_id'],
        'inicio' => agoraNaClinica()->addDay()->format('Y-m-d').' 14:00:00',
    ]);
    $agendamento->forceFill(['status_id' => StatusAgendamento::inicialId()])->save();

    return $agendamento;
}

/** Uma conversa que já existe para o telefone dado (E.164 com o "+", como a mensageria guarda). */
function conversaExistente(string $telefone): Conversa
{
    $conversa = new Conversa;
    $conversa->telefone_e164 = $telefone;
    $conversa->save();

    return $conversa;
}

function abrirConversa(Usuario $usuario, int $agendamentoId): TestResponse
{
    return test()->actingAs($usuario)->postJson("/api/agendamentos/{$agendamentoId}/conversa");
}

it('deve abrir a conversa que a família já tem, sem criar outra e sem enviar nada', function () {
    // ARRANGE
    $admin = admin();
    $sessao = sessaoDaConversa();
    $conversa = conversaExistente('+5511987654321');

    // ACT
    $resposta = abrirConversa($admin, $sessao->id);

    // ASSERT — só o identificador volta
    $resposta->assertOk()->assertExactJson(['conversa_id' => $conversa->id]);
    expect(Conversa::query()->count())->toBe(1)
        ->and(Mensagem::query()->count())->toBe(0);
});

it('deve reconhecer a conversa que guarda o celular sem o nono dígito', function () {
    // ARRANGE — a conversa é de antes do nono dígito; o cadastro o tem
    $admin = admin();
    $sessao = sessaoDaConversa();
    $conversa = conversaExistente('+551187654321');

    // ACT
    $resposta = abrirConversa($admin, $sessao->id);

    // ASSERT
    $resposta->assertOk()->assertExactJson(['conversa_id' => $conversa->id]);
    expect(Conversa::query()->count())->toBe(1);
});

it('deve criar a conversa vazia do celular quando a família nunca trocou mensagem', function () {
    // ARRANGE
    $admin = admin();
    $sessao = sessaoDaConversa();

    // ACT
    $resposta = abrirConversa($admin, $sessao->id);

    // ASSERT — a conversa nova é do celular do cadastro, ligada à criança, e nada saiu
    $resposta->assertOk();
    $conversa = Conversa::query()->sole();
    expect($resposta->json('conversa_id'))->toBe($conversa->id)
        ->and($conversa->telefone_e164)->toBe('+5511987654321')
        ->and((int) $conversa->paciente_id)->toBe((int) $sessao->paciente_id)
        ->and(Mensagem::query()->count())->toBe(0);
});

it('deve criar a conversa do celular de fora do país', function () {
    // ARRANGE — Reino Unido na faixa de ficção da Ofcom (change telefone-estrangeiro)
    $admin = admin();
    $sessao = sessaoDaConversa([['tipo' => 'whatsapp', 'valor' => '+44 7700 900123']]);

    // ACT
    $resposta = abrirConversa($admin, $sessao->id);

    // ASSERT — o número de fora vale como celular: a conversa é dele e da criança
    $resposta->assertOk();
    $conversa = Conversa::query()->sole();
    expect($conversa->telefone_e164)->toBe('+447700900123')
        ->and((int) $conversa->paciente_id)->toBe((int) $sessao->paciente_id);
});

it('deve abrir a conversa do segundo celular quando só ele já conversa', function () {
    // ARRANGE — dois celulares; a família conversa pelo segundo. O 1º é do tipo WhatsApp para a ordem de
    // preferência ser certa (entre dois do mesmo tipo, a ordem do banco não é garantida)
    $admin = admin();
    $sessao = sessaoDaConversa([
        ['tipo' => 'whatsapp', 'valor' => '(11) 98765-4321'],
        ['tipo' => 'celular', 'valor' => '(11) 91234-5678'],
    ]);
    $doSegundo = conversaExistente('+5511912345678');

    // ACT
    $resposta = abrirConversa($admin, $sessao->id);

    // ASSERT
    $resposta->assertOk()->assertExactJson(['conversa_id' => $doSegundo->id]);
    expect(Conversa::query()->count())->toBe(1);
});

it('deve abrir a conversa do celular de agora, e não a do número por onde o lembrete saiu', function () {
    // ARRANGE — o lembrete foi ao número de antes (outra família); a recepção corrigiu o cadastro
    $admin = admin();
    $sessao = sessaoDaConversa([['tipo' => 'celular', 'valor' => '(11) 98765-4321']]);
    $doNumeroAntigo = conversaExistente('+5511955550000');
    $mensagem = new Mensagem;
    $mensagem->forceFill(['conversa_id' => $doNumeroAntigo->id, 'direcao' => 'saida', 'tipo' => 'template', 'status' => 'lida', 'corpo' => 'Lembrete fictício'])->save();
    LembreteEnviado::create([
        'agendamento_id' => $sessao->id,
        ...LembreteEnviado::doQueFoiLembrado($sessao),
        'tipo' => LembreteEnviado::TIPO_AGENDAMENTO,
        'competencia' => $sessao->inicio->format('Y-m-d'),
        'status' => LembreteEnviado::ENVIADO,
        'mensagem_id' => $mensagem->id,
    ]);

    // ACT
    $resposta = abrirConversa($admin, $sessao->id);

    // ASSERT
    $resposta->assertOk();
    expect($resposta->json('conversa_id'))->not->toBe($doNumeroAntigo->id)
        ->and(Conversa::query()->find($resposta->json('conversa_id'))->telefone_e164)->toBe('+5511987654321');
});

it('deve recusar sem criar conversa quando o cadastro não tem celular válido', function (array $contatos, string $motivo) {
    // ARRANGE
    $admin = admin();
    $sessao = sessaoDaConversa($contatos);

    // ACT
    $resposta = abrirConversa($admin, $sessao->id);

    // ASSERT
    $resposta->assertStatus(422);
    expect($resposta->json('errors.conversa.0'))->toBe($motivo)
        ->and(Conversa::query()->count())->toBe(0);
})->with([
    'sem telefone' => [[], 'A criança não tem celular cadastrado.'],
    'telefone inválido' => [[['tipo' => 'celular', 'valor' => '55 49912-3456']], 'O telefone do cadastro não é válido para WhatsApp.'],
    'só fixo' => [[['tipo' => 'telefone', 'valor' => '(11) 3333-4444']], 'O telefone do cadastro é fixo e não tem WhatsApp.'],
]);

it('deve recusar o bloqueio de agenda, que não tem família', function () {
    // ARRANGE
    $admin = admin();
    $base = baseDeAgenda();
    $bloqueio = Agendamento::factory()->create([
        'tipo' => 'bloqueio', 'paciente_id' => null,
        'profissional_id' => $base['profissional_id'], 'especialidade_id' => null,
        'inicio' => agoraNaClinica()->addDay()->format('Y-m-d').' 12:00:00',
    ]);

    // ACT
    $resposta = abrirConversa($admin, $bloqueio->id);

    // ASSERT — pelo motivo do bloqueio, não pelo de telefone (gate r1, CR-WA-04)
    $resposta->assertStatus(422);
    expect($resposta->json('errors.conversa.0'))->toBe('Este horário não é de uma criança.')
        ->and(Conversa::query()->count())->toBe(0);
});

it('deve recusar do mesmo jeito a sessão de outra agenda e a sessão que não existe', function () {
    // ARRANGE — a profissional escopada não separa "não é minha" de "não existe" pela resposta
    admin();
    $sessao = sessaoDaConversa();
    $escopada = usuarioEscopadoEm(Profissional::factory()->create(), ['mensagens.ver', 'mensagens.responder']);

    // ACT
    $deOutra = abrirConversa($escopada, $sessao->id);
    $inexistente = abrirConversa($escopada, 999999);

    // ASSERT
    $deOutra->assertForbidden();
    $inexistente->assertForbidden();
    expect($deOutra->json('message'))->toBe($inexistente->json('message'))
        ->and(Conversa::query()->count())->toBe(0);
});

it('deve deixar a profissional escopada abrir a conversa de uma sessão da própria agenda', function () {
    // ARRANGE — o controle positivo do escopo
    admin();
    $sessao = sessaoDaConversa();
    $dona = usuarioEscopadoEm(Profissional::query()->findOrFail($sessao->profissional_id), ['mensagens.ver', 'mensagens.responder']);

    // ACT
    $resposta = abrirConversa($dona, $sessao->id);

    // ASSERT
    $resposta->assertOk();
    expect(Conversa::query()->count())->toBe(1);
});

it('não deve abrir a conversa sem as três permissões juntas', function (array $permissoes) {
    // ARRANGE — gate r1, SEC-WA-01: sem `agenda.ver`, um papel só de mensagens chegava a nome e celular
    // de crianças percorrendo ids; sem `mensagens.ver`, criava conversa que não podia ler
    admin();
    $sessao = sessaoDaConversa();
    $usuario = usuarioCom($permissoes, 'Papel Incompleto Fictício');

    // ACT
    $resposta = abrirConversa($usuario, $sessao->id);

    // ASSERT
    $resposta->assertForbidden();
    expect(Conversa::query()->count())->toBe(0);
})->with([
    'sem responder' => [['agenda.ver', 'agenda.editar', 'mensagens.ver']],
    'sem ver a agenda' => [['agenda.ver_todos', 'mensagens.ver', 'mensagens.responder']],
    'sem ver as mensagens' => [['agenda.ver', 'agenda.ver_todos', 'mensagens.responder']],
]);

it('deve devolver a conversa que ganhou quando dois cliques criam ao mesmo tempo', function () {
    // ARRANGE — o outro clique grava a conversa entre a busca e a criação deste
    $admin = admin();
    $sessao = sessaoDaConversa();
    $outroClique = null;
    DB::listen(function ($consulta) use (&$outroClique): void {
        $sql = strtolower($consulta->sql);
        if ($outroClique === null && str_starts_with($sql, 'select') && str_contains($sql, 'from `conversas`')) {
            $outroClique = DB::table('conversas')->insertGetId([
                'telefone_e164' => '+5511987654321', 'created_at' => now(), 'updated_at' => now(),
            ]);
        }
    });

    // ACT
    $resposta = abrirConversa($admin, $sessao->id);

    // ASSERT — a busca de antes não a viu; a criação bateu no `unique` e releu
    $resposta->assertOk()->assertExactJson(['conversa_id' => $outroClique]);
    expect(Conversa::query()->count())->toBe(1);
});

it('deve responder 404, e não erro do servidor, a um id que não é número', function () {
    // ARRANGE
    $admin = admin();

    // ACT
    $resposta = test()->actingAs($admin)->postJson('/api/agendamentos/abc/conversa');
    $gigante = test()->actingAs($admin)->postJson('/api/agendamentos/99999999999999999999999/conversa');

    // ASSERT
    $resposta->assertNotFound();
    $gigante->assertNotFound();
});

it('deve preferir o número de WhatsApp quando os dois celulares já conversam', function () {
    // ARRANGE — gate r1, CR-WA-02: a ordem de preferência do lembrete (WhatsApp, depois celular)
    $admin = admin();
    $sessao = sessaoDaConversa([
        ['tipo' => 'celular', 'valor' => '(11) 91234-5678'],
        ['tipo' => 'whatsapp', 'valor' => '(11) 98765-4321'],
    ]);
    conversaExistente('+5511912345678');
    $doWhatsapp = conversaExistente('+5511987654321');

    // ACT
    $resposta = abrirConversa($admin, $sessao->id);

    // ASSERT
    $resposta->assertOk()->assertExactJson(['conversa_id' => $doWhatsapp->id]);
});

it('deve criar a conversa do número de WhatsApp quando nenhum celular conversa', function () {
    // ARRANGE — gate r1, CR-WA-02
    $admin = admin();
    $sessao = sessaoDaConversa([
        ['tipo' => 'celular', 'valor' => '(11) 91234-5678'],
        ['tipo' => 'whatsapp', 'valor' => '(11) 98765-4321'],
    ]);

    // ACT
    $resposta = abrirConversa($admin, $sessao->id);

    // ASSERT
    $resposta->assertOk();
    expect(Conversa::query()->sole()->telefone_e164)->toBe('+5511987654321');
});

it('deve criar a conversa sem vínculo quando irmãos dividem o celular', function () {
    // ARRANGE — gate r1, CR-WA-03: a regra do disparo (`paraTelefone`): o número de duas crianças ativas
    // não escolhe uma delas
    $admin = admin();
    $sessao = sessaoDaConversa();
    Paciente::factory()->create(['contatos_json' => [['tipo' => 'celular', 'valor' => '(11) 98765-4321']]]);

    // ACT
    $resposta = abrirConversa($admin, $sessao->id);

    // ASSERT
    $resposta->assertOk();
    expect(Conversa::query()->sole()->paciente_id)->toBeNull();
});

it('deve abrir a conversa de janela aberta quando o mesmo celular tem duas conversas', function () {
    // ARRANGE — gate r1, CR-WA-01: o lembrete criou a conversa pelo cadastro (sem o nono dígito), e a
    // resposta da família criou outra pelo número do WhatsApp (com ele); é nesta que a família está
    $admin = admin();
    $sessao = sessaoDaConversa([['tipo' => 'celular', 'valor' => '(11) 8765-4321']]);
    $doLembrete = conversaExistente('+551187654321');
    $doLembrete->forceFill(['ultima_mensagem_em' => now()->subDay()])->save();
    $daFamilia = conversaExistente('+5511987654321');
    $daFamilia->forceFill(['ultima_mensagem_em' => now()->subMinutes(5), 'janela_expira_em' => now()->addHours(23)])->save();

    // ACT
    $resposta = abrirConversa($admin, $sessao->id);

    // ASSERT
    $resposta->assertOk()->assertExactJson(['conversa_id' => $daFamilia->id]);
});

it('deve abrir a de janela aberta mesmo quando a outra forma do celular é a mais recente', function () {
    // ARRANGE — gate r2, CR-WA-11: os dois critérios em conflito; a janela vence a recência
    $admin = admin();
    $sessao = sessaoDaConversa([['tipo' => 'celular', 'valor' => '(11) 8765-4321']]);
    $maisRecente = conversaExistente('+551187654321');
    $maisRecente->forceFill(['ultima_mensagem_em' => now()->subMinute()])->save();
    $deJanelaAberta = conversaExistente('+5511987654321');
    $deJanelaAberta->forceFill(['ultima_mensagem_em' => now()->subHours(3), 'janela_expira_em' => now()->addHours(21)])->save();

    // ACT
    $resposta = abrirConversa($admin, $sessao->id);

    // ASSERT
    $resposta->assertOk()->assertExactJson(['conversa_id' => $deJanelaAberta->id]);
});

it('deve abrir a de mensagem mais recente quando nenhuma forma do celular tem janela aberta', function () {
    // ARRANGE — gate r2, CR-WA-11: sem janela, a recência decide (e não a ordem do índice, que daria a de 8 dígitos)
    $admin = admin();
    $sessao = sessaoDaConversa([['tipo' => 'celular', 'valor' => '(11) 8765-4321']]);
    $antiga = conversaExistente('+551187654321');
    $antiga->forceFill(['ultima_mensagem_em' => now()->subDays(3)])->save();
    $recente = conversaExistente('+5511987654321');
    $recente->forceFill(['ultima_mensagem_em' => now()->subDay()])->save();

    // ACT
    $resposta = abrirConversa($admin, $sessao->id);

    // ASSERT
    $resposta->assertOk()->assertExactJson(['conversa_id' => $recente->id]);
});
