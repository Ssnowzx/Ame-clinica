<?php

use App\Models\ContatoNormalizado;
use App\Models\Paciente;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;

/*
 * `telefones:conferir-mais` (gate r1 da change telefone-estrangeiro): o cadastro antigo com `+`
 * digitado à toa na frente do DDD muda de país com a regra nova. O comando aponta onde olhar, SÓ
 * LENDO e sem número nem nome — o dono roda na produção e cola a saída na conversa.
 *
 * Dados e telefones 100% FICTÍCIOS (LGPD — menores); Reino Unido na faixa de ficção da Ofcom.
 */

function pacienteParaConferirMais(array $contatos, array $responsaveis = []): Paciente
{
    return Paciente::factory()->create([
        'nome' => 'Criança Fictícia Conferida',
        'contatos_json' => $contatos,
        'responsaveis_json' => $responsaveis !== [] ? $responsaveis : [['nome' => 'Responsável Fictícia', 'parentesco' => 'mãe']],
    ]);
}

function rodarConferirMais(): string
{
    expect(Artisan::call('telefones:conferir-mais'))->toBe(0);

    return Artisan::output();
}

it('deve listar o telefone com + que a regra antiga lia como brasileiro, sem número e sem nome', function () {
    // ARRANGE — `+ 11 …` era São Paulo e vira EUA; `+49 …` era Santa Catarina e vira Alemanha
    admin();
    $paciente = pacienteParaConferirMais(
        [['tipo' => 'celular', 'valor' => '+ 11 98765-4321']],
        [['nome' => 'Mãe Fictícia Conferida', 'parentesco' => 'mãe', 'telefone' => '+49 99123-4567']],
    );

    // ACT
    $saida = rodarConferirMais();

    // ASSERT
    expect($saida)->toContain("paciente {$paciente->id} · contato · +1 EUA, Canadá e Caribe")
        ->toContain("paciente {$paciente->id} · responsável · +49 Alemanha")
        ->toContain('Total: 2 telefone(s) em 1 paciente(s).')
        // o número em nenhuma das formas (as completas: um pedaço curto colidiria com um id)
        ->not->toContain('11987654321')->not->toContain('98765-4321')
        ->not->toContain('49991234567')->not->toContain('99123-4567')
        ->not->toContain('Fictícia');
});

it('não deve listar o telefone que a regra nova lê igual ou que a antiga recusava', function (array $contatos, array $responsaveis) {
    // ARRANGE
    admin();
    pacienteParaConferirMais($contatos, $responsaveis);

    // ACT
    $saida = rodarConferirMais();

    // ASSERT
    expect($saida)->toContain('Nenhum telefone com + mudou de país.')
        ->toContain('Total: 0 telefone(s) em 0 paciente(s).');
})->with([
    'estrangeiro de verdade' => [[['tipo' => 'whatsapp', 'valor' => '+44 7700 900123']], []],
    'brasileiro com +55' => [[['tipo' => 'celular', 'valor' => '+55 11 98765-4321']], []],
    'brasileiro sem +' => [[['tipo' => 'telefone', 'valor' => '(11) 98765-4321']], []],
    'contato que não é telefone' => [[['tipo' => 'email', 'valor' => '+ 11 98765-4321']], []],
    'responsável estrangeiro de verdade' => [[], [['nome' => 'Pai Fictício', 'parentesco' => 'pai', 'telefone' => '+44 7700 900123']]],
    'responsável com +55' => [[], [['nome' => 'Pai Fictício', 'parentesco' => 'pai', 'telefone' => '+55 (49) 99123-4567']]],
]);

it('deve tirar as marcas invisíveis do WhatsApp antes de olhar o +', function () {
    // ARRANGE
    admin();
    $paciente = pacienteParaConferirMais([['tipo' => 'celular', 'valor' => "\u{202A}+ 11 98765-4321\u{202C}"]]);

    // ACT
    $saida = rodarConferirMais();

    // ASSERT
    expect($saida)->toContain("paciente {$paciente->id} · contato · +1 EUA, Canadá e Caribe");
});

it('deve dizer o código de 3 dígitos quando o país não tem código curto', function () {
    // ARRANGE — `+35 9…` era o Sul de Minas e vira +359
    admin();
    $paciente = pacienteParaConferirMais([['tipo' => 'celular', 'valor' => '+35 99123-4567']]);

    // ACT
    $saida = rodarConferirMais();

    // ASSERT
    expect($saida)->toContain("paciente {$paciente->id} · contato · +359\n");
});

it('não deve escrever nada no banco', function () {
    // ARRANGE
    admin();
    pacienteParaConferirMais([['tipo' => 'celular', 'valor' => '+ 11 98765-4321']]);
    $antes = [Paciente::query()->count(), ContatoNormalizado::query()->count()];
    $escritas = [];
    DB::listen(function ($consulta) use (&$escritas): void {
        if (preg_match('/^\s*(insert|update|delete|replace|alter|create|drop|truncate)\b/i', $consulta->sql) === 1) {
            $escritas[] = $consulta->sql;
        }
    });

    // ACT
    rodarConferirMais();

    // ASSERT
    expect($escritas)->toBe([])
        ->and([Paciente::query()->count(), ContatoNormalizado::query()->count()])->toBe($antes);
});
