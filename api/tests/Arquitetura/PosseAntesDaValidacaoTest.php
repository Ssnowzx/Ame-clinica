<?php

use Illuminate\Foundation\Http\FormRequest;
use Symfony\Component\Finder\Finder;

/**
 * GUARDA DE IDIOMA — toda `FormRequest` que valida `profissional_id` decide POSSE no `authorize()`.
 *
 * Esta guarda nasce de um padrão, não de um defeito: **três rodadas seguidas do gate acharam a
 * mesma classe de furo em superfícies diferentes.** A ordem `validação → autorização` produz um
 * oráculo toda vez, porque a validação responde "esse id não existe" (422) a quem a autorização
 * responderia "não é seu" (403) — e a diferença enumera o cadastro.
 *
 * O histórico, para o próximo leitor entender por que a guarda existe:
 *
 * - r2 · `SEC-VP-20`: `PUT /agendamentos` — palpite certo do `paciente_id` dava 403, errado 422.
 * - r3 · `SEC-VP-32`: `POST /lista-espera/{id}/encaixar` e o desmarque em lote — colega 403,
 *   profissional inexistente 422.
 * - r3 · `SEC-VP-33`: rotas sem `FormRequest`, com `findOrFail` antes da posse — colega 403,
 *   inexistente 404.
 * - gate de `baixa-em-lote-por-status` · CR-03/SEC-BL-01: a chave `profissional_id` saiu das
 *   duas Requests de lote para o trait `AlcanceEmLoteRequest::regrasDoAlcance()`, e a versão
 *   anterior desta guarda — que casava o TEXTO do arquivo da Request — passou a PULAR as duas
 *   superfícies que a motivaram. Um `authorize(): bool { return true; }` redefinido na classe
 *   (método da classe sobrescreve o do trait em silêncio) mantinha a rede verde com a posse
 *   inalcançável. Daí a forma atual: a chave é procurada na Request E nos traits/pais que ela
 *   usa, e o `authorize()` examinado é o EFETIVO, resolvido por reflexão — o método que o
 *   Laravel vai chamar, more ele na classe, no trait ou no pai.
 *
 * O revisor nomeou o que os três têm em comum: *"cada conserto de ordenação move a fronteira, e a
 * fronteira nova nunca é varrida — enquanto não existir guarda mecânica, a rodada N+1 acha a
 * superfície N+1."* É essa guarda.
 *
 * LIMITES, ditos em vez de escondidos — são QUATRO; o terceiro veio do gate e o quarto da
 * rodada 4 (`SEC-VP-49`/CR4-03):
 *
 * 1. cobre o eixo `profissional_id` nas `FormRequest`; rotas SEM `FormRequest` são varredura de
 *    controller (`SEC-VP-33`/`SEC-VP-40`), não caem aqui;
 * 2. não cobre outros eixos de posse que venham a existir;
 * 3. **falso-negativo intra-método:** ela casa TEXTO do corpo do `authorize()`, não
 *    alcançabilidade — um `return true;` antes da chamada mantém a guarda VERDE com a posse
 *    inalcançável (medido no gate, `SEC-VP-42`). É o mesmo limite do `VinculoPrevioTest`, e está
 *    escrito aqui pela mesma razão: guarda vendida como rede que não é ensina a casa a confiar
 *    no que não protege;
 * 4. **a detecção é por FORMA da chave, não por semântica:** casa qualquer chave que termine em
 *    `profissional_id` (aspas simples ou duplas, qualquer lado direito — array literal, ternário
 *    como o da `EvolucaoRequest`, variável, chave de lote `itens.*.profissional_id`), no arquivo
 *    da Request ou nos traits/pais dela. O que continua fora: chave montada dinamicamente
 *    (`$campo => [...]`). E a ACEITAÇÃO também é por forma (re-review da rodada 4, CR4b-07): a
 *    guarda não sabe o EIXO (uma Request que decida a posse de um registro pelo eixo clínico
 *    passa) e não sabe se a chamada é código ou COMENTÁRIO (um `// assegurarPosseDoProfissional`
 *    a deixa verde). É linter, não prova — a prova é o teste de comportamento de cada
 *    superfície, que cai por mutação.
 *
 * A forma aceita de decidir posse é a da fonte única: `assegurarPosseDoProfissional()` (os dois
 * eixos, para vínculo) ou `->assegurarPosse(` sobre um `Escopo` dela (um eixo, para posse de um
 * registro ou autoria). Um `assegurarPosse` escrito à mão no controller NÃO conta: roda tarde.
 *
 * Provado por mutação (gate de `baixa-em-lote-por-status`): `public function authorize(): bool
 * { return true; }` acrescentado à `BaixaEmLoteRequest` derruba esta guarda — antes, não.
 *
 * Fecha a superfície que sangrou três vezes, não a categoria inteira.
 */

