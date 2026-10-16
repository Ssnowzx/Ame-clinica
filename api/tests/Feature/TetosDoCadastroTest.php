<?php

use App\Support\CamposCadastro\CatalogoCamposCadastro as Catalogo;
use App\Support\Validacao\TamanhoMaximo;
use Illuminate\Support\Facades\Validator;

/**
 * O TETO DE CADA CAMPO — declarado uma vez, recusado pelo servidor e entregue à tela
 * (change `tetos-do-cadastro-na-tela`).
 *
 * Nasceu do chamado de 04/09/2026: a recepção preencheu a ficha inteira e o servidor recusou o
 * logradouro por tamanho, sem dizer o tamanho e sem que o campo tivesse impedido o excesso. O
 * que estes testes prendem é a IGUALDADE entre os três lugares — se o número da régua deixar
 * de ser o número que o servidor recusa, um deles cai.
 *
 * Dados 100% FICTÍCIOS (LGPD).
 */
function recusaPorTamanho(int $limite, string $valor): array
{
    $validador = Validator::make(
        ['campo' => $valor],
        ['campo' => ['string', new TamanhoMaximo($limite)]],
        [],
        ['campo' => 'logradouro'],
    );

    return $validador->errors()->all();
}

it('deve aceitar o valor no limite e recusar um caractere além', function () {
    // ARRANGE + ACT + ASSERT — a fronteira, dos dois lados
    expect(recusaPorTamanho(255, str_repeat('a', 255)))->toBe([]);
    expect(recusaPorTamanho(255, str_repeat('a', 256)))->toHaveCount(1);
});

it('deve dizer na recusa o tamanho RECEBIDO, não só o limite', function () {
    // ARRANGE — o defeito que originou a change: num campo de linha única o excesso está fora
    // da vista, e "não pode ter mais de 255" não diz se sobram três caracteres ou trezentos

    // ACT
    $mensagens = recusaPorTamanho(255, str_repeat('a', 312));

    // ASSERT
    expect($mensagens[0])->toBe('O campo logradouro tem 312 caracteres; o limite é 255.');
});

it('deve medir em CARACTERES, não em bytes', function () {
    // ARRANGE — "coração" tem 7 caracteres e 9 bytes; medir bytes recusaria endereço com
    // acento que cabe

    // ACT + ASSERT
    expect(recusaPorTamanho(7, 'coração'))->toBe([]);
});

it('NÃO deve reclamar do que não é texto — quem recusa isso é a regra `string`', function () {
    // ARRANGE — duas mensagens sobre o mesmo defeito é ruído na tela
    $validador = Validator::make(['campo' => ['a', 'b']], ['campo' => ['string', new TamanhoMaximo(1)]]);

    // ACT + ASSERT
    expect($validador->errors()->get('campo'))->toHaveCount(1);
});

it('deve derivar o teto do campo a partir da FORMA, sem número escrito no catálogo', function () {
    // ARRANGE + ACT + ASSERT
    expect(Catalogo::tamanho('endereco_logradouro'))->toBe(500)
        ->and(Catalogo::tamanho('endereco_complemento'))->toBe(255)
        ->and(Catalogo::tamanho('obs'))->toBe(2000)
        ->and(Catalogo::tamanho('carteirinha'))->toBe(60);
});

it('NÃO deve confundir o `max` de ITENS de uma lista com teto de caracteres', function () {
    /*
     * ARRANGE — a armadilha desta change. `responsaveis_json` é `['array', 'max:5']` e
     * `contatos_json` é `['array', 'max:10']`: esse `max` conta ITENS. Uma derivação ingênua
     * ("ache um `max` e devolva o número") mandaria à tela um limite de 5 CARACTERES para a
     * lista de responsáveis.
     */
    expect(Catalogo::tamanho('responsaveis_json'))->toBeNull()
        ->and(Catalogo::tamanho('contatos_json'))->toBeNull();
});

it('NÃO deve entregar teto de campo que não é declarado como texto', function () {
    /*
     * ARRANGE — achado MENOR 1 do gate: o design D2 promete "tamanho somente quando `string`
     * acompanha o teto", e o código devolvia o limite de qualquer `TamanhoMaximo`. Hoje só
     * campo de texto o carrega, mas o teste prende a INVARIANTE, não o acaso.
     */
    // ACT + ASSERT — a mesma lista, com e sem a declaração de texto
    expect(Catalogo::tamanhoEm(['array', new TamanhoMaximo(5)]))->toBeNull()
        ->and(Catalogo::tamanhoEm(['string', new TamanhoMaximo(5)]))->toBe(5);
});

it('NÃO deve inventar teto para campo que não é texto', function () {
    // ARRANGE — data, lista fechada e número não têm teto de caracteres; entregar um faria a
    // tela inventar limite onde o servidor não tem
    expect(Catalogo::tamanho('nascimento'))->toBeNull()
        ->and(Catalogo::tamanho('sexo'))->toBeNull()
        ->and(Catalogo::tamanho('convenio_id'))->toBeNull()
        ->and(Catalogo::tamanho('cpf'))->toBeNull()
        ->and(Catalogo::tamanho('endereco_uf'))->toBeNull();
});

