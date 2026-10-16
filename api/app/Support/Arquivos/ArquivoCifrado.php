<?php

namespace App\Support\Arquivos;

use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpFoundation\HeaderUtils;
use Symfony\Component\HttpFoundation\Response;

/**
 * O arquivo enviado pelo usuário, do upload ao download (extraído do `AnexoController` pela change
 * `anexo-no-lancamento`, D1): o que é COMUM aos anexos do paciente e aos do lançamento. Uma segunda
 * cópia desta validação num segundo controller é o furo esperando para acontecer.
 *
 * - tipo detectado do CONTEÚDO (finfo — nunca extensão/Content-Type do cliente) contra uma
 *   whitelist, ANTES de gravar (SEC-AX-05);
 * - nome de exibição saneado — nunca entra no caminho físico, que é do chamador (SEC-AX-07);
 * - repouso CIFRADO (`Crypt`, SEC-AX-02);
 * - download sempre como anexo, nunca inline (PDF inline executa JS em leitores), com o nome
 *   codificado pela RFC 6266 (nome hostil não injeta header).
 */
class ArquivoCifrado
{
    private const DISCO = 'local';

    /**
     * O MIME do conteúdo, se está na whitelist; senão, `422` em `arquivo` com `$recusa`.
     *
     * @param  array<string, string>  $aceitos  MIME detectado → extensão gravada
     */
    public function tipoAceito(UploadedFile $arquivo, array $aceitos, string $recusa): string
    {
        $mime = (string) mime_content_type($arquivo->getRealPath());
        if (! isset($aceitos[$mime])) {
            throw ValidationException::withMessages(['arquivo' => $recusa]);
        }

        return $mime;
    }

    /**
     * Sem separadores de caminho/controles, com teto de tamanho — e a extensão SEMPRE a do tipo
     * detectado (SEC-FIN-03): um XML chamado `nota.svg` ou `recibo".html` sairia no download com
     * a extensão que o sistema operacional abre como página ativa.
     *
     * Só sai o sufixo com CARA de extensão (até 5 letras/dígitos, ao menos uma letra): "Laudo Dr.
     * Fulano" e "Relatório 25.09.2026" não perdem o fim (CR-R2-11). Idempotente — o download
     * reaplica a regra ao nome guardado.
     */
    public function nomeDeExibicao(string $original, string $extensao): string
    {
        $base = basename(str_replace('\\', '/', $original));
        $limpo = trim((string) preg_replace('/[\x00-\x1F\x7F\/\\\\"]+/', '', $base));
        $semExtensao = trim((string) preg_replace('/\.(?=[^.]*[A-Za-z])[A-Za-z0-9]{1,5}$/', '', $limpo));
        $raiz = $semExtensao === '' ? 'anexo' : $semExtensao;

        return Str::limit($raiz, 190, '').'.'.$extensao;
    }

    /** Grava CIFRADO no caminho dado (100% derivado pelo chamador — nada do cliente). */
    public function gravar(string $caminho, UploadedFile $arquivo): void
    {
        Storage::disk(self::DISCO)->put($caminho, Crypt::encrypt(file_get_contents($arquivo->getRealPath())));
    }

    public function apagar(string $caminho): void
    {
        Storage::disk(self::DISCO)->delete($caminho);
    }

    public function existe(string $caminho): bool
    {
        return Storage::disk(self::DISCO)->exists($caminho);
    }

    /**
     * O conteúdo decifrado, como anexo para download. O nome sai com a extensão do arquivo GRAVADO
     * (a do tipo detectado) também para o anexo enviado antes da regra existir (CR-R2-03).
     */
    public function resposta(string $caminho, string $mime, string $nome): Response
    {
        $claro = Crypt::decrypt(Storage::disk(self::DISCO)->get($caminho));
        $extensao = pathinfo($caminho, PATHINFO_EXTENSION);
        $nome = $extensao === '' ? $nome : $this->nomeDeExibicao($nome, $extensao);

        return response($claro, Response::HTTP_OK, [
            'Content-Type' => $mime,
            'Content-Disposition' => HeaderUtils::makeDisposition(
                HeaderUtils::DISPOSITION_ATTACHMENT,
                $nome,
                'anexo.'.pathinfo($caminho, PATHINFO_EXTENSION),
            ),
        ]);
    }
}
