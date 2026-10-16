<?php

namespace App\Support\Arquivos;

use DOMDocument;
use DOMElement;
use DOMNode;

/**
 * O XML aceito como anexo é DADO — a nota fiscal (NF-e, NFS-e) —, nunca um documento que o
 * navegador ou um leitor executa (SEC-FIN-03, CR-R2-02). A regex anterior olhava o TEXTO e errava
 * pelos dois lados: deixava passar `<x:script xmlns:x="…/xhtml">`, UTF-16 e `<?xml-stylesheet?>`,
 * e recusava uma NFS-e com `online="sim"` escrito na discriminação. Aqui se lê a ESTRUTURA:
 *
 * - até 1 MB (a nota tem poucos KB) e nenhuma tag com mais de 64 atributos, conferidos ANTES de a
 *   libxml ler (CR-R3-01): a checagem de atributo repetido dela é quadrática — 400 mil atributos
 *   numa tag eram minutos de CPU por envio —, e milhões de elementos estouravam a memória;
 * - UTF-8, ou ISO-8859-1/windows-1252 DECLARADOS (layouts municipais antigos de NFS-e); nunca byte
 *   nulo — a libxml para de ler nele e não veria o que vem depois;
 * - sem DOCTYPE nem ENTITY (nada de entidade externa ou expansão), recusados antes de analisar e,
 *   de novo, na árvore;
 * - bem formado;
 * - nenhum elemento em namespace de conteúdo ativo (XHTML, SVG, MathML, XSLT, XInclude, XLink),
 *   com ou sem prefixo, nem elemento que se chame script/html/svg/iframe/object/embed/math;
 * - nenhum atributo `on*` (manipulador de evento) nem atributo do XLink;
 * - nenhuma instrução de processamento (a declaração `<?xml …?>` não é uma).
 *
 * A árvore é percorrida nó a nó, sem montar a lista inteira (o XPath `//*` criava um objeto PHP
 * por elemento). Texto dentro dos elementos é livre: é onde a nota escreve o que quiser.
 */
final class XmlDeNota
{
    public const TETO_BYTES = 1024 * 1024;

    public const TETO_DE_ATRIBUTOS = 64;

    private const NAMESPACES_ATIVOS = [
        'http://www.w3.org/1999/xhtml',
        'http://www.w3.org/2000/svg',
        'http://www.w3.org/1998/Math/MathML',
        'http://www.w3.org/1999/XSL/Transform',
        'http://www.w3.org/2001/XInclude',
        'http://www.w3.org/1999/xlink',
    ];

    private const ELEMENTOS_ATIVOS = ['script', 'html', 'svg', 'iframe', 'object', 'embed', 'math'];

    /** As codificações de um byte aceitas quando declaradas — ASCII embaixo, sem bytes nulos. */
    private const CODIFICACOES_LATINAS = ['iso-8859-1', 'windows-1252'];

    public static function inerte(string $conteudo): bool
    {
        return strlen($conteudo) <= self::TETO_BYTES
            && self::codificacaoAceita($conteudo)
            && preg_match('/<!\s*(DOCTYPE|ENTITY)/i', $conteudo) !== 1
            && ! self::temTagComAtributosDemais($conteudo)
            && self::estruturaInerte($conteudo);
    }

    private static function codificacaoAceita(string $conteudo): bool
    {
        if (str_contains($conteudo, "\0")) {
            return false;
        }
        $declarada = preg_match('/^(\xEF\xBB\xBF)?\s*<\?xml\b[^>]*\bencoding\s*=\s*["\']([^"\']*)["\']/i', $conteudo, $achado) === 1
            ? strtolower($achado[2])
            : 'utf-8';

        if (in_array($declarada, self::CODIFICACOES_LATINAS, true)) {
            return true;
        }

        return $declarada === 'utf-8' && mb_check_encoding($conteudo, 'UTF-8');
    }

