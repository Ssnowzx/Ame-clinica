<?php

use App\Models\EnvioDeCadastro;
use App\Models\Paciente;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

/**
 * A ORIGEM DA FICHA — a ponte entre o envio público e o paciente
 * (change `cadastro-online-do-paciente`).
 *
 * Ela responde a duas perguntas diferentes, e por isso são duas colunas: `pacientes.
 * envio_de_cadastro_id` diz de onde a ficha veio, e `envios_de_cadastro.paciente_id` é o que faz
 * o expurgo saber que aquele conteúdo já virou prontuário.
 *
 * Sem a ponte, as duas colunas eram schema morto: nada as escrevia, e — o que importa mais —
 * apagar o paciente não alcançava a cópia do dado guardada no envio. O caminho de exclusão da
 * LGPD para toda criança vinda pelo link ficava quebrado (parecer PÓS-código, SEC-CO-34).
 */
function envioAceito(): EnvioDeCadastro
{
    $envio = EnvioDeCadastro::create([
        'payload' => ['nome' => 'Criança Fictícia do Link'],
        'enviado_em' => now(),
    ]);

    $envio->forceFill(['situacao' => 'aceito', 'conferido_em' => now()])->save();

    return $envio->fresh();
}

function fichaValida(array $extras = []): array
{
    return [
        'nome' => 'Criança Fictícia do Link',
        'nascimento' => '2018-03-15',
        'sexo' => 'feminino',
        'necessidade' => 'sem',
        'responsaveis_json' => [['nome' => 'Adulto Fictício', 'parentesco' => 'Mãe']],
        'consentimentos_json' => [],
        ...$extras,
    ];
}

it('deve gravar OS DOIS lados do vínculo ao criar a ficha', function () {
    // ARRANGE
    $usuario = admin();
    $envio = envioAceito();

    // ACT
    $resposta = $this->actingAs($usuario)
        ->postJson('/api/pacientes', fichaValida(['envio_de_cadastro_id' => $envio->id]));

    // ASSERT
    $resposta->assertCreated();
    $paciente = Paciente::findOrFail($resposta->json('id'));

    expect($paciente->envio_de_cadastro_id)->toBe($envio->id)
        ->and($envio->fresh()->paciente_id)->toBe($paciente->id);
});

it('deve deixar a origem NULA no cadastro de balcão', function () {
    // ARRANGE — o par de controle: a esmagadora maioria das fichas nasce no balcão, e carimbar
    // origem nelas seria mentira na trilha
    $usuario = admin();

    // ACT
    $resposta = $this->actingAs($usuario)->postJson('/api/pacientes', fichaValida());

    // ASSERT
    $resposta->assertCreated();
    expect(Paciente::findOrFail($resposta->json('id'))->envio_de_cadastro_id)->toBeNull();
});

it('NÃO deve deixar roubar o vínculo de um envio que já tem ficha', function () {
    // ARRANGE — sem isto, uma segunda ficha se declararia origem do mesmo envio e o expurgo
    // passaria a poupar o conteúdo por causa de um vínculo que não é verdade
    $usuario = admin();
    $envio = envioAceito();
    $primeira = $this->actingAs($usuario)
        ->postJson('/api/pacientes', fichaValida(['envio_de_cadastro_id' => $envio->id]));
    $primeira->assertCreated();

    // ACT
    $segunda = $this->actingAs($usuario)->postJson('/api/pacientes', fichaValida([
        'nome' => 'Outra Criança Fictícia',
        'envio_de_cadastro_id' => $envio->id,
    ]));

    // ASSERT
    $segunda->assertStatus(422);
    expect($envio->fresh()->paciente_id)->toBe($primeira->json('id'));
});

it('NÃO deve aceitar como origem um envio que ainda está na FILA', function () {
    // ARRANGE — envio pendente não foi conferido por ninguém; declará-lo origem tiraria da fila,
    // por via oblíqua, um cadastro que ninguém leu
    $usuario = admin();
    $pendente = EnvioDeCadastro::create([
        'payload' => ['nome' => 'Criança Fictícia na Fila'],
        'enviado_em' => now(),
    ]);

    // ACT + ASSERT
    $this->actingAs($usuario)
        ->postJson('/api/pacientes', fichaValida(['envio_de_cadastro_id' => $pendente->id]))
        ->assertStatus(422);
});

it('deve abortar a ficha inteira se o vínculo for tomado no meio do caminho', function () {
    // ARRANGE — a segunda defesa, e a que pega a concorrência: dois POSTs passam o `exists` e só
    // um `update` vence. Ignorar o retorno produzia ficha apontando para um envio que não aponta
    // de volta, com 201 mentindo (CR2-03). Simulo o outro POST vencendo entre a validação e a
    // gravação
    $usuario = admin();
    $envio = envioAceito();
    $outroPaciente = Paciente::factory()->create();

    $pacientesAntes = Paciente::count();

    // o "outro POST" leva o vínculo enquanto este ainda está em voo. O listener é removido no
    // fim: evento de model registrado num teste vive no processo inteiro
    Paciente::creating(function () use ($envio, $outroPaciente): void {
        EnvioDeCadastro::query()->whereKey($envio->id)->whereNull('paciente_id')
            ->update(['paciente_id' => $outroPaciente->id]);
    });

    try {
        // ACT
        $resposta = $this->actingAs($usuario)
            ->postJson('/api/pacientes', fichaValida(['envio_de_cadastro_id' => $envio->id]));

        // ASSERT — nada de 201, e nenhuma ficha nasceu: a transação inteira volta atrás
        $resposta->assertStatus(422);
        expect($resposta->json('errors.envio_de_cadastro_id.0'))->toContain('já foi usado')
            ->and(Paciente::count())->toBe($pacientesAntes);
    } finally {
        Paciente::flushEventListeners();
        Paciente::boot();
    }
});

it('NÃO deve deixar a EDIÇÃO mexer na origem', function () {
    // ARRANGE — a origem de uma ficha não muda depois: aceitar isso no PUT deixaria qualquer
    // edição reescrever de onde a criança veio
    $usuario = admin();
    $envio = envioAceito();
    $paciente = Paciente::factory()->create();

    // ACT + ASSERT
    $this->actingAs($usuario)
        ->putJson("/api/pacientes/{$paciente->id}", fichaValida(['envio_de_cadastro_id' => $envio->id]))
        ->assertStatus(422);
});
