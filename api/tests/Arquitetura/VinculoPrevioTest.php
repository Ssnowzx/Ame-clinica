<?php

use App\Support\Agenda\AgendamentoService;
use Tests\Arquitetura\Fontes;

/**
 * GUARDA DE IDIOMA — todo caminho que CRIA agendamento passa pela trava de vínculo prévio.
 *
 * A trava (`SEC-CP-04`) impede que um profissional escopado marque criança que ainda não é dele.
 * Ela vale por ser INESCAPÁVEL: um caminho de criação que não a consulte anula a trava inteira,
 * e o buraco fica invisível — o agendamento nasce normalmente, e só um teste de segurança
 * apontado exatamente para aquele caminho perceberia.
 *
 * Duas coisas são varridas aqui, e as duas são necessárias:
 *
 * 1. **O funil é único.** `Agendamento` só é instanciado dentro do `AgendamentoService`. O dia em
 *    que um controller criar direto, a trava deixa de existir para ele.
 * 2. **Toda entrada de criação chama a trava.** Não basta o método existir; ele tem de ser
 *    chamado por cada porta de criação, antes da validação de domínio.
 *
 * `atualizar` ESTÁ na lista, e o docblock anterior dizia o contrário — a premissa "a trava é
 * sobre nascer, não sobre mexer" foi destruída pelo bloqueante 8.1 do gate: remarcar não concede
 * vínculo, mas TROCAR a criança concede (`403 403 → PUT → 200 200`). `excluir` segue fora, porque
 * apagar não vincula ninguém.
 *
 * A VARREDURA É ANCORADA: só olha arquivo que menciona `Agendamento`. A rodada 3 desmentiu a
 * justificativa anterior deste docblock — eu havia escrito que `replicate()->save()` e
 * `fill()->save()` eram "indistinguíveis por texto"; medido, `app/` não tem NENHUM `replicate(`, e
 * os quatro arquivos com `fill(` não citam `Agendamento` uma vez sequer. O que produzia falso
 * positivo era a falta da âncora, não a forma. Com ela, as duas entram sem ruído.
 *
 * O QUE A ÂNCORA NÃO COBRE, e fica dito: um `use App\Models\Agendamento as X` derrota a busca por
 * texto. É limite da técnica, não desculpa — está aqui para o próximo leitor não confundir a
 * guarda com uma rede.
 *
 * LIMITE HONESTO DESTA GUARDA: ela casa TEXTO e ORDEM dentro do corpo do método, não
 * alcançabilidade. Um `return` antecipado colocado antes da chamada a deixa verde — medido na
 * rodada 2. O falso-negativo DIRECIONAL (procurar em `criar` e achar em `criarSerie`) morreu com o
 * recorte por reflexão; este outro é limite da técnica, e está escrito aqui em vez de a guarda ser
 * vendida como rede que ela não é.
 */
it('deve instanciar Agendamento apenas dentro do AgendamentoService', function () {
    // ARRANGE — o app inteiro como texto, exceto o próprio funil
    $fontes = Fontes::doApp(['Support/Agenda/AgendamentoService.php']);

    // ACT
    $forasteiros = [];
    foreach ($fontes as $caminho => $conteudo) {
        // `(?<![A-Za-z_])` é obrigatório: sem ele a guarda casa `StatusAgendamento::create(`,
        // que é OUTRA entidade — a primeira versão reprovou por isso, e um falso positivo
        // treina a casa a ignorar a guarda.
        //
        // ÂNCORA: só varre arquivo que MENCIONA `Agendamento`. É ela que torna seguras as duas
        // últimas formas do catálogo — a versão sem âncora reprovava `ConversaController` por um
        // `fill()->save()` de outra entidade. A rodada 3 mediu: com a âncora, zero falso positivo.
        // O que a âncora NÃO cobre é um alias de import (`use ... as X`), e isso fica dito.
        if (! str_contains($conteudo, 'Agendamento')) {
            continue;
        }

        // O CATÁLOGO DE FORMAS foi ampliado no gate (achado 8.8/SEC-VP-16): a versão anterior
        // olhava só `new Agendamento(` e `Agendamento::create(`, e passavam por baixo sete formas
        // — inclusive `updateOrCreate`/`firstOrCreate`, que já são idioma da casa em quatro
        // arquivos. Guarda que cobre a forma que ninguém usa não cobre nada.
        $formas = [
            'new\s+Agendamento\s*\(',
            // `query(` SOZINHO é LEITURA — casá-lo reprovava VerificadorDeConflitos e mais cinco
            // arquivos que só consultam. Exige-se a ESCRITA encadeada. (A primeira ampliação
            // errou por aqui: guarda barulhenta é guarda que a casa aprende a ignorar.)
            '(?<![A-Za-z_])Agendamento::(create|insert|firstOrCreate|firstOrNew|updateOrCreate|upsert|forceCreate)\s*\(',
            '(?<![A-Za-z_])Agendamento::query\s*\(\s*\)\s*->\s*(create|insert|firstOrCreate|firstOrNew|updateOrCreate|upsert)\s*\(',
            // `replicate()->save()` e `fill()->save()` só entram ANCORADAS (o `continue` acima
            // garante que o arquivo cita `Agendamento`). Sem a âncora elas reprovavam o
            // `ConversaController`; com ela, medido, dão zero falso positivo hoje.
            '->\s*(replicate|fill)\s*\([^;]*?->\s*save\s*\(',
            '->\s*agendamentos\s*\(\s*\)\s*->\s*(create|firstOrCreate|updateOrCreate|save|insert)\s*\(',
            '(?<![A-Za-z_])Agendamento::make\s*\(',
            'DB::table\s*\(\s*["\']agendamentos["\']',
            'DB::insert\s*\([^;]*?\binto\s+agendamentos\b',
        ];
        if (preg_match('/'.implode('|', $formas).'/', $conteudo)) {
            $forasteiros[] = $caminho;
        }
    }

    // ASSERT
    expect($forasteiros)->toBe(
        [],
        'Agendamento criado fora do AgendamentoService: a trava de vínculo prévio (SEC-CP-04) '
        .'não alcança esse caminho. Crie pelo serviço.'
    );
});

