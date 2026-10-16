<?php

namespace App\Http\Controllers;

use App\Models\Profissional;
use App\Support\Auditoria\RegistroDeAuditoria;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\ValidationException;

/**
 * A foto do profissional (change foto-do-profissional) — o mesmo contrato da foto de perfil do
 * usuário (`AvatarUsuarioController`), só que sobre o CADASTRO: quem tem `profissionais.editar`
 * envia e remove; lê quem já enxerga o profissional pela agenda, pela fila ou pelo cadastro
 * (`agenda.ver` | `lista_espera.ver` | `profissionais.ver` — SEC-FP-01: a foto nunca chega a quem o
 * nome não chega). Id inexistente é 404, nunca 403.
 */
class FotoProfissionalController extends Controller
{
    private const MIMES = [
        'image/png' => 'png',
        'image/jpeg' => 'jpg',
        'image/webp' => 'webp',
    ];

    private const TETO_BYTES = 1024 * 1024;

    private const LADO_MIN = 64;

    private const LADO_MAX = 4096;

    public function store(Request $request, int $id): JsonResponse
    {
        $profissional = Profissional::findOrFail($id);

        $request->validate(
            ['arquivo' => ['required', 'file', 'max:'.intval(self::TETO_BYTES / 1024)]],
            ['arquivo.max' => 'O arquivo excede o tamanho máximo de 1 MB.'],
        );

        $arquivo = $request->file('arquivo');
        $mime = (string) mime_content_type($arquivo->getRealPath());
        if (! isset(self::MIMES[$mime])) {
            throw ValidationException::withMessages([
                'arquivo' => 'Formato não aceito. Envie PNG, JPG ou WebP.',
            ]);
        }

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

        $anterior = $profissional->foto_path;
        $caminho = sprintf(
            'profissionais/%d/foto.%s',
            $profissional->id,
            self::MIMES[$mime],
        );
        Storage::disk('local')->put($caminho, file_get_contents($arquivo->getRealPath()));

        $profissional->forceFill([
            'foto_path' => $caminho,
            'foto_atualizado_em' => now(),
        ])->save();

        if ($anterior !== null && $anterior !== $caminho) {
            Storage::disk('local')->delete($anterior);
        }

        RegistroDeAuditoria::registrar($profissional, 'enviou_foto', [
            'antes' => ['foto_path' => $anterior],
            'depois' => ['foto_path' => $caminho],
        ]);

        return response()->json(
            ['foto_versao' => $profissional->foto_atualizado_em->format('YmdHis')],
            Response::HTTP_CREATED,
        );
    }

    public function show(int $id): Response
    {
        $profissional = Profissional::findOrFail($id);

        abort_if($profissional->foto_path === null, Response::HTTP_NOT_FOUND);
        abort_unless(Storage::disk('local')->exists($profissional->foto_path), Response::HTTP_NOT_FOUND);

        $extensao = pathinfo($profissional->foto_path, PATHINFO_EXTENSION);
        $mime = (string) array_search($extensao, self::MIMES, true);

        // Diferente do avatar (`/me/avatar`, URL sem id, que NÃO pode ser cacheada entre sessões):
        // aqui a URL carrega o id e a versão (`?v=YmdHis`) — única por pessoa e por foto. Cache
        // longo e imutável: a agenda com 20 colunas não baixa 20 fotos a cada abertura
        // (code-reviewer CR-FP-01). Trocar a foto troca a versão, e a URL antiga morre sozinha.
        return response(Storage::disk('local')->get($profissional->foto_path), Response::HTTP_OK, [
            'Content-Type' => $mime !== '' ? $mime : 'application/octet-stream',
            'Cache-Control' => 'private, max-age=31536000, immutable',
            'X-Content-Type-Options' => 'nosniff',
        ]);
    }

    public function destroy(int $id): Response
    {
        $profissional = Profissional::findOrFail($id);

        $anterior = $profissional->foto_path;
        if ($anterior !== null) {
            Storage::disk('local')->delete($anterior);
            $profissional->forceFill(['foto_path' => null, 'foto_atualizado_em' => null])->save();

            RegistroDeAuditoria::registrar($profissional, 'removeu_foto', [
                'antes' => ['foto_path' => $anterior],
                'depois' => ['foto_path' => null],
            ]);
        }

        return response()->noContent();
    }
}