it('deve entregar os tetos dos SUBCAMPOS das listas', function () {
    // ARRANGE + ACT
    $responsavel = Catalogo::tamanhosDosItens('responsaveis_json');
    $contato = Catalogo::tamanhosDosItens('contatos_json');

    // ASSERT
    expect($responsavel)->toBe(['nome' => 255, 'parentesco' => 60, 'telefone' => 20, 'email' => 255])
        ->and($contato)->toBe(['valor' => 255, 'obs' => 255])
        ->and(Catalogo::tamanhosDosItens('nome'))->toBe([]);
});

it('deve garantir que TODO campo do catálogo tem forma declarada', function () {
    /*
     * ARRANGE — achado TETO-SEC-03. `Catalogo::tamanho()` chama `FormaDoCampo::regras()`, cujo
     * `default` LANÇA. Hoje é inócuo, mas campo novo no catálogo sem forma faria
     * `GET /api/publico/cadastro/{slug}` responder 500 **só para as clínicas que publicaram
     * esse campo** — diferença de resposta correlacionada à configuração da clínica, na rota
     * cuja invariante é justamente não contar o que existe.
     *
     * Antes desta change o mesmo campo só quebraria no envio. A guarda fecha a porta nova.
     */
    foreach (array_keys(Catalogo::todos()) as $campo) {
        // ACT + ASSERT — nenhuma exceção, para nenhum campo. São DOIS métodos porque são dois
        // que o controller e o formulário público chamam por campo, e `itensDe()` tem o próprio
        // `default => throw`: campo-LISTA novo sem itens declarados reproduz o mesmo 500
        // seletivo por configuração (achado TETO-SEC-06 da rodada 2)
        expect(fn () => Catalogo::tamanho($campo))->not->toThrow(InvalidArgumentException::class)
            ->and(fn () => Catalogo::tamanhosDosItens($campo))->not->toThrow(InvalidArgumentException::class);
    }
});

it('deve entregar o teto na leitura da régua, para quem só pode CRIAR paciente', function () {
    // ARRANGE — é a leitura que monta o formulário; exigir a permissão de configurações para
    // desenhar um campo pararia o cadastro para quem não é administrador
    admin();
    $recepcao = usuarioCom(['pacientes.ver', 'pacientes.criar'], 'Recepção Fictícia');

    // ACT
    $resposta = $this->actingAs($recepcao)->getJson('/api/campos-cadastro/paciente');

    // ASSERT
    $resposta->assertOk();
    $porCampo = collect($resposta->json('campos'))->keyBy('campo');
    expect($porCampo['endereco_logradouro']['tamanho'])->toBe(500)
        ->and($porCampo['nascimento']['tamanho'])->toBeNull()
        ->and($porCampo['responsaveis_json']['tamanho'])->toBeNull()
        ->and($porCampo['responsaveis_json']['tamanhos_dos_itens']['nome'])->toBe(255);
});

it('deve provar que o teto da RÉGUA é o mesmo que o servidor recusa', function () {
    /*
     * ARRANGE — o cenário que impede a divergência silenciosa entre a tela e o boundary. Se
     * alguém mudar o número num lugar só, este teste cai: ele LÊ o teto da régua e usa esse
     * valor para montar o payload.
     */
    $adminDaClinica = admin();
    $regua = $this->actingAs($adminDaClinica)->getJson('/api/campos-cadastro/paciente')->json('campos');
    $teto = collect($regua)->firstWhere('campo', 'endereco_logradouro')['tamanho'];

    // ACT + ASSERT — exatamente o teto passa
    $this->actingAs($adminDaClinica)->postJson('/api/pacientes', [
        ...pacienteMenorValido(),
        'endereco_json' => ['logradouro' => str_repeat('a', $teto)],
    ])->assertCreated();

    // e um caractere além é recusado, dizendo o tamanho
    $resposta = $this->actingAs($adminDaClinica)->postJson('/api/pacientes', [
        ...pacienteMenorValido(),
        'nome' => 'Outro Paciente Fictício',
        'endereco_json' => ['logradouro' => str_repeat('a', $teto + 1)],
    ])->assertUnprocessable();

    $mensagem = $resposta->json('errors')['endereco_json.logradouro'][0];
    expect($mensagem)->toContain((string) ($teto + 1))->toContain((string) $teto);
});

it('NÃO deve deixar a clínica gravar o TAMANHO pela régua', function () {
    // ARRANGE — tamanho é FORMA do campo, não preferência de clínica (§13). Aceitar aqui
    // criaria a segunda cópia do número, que é o que esta change existe para impedir
    $adminDaClinica = admin();

    // ACT + ASSERT
    $this->actingAs($adminDaClinica)->putJson('/api/campos-cadastro/paciente', [
        'campos' => ['endereco_logradouro' => ['tamanho' => 9000]],
    ])->assertUnprocessable();
});
