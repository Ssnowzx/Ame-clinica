<?php

use App\Models\Auditoria;
use App\Models\CampoCadastro;
use App\Support\CamposCadastro\CatalogoCamposCadastro as Catalogo;
use App\Support\CamposCadastro\ReguaDoCadastro;
use Illuminate\Database\QueryException;

/**
 * A régua efetiva: catálogo + override da clínica (change campos-do-cadastro-configuraveis).
 *
 * O que estes testes protegem: o padrão do catálogo vale até a clínica configurar, o override
 * vence o padrão — e a leitura precisa ser coerente mesmo com dado torto no banco.
 */
function regua(): ReguaDoCadastro
{
    return app(ReguaDoCadastro::class);
}

it('deve devolver o padrão do catálogo para a clínica que nunca configurou', function () {
    // ARRANGE
    admin();

    // ACT / ASSERT — a obrigatoriedade de antes da change, sem nenhuma linha no banco
    expect(CampoCadastro::query()->count())->toBe(0)
        ->and(regua()->obrigatorio('nascimento'))->toBeTrue()
        ->and(regua()->obrigatorio('sexo'))->toBeTrue()
        ->and(regua()->obrigatorio('necessidade'))->toBeTrue()
        ->and(regua()->obrigatorio('estado_civil'))->toBeFalse()
        ->and(regua()->desabilitado('estado_civil'))->toBeFalse();
});

it('deve devolver o override quando a clínica configurou', function () {
    // ARRANGE
    admin();

    // ACT
    regua()->gravar('sexo', ['obrigatorio' => false]);
    regua()->gravar('endereco_cidade', ['obrigatorio' => true]);

    // ASSERT — é assim que a clínica opera hoje no sistema antigo
    expect(regua()->obrigatorio('sexo'))->toBeFalse()
        ->and(regua()->obrigatorio('endereco_cidade'))->toBeTrue()
        // o que não foi tocado continua no padrão
        ->and(regua()->obrigatorio('nascimento'))->toBeTrue();
});

it('NÃO deve deixar a clínica duplicar a régua de um campo', function () {
    // ARRANGE
    admin();
    regua()->gravar('sexo', ['obrigatorio' => false]);

    // ACT / ASSERT — a invariante é do BANCO, não da aplicação
    expect(function () {
        DB::table('campos_cadastro')->insert([
            'formulario' => 'paciente',
            'campo' => 'sexo',
            'obrigatorio' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    })->toThrow(QueryException::class);
});

it('deve fazer o campo escondido vencer o obrigatório na leitura', function () {
    // ARRANGE — dado TORTO de propósito: as duas chaves ligadas no mesmo campo. A escrita
    // pela API recusa essa combinação, mas quem LÊ não pode depender disso: vindo de
    // migração ou de console, produziria um cadastro impossível de salvar — 422 sem campo
    // culpado, porque o formulário nem mostra o campo.
    admin();
    regua()->gravar('necessidade', ['obrigatorio' => true, 'desabilitado' => true]);

    // ACT / ASSERT
    expect(regua()->desabilitado('necessidade'))->toBeTrue()
        ->and(regua()->obrigatorio('necessidade'))->toBeFalse()
        ->and(regua()->obrigatorios())->not->toContain('necessidade');
});

it('deve listar os obrigatórios e os escondidos da clínica', function () {
    // ARRANGE
    admin();
    regua()->gravar('sexo', ['obrigatorio' => false]);
    regua()->gravar('endereco_cidade', ['obrigatorio' => true]);
    regua()->gravar('estado_civil', ['desabilitado' => true]);

    // ACT / ASSERT
    expect(regua()->obrigatorios())
        ->toEqualCanonicalizing(['nome', 'nascimento', 'necessidade', 'endereco_cidade'])
        ->and(regua()->desabilitados())->toBe(['estado_civil']);
});

it('deve auditar a gravação da régua com o campo e a chave', function () {
    // ARRANGE
    admin();

    // ACT
    regua()->gravar('sexo', ['obrigatorio' => false]);

    // ASSERT — mudar o que a clínica exige de uma família é mudança de regra de negócio (§12)
    $registro = Auditoria::where('entidade', 'campos_cadastro')->where('acao', 'criou')->firstOrFail();

    expect($registro->diff_json['depois']['campo'])->toBe('sexo')
        ->and($registro->diff_json['depois']['obrigatorio'])->toBeFalsy();
});

it('NÃO deve poluir a trilha quando a gravação não muda nada', function () {
    // ARRANGE
    admin();
    regua()->gravar('sexo', ['obrigatorio' => false]);
    $antes = Auditoria::where('entidade', 'campos_cadastro')->count();

    // ACT — mesmíssimo valor
    regua()->gravar('sexo', ['obrigatorio' => false]);

    // ASSERT
    expect(Auditoria::where('entidade', 'campos_cadastro')->count())->toBe($antes);
});

it('deve recusar leitura de campo fora do catálogo', function () {
    // ARRANGE
    admin();

    // ACT / ASSERT
    expect(fn () => regua()->obrigatorio('campo_que_nao_existe'))
        ->toThrow(InvalidArgumentException::class);
});

it('deve esquecer o memo ao gravar, para a mesma requisição ver o valor novo', function () {
    // ARRANGE — a FormRequest lê ANTES; o controller grava; a listagem lê DEPOIS (D7)
    admin();
    expect(regua()->obrigatorio('sexo'))->toBeTrue();

    // ACT
    regua()->gravar('sexo', ['obrigatorio' => false]);

    // ASSERT — sem invalidar o memo, a leitura seguinte devolveria o valor velho
    expect(regua()->obrigatorio('sexo'))->toBeFalse()
        ->and(Catalogo::padrao('sexo', 'obrigatorio'))->toBeTrue(); // o catálogo não mudou
});
