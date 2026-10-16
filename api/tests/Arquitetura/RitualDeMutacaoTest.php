<?php

use App\Support\Agenda\AgendamentoService;

/**
 * GUARDA DE IDIOMA — toda entrada pública de MUTAÇÃO do `AgendamentoService` abre zerando o
 * estado por escrita.
 *
 * O serviço carrega estado derivado entre a validação e a resposta: os dois avisos (`avisar` do
 * convênio e do paciente sobreposto) e dois memos de leitura. Nada disso pode atravessar duas
 * operações do mesmo request — serviria a resposta da anterior, em silêncio, sem erro.
 *
 * A dívida não é hipotética. Na rodada 1 do gate de `conflito-do-paciente`, o ritual estava
 * COPIADO nas quatro entradas e `excluir()` era a única sem ele; a rodada 3 mostrou que remover
 * um dos resets deixava a suíte inteira verde. Guarda de comportamento não pega isso: o dano é
 * "resposta de outra operação", que só aparece em cenário de duas escritas no mesmo request.
 *
 * Esta guarda varre o TEXTO. É a camada que pega o método NOVO que copia o padrão errado — e é
 * por aí que a dívida volta.
 */
it('deve começar toda mutação pública do AgendamentoService com iniciarMutacao()', function () {
    // ARRANGE — os métodos públicos que MUTAM (os acessores de aviso são leitura pura)
    $mutantes = ['criar', 'criarSerie', 'atualizar', 'excluir'];
    $fonte = file_get_contents(dirname(__DIR__, 2).'/app/Support/Agenda/AgendamentoService.php');

    // ACT + ASSERT — a lista está completa (método público novo entra aqui de propósito)...
    $reflexao = new ReflectionClass(AgendamentoService::class);
    $publicos = collect($reflexao->getMethods(ReflectionMethod::IS_PUBLIC))
        ->filter(fn (ReflectionMethod $m) => $m->class === AgendamentoService::class)
        ->reject(fn (ReflectionMethod $m) => $m->isConstructor())
        ->map(fn (ReflectionMethod $m) => $m->name)
        ->values()->all();
    // `irmasSeguintes` é consulta (o alcance da série para o aviso à família): não grava nada
    expect(array_diff($publicos, [...$mutantes, 'avisoDeLimite', 'avisoDePacienteSobreposto', 'irmasSeguintes']))
        ->toBe([], 'Método público novo no AgendamentoService: se ele MUTA, some à lista e zere o estado.');

    // ...e cada mutante abre com o ritual, na PRIMEIRA instrução
    foreach ($mutantes as $metodo) {
        expect($fonte)->toMatch(
            // `(?:\s*\/\/[^\n]*\n)*` — comentário de linha entre a chave e a chamada é permitido;
            // qualquer INSTRUÇÃO antes dela, não. É a diferença entre documentar e esquecer.
            '/public function '.$metodo.'\([^)]*\)[^{]*\{\s*(?:\/\/[^\n]*\n\s*)*\$this->iniciarMutacao\(\);/s',
            "`{$metodo}` não abre com \$this->iniciarMutacao()."
        );
    }
});
