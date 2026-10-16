<?php

use App\Models\LembreteEnviado;
use App\Models\Mensagem;
use App\Models\StatusAgendamento;
use App\Support\Configuracoes\ConfiguracaoService;
use App\Support\Mensageria\TelefoneE164;
use Illuminate\Support\Facades\DB;

/*
 * A base da resposta ao lembrete (change lembrete-com-botoes-de-resposta, grupo 1): as chaves, o
 * status "Desmarcado pelo Paciente" e a coluna da resposta. Dados FICTÍCIOS sempre (LGPD).
 */

function migrationDoDesmarcadoPeloPaciente(): object
{
    return require dirname(__DIR__, 2).'/database/migrations/2026_09_29_110000_backfill_desmarcado_pelo_paciente.php';
}

it('deve nascer sinalizando o pedido de desmarque, sem status e com as respostas padrão', function () {
    // ARRANGE — a clínica decidiu marcar em vermelho; uma clínica nova começa assim
    $admin = admin();

    // ACT
    $resposta = $this->actingAs($admin)->getJson('/api/configuracoes');

    // ASSERT
    $valores = collect($resposta->json('configuracoes'))->pluck('valor', 'chave');
    expect($valores['lembretes.acao_desmarque'])->toBe('sinalizar')
        ->and($valores['lembretes.status_desmarque_familia_id'])->toBe(0)
        ->and($valores['lembretes.resposta_confirmou'])->toBe('Obrigado! Presença confirmada ✅')
        ->and($valores['lembretes.resposta_desmarque'])->toBe('Recebemos 👍 A recepção vai falar com você para remarcar.');
});

it('deve recusar ação de desmarque fora das duas opções', function () {
    // ARRANGE
    $admin = admin();

    // ACT
    $resposta = $this->actingAs($admin)->putJsonComVersao('/api/configuracoes', [
        'chave' => 'lembretes.acao_desmarque',
        'valor' => 'cancelar',
    ]);

    // ASSERT
    $resposta->assertStatus(422);
});

it('deve aceitar como status do desmarque pela família o "Desmarcado pelo Paciente"', function () {
    // ARRANGE
    $admin = admin();
    $alvo = StatusAgendamento::where('nome', 'Desmarcado pelo Paciente')->firstOrFail();

    // ACT
    $resposta = $this->actingAs($admin)->putJsonComVersao('/api/configuracoes', [
        'chave' => 'lembretes.status_desmarque_familia_id',
        'valor' => $alvo->id,
    ]);

    // ASSERT
    $resposta->assertOk();
    expect((int) app(ConfiguracaoService::class)->get('lembretes.status_desmarque_familia_id'))->toBe($alvo->id);
});

it('deve recusar como desmarque pela família um status que ocupa o horário', function () {
    // ARRANGE — "Falta Justificada" não desconta, mas SEGURA o horário: desmarcar por ela não
    // devolveria a vaga para outra criança
    $admin = admin();
    $alvo = StatusAgendamento::where('nome', 'Falta Justificada')->firstOrFail();

    // ACT
    $resposta = $this->actingAs($admin)->putJsonComVersao('/api/configuracoes', [
        'chave' => 'lembretes.status_desmarque_familia_id',
        'valor' => $alvo->id,
    ]);

    // ASSERT
    $resposta->assertStatus(422);
});

it('deve recusar como desmarque pela família um status que desconta sessão', function () {
    // ARRANGE — um status que libera o horário MAS desconta: desmarcar consumiria a sessão da criança
    $admin = admin();
    $alvo = StatusAgendamento::create([
        'nome' => 'Cancelado Cobrado Fictício', 'cor' => '#94A3B8', 'tipo' => 'ban', 'ordem' => 90,
        'desconta_sessao' => true, 'ocupa_horario' => false,
    ]);

    // ACT
    $resposta = $this->actingAs($admin)->putJsonComVersao('/api/configuracoes', [
        'chave' => 'lembretes.status_desmarque_familia_id',
        'valor' => $alvo->id,
    ]);

    // ASSERT
    $resposta->assertStatus(422);
});

it('deve zerar o status do desmarque pela família quando o status apontado é excluído', function () {
    // ARRANGE — ponteiro pendurado faria o "Desmarcar" do card aplicar um status que não existe
    $admin = admin();
    $alvo = StatusAgendamento::where('nome', 'Desmarcado pelo Paciente')->firstOrFail();
    app(ConfiguracaoService::class)->set('lembretes.status_desmarque_familia_id', $alvo->id);

    // ACT
    $this->actingAs($admin)->deleteJson("/api/status-agendamento/{$alvo->id}")->assertNoContent();

    // ASSERT
    expect((int) app(ConfiguracaoService::class)->get('lembretes.status_desmarque_familia_id'))->toBe(0);
});

it('deve marcar os ponteiros de status para a tela escolher numa lista', function () {
    // ARRANGE — digitar o número interno do status confundiu o próprio usuário (28/09)
    $admin = admin();

    // ACT
    $resposta = $this->actingAs($admin)->getJson('/api/configuracoes');

    // ASSERT
    $formatos = collect($resposta->json('configuracoes'))->pluck('formato', 'chave');
    expect($formatos['agenda.status_desmarque_id'])->toBe('status')
        ->and($formatos['lembretes.status_desmarque_familia_id'])->toBe('status_que_libera');
});

