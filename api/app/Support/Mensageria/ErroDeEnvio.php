<?php

namespace App\Support\Mensageria;

use RuntimeException;

/**
 * Falha ao falar com a Meta (change mensageria-whatsapp, D8).
 *
 * A distinção que importa é UMA: `permanente` ou não.
 *
 * - **Temporário** (rede caiu, 429, 5xx): retentar tem sentido — o Job espera e volta.
 * - **Permanente** (número inválido, template inexistente, credencial recusada): retentar
 *   é queimar tentativa contra um erro que não muda sozinho. A mensagem vai para `falhou`
 *   com motivo legível, e alguém decide o que fazer.
 *
 * Sem essa separação, o Job trataria "esse número não existe" como instabilidade e tentaria
 * cinco vezes — atrasando a fila inteira para chegar ao mesmo lugar.
 */
class ErroDeEnvio extends RuntimeException
{
    public function __construct(
        string $mensagem,
        public readonly bool $permanente,
        public readonly ?string $codigo = null,
    ) {
        parent::__construct($mensagem);
    }

    public static function permanente(string $mensagem, ?string $codigo = null): self
    {
        return new self($mensagem, permanente: true, codigo: $codigo);
    }

    public static function temporario(string $mensagem, ?string $codigo = null): self
    {
        return new self($mensagem, permanente: false, codigo: $codigo);
    }
}
