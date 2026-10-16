<?php

use App\Models\Paciente;
use Illuminate\Support\Str;
use Illuminate\Validation\Validator;

/**
 * A validação do framework FALA COM O USUÁRIO — e falava em inglês.
 *
 * A tela do Financeiro exibia "The de field must match the format Y-m-d." em vermelho para
 * a recepção (validação em produção, 2026-08-21): texto de máquina, em outro idioma, numa
 * clínica brasileira. A regra de fronteira do projeto é explícita — se a string aparece na
 * tela de alguém, é português.
 *
 * Estes testes existem porque a correção é frágil por natureza: some se o `lang/pt_BR`
 * for apagado num merge, se o `locale` do config voltar para `en`, ou se alguém publicar
 * as traduções por cima. Nenhuma dessas três coisas quebraria um teste de feature comum.
 */
it('deve responder a validação em português, não em inglês', function () {
    // ARRANGE
    admin();
    $financeiro = usuarioCom(['fluxo_caixa.ver'], 'Financeiro Fictício');

    // ACT — data em formato impossível, o mesmo caminho do achado em produção
    $resposta = $this->actingAs($financeiro)->getJson('/api/fluxo-caixa?de=12026-08-01&ate=2026-08-31');

    // ASSERT
    $resposta->assertStatus(422);
    $mensagem = $resposta->json('errors.de.0');
    expect($mensagem)->toContain('formato');
    expect($mensagem)->toContain('data inicial'); // o nome que a clínica usa, não `de`
    expect($mensagem)->not->toContain('field must');
});

it('deve nomear o campo como a clínica o chama, não como a coluna do banco', function () {
    // ARRANGE — "O campo paciente_id é obrigatório" é nome de coluna vazando para a tela
    admin(); // idem
    $quemMarca = usuarioCom(['agenda.criar', 'agenda.ver_todos'], 'Marca Fictício');

    // ACT
    $resposta = $this->actingAs($quemMarca)->postJson('/api/agendamentos', []);

    // ASSERT
    $resposta->assertStatus(422);
    $erros = json_encode($resposta->json('errors'), JSON_UNESCAPED_UNICODE);
    // afirma o que a mensagem É (português), não o que ela não é — negar "The " dá falso
    // positivo com acento no meio da string
    expect($erros)->toContain('O campo');
    expect($erros)->toContain('obrigatório');
    expect($erros)->not->toContain('field is required');
    expect($erros)->not->toContain('must be');
});

it('deve manter o locale da aplicação em pt_BR', function () {
    // ARRANGE + ACT + ASSERT — o locale é o que carrega o `lang/pt_BR`; voltando para `en`,
    // toda mensagem volta ao inglês sem que nenhum outro teste perceba.
    // O FALLBACK segue `en` de propósito: chave sem tradução caindo no inglês é feio, mas
    // legível — cair em pt_BR mostraria a CHAVE crua ao usuário. Quem impede a falta de
    // tradução é a guarda do teste seguinte, não o fallback.
    expect(config('app.locale'))->toBe('pt_BR');
    expect(file_exists(lang_path('pt_BR/validation.php')))->toBeTrue();
});

it('deve ter tradução para toda regra de validação que o produto usa', function () {
    // ARRANGE — regra nova sem tradução volta a sair em inglês, em silêncio.
    //
    // A primeira versão desta guarda cruzava com uma lista de regras escrita À MÃO — e por
    // isso não viu `required_unless`, que passou verde enquanto a API respondia "The paciente
    // field is required unless tipo is in bloqueio." Quem pegou foi o teste de cima, não ela.
    // Agora a lista de referência é a do FRAMEWORK (as regras que o validador conhece), não
    // a minha memória.
    $doFramework = collect((new ReflectionClass(Validator::class))
        ->getDefaultProperties()['implicitRules'] ?? [])
        ->merge((new ReflectionClass(Validator::class))
            ->getDefaultProperties()['dependentRules'] ?? [])
        ->map(fn (string $regra) => Str::snake($regra))
        ->all();

    $fontes = collect(glob(app_path('Http/Requests/*.php')))
        ->merge(glob(app_path('Http/Controllers/*.php')))
        ->map(fn (string $arquivo) => file_get_contents($arquivo))
        ->implode("\n");

    $conhecidas = array_keys(require lang_path('pt_BR/validation.php'));

    // toda string do tipo 'regra' ou 'regra:parametros' que o framework reconhece como regra
    preg_match_all("/'([a-z_]+)(?::[^']*)?'/", $fontes, $achados);
    $usadas = collect($achados[1])->unique()->intersect($doFramework);

    // ASSERT
    $semTraducao = $usadas->reject(fn (string $regra) => in_array($regra, $conhecidas, true));
    expect($semTraducao->all())->toBe([]);
});