it('deve dizer nos alvos de status quais liberam o horário', function () {
    // ARRANGE — a lista do desmarque pela família só oferece status que liberam o horário
    $admin = admin();

    // ACT
    $resposta = $this->actingAs($admin)->getJson('/api/configuracoes/alvos-encadeamento');

    // ASSERT
    $ocupa = collect($resposta->json('alvos'))->pluck('ocupa_horario', 'nome');
    expect($ocupa['Desmarcado pelo Paciente'])->toBeFalse()
        ->and($ocupa['Falta Justificada'])->toBeTrue();
});

it('deve nascer a clínica com "Desmarcado pelo Paciente" liberando o horário sem descontar', function () {
    // ACT — a clínica do teste nasceu no setUp (os defaults vêm do ClinicaObserver)
    $status = StatusAgendamento::where('nome', 'Desmarcado pelo Paciente')->sole();
    expect($status->ocupa_horario)->toBeFalse()
        ->and($status->desconta_sessao)->toBeFalse()
        ->and($status->marca_falta)->toBeFalse();
});

it('deve criar "Desmarcado pelo Paciente" uma vez só na clínica que ainda não tinha', function () {
    // ARRANGE — a clínica antiga: sem o status novo, e com um default que ela APAGOU
    StatusAgendamento::where('nome', 'Desmarcado pelo Paciente')->delete();
    StatusAgendamento::where('nome', 'Consulta')->delete();

    // ACT — duas vezes
    migrationDoDesmarcadoPeloPaciente()->up();
    migrationDoDesmarcadoPeloPaciente()->up();

    // ASSERT — um só, liberando o horário; e o default apagado NÃO ressuscita
    expect(StatusAgendamento::where('nome', 'Desmarcado pelo Paciente')->count())->toBe(1)
        ->and(StatusAgendamento::where('nome', 'Desmarcado pelo Paciente')->sole()->ocupa_horario)->toBeFalse()
        ->and(StatusAgendamento::where('nome', 'Consulta')->exists())->toBeFalse();
});

it('não deve desfazer a edição da clínica ao rodar o backfill de novo', function () {
    // ARRANGE — a clínica mudou a cor do status novo
    StatusAgendamento::where('nome', 'Desmarcado pelo Paciente')->update(['cor' => '#123456']);

    // ACT
    migrationDoDesmarcadoPeloPaciente()->up();

    // ASSERT
    expect(StatusAgendamento::where('nome', 'Desmarcado pelo Paciente')->sole()->cor)->toBe('#123456');
});

it('deve manter o lembrete quando a mensagem da resposta é apagada', function () {
    // ARRANGE — a resposta aponta o toque na conversa; apagar a conversa não pode apagar o registro
    // do disparo (a recepção precisa saber quem foi lembrado)
    admin();
    $conversa = conversaAberta();
    $toque = new Mensagem(['corpo' => 'Confirmo fictício', 'tipo' => 'botao']);
    $toque->conversa_id = $conversa->id;
    $toque->direcao = Mensagem::DIRECAO_RECEBIDA;
    $toque->save();
    $agendamento = agendamentoDoDesmarque(baseDoDesmarque(), agoraNaClinica()->copy()->addDay()->setTime(9, 0)->format('Y-m-d H:i'));
    $lembrete = LembreteEnviado::create([
        'agendamento_id' => $agendamento->id,
        'tipo' => LembreteEnviado::TIPO_AGENDAMENTO,
        'competencia' => $agendamento->inicio->format('Y-m-d'),
        'status' => LembreteEnviado::ENVIADO,
    ]);
    DB::table('lembretes_enviados')->where('id', $lembrete->id)->update([
        'resposta' => LembreteEnviado::CONFIRMOU, 'respondido_em' => now(), 'resposta_mensagem_id' => $toque->id,
    ]);

    // ACT
    DB::table('mensagens')->where('id', $toque->id)->delete();

    // ASSERT
    $depois = $lembrete->fresh();
    expect($depois)->not->toBeNull()
        ->and($depois->resposta)->toBe(LembreteEnviado::CONFIRMOU)
        ->and($depois->resposta_mensagem_id)->toBeNull();
});

it('deve marcar na seleção da agenda qual status é o desmarque pela família', function () {
    // ARRANGE — é o status que o "Desmarcar" do card aplica quando a família pediu
    $admin = admin();
    $alvo = StatusAgendamento::where('nome', 'Desmarcado pelo Paciente')->firstOrFail();
    app(ConfiguracaoService::class)->set('lembretes.status_desmarque_familia_id', $alvo->id);

    // ACT
    $resposta = $this->actingAs($admin)->getJson('/api/agenda/selecao');

    // ASSERT — só ele
    $resposta->assertOk();
    expect(collect($resposta->json('status'))->where('desmarque_da_familia', true)->pluck('id')->all())->toBe([$alvo->id]);
});

it('não deve confundir o celular novo com o telefone fixo de outra pessoa', function () {
    // ARRANGE — `9 3333-4444` sem o 9 seria o FIXO `3333-4444` (SEC-BT-07)
    $celularQueComecaPor3 = '+5511933334444';
    $celularDeVerdade = '+5511987654321';

    // ACT
    $variantesDoPrimeiro = TelefoneE164::variantes($celularQueComecaPor3);
    $variantesDoSegundo = TelefoneE164::variantes($celularDeVerdade);

    // ASSERT
    expect($variantesDoPrimeiro)->toBe([$celularQueComecaPor3])
        ->and($variantesDoSegundo)->toBe([$celularDeVerdade, '+551187654321']);
});
