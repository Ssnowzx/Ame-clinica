<?php

namespace App\Http\Controllers;

use App\Models\Usuario;
use App\Support\Auditoria\RegistroDeAuditoria;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\ValidationException;

/**
 * Foto de perfil do usuário (change foto-de-perfil-do-usuario) — o avatar que a barra
 * de conta do shell exibe.
 *
 * Espelha o `ClinicaLogoController` e herda o mesmo endurecimento de upload (SEC-AX):
 * MIME detectado do CONTEÚDO (nunca extensão/Content-Type do cliente) → whitelist →
 * decodifica a IMAGEM de fato (getimagesize) → só então grava. SVG NÃO entra na
 * whitelist de propósito: vetor executável (script/handlers) é XSS servido pela própria
 * origem. O caminho é 100% server-set por usuário (`usuarios/{id}/avatar.{ext}`) — nada
 * do cliente entra nele. Sem `Crypt`: foto de EQUIPE (identidade pessoal), não dado
 * clínico de paciente.
 *
 * O sujeito é SEMPRE `$request->user()` — a rota é `/me/avatar`, então é impossível
 * endereçar outro usuário (sem IDOR, sem policy por recurso). Escrita auditada; leitura
 * é do próprio autenticado, então GET não exige permissão além do auth.
 */
class AvatarUsuarioController extends Controller
{
    /** MIME detectado → extensão gravada (whitelist estrita; SVG fora — XSS). */
    private const MIMES = [
        'image/png' => 'png',
        'image/jpeg' => 'jpg',
        'image/webp' => 'webp',
    ];

    /** Teto do arquivo (bytes) — 1 MB. */
    private const TETO_BYTES = 1024 * 1024;

    /** Cada lado entre estes limites (px) — abaixo vira borrão, acima é abuso. */
    private const LADO_MIN = 64;

    private const LADO_MAX = 4096;

    public function store(Request $request): JsonResponse
    {
        $usuario = $this->usuarioAtual($request);

        $request->validate(
            ['arquivo' => ['required', 'file', 'max:'.intval(self::TETO_BYTES / 1024)]],
            ['arquivo.max' => 'O arquivo excede o tamanho máximo de 1 MB.'],
        );

        // ORDEM da defesa (SEC-AX-05): conteúdo → whitelist → decodifica → grava
        $arquivo = $request->file('arquivo');
        $mime = (string) mime_content_type($arquivo->getRealPath());
        if (! isset(self::MIMES[$mime])) {
            throw ValidationException::withMessages([
                'arquivo' => 'Formato não aceito. Envie PNG, JPG ou WebP.',
            ]);
        }

        // getimagesize DECODIFICA: arquivo que se diz imagem mas não abre é recusado
        $dimensoes = @getimagesize($arquivo->getRealPath());
        if ($dimensoes === false) {
            throw ValidationException::withMessages([
                'arquivo' => 'O arquivo não é uma imagem válida.',
            ]);
        }
        [$largura, $altura] = $dimensoes;
        if (
            $largura < self::LADO_MIN || $altura < self::LADO_MIN
            || $largura > self::LADO_MAX || $altura > self::LADO_MAX
        ) {
            throw ValidationException::withMessages([
                'arquivo' => sprintf(
                    'A imagem deve ter cada lado entre %d e %d pixels (recebida: %d×%d).',
                    self::LADO_MIN,
                    self::LADO_MAX,
                    $largura,
                    $altura,
                ),
            ]);
        }

        // caminho 100% server-set; a extensão muda com o MIME, então o arquivo
        // anterior (se de outro formato) é removido DEPOIS da troca assentar
        $anterior = $usuario->avatar_path;
        $caminho = sprintf('usuarios/%d/avatar.%s', $usuario->id, self::MIMES[$mime]);
        Storage::disk('local')->put($caminho, file_get_contents($arquivo->getRealPath()));

        $usuario->forceFill([
            'avatar_path' => $caminho,
            'avatar_atualizado_em' => now(),
        ])->save();

        if ($anterior !== null && $anterior !== $caminho) {
            Storage::disk('local')->delete($anterior);
        }

        RegistroDeAuditoria::registrar($usuario, 'enviou_avatar', [
            'antes' => ['avatar_path' => $anterior],
            'depois' => ['avatar_path' => $caminho],
        ]);

        return response()->json(
            ['avatar_versao' => $usuario->avatar_atualizado_em->format('YmdHis')],
            Response::HTTP_CREATED,
        );
    }

    public function show(Request $request): Response
    {
        $usuario = $this->usuarioAtual($request);

        // sem foto (ou drift: linha sem arquivo) → 404; o front cai para o ícone
        abort_if($usuario->avatar_path === null, Response::HTTP_NOT_FOUND);
        abort_unless(Storage::disk('local')->exists($usuario->avatar_path), Response::HTTP_NOT_FOUND);

        // Content-Type derivado da EXTENSÃO gravada (que veio do MIME detectado no
        // upload — nunca do cliente); private: a foto é do usuário, não de CDN
        $extensao = pathinfo($usuario->avatar_path, PATHINFO_EXTENSION);
        $mime = (string) array_search($extensao, self::MIMES, true);

        return response(Storage::disk('local')->get($usuario->avatar_path), Response::HTTP_OK, [
            'Content-Type' => $mime !== '' ? $mime : 'application/octet-stream',
            // `no-cache` (revalida sempre), NÃO o `max-age` longo do logo (SEC-01): o logo é
            // da CLÍNICA (mesma imagem p/ todos), mas o avatar é por-USUÁRIO servido por uma
            // URL SEM id (`/me/avatar?v=YmdHis`). No balcão compartilhado, dois usuários que
            // enviam foto no MESMO segundo teriam URL byte-idêntica — cache de 1 dia serviria
            // a cara de um sob a sessão do outro. Revalidar força o servidor a resolver pela
            // sessão a cada carga; o `?v=` segue furando o cache quando a foto muda.
            'Cache-Control' => 'private, no-cache',
            // nunca inline-interpretável como HTML — cinto extra ao lado da whitelist
            'X-Content-Type-Options' => 'nosniff',
        ]);
    }

    public function destroy(Request $request): Response
    {
        $usuario = $this->usuarioAtual($request);

        $anterior = $usuario->avatar_path;
        if ($anterior !== null) {
            Storage::disk('local')->delete($anterior);
            $usuario->forceFill(['avatar_path' => null, 'avatar_atualizado_em' => null])->save();

            RegistroDeAuditoria::registrar($usuario, 'removeu_avatar', [
                'antes' => ['avatar_path' => $anterior],
                'depois' => ['avatar_path' => null],
            ]);
        }

        return response()->noContent();
    }

    /** O usuário da sessão — o guard `auth:sanctum` garante que não é nulo. */
    private function usuarioAtual(Request $request): Usuario
    {
        /** @var Usuario $usuario */
        $usuario = $request->user();

        return $usuario;
    }
}
