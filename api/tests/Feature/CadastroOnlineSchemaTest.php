<?php

use App\Models\Configuracao;
use App\Models\EnvioDeCadastro;
use App\Models\Paciente;
use Illuminate\Support\Facades\DB;

/**
 * O schema do auto-cadastro público, antes de existir qualquer rota que o use
 * (change `cadastro-online-do-paciente`, passo 4 da ordem que o parecer pré-código fixou).
 *
 * A ordem não é burocracia: a porta só pode nascer depois da proteção. Payload que chega antes
 * da cifra fica em claro para sempre — cifrar depois é migração de dado, não decisão de desenho.
 */
function envioPendente(array $payload = ['nome' => 'Criança Fictícia do Envio']): EnvioDeCadastro
{
    return EnvioDeCadastro::create([
        'payload' => $payload,
        'enviado_em' => now(),
    ]);
}

it('deve gravar o conteúdo do envio CIFRADO — o nome não está legível na coluna', function () {
    // ARRANGE — a existência de um envio já diz que aquela criança busca tratamento nesta
    // clínica: é dado referente à saúde por inferência (art. 11), no piso da anamnese
    admin();

    // ACT
    $envio = envioPendente(['nome' => 'Criança Fictícia Secreta', 'cpf' => '39053344705']);

    // ASSERT — pelo model, legível; na coluna crua, não
    $cru = (string) DB::table('envios_de_cadastro')->where('id', $envio->id)->value('payload');
    expect($envio->fresh()->payload['nome'])->toBe('Criança Fictícia Secreta')
        ->and($cru)->not->toContain('Criança Fictícia Secreta')
        ->and($cru)->not->toContain('39053344705')
        ->and($cru)->not->toBe('');
});

it('deve manter o conteúdo do envio FORA da trilha de auditoria', function () {
    // ARRANGE — a trilha prova o ciclo de vida (houve envio, foi aceito por fulano, quando) sem
    // repetir o dado do menor. Aqui a regra é mais estrita que a de `pacientes`, por escolha
    admin();

    // ACT
    envioPendente(['nome' => 'Criança Fictícia da Trilha', 'cpf' => '39053344705']);

    // ASSERT
    $diff = json_encode(
        DB::table('auditoria')->where('entidade', 'envios_de_cadastro')->value('diff_json'),
        JSON_UNESCAPED_UNICODE
    );
    expect($diff)->not->toContain('Criança Fictícia da Trilha')
        ->and($diff)->not->toContain('39053344705')
        ->and($diff)->toContain('***');
});

it('deve nascer com o endereço público NULO na clínica', function () {
    // ARRANGE + ACT — ninguém ganha uma porta pública por deploy (a clínica nasce no TestCase)
    $clinica = clinica();

    // ASSERT
    expect($clinica->fresh()->cadastro_online_slug)->toBeNull();
});

it('deve deixar o paciente do cadastro INTERNO sem origem externa', function () {
    // ARRANGE + ACT — é a marca que distingue "a família digitou" de "a recepção digitou"
    admin();
    $paciente = Paciente::factory()->create();

    // ASSERT
    expect($paciente->fresh()->envio_de_cadastro_id)->toBeNull();
});

it('deve nascer com o cadastro pelo link DESLIGADO, e recusar retenção fora da faixa', function () {
    // ARRANGE — posição segura de uma rota pública que escreve: a clínica liga quando quiser
    $usuario = admin();

    // ACT + ASSERT — o default
    $resposta = $this->actingAs($usuario)->getJson('/api/configuracoes')->assertOk();
    $valores = collect($resposta->json('configuracoes'))->keyBy('chave');
    expect($valores['cadastro_online.ativo']['valor'])->toBeFalse()
        ->and($valores['cadastro_online.retencao_dias']['valor'])->toBe(30)
        // e o bloco novo tem rótulo em português, para a tela não inventar um a partir do slug
        ->and(collect($resposta->json('blocos'))->pluck('bloco'))->toContain('cadastro_online');

    // ACT + ASSERT — a faixa
    foreach ([0, 400] as $foraDaFaixa) {
        $this->actingAs($usuario)->putJson('/api/configuracoes', [
            'chave' => 'cadastro_online.retencao_dias', 'valor' => $foraDaFaixa,
        ])->assertUnprocessable();
    }
    expect(Configuracao::where('chave', 'cadastro_online.retencao_dias')->exists())->toBeFalse();
});

it('NÃO deve deixar o endereço público entrar pelo catálogo de configurações', function () {
    // ARRANGE — toda escrita em `configuracoes` é auditada COM O VALOR EM CLARO, e a trilha é
    // legível por quem tem `auditoria.ver`: gravar o slug ali entregaria o endereço do
    // formulário pela própria trilha (design D5)
    $usuario = admin();

    // ACT + ASSERT
    foreach (['cadastro_online.slug', 'cadastro_online.endereco', 'clinica.cadastro_online_slug'] as $chave) {
        $this->actingAs($usuario)->putJson('/api/configuracoes', [
            'chave' => $chave, 'valor' => 'abc123xyz',
        ])->assertUnprocessable();
    }

    expect(Configuracao::query()->count())->toBe(0);
});
