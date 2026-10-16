<?php

use Tests\Arquitetura\Fontes;

/**
 * GUARDA da whitelist do MENOR.
 *
 * `App\Support\Clinica\ResumoDoPaciente` é a fonte única das ÚNICAS colunas de um paciente que
 * uma tela de OUTRA entidade pode ver. Ela nasceu na change `tratamentos` — e mesmo assim o par
 * de camadas continuou COPIADO LITERALMENTE em três controllers, cada cópia livre para erodir
 * sozinha, em silêncio.
 *
 * NÃO confundir com o cadastro PRÓPRIO do paciente (`PacienteController`), que legitimamente lê
 * nascimento, CPF e responsáveis sob `pacientes.ver`: aquilo é a tela DA criança, não a de outra
 * entidade mostrando o nome dela.
 *
 * ⚠️ A guarda tem três asserções, e a TERCEIRA é a que o gate exigiu. As duas primeiras são
 * NEGATIVAS (proíbem a cópia). Mas o caminho mais provável do próximo setor não é *copiar* a
 * whitelist — é **esquecê-la**: um `with('paciente')` sem select serializa o **cadastro inteiro
 * de um menor** (CPF, nascimento, responsáveis, endereço, `necessidade` — dado de saúde), porque
 * o model não tem `$hidden`. Passaria nas duas primeiras com a suíte verde. Proibir a cópia e
 * deixar aberto o esquecimento é guardar a porta e deixar a janela.
 */

/**
 * A ÚNICA exceção é a fonte única.
 *
 * O `PacienteController` (a tela DA criança, sob `pacientes.ver`) **também é varrido**, e passa
 * **por construção**: as listas dele CONTINUAM depois de `nome_social` (`'nascimento'`, `'cpf'`…)
 * e não casam a lista fechada; ele não tem `with('paciente')` nenhum. Excluí-lo por arquivo (como
 * a primeira versão fazia) liberaria uma 4ª cópia literal dentro dele — que é justamente de onde
 * alguém copiaria (re-review r8). Passar por construção é mais forte que ser dispensado.
 */
const DONOS_DO_CADASTRO = [
    'Support/Clinica/ResumoDoPaciente.php',
];

it('deve manter o whitelist do menor SÓ na fonte única — camada app→HTTP', function () {
    // ARRANGE — a lista FECHADA das três colunas é o serializador do menor. O `Fontes::normalizar`
    // colapsa espaços: sem ele, `['id',  'nome', …]` (dois espaços, ou a quebra de linha do Pint)
    // escaparia — e a guarda ficaria verde e CEGA.
    // As listas do cadastro próprio CONTINUAM depois de `nome_social` (`, 'nascimento', 'cpf'…`)
    // e não casam o `]` de fechamento.
    $regex = "/\\[ ?'id', 'nome', 'nome_social' ?\\]|->only\\('id', 'nome', 'nome_social'\\)/";

    // ACT
    $copias = [];
    foreach (Fontes::doApp(DONOS_DO_CADASTRO) as $arquivo => $fonte) {
        if (preg_match($regex, Fontes::normalizar($fonte)) === 1) {
            $copias[] = $arquivo;
        }
    }

    // ASSERT
    expect($copias)->toBe([], implode(PHP_EOL, [
        'As colunas de um MENOR visíveis fora do cadastro têm FONTE ÚNICA.',
        'Use `ResumoDoPaciente::CAMPOS` / `::de()` / `::deOuNulo()` — nunca a lista literal.',
        'Cópias: '.implode(', ', $copias),
    ]));
});

