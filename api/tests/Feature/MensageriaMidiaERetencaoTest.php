<?php

use App\Models\Agendamento;
use App\Models\Configuracao;
use App\Models\Conversa;
use App\Models\Mensagem;
use App\Models\MensagemMidia;
use App\Models\Paciente;
use App\Support\Mensageria\ClienteSimulado;
use App\Support\Mensageria\ClienteWhatsApp;
use App\Support\Mensageria\GravadorDeMidia;
use App\Support\Mensageria\MidiaBaixada;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Spatie\Permission\PermissionRegistrar;

/**
 * Mídia, templates, bloco de notificações, retenção e o marcador da agenda
 * (change mensageria-whatsapp).
 *
 * A mídia recebe o MESMO tratamento dos anexos do paciente, e pelo mesmo motivo: a família
 * manda foto da criança e laudo em PDF pelo WhatsApp.
 *
 * Dados 100% FICTÍCIOS.
 */
function pngFicticio(): string
{
    return base64_decode(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    );
}

beforeEach(function () {
    Storage::fake('local');
    Queue::fake();
    app()->instance(ClienteWhatsApp::class, new ClienteSimulado);
});

it('deve guardar a mídia CIFRADA, sob caminho do servidor, sem o nome original', function () {
    // ARRANGE — nome de arquivo codifica diagnóstico ("laudo-tea.pdf")
    $admin = admin();
    canalConectado();
    $conversa = conversaAberta();

    // ACT
    $resposta = $this->actingAs($admin)->post("/api/mensagens/conversas/{$conversa->id}/mensagens", [
        'tipo' => 'midia',
        'arquivo' => UploadedFile::fake()->createWithContent('laudo-ficticio.png', pngFicticio()),
    ]);

    // ASSERT
    $resposta->assertCreated();
    $midia = MensagemMidia::query()->firstOrFail();
    expect($midia->caminho)->not->toContain('laudo-ficticio');
    expect($midia->mime)->toBe('image/png');
    // no disco, ciphertext; quem abrir o volume não vê a foto da criança
    expect(Storage::disk('local')->get($midia->caminho))->not->toBe(pngFicticio());
    expect(Crypt::decrypt(Storage::disk('local')->get($midia->caminho)))->toBe(pngFicticio());
});

it('deve recusar arquivo cujo CONTEÚDO não é do tipo declarado', function () {
    // ARRANGE — confiar na extensão é aceitar executável rotulado de imagem
    $admin = admin();
    canalConectado();
    $conversa = conversaAberta();

    // ACT
    $resposta = $this->actingAs($admin)->post("/api/mensagens/conversas/{$conversa->id}/mensagens", [
        'tipo' => 'midia',
        'arquivo' => UploadedFile::fake()->createWithContent('foto.png', '<?php echo "ficticio"; ?>'),
    ]);

    // ASSERT
    $resposta->assertStatus(422)->assertJsonValidationErrors(['arquivo']);
});

it('NÃO deve entregar a mídia a quem não tem mensagens.ver', function () {
    // ARRANGE
    $admin = admin();
    canalConectado();
    $conversa = conversaAberta();
    // o usuário restrito nasce ANTES do primeiro `actingAs`: depois dele o guard ativo
    // vira `sanctum`, e `usuarioCom` criaria o papel no guard errado
    $semAcesso = usuarioCom(['pacientes.ver'], 'Sem Canal');

    $this->actingAs($admin)->post("/api/mensagens/conversas/{$conversa->id}/mensagens", [
        'tipo' => 'midia',
        'arquivo' => UploadedFile::fake()->createWithContent('foto.png', pngFicticio()),
    ])->assertCreated();
    $midia = MensagemMidia::query()->firstOrFail();

    // ACT / ASSERT — troca de guard entre os dois `actingAs`
    $this->flushSession();
    app('auth')->forgetGuards();
    $this->actingAs($semAcesso)->get("/api/mensagens/midias/{$midia->id}")->assertForbidden();

    $this->flushSession();
    app('auth')->forgetGuards();
    $this->actingAs($admin)->get("/api/mensagens/midias/{$midia->id}")->assertOk();
});

