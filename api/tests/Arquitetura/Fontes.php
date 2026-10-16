<?php

namespace Tests\Arquitetura;

use Symfony\Component\Finder\Finder;

/**
 * O fonte do `app/` como texto, para as guardas de idioma.
 *
 * Vive numa classe (e não em funções soltas) porque duas guardas a usam, e função global
 * duplicada entre dois arquivos de teste é fatal no PHP — a guarda derrubaria a suíte que
 * ela existe para proteger.
 *
 * As guardas NÃO sobem o framework nem tocam o banco: são varredura de disco (0.15s).
 */
final class Fontes
{
    /**
     * Todo o `app/` — não só `app/Http/Requests`.
     *
     * A primeira versão desta guarda varria só as `FormRequest`, e o gate pegou o buraco: **20
     * controllers validam INLINE** (`$request->validate([...])`). A dívida voltaria pelo caminho
     * mais provável — a tela nova declarando o campo imutável dentro do controller — com a
     * guarda VERDE. Guarda que não cobre a fonte por onde o defeito de fato volta é decoração.
     *
     * @param  list<string>  $exceto  caminhos relativos (ex.: 'Support/Clinica/ResumoDoPaciente.php')
     * @return array<string, string> caminho relativo => conteúdo
     */
    public static function doApp(array $exceto = []): array
    {
        $arquivos = [];
        $raiz = dirname(__DIR__, 2).'/app';

        foreach (Finder::create()->files()->in($raiz)->name('*.php') as $arquivo) {
            $caminho = str_replace(DIRECTORY_SEPARATOR, '/', $arquivo->getRelativePathname());

            if (! in_array($caminho, $exceto, true)) {
                $arquivos[$caminho] = $arquivo->getContents();
            }
        }

        return $arquivos;
    }

    /**
     * Todo o `web/src` — o outro lado da fronteira.
     *
     * Guarda que varre só um arquivo do front é a mesma decoração que o docblock acima
     * descreve: quem recria o dicionário de configurações noutro arquivo, ou renomeia a
     * constante, passa por baixo com a suíte verde.
     *
     * @return array<string, string> caminho relativo => conteúdo
     */
    public static function doWeb(): array
    {
        $arquivos = [];
        $raiz = dirname(__DIR__, 3).'/web/src';

        // falha alto se o front sumir: guarda que evapora em silêncio é pior que guarda nenhuma
        if (! is_dir($raiz)) {
            throw new \RuntimeException("Fonte do front não encontrada em {$raiz}.");
        }

        foreach (Finder::create()->files()->in($raiz)->name('*.ts')->name('*.tsx') as $arquivo) {
            $caminho = str_replace(DIRECTORY_SEPARATOR, '/', $arquivo->getRelativePathname());
            $arquivos[$caminho] = $arquivo->getContents();
        }

        return $arquivos;
    }

    /**
     * Colapsa espaços — o regex confere o IDIOMA, não a formatação.
     *
     * Sem isto, `['id',  'nome',  'nome_social']` (dois espaços) ou a quebra de linha do Pint
     * escapariam de uma guarda que estaria "verde" e cega.
     */
    public static function normalizar(string $fonte): string
    {
        return (string) preg_replace('/\s+/', ' ', $fonte);
    }

    /**
     * `$nome(...)` chamada como FUNÇÃO GLOBAL no código — ignorando comentários, docblocks
     * e strings (via token_get_all). Um regex cru sobre o fonte pegaria `env()` citado num
     * comentário ("NUNCA env() cru") e reprovaria a própria documentação da defesa.
     *
     * Descarta `$obj->nome(`, `Classe::nome(` e `function nome(` — só a chamada global conta.
     */
    public static function chamaFuncaoGlobal(string $fonte, string $nome): bool
    {
        $tokens = token_get_all($fonte);
        $total = count($tokens);

        for ($i = 0; $i < $total; $i++) {
            $token = $tokens[$i];
            if (! is_array($token) || $token[0] !== T_STRING || $token[1] !== $nome) {
                continue;
            }

            $anterior = null;
            for ($k = $i - 1; $k >= 0; $k--) {
                if (is_array($tokens[$k]) && $tokens[$k][0] === T_WHITESPACE) {
                    continue;
                }
                $anterior = $tokens[$k];
                break;
            }
            if (is_array($anterior) && in_array($anterior[0], [
                T_OBJECT_OPERATOR, T_NULLSAFE_OBJECT_OPERATOR, T_DOUBLE_COLON, T_FUNCTION,
            ], true)) {
                continue; // método ou declaração — não é a função global
            }

            for ($j = $i + 1; $j < $total; $j++) {
                if (is_array($tokens[$j]) && $tokens[$j][0] === T_WHITESPACE) {
                    continue;
                }
                if ($tokens[$j] === '(') {
                    return true;
                }
                break;
            }
        }

        return false;
    }
}
