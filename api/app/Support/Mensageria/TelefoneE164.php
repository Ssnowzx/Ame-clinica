<?php

namespace App\Support\Mensageria;

/**
 * Forma canônica E.164 do telefone (change mensageria-whatsapp, D6).
 *
 * O problema real: o cadastro guarda `(11) 98765-4321` e a Meta entrega
 * `5511987654321`. Sem uma forma comum, casar a mensagem que chega com o paciente
 * exige varrer `contatos_json` da base inteira a cada webhook.
 *
 * O NONO DÍGITO é o segundo problema, e é histórico: celulares de São Paulo ganharam
 * o 9 inicial em 2012 e o resto do país até 2016. A base da clínica tem cadastro dos
 * dois lados da linha, e o mesmo aparelho aparece com 8 ou 9 dígitos conforme quem
 * digitou. Por isso `normalizar()` guarda o número COMO ELE É (nunca inventa dígito
 * no cadastro) e `variantes()` produz as duas leituras possíveis para a BUSCA — a
 * tolerância vive na consulta, não no dado gravado.
 *
 * O PAÍS (change telefone-estrangeiro): o padrão é o Brasil, e só o `+` explícito diz outra coisa.
 * A clínica tem família com celular do Reino Unido, e "DDI é sempre +55" deixava esse contato sem
 * lembrete e a resposta dele sem criança. Com `+` e um código de país que não é 55, o número é
 * guardado em E.164 como veio (`+447700900123`): 8 a 15 dígitos, sem começar por 0, sem nono
 * dígito e sem saber se é fixo — para o lembrete ele é celular. Sem o `+`, `447700900123` continua
 * lido como brasileiro (e recusado): pode ser só um erro de digitação, e adivinhar o país aqui
 * mandaria o lembrete para outra pessoa. Com `+55`, a regra brasileira inteira, igual a sem o `+`.
 */
class TelefoneE164
{
    private const DDI = '55';

    /** E.164 depois do `+`: o código do país não começa por 0, e o total vai de 8 a 15 dígitos. */
    private const INTERNACIONAL = '/^[1-9]\d{7,14}$/';

    public const CELULAR = 'celular';

    public const FIXO = 'fixo';

    /**
     * Forma canônica `+55DD########` (ou `+55DD#########`), `+<dígitos>` para o número estrangeiro
     * com `+`, ou null quando o número não é utilizável — cadastro antigo com telefone pela metade é
     * comum, e ele NÃO pode impedir a gravação do paciente: fica só de fora do índice.
     */
    public static function normalizar(?string $bruto): ?string
    {
        $texto = self::limpo($bruto);
        $digitos = preg_replace('/\D+/', '', $texto) ?? '';

        if ($digitos === '') {
            return null;
        }

        // `+` e país que não é o Brasil: E.164 como veio, sem a régua de DDD e assinante
        // (change telefone-estrangeiro). `+55` segue adiante, pela regra brasileira de sempre
        if (str_starts_with($texto, '+') && ! str_starts_with($digitos, self::DDI)) {
            return preg_match(self::INTERNACIONAL, $digitos) === 1 ? '+'.$digitos : null;
        }

        // Só descasca o DDI quando o comprimento SÓ se explica com ele: 12/13 dígitos.
        // Sem essa trava, o DDD 55 (Rio Grande do Sul) seria comido como se fosse o país
        // — `5533334444` é um fixo de Santa Maria, não um número com DDI.
        $nacional = (strlen($digitos) >= 12 && str_starts_with($digitos, self::DDI))
            ? substr($digitos, 2)
            : $digitos;

        if (! preg_match('/^(\d{2})(\d{8,9})$/', $nacional, $partes)) {
            return null;
        }

        [, $ddd, $assinante] = $partes;

        if ((int) $ddd < 11) {
            return null;
        }

        // 9 dígitos: celular, obrigatoriamente iniciado em 9 (a numeração brasileira não
        // tem outra faixa com esse comprimento). 8 dígitos: fixo (2–5) ou celular antigo (6–9).
        $valido = strlen($assinante) === 9
            ? str_starts_with($assinante, '9')
            : (int) $assinante[0] >= 2;

        return $valido ? '+'.self::DDI.$ddd.$assinante : null;
    }