it('deve marcar a mensagem como não suportada quando a mídia RECEBIDA é recusada', function () {
    // ARRANGE — a mensagem nunca some: fica dizendo que veio algo que não dá para abrir
    admin();
    $conversa = conversaAberta();
    $mensagem = new Mensagem(['corpo' => null, 'tipo' => 'documento']);
    $mensagem->conversa_id = $conversa->id;
    $mensagem->direcao = Mensagem::DIRECAO_RECEBIDA;
    $mensagem->save();

    $midia = new MensagemMidia;
    $midia->mensagem_id = $mensagem->id;
    $midia->mime = 'application/x-executavel-ficticio';
    $midia->save();

    // ACT
    $aceita = app(GravadorDeMidia::class)->gravar(
        $midia,
        new MidiaBaixada("\x00\x01\x02\x03BINARIO_FICTICIO\xFF\xFE", 'application/octet-stream', 24),
    );

    // ASSERT
    expect($aceita)->toBeFalse();
    expect($mensagem->fresh()->tipo)->toBe('nao_suportado');
    expect($mensagem->fresh()->erro_motivo)->toContain('não suportado');
});

it('deve sincronizar os templates aprovados da Meta', function () {
    // ARRANGE
    $admin = admin();
    canalConectado();

    // ACT
    $resposta = $this->actingAs($admin)->postJson('/api/mensagens/templates/sincronizar');

    // ASSERT — o corpo e as variáveis vêm juntos, para a tela cobrar antes de enviar
    $resposta->assertOk()
        ->assertJsonPath('0.nome', 'lembrete_agendamento')
        ->assertJsonPath('0.aprovado', true)
        ->assertJsonPath('0.variaveis', ['1', '2']);
});

it('NÃO deve sincronizar templates com o canal desconectado', function () {
    // ARRANGE
    $admin = admin();

    // ACT / ASSERT
    $this->actingAs($admin)->postJson('/api/mensagens/templates/sincronizar')
        ->assertStatus(422)->assertJsonValidationErrors(['conexao']);
});

it('deve acender o bloco de conversas não lidas SEM mostrar o teor', function () {
    // ARRANGE — o centro fica aberto em telas compartilhadas do balcão
    $admin = admin();
    $conversa = conversaAberta();
    $teor = 'O laudo do neuro ficticio saiu, posso levar?';
    $mensagem = new Mensagem(['corpo' => $teor, 'tipo' => 'texto']);
    $mensagem->conversa_id = $conversa->id;
    $mensagem->direcao = Mensagem::DIRECAO_RECEBIDA;
    $mensagem->save();
    $conversa->forceFill(['nao_lidas' => 2, 'ultima_mensagem_em' => now()])->save();

    // ACT
    $centro = $this->actingAs($admin)->getJson('/api/notificacoes');

    // ASSERT
    $centro->assertOk()->assertJsonPath('mensagens.total', 1);
    expect($centro->json('mensagens.conversas.0.nao_lidas'))->toBe(2);
    semVazamento($centro->json('mensagens'), $teor);
});

it('NÃO deve mostrar o bloco de mensagens a quem não tem a permissão', function () {
    // ARRANGE
    admin();
    $semCanal = usuarioCom(['pacientes.ver'], 'Sem Canal');

    // ACT / ASSERT — bloco AUSENTE, nunca zerado
    $centro = $this->actingAs($semCanal)->getJson('/api/notificacoes');
    expect($centro->json())->not->toHaveKey('mensagens');
});

it('deve expurgar o CONTEÚDO além da retenção, preservando a linha do tempo', function () {
    // ARRANGE — guardar conversa de menor indefinidamente é acúmulo sem finalidade
    admin();
    $conversa = conversaAberta();
    Configuracao::create(['chave' => 'mensagens.retencao_dias', 'valor' => '30']);

    $antiga = new Mensagem(['corpo' => 'conteudo ficticio antigo', 'tipo' => 'texto']);
    $antiga->conversa_id = $conversa->id;
    $antiga->direcao = Mensagem::DIRECAO_RECEBIDA;
    $antiga->save();
    $antiga->forceFill(['created_at' => now()->subDays(60)])->saveQuietly();

    $recente = new Mensagem(['corpo' => 'conteudo ficticio recente', 'tipo' => 'texto']);
    $recente->conversa_id = $conversa->id;
    $recente->direcao = Mensagem::DIRECAO_RECEBIDA;
    $recente->save();

    // ACT
    $this->artisan('mensagens:expurgar')->assertSuccessful();

    // ASSERT — o teor sai; o registro de que houve contato permanece
    $antiga->refresh();
    expect($antiga->corpo)->toBeNull();
    expect($antiga->expurgada_em)->not->toBeNull();
    expect($antiga->exists)->toBeTrue();
    // e o recente fica intacto
    expect($recente->fresh()->corpo)->toBe('conteudo ficticio recente');
});

