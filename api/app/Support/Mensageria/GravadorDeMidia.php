<?php

namespace App\Support\Mensageria;

use App\Models\MensagemMidia;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/**
 * Grava a mídia de uma conversa em disco privado (change mensageria-whatsapp).
 *
 * MESMO tratamento dos anexos do paciente, e pelo mesmo motivo: é documento de MENOR
 * (a família manda foto da criança e laudo em PDF pelo WhatsApp).
 *
 * - MIME pelo **CONTEÚDO** (`finfo`), nunca o que a Meta declarou. Confiar na declaração é
 *   aceitar um executável rotulado de imagem.
 * - Caminho 100% gerado pelo servidor, com UUID: o nome original do arquivo codifica
 *   diagnóstico ("laudo-tea.pdf") e não entra em caminho nem em trilha.
 * - Conteúdo CIFRADO em repouso: quem tiver o disco não tem a foto da criança.
 */
class GravadorDeMidia
{
    /** Whitelist do que o canal aceita guardar — mime do conteúdo → extensão. */
    private const MIMES = [
        'image/jpeg' => 'jpg',
        'image/png' => 'png',
        'image/webp' => 'webp',
        'audio/ogg' => 'ogg',
        'audio/mpeg' => 'mp3',
        'audio/mp4' => 'm4a',
        'audio/amr' => 'amr',
        'video/mp4' => 'mp4',
        'video/3gpp' => '3gp',
        'application/pdf' => 'pdf',
        'application/msword' => 'doc',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document' => 'docx',
        'application/vnd.ms-excel' => 'xls',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' => 'xlsx',
        'text/plain' => 'txt',
    ];

    /**
     * @return bool false quando a mídia é recusada (tipo fora da lista ou tamanho acima do
     *              teto) — a mensagem fica registrada como não suportada, nunca some
     */
    public function gravar(MensagemMidia $registro, MidiaBaixada $baixada): bool
    {
        if ($baixada->tamanho > (int) config('mensageria.midia_max_bytes')) {
            return $this->recusar($registro, 'arquivo acima do teto');
        }

        $mime = $this->mimeDoConteudo($baixada->conteudo);

        if ($mime === null || ! isset(self::MIMES[$mime])) {
            return $this->recusar($registro, 'tipo de arquivo não suportado');
        }

        $disco = Storage::disk((string) config('mensageria.disco_midia'));
        $caminho = sprintf(
            'mensagens/%d/%s.%s',
            $registro->mensagem_id,
            Str::uuid(),
            self::MIMES[$mime],
        );

        $disco->put($caminho, Crypt::encrypt($baixada->conteudo));

        $registro->caminho = $caminho;
        $registro->mime = $mime;
        $registro->tamanho = $baixada->tamanho;
        $registro->sha256 = hash('sha256', $baixada->conteudo);
        $registro->save();

        return true;
    }

    /** O conteúdo em claro, para o download autorizado. */
    public function ler(MensagemMidia $registro): ?string
    {
        $disco = Storage::disk((string) config('mensageria.disco_midia'));

        if ($registro->caminho === null || ! $disco->exists($registro->caminho)) {
            return null;
        }

        return Crypt::decrypt($disco->get($registro->caminho));
    }

    private function recusar(MensagemMidia $registro, string $motivo): bool
    {
        $registro->mensagem->forceFill([
            'tipo' => 'nao_suportado',
            'erro_motivo' => 'Mídia recusada: '.$motivo.'.',
        ])->save();

        $registro->delete();

        return false;
    }

    private function mimeDoConteudo(string $conteudo): ?string
    {
        $finfo = finfo_open(FILEINFO_MIME_TYPE);

        if ($finfo === false) {
            return null;
        }

        $mime = finfo_buffer($finfo, $conteudo);
        finfo_close($finfo);

        return is_string($mime) ? $mime : null;
    }
}