    /**
     * O texto sem as marcas invisíveis (Unicode Cf, todas) e sem espaço em volta — é nele que se olha
     * o `+`. O número copiado do WhatsApp vem embrulhado em marcas de direção de texto
     * (`\u{202A}+44 …\u{202C}`): com elas, o `+` não era o primeiro caractere e o celular de fora do
     * país era lido como brasileiro (gate r1 da change telefone-estrangeiro).
     */
    public static function limpo(?string $bruto): string
    {
        $texto = (string) $bruto;

        // UTF-8 inválido faz o `/u` devolver null: o texto segue como veio, e os dígitos decidem
        return trim(preg_replace('/\p{Cf}+/u', '', $texto) ?? $texto);
    }

    /**
     * O `from` que a Meta entrega no webhook: o DDI completo e sem o `+` (`5511987654321`,
     * `447700900123`). É lido como internacional — o `+` que ela não manda vai na frente —, e o
     * brasileiro cai na mesma regra de `normalizar()` (change telefone-estrangeiro). Sem isso a
     * resposta de uma família de fora do país não ganhava conversa nem criança.
     */
    public static function daMeta(?string $deDaMeta): ?string
    {
        return self::normalizar('+'.$deDaMeta);
    }

    /**
     * O que o cadastro diz ao lado do campo (change telefone-que-chega-no-whatsapp, D1): a forma que
     * a projeção grava e se ela é de celular ou de fixo. Fixo é o assinante de 8 dígitos iniciado em
     * 2–5; o de 6–9 é o celular de antes do nono dígito, e o de 9 é sempre celular.
     *
     * É a regra que a TELA copia (`web/src/lib/telefone-whatsapp.ts`). A cópia é conferida contra a
     * saída de `telefones:casos`, que roda ESTA função — mudar aqui sem regerar a fixture deixa o
     * teste de contrato do web vermelho.
     *
     * @return array{forma: string|null, tipo: 'celular'|'fixo'|null}
     */
    public static function classificar(?string $bruto): array
    {
        $forma = self::normalizar($bruto);

        if ($forma === null) {
            return ['forma' => null, 'tipo' => null];
        }

        // de fora do país não se sabe se é fixo: para o lembrete e os avisos, é celular
        if (self::estrangeiro($forma)) {
            return ['forma' => $forma, 'tipo' => self::CELULAR];
        }

        $assinante = substr($forma, 5);
        $fixo = strlen($assinante) === 8 && (int) $assinante[0] <= 5;

        return ['forma' => $forma, 'tipo' => $fixo ? self::FIXO : self::CELULAR];
    }

    /**
     * As formas sob as quais este número pode estar gravado: a canônica e, para celular,
     * a leitura com/sem o nono dígito. Usada na BUSCA (`whereIn`) — nunca na gravação.
     *
     * @return list<string>
     */
    public static function variantes(?string $bruto): array
    {
        $canonico = self::normalizar($bruto);

        if ($canonico === null) {
            return [];
        }

        // o nono dígito é história do Brasil: um número de fora só tem a forma que veio
        if (self::estrangeiro($canonico)) {
            return [$canonico];
        }

        $ddd = substr($canonico, 3, 2);
        $assinante = substr($canonico, 5);

        $alternativa = match (true) {
            // celular novo → como estaria gravado antes do nono dígito. Só quando o que sobra é CELULAR
            // (começa por 6–9): `9 3333-4444` sem o 9 seria o FIXO `3333-4444` de outra pessoa
            // (rodada 2 do gate de lembrete-com-botoes-de-resposta, SEC-BT-07)
            strlen($assinante) === 9 && str_starts_with($assinante, '9') && (int) $assinante[1] >= 6 => substr($assinante, 1),
            // celular antigo → como a Meta o entrega hoje
            strlen($assinante) === 8 && (int) $assinante[0] >= 6 => '9'.$assinante,
            default => null,
        };

        return $alternativa === null
            ? [$canonico]
            : [$canonico, '+'.self::DDI.$ddd.$alternativa];
    }

    /** A forma canônica é de fora do país? Só a brasileira começa por `+55`. */
    private static function estrangeiro(string $forma): bool
    {
        return ! str_starts_with($forma, '+'.self::DDI);
    }
}