it('deve expurgar também as variáveis do modelo, que levam o nome da criança', function () {
    // ARRANGE — o lembrete e os avisos do agendamento guardam nome, horário e profissional nas
    // variáveis; zerar só o corpo deixava o dado do menor fora do alcance da retenção (SEC-AV-17)
    admin();
    $conversa = conversaAberta();
    Configuracao::create(['chave' => 'mensagens.retencao_dias', 'valor' => '30']);
    $antiga = new Mensagem(['corpo' => 'conteudo ficticio antigo', 'tipo' => 'template']);
    $antiga->conversa_id = $conversa->id;
    $antiga->direcao = Mensagem::DIRECAO_ENVIADA;
    $antiga->variaveis_json = ['1' => 'Criança Fictícia', '2' => 'quinta-feira, 01/10 às 09:00'];
    $antiga->save();
    $antiga->forceFill(['created_at' => now()->subDays(60)])->saveQuietly();

    // ACT
    $this->artisan('mensagens:expurgar')->assertSuccessful();

    // ASSERT
    expect($antiga->fresh()->variaveis_json)->toBeNull();
});

it('deve apagar a conversa que nunca teve mensagem além da retenção', function () {
    // ARRANGE — change avisar-no-whatsapp-abre-a-conversa, gate r1, SEC-WA-02: aberta pelo atalho e não
    // usada, ela só guarda "esta criança, este telefone"
    admin();
    Configuracao::create(['chave' => 'mensagens.retencao_dias', 'valor' => '30']);
    $paciente = Paciente::factory()->create();
    $vazia = new Conversa;
    $vazia->telefone_e164 = '+5511987650001';
    $vazia->paciente_id = $paciente->id;
    $vazia->save();
    $vazia->forceFill(['created_at' => now()->subDays(60), 'updated_at' => now()->subDays(60)])->saveQuietly();
    $recente = new Conversa;
    $recente->telefone_e164 = '+5511987650002';
    $recente->save();
    $comPedido = new Conversa(['sem_lembretes' => true]);
    $comPedido->telefone_e164 = '+5511987650003';
    $comPedido->save();
    $comPedido->forceFill(['created_at' => now()->subDays(60), 'updated_at' => now()->subDays(60)])->saveQuietly();
    // a antiga COM histórico: a trava do `whereDoesntHave` — a cascata levaria as mensagens (gate r2, CR-WA-10)
    $comHistorico = new Conversa;
    $comHistorico->telefone_e164 = '+5511987650005';
    $comHistorico->save();
    $comHistorico->forceFill(['created_at' => now()->subDays(400), 'updated_at' => now()->subDays(400)])->saveQuietly();
    $mensagem = new Mensagem(['corpo' => 'conteudo ficticio', 'tipo' => 'texto']);
    $mensagem->conversa_id = $comHistorico->id;
    $mensagem->direcao = Mensagem::DIRECAO_RECEBIDA;
    $mensagem->save();
    // a antiga que a recepção vinculou hoje (gate r2, SEC-WA-04)
    $mexidaHoje = new Conversa;
    $mexidaHoje->telefone_e164 = '+5511987650006';
    $mexidaHoje->save();
    $mexidaHoje->forceFill(['created_at' => now()->subDays(60)])->saveQuietly();

    // ACT
    $this->artisan('mensagens:expurgar')->assertSuccessful();

    // ASSERT — só a antiga, vazia e parada sai (lido direto do banco)
    expect(Conversa::find($vazia->id))->toBeNull()
        ->and(Conversa::find($recente->id))->not->toBeNull()
        ->and(Conversa::find($comPedido->id))->not->toBeNull()
        ->and(Conversa::find($comHistorico->id))->not->toBeNull()
        ->and(Mensagem::where('conversa_id', $comHistorico->id)->count())->toBe(1)
        ->and(Conversa::find($mexidaHoje->id))->not->toBeNull();
});