it('deve manter o whitelist do menor SÓ na fonte única — camada banco→app', function () {
    // ARRANGE — o `select` do eager load (`'paciente:id,nome,nome_social'`) é a camada que impede
    // o cadastro da criança de ENTRAR NA MEMÓRIA do processo, de onde vazaria para log, dump ou
    // payload de exceção. Trocar só o serializador deixaria essa fronteira aberta — e o teste de
    // JSON ficaria verde do mesmo jeito (SEC-TR-18).
    $regex = '/:ID,NOME,NOME_SOCIAL/i';

    // ACT
    $copias = [];
    foreach (Fontes::doApp(DONOS_DO_CADASTRO) as $arquivo => $fonte) {
        // sem espaços, a ordem canônica é a única que o Eloquent aceita nesta forma
        if (preg_match($regex, str_replace(' ', '', $fonte)) === 1) {
            $copias[] = $arquivo;
        }
    }

    // ASSERT
    expect($copias)->toBe([], implode(PHP_EOL, [
        'O eager load do menor sai da FONTE ÚNICA: use `ResumoDoPaciente::relacao()`.',
        'Cópias: '.implode(', ', $copias),
    ]));
});

it('deve recusar carregar o paciente SEM whitelist — esquecer vaza mais que copiar', function () {
    // ARRANGE — a asserção POSITIVA (gate, SEC-CC-02). As duas acima proíbem a CÓPIA; esta proíbe
    // o ESQUECIMENTO, que é o caminho mais provável e o mais grave:
    //
    //   Tratamento::with('paciente')  →  serializa `$x->paciente`  →  sai o CADASTRO INTEIRO de um
    //   menor: cpf, nascimento, responsaveis_json, contatos_json, endereco_json e `necessidade`
    //   (dado de SAÚDE, art. 11). O model não tem `$hidden` — e `$hidden` não serviria, porque
    //   quebraria a tela DA criança, que legitimamente lê tudo isso.
    //
    // Casa a relação NUA em QUALQUER posição do `with()`/`load()`, e também a ANINHADA. A
    // primeira versão ancorava `'paciente'` logo depois do `(`/`[` — e escapavam as DUAS formas
    // que esta base já escreve (re-review r8, bloqueante):
    //
    //   ->with(['sala', 'paciente'])          ← array multi-relação é o idioma padrão daqui
    //   ->with('agendamento.paciente')        ← aninhada (existe em EvolucoesEmAberto, COM
    //                                            whitelist; apagar o `:id,nome` vazaria tudo)
    //
    // O `'` de fechamento colado em `paciente` é o que distingue a relação NUA da WHITELIST:
    // `'paciente:id,nome'` tem `:` ali e não casa; `'paciente' => fn ($q) => $q->select(...)`
    // é seguido de `=>`, não de `,)]`.
    //
    // O átomo `(?:[^()]|\([^()]*\))*?` atravessa UM nível de parênteses. Com o `[^)]*?` da
    // versão anterior, qualquer `)` antes do `'paciente'` interrompia a busca — e a CLOSURE
    // dentro do `with()` é o idioma desta base (re-review r9):
    //
    //   ->with(['convenio' => fn ($q) => $q->select('id', 'nome'), 'paciente'])   ← ESCAPAVA
    //   ->with([ResumoDoPaciente::relacao(), 'paciente'])                         ← ESCAPAVA
    $regex = "/(?:with|load)\\(\\s*\\[?(?:[^()]|\\([^()]*\\))*?'[\\w.]*paciente'\\s*[,)\\]]/";

    // ACT
    $semWhitelist = [];
    foreach (Fontes::doApp(DONOS_DO_CADASTRO) as $arquivo => $fonte) {
        if (preg_match($regex, Fontes::normalizar($fonte)) === 1) {
            $semWhitelist[] = $arquivo;
        }
    }

    // ASSERT
    expect($semWhitelist)->toBe([], implode(PHP_EOL, [
        'Carregar `paciente` SEM whitelist traz o cadastro INTEIRO do menor para a memória —',
        'CPF, nascimento, responsáveis, endereço e `necessidade` (dado de saúde, art. 11).',
        'Use `ResumoDoPaciente::relacao()` no `with()`/`load()`.',
        'Arquivos: '.implode(', ', $semWhitelist),
    ]));
});
