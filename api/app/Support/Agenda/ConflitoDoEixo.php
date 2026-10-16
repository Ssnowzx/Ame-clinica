<?php

namespace App\Support\Agenda;

/**
 * O veredito de UM eixo do conflito: a causa, a frase e quantos ocupam (change
 * atendimento-em-grupo, rodada 1 do gate — achado BLOQUEANTE do `code-reviewer`).
 *
 * Antes a primitiva devolvia só `campo => mensagem`, e o serviço — que precisa saber quando
 * PODE relevar um conflito antigo (D4) — não tinha como distinguir "lotou" de "está
 * bloqueado". Relevava os dois. Com capacidade 1, o default, isso levantava o
 * veto do bloqueio: medido, três recusas que existiam viraram 201, e em duas requisições
 * nascia um atendimento ocupando o horário por cima de uma folga declarada.
 *
 * **A causa é do domínio, não conveniência de mensagem.** Bloqueio é ausência do
 * profissional; lotação é disputa de vaga. A primeira nunca se releva, a segunda sim — e é
 * essa diferença que a estrutura carrega.
 *
 * `ocupantes` é a contagem REAL, não o teto: a frase "já tem N" tem de dizer o que está lá.
 * Com o teto baixado de 4 para 2 e quatro marcados, anunciar o teto diria "já tem 2" havendo
 * quatro.
 */
final readonly class ConflitoDoEixo
{
    public function __construct(
        /** @var 'bloqueio'|'capacidade' */
        public string $causa,
        public string $mensagem,
        public int $ocupantes = 0,
    ) {}

    /** O bloqueio é veto ABSOLUTO: nenhum chamador pode relevá-lo. */
    public function ehBloqueio(): bool
    {
        return $this->causa === VerificadorDeConflitos::CAUSA_BLOQUEIO;
    }
}
