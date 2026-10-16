<?php

use Tests\Arquitetura\Fontes;

/**
 * GUARDA DE IDIOMA — a camada 1 de duas.
 *
 * A camada 2 são os vetores de runtime (um por boundary: `PUT` com a chave NULA → 422), que
 * provam o COMPORTAMENTO. Esta prova o TEXTO — e é ela que pega o boundary **novo** que copia o
 * padrão errado, que é o modo como esta dívida cresce. Uma não substitui a outra: a de runtime
 * só cobre os boundaries que já existem.
 *
 * (A mesma lição do SEC-TR-18: o teste que assertava no JSON — o PRODUTO das duas camadas —
 * ficava verde com QUALQUER uma delas caída.)
 *
 * ⚠️ A varredura é sobre `app/` INTEIRO, não só `app/Http/Requests`. A primeira versão olhava só
 * as `FormRequest` — e o gate mostrou o buraco: **20 controllers validam INLINE**
 * (`$request->validate([...])`). O caminho mais provável da reincidência é a tela nova declarando
 * o campo imutável dentro do controller; ali a guarda estreita ficaria verde, e o gatilho
 * continuaria marcado como fechado. Guarda cega na fonte por onde o defeito volta é decoração.
 */
it('deve recusar `prohibited` como regra de imutabilidade em qualquer validação do app', function () {
    // ARRANGE — `prohibited` no Laravel 12 é "ausente OU VAZIO"
    // (`validateProhibited = ! validateRequired`): a chave presente-e-NULA PASSA, e o
    // `validated()` a carrega adiante. Foi assim que a autoria da evolução chegou a uma
    // coluna NOT NULL como 500 — num payload que, antes da "correção", respondia 422.
    //
    // Para imutabilidade a regra é `missing` (`! Arr::has(...)`): decide por PRESENÇA da
    // chave, valor irrelevante. `prohibited_if`/`prohibited_unless` são condicionais de
    // FORMA (o campo é proibido NAQUELE caso) e continuam válidos.
    //
    // UM regex para as TRÊS posições em que a regra pode aparecer — a versão anterior tinha
    // dois, e o pipe que COMEÇA por `prohibited` escapava dos dois (re-review r8):
    //   ['prohibited']           → lista
    //   'sometimes|prohibited'   → pipe, no fim
    //   'prohibited|integer'     → pipe, no INÍCIO  ← escapava
    // Aspas simples E duplas (não há `pint.json` nem CI que garanta a normalização).
    // O `prohibited_if`/`prohibited_unless` continua fora: depois de `prohibited` vem `_`,
    // e o regex exige `|` ou a aspa de fechamento.
    $regex = '/["\'](?:[^"\']*\|)?prohibited(?:\||["\'])/';

    // ACT
    $reincidentes = [];
    foreach (Fontes::doApp() as $arquivo => $fonte) {
        if (preg_match($regex, $fonte) === 1) {
            $reincidentes[] = $arquivo;
        }
    }

    // ASSERT
    expect($reincidentes)->toBe([], implode(PHP_EOL, [
        'Campo imutável NÃO se declara com `prohibited` — ele deixa a chave NULA passar.',
        'Use `missing`, que recusa a PRESENÇA da chave (com qualquer valor).',
        'Ajuste a chave do `messages()` junto: `.prohibited` → `.missing`.',
        'Reincidentes: '.implode(', ', $reincidentes),
    ]));
});

it('deve manter a mensagem em sincronia com a regra de imutabilidade', function () {
    // ARRANGE — regra `missing` com mensagem indexada em `.prohibited` é mensagem MORTA: o
    // Laravel procura `campo.missing`, não acha, e a recusa vira texto genérico na tela. O
    // usuário perde a instrução — que é o que esta base chama de "a recusa vira correção".
    //
    // O regex casa `.prohibited'` SÓ com a aspa colada: `.prohibited_if'` tem `_if` antes dela e
    // não casa. Por isso NÃO há exceção por arquivo aqui — a primeira versão tinha uma
    // (`se o arquivo contém prohibited_if, ignore`), e ela era um PONTO CEGO: silenciava
    // justamente o único arquivo onde uma mensagem órfã poderia se esconder (gate, NIT).
    $orfas = [];

    // ACT
    foreach (Fontes::doApp() as $arquivo => $fonte) {
        if (preg_match("/\\.prohibited'\\s*=>/", $fonte) === 1) {
            $orfas[] = $arquivo;
        }
    }

    // ASSERT
    expect($orfas)->toBe([], implode(PHP_EOL, [
        'Mensagem indexada em `.prohibited` para uma regra que agora é `missing`:',
        'ela nunca será encontrada, e a recusa vira erro genérico na tela.',
        'Arquivos: '.implode(', ', $orfas),
    ]));
});
