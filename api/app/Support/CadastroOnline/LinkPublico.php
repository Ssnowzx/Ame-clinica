<?php

namespace App\Support\CadastroOnline;

use App\Models\Clinica;
use App\Support\Configuracoes\ConfiguracaoService;
use Symfony\Component\HttpKernel\Exception\HttpException;

/**
 * O endereço público do auto-cadastro: quem é dono dele, como ele nasce e como ele morre
 * (change `cadastro-online-do-paciente`).
 *
 * **Fonte única da resolução.** Quem traduz um endereço na clínica é só esta classe — porque a
 * tradução carrega três decisões de segurança que, copiadas, divergem: a recusa idêntica, a
 * guarda do identificador vazio e a ordem em que o link desligado é checado.
 */
class LinkPublico
{
    /**
     * O identificador tem 16 caracteres de um alfabeto sem ambiguidade visual (sem `0/O`, `1/l/I`)
     * — a família às vezes recebe o link e digita. São 31^16 ≈ 10^24 combinações: varrer o espaço
     * não é um ataque, é uma fantasia. E ele NÃO deriva do `id` da clínica nem é sequencial: com
     * endereço adivinhável por incremento, a opacidade seria decorativa.
     */
    private const ALFABETO = 'abcdefghjkmnpqrstuvwxyz23456789';

    private const TAMANHO = 16;

    public function __construct(private readonly ConfiguracaoService $configuracoes) {}

    /**
     * Gera um endereço novo para a clínica, aposentando o anterior.
     *
     * Rotacionar é a mitigação do link vazado, e por isso existe desde a primeira versão em vez de
     * "depois, se precisar": um endereço que foi parar no lugar errado se conserta trocando o
     * endereço, não pedindo para apagarem a mensagem.
     */
    public function rotacionar(): string
    {
        $clinica = Clinica::atual();

        // laço porque a coluna é única: a colisão é astronomicamente improvável, e "improvável"
        // não é "impossível" — a garantia de verdade é o índice único do banco, e este laço só
        // evita que ela apareça como erro 500 para quem clicou em "gerar"
        do {
            $novo = $this->sortear();
        } while (self::emUso($novo));

        $clinica->forceFill(['cadastro_online_slug' => $novo])->save();

        return $novo;
    }

    /** O endereço atual da clínica, ou `null` se ela nunca gerou um. */
    public function atual(): ?string
    {
        return Clinica::atual()->cadastro_online_slug;
    }

    /**
     * Resolve a clínica DONA de um endereço — ou recusa, sempre do mesmo jeito.
     *
     * Três negativas respondem **igual**, em corpo e em código: endereço que nunca existiu,
     * endereço de clínica inativa e endereço com o link desligado. Diferenciá-las diria a um
     * varredor quais clínicas usam o produto, e a existência de uma clínica de neurodesenvolvimento
     * numa cidade pequena não é dado neutro.
     *
     * A guarda do identificador vazio vem **antes da consulta**, e não é zelo: no Eloquent,
     * `where('coluna', null)` vira `IS NULL`, e a coluna nasce nula — um endereço vazio casaria com
     * a clínica (ameaça A12 do parecer pré-código).
     */
    public function resolver(?string $slug): Clinica
    {
        if ($slug === null || $slug === '' || ! preg_match('/^[a-z0-9]{8,32}$/', $slug)) {
            $this->recusar();
        }

        $clinica = Clinica::where('cadastro_online_slug', $slug)->first();

        if ($clinica === null || ! $clinica->ativo) {
            $this->recusar();
        }

        if ($this->configuracoes->get('cadastro_online.ativo') !== true) {
            $this->recusar();
        }

        return $clinica;
    }

    /**
     * A recusa. Uma só, em um lugar só — é isso que torna as três indistinguíveis, e é o que uma
     * segunda cópia acabaria divergindo na primeira vez que alguém "melhorasse a mensagem".
     */
    private function recusar(): never
    {
        throw new HttpException(404, 'Este endereço de cadastro não está disponível.');
    }

    private function sortear(): string
    {
        $tamanhoDoAlfabeto = strlen(self::ALFABETO);
        $sorteado = '';

        for ($i = 0; $i < self::TAMANHO; $i++) {
            // `random_int` e não `rand`: é gerador criptográfico. Endereço previsível é endereço
            // adivinhável, e a opacidade é metade do que segura esta porta
            $sorteado .= self::ALFABETO[random_int(0, $tamanhoDoAlfabeto - 1)];
        }

        return $sorteado;
    }

    /**
     * Existe endereço gerado com este valor? — usado só pelo laço de colisão.
     * Fora daqui, ninguém consulta a coluna direto: quem resolve é `resolver()`.
     */
    public static function emUso(string $slug): bool
    {
        return Clinica::query()->where('cadastro_online_slug', $slug)->exists();
    }
}
