<?php

namespace App\Http\Controllers;

use App\Models\Clinica;
use App\Support\Auditoria\RegistroDeAuditoria;
use App\Support\Configuracoes\ConfiguracaoService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\ValidationException;

/**
 * Logo da clínica (change identidade-da-clinica) — a marca que a barra lateral exibe.
 *
 * Herda o endurecimento do upload de anexos (SEC-AX): MIME detectado do CONTEÚDO
 * (nunca extensão/Content-Type do cliente) → whitelist → decodifica a IMAGEM de fato
 * (getimagesize) → só então grava. SVG NÃO entra na whitelist de propósito: vetor
 * executável (script/handlers) é XSS servido pela própria origem (design, decisão 2).
 * O caminho é 100% server-set — nada do cliente entra nele — e mora em
 * `clinica`, nunca em `configuracoes` (decisão 1). Sem `Crypt`: logo é marca pública
 * da clínica, não dado clínico. Escrita auditada; leitura é de qualquer autenticado
 * da clínica (o shell é de todos) — por isso GET não audita nem exige permissão além
 * do auth.
 */
class ClinicaLogoController extends Controller
{
    /** MIME detectado → extensão gravada (whitelist estrita; SVG fora — XSS). */
    private const MIMES = [
        'image/png' => 'png',
        'image/jpeg' => 'jpg',
        'image/webp' => 'webp',
    ];

    /** Teto do arquivo (bytes) — 1 MB (logo, não fotografia). */
    private const TETO_BYTES = 1024 * 1024;

    /** Cada lado entre estes limites (px) — abaixo vira borrão, acima é abuso. */
    private const LADO_MIN = 64;

    private const LADO_MAX = 4096;

    public function store(Request $request): JsonResponse
    {
        $clinica = Clinica::atual();

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
        $anterior = $clinica->logo_path;
        $caminho = sprintf('clinica/logo.%s', self::MIMES[$mime]);
        Storage::disk('local')->put($caminho, file_get_contents($arquivo->getRealPath()));

        // AS TRÊS ESCRITAS DE BANCO NUMA TRANSAÇÃO SÓ (achado CR-M1/SEC-M2 do gate).
        //
        // O design desta change escolheu o servidor justamente porque "a falha do segundo
        // deixaria o estado pela metade, que é exatamente o defeito de hoje" — e a primeira
        // versão fazia as quatro escritas em sequência solta. Um lock timeout no
        // `updateOrCreate` da configuração (a tabela é escrita pela tela de Configurações no
        // mesmo instante) devolvia 500 com a logo no servidor e a identidade ainda em `nome`:
        // o defeito de origem de volta, agora com cara de erro do sistema.
        //
        // O arquivo fica FORA: `Storage` não participa de transação de banco. Ele é gravado
        // antes (um arquivo órfão não quebra nada — o `logo_path` é que manda) e o anterior só
        // é apagado depois do commit, quando a troca já assentou.
        $identidadeAplicada = DB::transaction(function () use ($clinica, $caminho, $anterior): bool {
            $clinica->forceFill([
                'logo_path' => $caminho,
                'logo_atualizado_em' => now(),
            ])->save();

            RegistroDeAuditoria::registrar($clinica, 'enviou_logo', [
                'antes' => ['logo_path' => $anterior],
                'depois' => ['logo_path' => $caminho],
            ]);

            // ENVIAR A LOGO É USAR A LOGO (change logo-aplicada-ao-enviar).
            //
            // O arquivo e a ESCOLHA (`clinica.identidade`) têm donos separados, e a tela pedia
            // os dois gestos: enviar, e depois marcar "Logo" num botão que ficava ACIMA do
            // campo de envio. Quem envia por último não vê botão nenhum abaixo e conclui que
            // não há onde salvar — foi o que aconteceu com a administradora em 2026-08-28: a
            // logo estava no servidor e a barra seguia exibindo o texto.
            //
            // A regra mora AQUI, e não no front, por dois motivos: um só pedido não deixa
            // estado pela metade, e a regra vale para qualquer cliente. A escrita é auditada
            // como qualquer configuração (o model é `Auditavel`).
            //
            // Só quando está em `nome`: enviar uma logo nova com a identidade JÁ em `logo` não
            // reescreve escolha nenhuma.
            $configuracoes = app(ConfiguracaoService::class);
            if ($configuracoes->get('clinica.identidade') === 'logo') {
                return false;
            }

            $configuracoes->set('clinica.identidade', 'logo');

            return true;
        });

        if ($anterior !== null && $anterior !== $caminho) {
            Storage::disk('local')->delete($anterior);
        }

        return response()->json(
            [
                'logo_versao' => $clinica->logo_atualizado_em->format('YmdHis'),
                // a tela usa isto para dizer o que de fato aconteceu, em vez de adivinhar
                'identidade_aplicada' => $identidadeAplicada,
            ],
            Response::HTTP_CREATED,
        );
    }

    public function show(): Response
    {
        $clinica = Clinica::atual();

        // sem logo (ou drift: linha sem arquivo) → 404; o front cai para o nome
        abort_if($clinica->logo_path === null, Response::HTTP_NOT_FOUND);
        abort_unless(Storage::disk('local')->exists($clinica->logo_path), Response::HTTP_NOT_FOUND);

        // Content-Type derivado da EXTENSÃO gravada (que veio do MIME detectado no
        // upload — nunca do cliente); private: a marca é da clínica, não de CDN
        $extensao = pathinfo($clinica->logo_path, PATHINFO_EXTENSION);
        $mime = (string) array_search($extensao, self::MIMES, true);

        return response(Storage::disk('local')->get($clinica->logo_path), Response::HTTP_OK, [
            'Content-Type' => $mime !== '' ? $mime : 'application/octet-stream',
            'Cache-Control' => 'private, max-age=86400',
            // nunca inline-interpretável como HTML — cinto extra ao lado da whitelist
            'X-Content-Type-Options' => 'nosniff',
        ]);
    }

    /**
     * Remover a logo NÃO mexe em `clinica.identidade` (change logo-aplicada-ao-enviar): a clínica
     * pode estar trocando de arquivo, e reverter para `nome` apagaria uma escolha dela. O estado
     * "identidade em logo, sem arquivo" já é sinalizado na tela e degrada para o nome.
     */
    public function destroy(): Response
    {
        $clinica = Clinica::atual();

        $anterior = $clinica->logo_path;
        if ($anterior !== null) {
            Storage::disk('local')->delete($anterior);
            $clinica->forceFill(['logo_path' => null, 'logo_atualizado_em' => null])->save();

            RegistroDeAuditoria::registrar($clinica, 'removeu_logo', [
                'antes' => ['logo_path' => $anterior],
                'depois' => ['logo_path' => null],
            ]);
        }

        return response()->noContent();
    }
}
