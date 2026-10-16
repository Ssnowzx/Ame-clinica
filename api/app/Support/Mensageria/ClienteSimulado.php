<?php

namespace App\Support\Mensageria;

/**
 * O canal sem rede (change mensageria-whatsapp, D2).
 *
 * Serve a dois momentos que são o mesmo problema: a suíte de testes e o período em que a
 * clínica ainda não entregou a credencial. Em ambos, o sistema precisa rodar INTEIRO sem
 * falar com a Meta.
 *
 * Ele registra o que enviaria (`$enviados`) para os testes assertarem, e devolve ids no
 * formato da Meta (`wamid.…`) — id fora de formato faria o teste passar por um caminho que
 * a produção não percorre.
 *
 * ATENÇÃO: nenhuma resolução de produção chega aqui com conexão `conectado`. O service de
 * envio recusa ANTES, com "WhatsApp não conectado" — este cliente existe para que o resto
 * do sistema não precise de um `if` de ambiente em lugar nenhum.
 */
class ClienteSimulado implements ClienteWhatsApp
{
    /** @var list<array<string, mixed>> */
    public array $enviados = [];

    private int $sequencia = 0;

    public function enviarTexto(string $paraE164, string $texto): string
    {
        return $this->registrar(['tipo' => 'texto', 'para' => $paraE164, 'texto' => $texto]);
    }

    public function enviarMidia(
        string $paraE164,
        string $conteudo,
        string $nomeArquivo,
        string $mime,
        ?string $legenda = null,
    ): string {
        return $this->registrar([
            'tipo' => 'midia',
            'para' => $paraE164,
            'arquivo' => $nomeArquivo,
            'bytes' => strlen($conteudo),
            'mime' => $mime,
            'legenda' => $legenda,
        ]);
    }

    public function enviarTemplate(string $paraE164, string $nome, string $idioma, array $variaveis = [], array $payloadsDosBotoes = []): string
    {
        return $this->registrar([
            'tipo' => 'template',
            'para' => $paraE164,
            'nome' => $nome,
            'idioma' => $idioma,
            'variaveis' => $variaveis,
            'botoes' => $payloadsDosBotoes,
        ]);
    }

    public function baixarMidia(string $waMediaId): MidiaBaixada
    {
        // PNG mínimo REAL: o gravador valida pelo CONTEÚDO, e um conteúdo falso seria
        // recusado — o simulado precisa produzir algo que passe pela mesma porta
        $png = base64_decode(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
        );

        return new MidiaBaixada($png, 'image/png', strlen($png));
    }

    public function listarTemplates(): array
    {
        return [[
            'nome' => 'lembrete_agendamento',
            'idioma' => 'pt_BR',
            'categoria' => 'UTILITY',
            'corpo' => 'Olá {{1}}, lembrando da sua sessão em {{2}}.',
            'variaveis' => ['1', '2'],
            'botoes' => [],
            'status' => 'APPROVED',
        ]];
    }

    public function verificarCredencial(): string
    {
        return '+55 11 0000-0000';
    }

    /** @param array<string, mixed> $registro */
    private function registrar(array $registro): string
    {
        $this->enviados[] = $registro;

        return 'wamid.SIMULADO'.(++$this->sequencia);
    }
}