    /** O que se salta INTEIRO: aspas ali dentro não são de atributo (um apóstrofo num comentário
     * faria a contagem pular a tag seguinte como se fosse valor). */
    private const TRECHOS_SEM_ATRIBUTO = ['<!--' => '-->', '<![CDATA[' => ']]>', '<?' => '?>'];

    /**
     * Uma passada linear: em cada tag, conta os valores entre aspas (um por atributo) até o `>` que
     * a fecha; comentário, CDATA e instrução de processamento são saltados inteiros. Na dúvida o
     * erro é recusar, nunca deixar passar.
     */
    private static function temTagComAtributosDemais(string $conteudo): bool
    {
        $tamanho = strlen($conteudo);
        $i = 0;
        while (($i = strpos($conteudo, '<', $i)) !== false) {
            foreach (self::TRECHOS_SEM_ATRIBUTO as $abre => $fecha) {
                if (substr_compare($conteudo, $abre, $i, strlen($abre)) === 0) {
                    $fim = strpos($conteudo, $fecha, $i + strlen($abre));
                    if ($fim === false) {
                        return false; // mal formado: a libxml recusa
                    }
                    $i = $fim + strlen($fecha);

                    continue 2;
                }
            }
            $atributos = 0;
            for ($i++; $i < $tamanho && $conteudo[$i] !== '>'; $i++) {
                $caractere = $conteudo[$i];
                if ($caractere !== '"' && $caractere !== "'") {
                    continue;
                }
                $fechaAspas = strpos($conteudo, $caractere, $i + 1);
                if ($fechaAspas === false) {
                    return false; // mal formado: a libxml recusa
                }
                if (++$atributos > self::TETO_DE_ATRIBUTOS) {
                    return true;
                }
                $i = $fechaAspas;
            }
        }

        return false;
    }

    private static function estruturaInerte(string $conteudo): bool
    {
        $documento = new DOMDocument;
        $antes = libxml_use_internal_errors(true);
        try {
            // sem LIBXML_NOENT (nenhuma entidade é substituída) e sem rede
            if (! $documento->loadXML($conteudo, LIBXML_NONET)) {
                return false;
            }
        } finally {
            libxml_clear_errors();
            libxml_use_internal_errors($antes);
        }
        // a regex de DOCTYPE/ENTITY e esta checagem se cobrem uma à outra (nenhum teste derruba
        // uma sozinha, CR-R4-02) — e a caminhada abaixo depende delas: os nós de DTD e de
        // entidade da libxml não terminam o `parentNode`/`nextSibling` (laço, CR-R4-01)
        if ($documento->doctype !== null) {
            return false;
        }

        // em profundidade, do primeiro filho ao último, sem pilha nem lista
        $no = $documento->firstChild;
        while ($no !== null) {
            if (! self::noInerte($no)) {
                return false;
            }
            if ($no->firstChild !== null) {
                $no = $no->firstChild;

                continue;
            }
            while ($no !== null && $no->nextSibling === null) {
                $no = $no->parentNode;
            }
            $no = $no?->nextSibling;
        }

        return true;
    }

    private static function noInerte(DOMNode $no): bool
    {
        // o DOCTYPE e a referência de entidade como terceira linha: se as duas de cima sumirem,
        // a caminhada para aqui em vez de girar para sempre
        if (in_array($no->nodeType, [XML_PI_NODE, XML_DOCUMENT_TYPE_NODE, XML_ENTITY_REF_NODE], true)) {
            return false;
        }
        if (! $no instanceof DOMElement) {
            return true;
        }
        if (in_array($no->namespaceURI, self::NAMESPACES_ATIVOS, true)
            || in_array(strtolower((string) $no->localName), self::ELEMENTOS_ATIVOS, true)) {
            return false;
        }
        foreach ($no->attributes as $atributo) {
            if (str_starts_with(strtolower((string) $atributo->localName), 'on')
                || in_array($atributo->namespaceURI, self::NAMESPACES_ATIVOS, true)) {
                return false;
            }
        }

        return true;
    }
}
