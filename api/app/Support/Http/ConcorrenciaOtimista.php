<?php

namespace App\Support\Http;

use Carbon\Carbon;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\Request;
use Throwable;

/**
 * Concorrência otimista dos PUTs de edição (EX-05 — decisão da clínica,
 * 2026-07-16 bloco 5: "travar agora"; parecer SEC-OCC).
 *
 * O cliente devolve, no header `If-Match`, o `updated_at` da leitura que
 * hidratou o formulário — a string VERBATIM, como o JSON a entregou. Divergiu,
 * 409: alguém salvou no meio; a tela avisa e recarrega. Faltou, 428: fail-closed
 * — sem token não se salva às cegas (e `updated_at` no BODY não conta: o header
 * é a única superfície).
 *
 * O token é COERÊNCIA, nunca credencial: nenhuma decisão de autorização deriva
 * dele, e a checagem roda DEPOIS de posse/escopo (404/403 sempre vencem — a
 * versão não é oráculo de existência). A comparação é em memória; o valor do
 * cliente jamais chega a SQL.
 *
 * Onde a perda seria irrecuperável (evolução — conteúdo mascarado na trilha), o
 * chamador roda esta checagem SOB lockForUpdate dentro da transação; nos demais
 * boundaries ela reduz a janela de minutos (formulário aberto) para
 * milissegundos — residual documentado. A gravação segue SEMPRE via Eloquent
 * (`$model->update()`), nunca update condicional de query builder: pularia os
 * model events do Auditavel e a mudança sumiria da trilha.
 */
class ConcorrenciaOtimista
{
    /** Teto do token: um instante serializado tem ~27 chars; acima disso é lixo. */
    private const TETO_TOKEN = 64;

    // Corpos FIXOS (SEC-OCC-05): nada do registro, nem o updated_at atual — o
    // caminho de reparo é RELER (na evolução, a releitura é auditada).
    private const MENSAGEM_CONFLITO = 'Este registro foi alterado por outra pessoa enquanto você editava. '
        .'Recarregue para ver a versão atual antes de salvar.';

    private const MENSAGEM_SEM_VERSAO = 'Requisição sem a versão do registro (If-Match). '
        .'Recarregue a tela e tente novamente.';

    public static function assegurar(Model $model, Request $request): void
    {
        $token = $request->header('If-Match');

        if ($token === null || $token === '') {
            abort(428, self::MENSAGEM_SEM_VERSAO);
        }

        $atual = $model->getAttribute('updated_at');

        // parse DEFENSIVO (SEC-OCC-03): `*`, lixo ou token gigante nunca viram
        // 500 — um token que não representa instante simplesmente não confere
        if (strlen($token) > self::TETO_TOKEN) {
            abort(409, self::MENSAGEM_CONFLITO);
        }

        try {
            $instanteDoCliente = Carbon::parse($token);
        } catch (Throwable) {
            abort(409, self::MENSAGEM_CONFLITO);
        }

        if ($atual === null || ! $atual->equalTo($instanteDoCliente)) {
            abort(409, self::MENSAGEM_CONFLITO);
        }
    }
}
