<?php

namespace App\Support\Validacao;

use Closure;
use Illuminate\Contracts\Validation\ValidationRule;

/**
 * O TETO DE UM CAMPO DE TEXTO — e ele sabe dizer o tamanho que recebeu.
 *
 * Nasceu de um chamado real (04/09/2026): a recepção preencheu a ficha inteira e o servidor
 * recusou com **"O campo logradouro não pode ter mais de 255 caracteres"**. A mensagem diz o
 * limite e não diz o tamanho — e num campo de linha única o excesso está fora da vista, porque
 * o `input` desenha o valor a partir do começo. Não havia como saber se sobravam três
 * caracteres ou trezentos.
 *
 * Um limite que a pessoa não tem como medir sozinha não é instrução.
 *
 * Esta regra existe por duas razões, e a segunda não é óbvia:
 *
 * 1. **A mensagem ganha o número que faltava.** `:max` o Laravel já substitui; o tamanho
 *    RECEBIDO não é placeholder de regra nativa nenhuma. Uma regra própria vê o valor.
 * 2. **O limite deixa de ser texto para virar dado legível.** `'max:255'` é string: quem
 *    quisesse mandar o teto para a tela teria de fatiá-la com regex. Aqui o número é uma
 *    propriedade — e é assim que `CatalogoCamposCadastro::tamanho()` o entrega ao formulário,
 *    sem que ninguém escreva o número uma segunda vez.
 */
class TamanhoMaximo implements ValidationRule
{
    public function __construct(public readonly int $limite) {}

    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        // quem recusa o que não é texto é a regra `string`, que anda junto desta; medir
        // `mb_strlen` de um array aqui produziria uma segunda mensagem sobre o mesmo defeito
        if (! is_string($value)) {
            return;
        }

        $tamanho = mb_strlen($value);

        if ($tamanho > $this->limite) {
            $fail('validation.tamanho_maximo')->translate([
                'tamanho' => $tamanho,
                'max' => $this->limite,
            ]);
        }
    }
}
