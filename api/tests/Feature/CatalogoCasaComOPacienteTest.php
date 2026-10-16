<?php

use App\Http\Requests\PacienteRequest;
use App\Models\Paciente;
use App\Support\CamposCadastro\CatalogoCamposCadastro as Catalogo;
use App\Support\CamposCadastro\FormaDoCampo as Forma;
use Illuminate\Support\Facades\Schema;

/**
 * A GUARDA CATÁLOGO × PACIENTE (Risco 1 do design).
 *
 * O catálogo é uma lista escrita à mão. Um campo com `caminho` que o paciente não guarda
 * aparece na tela de configuração, aceita ser marcado como obrigatório — e não faz nada,
 * ou pior, passa a exigir uma chave que o boundary descarta. Campo fantasma é o modo de
 * falha desta change, e ele não dá erro: dá silêncio.
 *
 * A guarda NÃO pode se ancorar nas `rules()` da `PacienteRequest`, porque a partir da
 * tarefa 2.1 elas são GERADAS do catálogo — o teste passaria por construção, provando
 * apenas que o catálogo é igual a si mesmo. A âncora é o que de fato guarda dado: as
 * colunas da tabela, o `$fillable` do model e as whitelists de chave dos JSONs.
 *
 * As asserções acumulam os defeitos numa LISTA em vez de parar no primeiro: `toContain`
 * do Pest é variádico (argumento extra é outra agulha esperada, não mensagem), então o
 * jeito de dizer QUAL campo quebrou é o próprio conteúdo da lista.
 */

/**
 * As whitelists de chave dos JSONs.
 *
 * Elas eram privadas da `PacienteRequest`, e o motivo era bom: o boundary é dono da própria
 * whitelist. A change `cadastro-online-do-paciente` abriu o SEGUNDO boundary do mesmo cadastro (o
 * formulário público), e o motivo passou a apontar para o outro lado — duas cópias divergiriam sem
 * produzir erro, e a divergência apareceria como uma família enviando um campo que a recepção não
 * consegue salvar. Elas moram agora em `FormaDoCampo`, que é a fonte única da FORMA dos campos.
 */
function chavesPrivadasDoPaciente(string $const): array
{
    return (new ReflectionClass(Forma::class))->getConstant($const);
}

/** @return list<string> um defeito por campo do catálogo que o paciente não sabe guardar */
function defeitosDoCatalogo(): array
{
    $colunas = Schema::getColumnListing('pacientes');
    $fillable = (new Paciente)->getFillable();
    $chavesDeEndereco = chavesPrivadasDoPaciente('CHAVES_ENDERECO');

    $defeitos = [];

    foreach (Catalogo::todos() as $campo => $definicao) {
        if (! in_array($definicao['coluna'], $colunas, true)) {
            $defeitos[] = "{$campo} → coluna `{$definicao['coluna']}` não existe em `pacientes`";
        }

        [$raiz, $folha] = array_pad(explode('.', $definicao['caminho'], 2), 2, null);

        if (! in_array($raiz, $fillable, true)) {
            $defeitos[] = "{$campo} → `{$raiz}` não é fillable no paciente";

            continue;
        }

        if ($folha === null) {
            continue;
        }

        // caminho aninhado só existe dentro de JSON com whitelist — hoje, só o endereço
        if ($raiz !== 'endereco_json') {
            $defeitos[] = "{$campo} → caminho aninhado inesperado em `{$raiz}`";
        } elseif (! in_array($folha, $chavesDeEndereco, true)) {
            $defeitos[] = "{$campo} → `{$folha}` fora da whitelist do endereço";
        }
    }

    return $defeitos;
}

it('deve ter, para todo campo do catálogo, coluna e caminho que o paciente sabe guardar', function () {
    // ARRANGE / ACT / ASSERT
    expect(defeitosDoCatalogo())->toBe([]);
});

it('deve REPROVAR quando um campo fantasma entra no catálogo', function () {
    // ARRANGE — a prova por MUTAÇÃO. Sem ela, a guarda acima poderia estar varrendo uma
    // lista vazia (ou comparando com uma âncora que aceita tudo) e passaria igual.
    Catalogo::registrarExtra('campo_fantasma', [
        'rotulo' => 'Campo Fantasma',
        'secao' => 'outros',
        'caminho' => 'coluna_que_nao_existe',
        'coluna' => 'coluna_que_nao_existe',
        'padrao' => ['obrigatorio' => false, 'desabilitado' => false, 'rapido' => false, 'online' => false],
    ]);

    // ACT
    $defeitos = defeitosDoCatalogo();

    // ASSERT — e limpa antes de qualquer expect que possa falhar, para não contaminar
    // os testes seguintes com o fantasma
    Catalogo::limparExtras();

    expect($defeitos)->toHaveCount(2) // a coluna inexistente E o caminho não-fillable
        ->and(implode(' | ', $defeitos))->toContain('campo_fantasma')
        ->and(defeitosDoCatalogo())->toBe([]); // catálogo limpo de novo
});

it('deve REPROVAR quando o caminho aponta para chave fora da whitelist do endereço', function () {
    // ARRANGE — o fantasma sutil: coluna certa, chave errada. Este é o que passaria por
    // uma guarda que só olhasse a coluna.
    Catalogo::registrarExtra('endereco_pais', [
        'rotulo' => 'País',
        'secao' => 'endereco',
        'caminho' => 'endereco_json.pais', // `pais` não está em CHAVES_ENDERECO
        'coluna' => 'endereco_json',
        'padrao' => ['obrigatorio' => false, 'desabilitado' => false, 'rapido' => false, 'online' => false],
    ]);

    // ACT
    $defeitos = defeitosDoCatalogo();
    Catalogo::limparExtras();

    // ASSERT
    expect($defeitos)->toHaveCount(1)
        ->and($defeitos[0])->toContain('fora da whitelist do endereço');
});