it('deve chamar a trava de vínculo prévio em toda entrada que vincula paciente', function () {
    // ARRANGE — as entradas que VINCULAM paciente a agendamento. `atualizar` entrou na lista no
    // gate: a trava governa a TROCA de paciente, não o nascimento (achado 8.1) — trocar a criança
    // num agendamento existente concede o vínculo do mesmo jeito que criar um.
    $guardadas = ['criar', 'criarSerie', 'atualizar'];
    $fonte = file_get_contents(dirname(__DIR__, 2).'/app/Support/Agenda/AgendamentoService.php');

    // ACT + ASSERT — a lista está completa: método público novo que cria entra aqui de propósito
    $reflexao = new ReflectionClass(AgendamentoService::class);
    $publicos = collect($reflexao->getMethods(ReflectionMethod::IS_PUBLIC))
        ->filter(fn (ReflectionMethod $m) => $m->class === AgendamentoService::class)
        ->reject(fn (ReflectionMethod $m) => $m->isConstructor())
        ->map(fn (ReflectionMethod $m) => $m->name)
        ->values()->all();
    // `irmasSeguintes` é consulta: não vincula paciente a nada
    $conhecidos = [...$guardadas, 'excluir', 'avisoDeLimite', 'avisoDePacienteSobreposto', 'irmasSeguintes'];
    expect(array_diff($publicos, $conhecidos))->toBe(
        [],
        'Método público novo no AgendamentoService: se ele VINCULA paciente a agendamento, some à '
        .'lista das guardadas e chame $this->assegurarVinculoPrevio() antes de validarDominio().'
    );

    // ...e cada uma chama a trava ANTES da validação de domínio — a autorização vem antes de
    // qualquer recusa de regra, senão a mensagem de domínio já conta que a criança existe.
    //
    // O CORPO DO MÉTODO É RECORTADO POR REFLEXÃO, e não por regex sobre o arquivo inteiro. A
    // versão anterior usava `/s` com `.*?` e ATRAVESSAVA a fronteira do método: procurando a
    // chamada de `criar`, ela encontrava a de `criarSerie` logo abaixo e ficava verde. Medido no
    // gate (achado 8.4): removendo a trava só do `criar()`, a guarda passava — o caminho de
    // criação principal podia perder a trava com a guarda verde. Guarda com falso-negativo
    // direcional é pior que guarda nenhuma, porque some a desconfiança.
    $linhas = explode("\n", $fonte);
    foreach ($guardadas as $metodo) {
        $reflexo = $reflexao->getMethod($metodo);
        $corpo = implode("\n", array_slice(
            $linhas,
            $reflexo->getStartLine() - 1,
            $reflexo->getEndLine() - $reflexo->getStartLine() + 1,
        ));

        expect($corpo)->toMatch(
            '/\$this->assegurarVinculoPrevio\(.*?\$this->validarDominio\(/s',
            "`{$metodo}` não chama \$this->assegurarVinculoPrevio() antes de \$this->validarDominio() "
            .'— e o corpo verificado é SÓ o deste método, por reflexão.'
        );
    }
});
