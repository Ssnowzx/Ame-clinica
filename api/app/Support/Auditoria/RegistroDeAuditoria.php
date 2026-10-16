<?php

namespace App\Support\Auditoria;

use App\Models\Auditoria;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Auth;

/**
 * Única porta de escrita da trilha de auditoria (parecer T-aud-01/T-aud-03).
 * usuario_id/ip ficam nulos fora de request HTTP (console, jobs) — spec auditoria.
 *
 * O **tipo de autor** é gravado explicitamente (change `cadastro-online-do-paciente`): até aqui
 * o nulo em `usuario_id` significava uma coisa só — operação de sistema. Com a porta pública, ele
 * passaria a significar duas, e a trilha ficaria sem dizer qual. Ver `OrigemDaOperacao`.
 */
class RegistroDeAuditoria
{
    /** Campos NUNCA expostos em claro no diff, em qualquer entidade (T-aud-02). */
    private const MASCARADOS_SEMPRE = ['senha_hash', 'remember_token', 'password'];

    public const MASCARA = '***';

    /** Ruído sem valor de auditoria. */
    private const IGNORADOS = ['created_at', 'updated_at'];

    /**
     * @param  array<string, array<string, mixed>>  $diff  ex.: ['antes' => [...], 'depois' => [...]] (valores crus — o mascaramento acontece AQUI, num lugar só)
     * @param  list<string>  $excluirDoModel  campos sensíveis adicionais do model
     */
    public static function registrar(Model $entidade, string $acao, array $diff, array $excluirDoModel = []): void
    {
        $requisicao = request();
        $temRota = $requisicao?->route() !== null;
        $origem = app(OrigemDaOperacao::class);

        /*
         * ORIGEM EXTERNA VENCE A SESSÃO, e é o ponto do parecer (ameaça A5): a recepcionista com
         * o sistema aberto que abre o link público no mesmo navegador manda o cookie junto — o
         * `statefulApi` torna a requisição autenticada e `Auth::id()` devolve o id dela. Sem esta
         * ordem, o envio da família sairia na trilha como ato da recepcionista, para sempre.
         */
        $tipoDeAutor = match (true) {
            $origem->ehPeloWhatsapp() => OrigemDaOperacao::WHATSAPP,
            $origem->ehExterna() => OrigemDaOperacao::EXTERNA,
            $temRota && Auth::id() !== null => OrigemDaOperacao::USUARIO,
            default => OrigemDaOperacao::SISTEMA,
        };

        Auditoria::create([
            'autor_tipo' => $tipoDeAutor,
            // só o autor do tipo `usuario` tem id; nas outras duas origens não existe usuário a
            // apontar, e apontar um seria a trilha mentindo sobre quem agiu
            'usuario_id' => $tipoDeAutor === OrigemDaOperacao::USUARIO ? Auth::id() : null,
            'entidade' => $entidade->getTable(),
            'entidade_id' => $entidade->getKey(),
            'acao' => $acao,
            // o lote em curso da requisição, ou nulo (D11): a linha da baixa/desmarque em lote
            // carrega a chave que a reconstitui; a do chip do card, do cadastro, do console e
            // do job nasce sem lote — o campo nunca herda o lote de outra requisição (`scoped`)
            'lote_id' => app(ContextoDoLote::class)->id(),
            'diff_json' => array_map(
                fn (array $atributos) => self::mascarar($atributos, $excluirDoModel),
                $diff
            ),
            'ip' => $temRota ? $requisicao->ip() : null,
            'criado_em' => now(),
        ]);
    }

    /**
     * @param  array<string, mixed>  $atributos
     * @param  list<string>  $excluirDoModel
     * @return array<string, mixed>
     */
    public static function mascarar(array $atributos, array $excluirDoModel = []): array
    {
        $mascarar = array_merge(self::MASCARADOS_SEMPRE, $excluirDoModel);
        $limpos = [];

        foreach ($atributos as $campo => $valor) {
            if (in_array($campo, self::IGNORADOS, true)) {
                continue;
            }
            $limpos[$campo] = in_array($campo, $mascarar, true) ? self::MASCARA : $valor;
        }

        return $limpos;
    }
}
