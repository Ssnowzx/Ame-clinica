<?php

namespace App\Support\Mensageria;

/**
 * O que voltou do download de uma mídia da Meta (change mensageria-whatsapp).
 *
 * `mime` aqui é o que a META declarou — e por isso NÃO é a palavra final: quem grava
 * revalida pelo CONTEÚDO antes de aceitar (mesmo tratamento dos anexos do paciente).
 * O objeto carrega a declaração; a verificação é de quem persiste.
 */
readonly class MidiaBaixada
{
    public function __construct(
        public string $conteudo,
        public string $mime,
        public int $tamanho,
    ) {}
}