it('deve desligar da criança a conversa só de saída além da retenção', function () {
    // ARRANGE — gate r1, SEC-WA-02: sem resposta da família, não há nome de perfil, e o vínculo escapava
    admin();
    Configuracao::create(['chave' => 'mensagens.retencao_dias', 'valor' => '30']);
    $paciente = Paciente::factory()->create();
    $conversa = new Conversa;
    $conversa->telefone_e164 = '+5511987650004';
    $conversa->paciente_id = $paciente->id;
    $conversa->save();
    $saida = new Mensagem(['corpo' => 'lembrete ficticio', 'tipo' => 'template']);
    $saida->conversa_id = $conversa->id;
    $saida->direcao = Mensagem::DIRECAO_ENVIADA;
    $saida->save();
    $saida->forceFill(['created_at' => now()->subDays(60)])->saveQuietly();
    $conversa->forceFill(['ultima_mensagem_em' => now()->subDays(60)])->saveQuietly();

    // ACT
    $this->artisan('mensagens:expurgar')->assertSuccessful();

    // ASSERT
    expect($conversa->fresh()->paciente_id)->toBeNull()
        ->and($conversa->fresh()->exists)->toBeTrue();
});

it('deve nascer o agendamento com o marcador da PRÉ-SELEÇÃO da clínica', function () {
    // ARRANGE — a pré-seleção é dado (§13), não default de coluna
    $admin = admin();
    Configuracao::create(['chave' => 'whatsapp.pre_selecionado', 'valor' => '1']);

    // ACT
    $resposta = $this->actingAs($admin)->postJson('/api/agendamentos', baseDeAgenda());

    // ASSERT
    $resposta->assertCreated();
    expect(Agendamento::query()->firstOrFail()->lembrete_whatsapp)->toBeTrue();
});

it('deve respeitar a pré-seleção DESLIGADA da clínica', function () {
    // ARRANGE
    $admin = admin();
    Configuracao::create(['chave' => 'whatsapp.pre_selecionado', 'valor' => '0']);

    // ACT
    $this->actingAs($admin)->postJson('/api/agendamentos', baseDeAgenda())->assertCreated();

    // ASSERT
    expect(Agendamento::query()->firstOrFail()->lembrete_whatsapp)->toBeFalse();
});

it('deve deixar quem cuida da AGENDA mexer no marcador SEM permissão de mensagens', function () {
    // ARRANGE — marcar lembrete é decisão de AGENDA, não de canal. O nível perde as três
    // permissões de mensagens e mantém o resto: é o recorte que prova a independência
    // (criar um usuário só com `agenda.*` esbarraria no ESCOPO do profissional, que é
    // outra regra e não é o que este teste investiga).
    $admin = admin();
    $admin->roles->first()->revokePermissionTo(['mensagens.ver', 'mensagens.responder', 'mensagens.conectar']);
    app(PermissionRegistrar::class)->forgetCachedPermissions();

    $base = baseDeAgenda();
    $criado = $this->actingAs($admin)->postJson('/api/agendamentos', $base);
    $criado->assertCreated();

    // ACT — o PUT desta API é COMPLETO (não parcial): leva a cena inteira de volta
    // a versão vai no header `If-Match` (concorrência otimista da casa), nunca no corpo
    $resposta = $this->actingAs($admin)->putJson(
        '/api/agendamentos/'.$criado->json('id'),
        [...$base, 'lembrete_whatsapp' => false],
        ['If-Match' => $criado->json('updated_at')],
    );

    // ASSERT
    $resposta->assertOk();
    expect(Agendamento::query()->firstOrFail()->lembrete_whatsapp)->toBeFalse();
    // e o canal continua fechado para ele
    $this->actingAs($admin)->getJson('/api/mensagens/conversas')->assertForbidden();
});
