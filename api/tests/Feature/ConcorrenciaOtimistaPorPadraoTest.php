<?php

use Illuminate\Support\Facades\Route;

/**
 * GUARDA DE IDIOMA da concorrência otimista (EX-05 · SEC-OCC-08) — a rede de COMPLETUDE.
 *
 * TODA rota `PUT`/`PATCH` do ROUTER (não do arquivo: provider, pacote e web.php entram — e sem
 * filtro de prefixo, para a rota futura fora de `api/*` não escapar) TEM de chamar
 * `ConcorrenciaOtimista::assegurar` no método que a serve, OU estar classificada como exceção
 * **por URI exata** com justificativa. O 32º PUT não nasce desprotegido: reprova aqui até ser
 * classificado.
 *
 * Camada 1 de duas (doutrina `ContratoDeBoundaryTest`): o texto do método conter a chamada não
 * prova execução — a camada 2 são os vetores de runtime (409/428/200 por entidade
 * representativa em `ConcorrenciaOtimistaTest`). Vive em `tests/Feature` (e não em
 * `tests/Arquitetura`) porque itera o router — precisa do framework de pé, como a
 * `EscopoPorPadraoTest`.
 */

/**
 * Exceções por URI EXATA (nunca por controller — um segundo uso do controller não herda a
 * exceção). Cada entrada carrega a justificativa; a própria guarda reprova entrada podre
 * (URI listada que não existe mais no router).
 */
const EXCECOES_DE_VERSAO = [
    // upsert chave-a-chave ({chave, valor}): não há "registro lido" único a versionar — a
    // granularidade por chave JÁ é o conflito real; residual (dois admins na MESMA chave,
    // última intenção vence) é auditado e aceito (SEC-OCC-06)
    'api/configuracoes',
    // intenção única ("definir o nível X" — syncRoles substitui, auditoria antes/depois):
    // a última intenção vencer é o comportamento correto, não um lost update (SEC-OCC-06)
    'api/usuarios/{usuario}/nivel-permissao',
    // lote de posições do arrasto no mural (kanban-da-equipe, design D4): não há "registro
    // lido" único a versionar — o quadro é colaborativo e a última intenção de ORDEM vence;
    // o servidor reindexa denso em transação (consistência garantida) e id estranho é 422
    // atômico. Edição de CAMPOS da tarefa segue versionada (PATCH /api/tarefas/{id}).
    'api/tarefas/ordem',
    // credencial do WhatsApp (mensageria-whatsapp): INTENÇÃO ÚNICA e indivisível ("esta é a
    // credencial"), com os cinco campos obrigatórios em todo envio — não existe edição
    // parcial a perder. E gravar sempre volta o estado a `nao_conectado`: dois admins
    // colando credenciais ao mesmo tempo terminam num estado consistente, e o que decide a
    // verdade é o "Testar conexão" seguinte, não a ordem de chegada. Mesma forma de
    // `api/configuracoes` (SEC-OCC-06).
    'api/mensagens/conexao',
    // régua do cadastro (campos-do-cadastro-configuraveis, D9): a escrita é POR CAMPO, e não
    // há "registro lido" único a versionar — é a mesma forma do `api/configuracoes`, do qual
    // ela é irmã. Dois administradores só se atropelam mexendo no MESMO campo, e o residual
    // (última intenção vence) é auditado campo a campo, com o diff da chave. Exigir versão
    // obrigaria o front a inventar uma noção de versão de COLEÇÃO que a tela de configurações
    // não tem — por um ganho que não existe (SEC-OCC-06).
    'api/campos-cadastro/{formulario}',
];

it('deve exigir a checagem de versão em TODA rota PUT/PATCH — ou classificação por URI exata', function () {
    // ARRANGE + ACT — varre o ROUTER e lê o fonte do MÉTODO que serve cada rota
    $semChecagem = [];
    $urisDeEscrita = [];

    foreach (Route::getRoutes() as $rota) {
        if (array_intersect(['PUT', 'PATCH'], $rota->methods()) === []) {
            continue;
        }

        $uri = $rota->uri();
        $urisDeEscrita[] = $uri;

        if (in_array($uri, EXCECOES_DE_VERSAO, true)) {
            continue;
        }

        $acao = $rota->getActionName();
        if (! str_contains($acao, '@')) {
            $semChecagem[] = "{$uri} (closure — sem método para verificar)";

            continue;
        }

        [$classe, $metodo] = explode('@', $acao);
        $reflexo = new ReflectionMethod($classe, $metodo);
        $linhas = file($reflexo->getFileName());
        $corpo = implode('', array_slice(
            $linhas,
            $reflexo->getStartLine() - 1,
            $reflexo->getEndLine() - $reflexo->getStartLine() + 1,
        ));

        if (! str_contains($corpo, 'ConcorrenciaOtimista::assegurar')) {
            $semChecagem[] = "{$uri} ({$acao})";
        }
    }

    // ASSERT — nenhuma rota de edição sem versão…
    expect($semChecagem)->toBe([]);

    // …e nenhuma exceção APODRECIDA: toda URI classificada ainda existe no router
    // (a exceção de uma rota removida seria herdada em silêncio por quem a recriasse)
    foreach (EXCECOES_DE_VERSAO as $uriClassificada) {
        expect($urisDeEscrita)->toContain($uriClassificada);
    }
});
