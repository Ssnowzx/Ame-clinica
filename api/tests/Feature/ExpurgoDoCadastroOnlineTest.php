<?php

use App\Models\EnvioDeCadastro;
use App\Models\Paciente;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;

/**
 * A retenção do auto-cadastro (change `cadastro-online-do-paciente`, passo 5).
 *
 * Existe **antes** da rota que coleta, e a ordem é o ponto: porta que coleta sem expurgo é
 * acúmulo de dado de MENOR desde o primeiro dia. Guardar envio que ninguém quis é guardar dado
 * sem finalidade — o oposto da minimização que a §12 exige.
 */
function envioAntigo(int $diasAtras, array $extras = []): EnvioDeCadastro
{
    $envio = EnvioDeCadastro::create([
        'payload' => ['nome' => 'Criança Fictícia Antiga', 'cpf' => '39053344705'],
        'enviado_em' => now()->subDays($diasAtras),
    ]);

    $envio->forceFill(['ip' => '203.0.113.7', ...$extras])->save();

    return $envio->fresh();
}

it('deve apagar o conteúdo E o IP do envio vencido, preservando a linha', function () {
    // ARRANGE — 30 dias é o padrão respondido pela clínica
    admin();
    $vencido = envioAntigo(31);

    // ACT
    $this->artisan('cadastro-online:expurgar')->assertSuccessful();

    // ASSERT — a linha sobrevive; o dado, não. E a marca diz que foi por prazo, não por vazio
    $depois = $vencido->fresh();
    expect($depois)->not->toBeNull()
        ->and($depois->payload)->toBeNull()
        ->and($depois->ip)->toBeNull()
        ->and($depois->expurgado_em)->not->toBeNull()
        ->and($depois->situacao)->toBe('pendente');

    // e nem na coluna crua sobrou rastro do que a família digitou
    $cru = (string) DB::table('envios_de_cadastro')->where('id', $vencido->id)->value('payload');
    expect($cru)->toBe('');
});

it('NÃO deve tocar no envio ainda dentro do prazo', function () {
    // ARRANGE — o par de controle: sem ele, um comando que apagasse tudo passaria no teste acima
    admin();
    $recente = envioAntigo(29);

    // ACT
    $this->artisan('cadastro-online:expurgar')->assertSuccessful();

    // ASSERT
    expect($recente->fresh()->payload['nome'])->toBe('Criança Fictícia Antiga')
        ->and($recente->fresh()->expurgado_em)->toBeNull();
});

it('NÃO deve alcançar o envio ACEITO, nem o paciente que ele gerou', function () {
    // ARRANGE — o dado do aceito virou paciente, e o paciente tem a retenção do prontuário,
    // que é outra e muito mais longa
    admin();
    $paciente = Paciente::factory()->create(['nome' => 'Criança Fictícia Aceita']);
    $aceito = envioAntigo(90, [
        'situacao' => 'aceito',
        'paciente_id' => $paciente->id,
        'conferido_em' => now()->subDays(89),
    ]);

    // ACT
    $this->artisan('cadastro-online:expurgar')->assertSuccessful();

    // ASSERT — o conteúdo fica (é prontuário agora), mas o IP não: IP não é prontuário
    expect($aceito->fresh()->expurgado_em)->toBeNull()
        ->and($aceito->fresh()->payload['nome'])->toBe('Criança Fictícia Antiga')
        ->and($aceito->fresh()->ip)->toBeNull()
        ->and($paciente->fresh()->nome)->toBe('Criança Fictícia Aceita');
});

it('deve ALCANÇAR o envio aceito que nunca virou ficha', function () {
    // ARRANGE — a recepção clicou em "aceitar", o envio saiu da fila e o formulário nunca foi
    // salvo: interrupção no balcão basta. Antes, esse envio guardava payload e IP de MENOR para
    // sempre — invisível na tela e fora do expurgo (SEC-CO-34)
    admin();
    $abandonado = envioAntigo(200, ['situacao' => 'aceito', 'conferido_em' => now()->subDays(199)]);
    expect($abandonado->paciente_id)->toBeNull();

    // ACT
    $this->artisan('cadastro-online:expurgar')->assertSuccessful();

    // ASSERT — minimizado como qualquer outro que ninguém quis
    $depois = $abandonado->fresh();
    expect($depois->payload)->toBeNull()
        ->and($depois->ip)->toBeNull()
        ->and($depois->expurgado_em)->not->toBeNull();
});

it('deve minimizar o envio DESCARTADO, guardando o motivo da decisão', function () {
    // ARRANGE — o motivo é registro de decisão da clínica, não dado da família: ele fica.
    // O conteúdo vai, porque a decisão já foi tomada e o dado não serve mais a nada
    admin();
    $descartado = envioAntigo(45, [
        'situacao' => 'descartado',
        'motivo_descarte' => 'Cadastro em duplicidade.',
        'conferido_em' => now()->subDays(44),
    ]);

    // ACT
    $this->artisan('cadastro-online:expurgar')->assertSuccessful();

    // ASSERT
    expect($descartado->fresh()->payload)->toBeNull()
        ->and($descartado->fresh()->motivo_descarte)->toBe('Cadastro em duplicidade.');
});

it('NÃO deve expurgar duas vezes o mesmo envio', function () {
    // ARRANGE — sem a guarda do `expurgado_em`, cada execução reescreveria a marca e a data
    // do expurgo passaria a mentir sobre quando o dado saiu
    admin();
    $vencido = envioAntigo(60);
    $this->artisan('cadastro-online:expurgar')->assertSuccessful();
    $primeiroExpurgo = $vencido->fresh()->expurgado_em;

    // ACT
    $this->travel(1)->days();
    $this->artisan('cadastro-online:expurgar')->assertSuccessful();

    // ASSERT
    expect($vencido->fresh()->expurgado_em->toDateTimeString())->toBe($primeiroExpurgo->toDateTimeString());
});

it('deve estar no agendamento — comando que ninguém chama não é retenção, é intenção', function () {
    // ARRANGE + ACT — pergunta ao próprio agendador o que ele tem, e não ao arquivo de origem:
    // um teste que lesse `bootstrap/app.php` como texto passaria com a linha comentada
    Artisan::call('schedule:list');
    $saida = Artisan::output();

    // ASSERT
    expect($saida)->toContain('cadastro-online:expurgar');
});