/**
 * Os arquivos-fonte que compõem uma Request: o dela, os dos pais (até a `FormRequest`,
 * exclusive) e os de TODOS os traits, recursivamente — porque é em qualquer um deles que a
 * chave validada pode morar.
 *
 * @return list<string>
 */
function fontesDaRequest(ReflectionClass $classe): array
{
    $fontes = [];

    for ($atual = $classe; $atual !== false && $atual->getName() !== FormRequest::class; $atual = $atual->getParentClass()) {
        $fontes[] = $atual->getFileName();
        foreach ($atual->getTraits() as $trait) {
            $fontes = [...$fontes, ...fontesDoTrait($trait)];
        }
    }

    return array_values(array_unique(array_filter($fontes)));
}

/** @return list<string> */
function fontesDoTrait(ReflectionClass $trait): array
{
    $fontes = [$trait->getFileName()];
    foreach ($trait->getTraits() as $usado) {
        $fontes = [...$fontes, ...fontesDoTrait($usado)];
    }

    return $fontes;
}

/** O corpo do método como está no arquivo em que ele foi declarado (classe, trait ou pai). */
function corpoDoMetodo(ReflectionMethod $metodo): string
{
    $linhas = file($metodo->getFileName()) ?: [];

    return implode('', array_slice($linhas, $metodo->getStartLine() - 1, $metodo->getEndLine() - $metodo->getStartLine() + 1));
}

it('deve decidir posse no authorize() em toda FormRequest que valida profissional_id', function () {
    // ARRANGE — as Requests do app
    $raiz = dirname(__DIR__, 2).'/app/Http/Requests';
    $faltando = [];
    $examinadas = [];

    // EXCEÇÃO ÚNICA, e ela é semântica: aqui `profissional_id` é o VÍNCULO que se está atribuindo
    // a um usuário (quem administra pessoas liga um login a um profissional), não a agenda de
    // alguém. Exigir posse inverteria o sentido — o admin passaria a só poder vincular a si mesmo.
    // A rota é gated por `usuarios.editar`, que um profissional escopado não tem.
    $excecoes = ['UsuarioGestaoRequest.php'];

    foreach (Finder::create()->files()->in($raiz)->name('*.php') as $arquivo) {
        $caminho = str_replace(DIRECTORY_SEPARATOR, '/', $arquivo->getRelativePathname());

        if (in_array($caminho, $excecoes, true)) {
            continue;
        }

        // só a Request CONCRETA que a rota usa é examinada; um trait (`Concerns/`) ou uma classe
        // abstrata entra pelas Requests que os usam — é lá que o `authorize()` efetivo se decide
        $classe = new ReflectionClass('App\\Http\\Requests\\'.str_replace('/', '\\', substr($caminho, 0, -4)));
        if (! $classe->isSubclassOf(FormRequest::class) || $classe->isAbstract()) {
            continue;
        }

        // só interessa quem VALIDA o campo — quem não o recebe não tem posse a decidir. A chave
        // pode morar na própria Request ou num trait dela (`regrasDoAlcance()`)
        $valida = false;
        foreach (fontesDaRequest($classe) as $fonte) {
            if (preg_match('/profissional_id[\'"]\s*=>/', (string) file_get_contents($fonte))) {
                $valida = true;
                break;
            }
        }
        if (! $valida) {
            continue;
        }
        $examinadas[] = $caminho;

        // ACT — o `authorize()` EFETIVO precisa consultar o escopo. A forma aceita é a da fonte
        // única; um `assegurarPosse` escrito à mão no controller NÃO conta, porque roda tarde
        // demais. Sem `authorize()` nenhum, o Laravel autoriza tudo — falta do mesmo jeito.
        $decidePosse = false;
        if ($classe->hasMethod('authorize')) {
            $corpo = corpoDoMetodo($classe->getMethod('authorize'));
            $decidePosse = str_contains($corpo, 'assegurarPosseDoProfissional') || str_contains($corpo, '->assegurarPosse(');
        }

        if (! $decidePosse) {
            $faltando[] = $caminho;
        }
    }

    // ASSERT — as duas Requests de lote, que herdam a chave do trait, ESTÃO na varredura
    expect($examinadas)->toContain('BaixaEmLoteRequest.php', 'DesmarqueEmLoteRequest.php');
    expect($faltando)->toBe(
        [],
        'FormRequest valida `profissional_id` sem decidir posse no authorize(): a posse ficaria '
        .'DEPOIS da validação, e o par colega × inexistente se separa por status (403 × 422), '
        .'enumerando o cadastro. Decida a posse no authorize(): assegurarPosseDoProfissional() para '
        .'vínculo (dois eixos) ou $escopos->agenda()/clinico()->assegurarPosse() para registro/autoria.'
    );
});
