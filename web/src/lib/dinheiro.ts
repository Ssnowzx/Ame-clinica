/**
 * Dinheiro é decimal, nunca float (D1).
 *
 * O servidor manda valores como STRING decimal de 2 casas (`decimal:2`), e os
 * totais do extrato vêm somados lá (`bcadd`/`bcsub`). A tela só FORMATA — e faz
 * isso manipulando a string, sem `Number(...)`: converter para ponto flutuante
 * introduziria o erro de arredondamento exatamente onde ele não pode existir
 * (um centavo perdido num recibo é um recibo errado).
 */

/** A forma que É dinheiro: inteiro opcionalmente com casas decimais, e nada mais. */
const DECIMAL_PLANO = /^[+-]?\d+(\.\d+)?$/

/**
 * Formata uma string decimal (`"1234.50"`) em BRL/pt-BR (`"R$ 1.234,50"`).
 *
 * O que não tem a FORMA de decimal vale `R$ 0,00`. Antes esta função fazia `valor.trim()`
 * cru e depois extraía dígitos: `null` a quebrava com `valor.trim is not a function`, e
 * `"1e-7"` (o que o JavaScript imprime para `0.0000001`) virava **R$ 1,00** — dinheiro
 * inventado. É a mesma disciplina de `emCentavos`, e vale aqui com mais razão: esta função
 * roda dezenas de vezes por tela financeira (achado do gate).
 */
export function formatarBRL(valor: string): string {
  const texto = String(valor ?? '').trim()
  if (!DECIMAL_PLANO.test(texto)) {
    return 'R$ 0,00'
  }
  const negativo = texto.startsWith('-')
  const semSinal = texto.replace(/^[+-]/, '')
  const [inteiroRaw = '0', decimalRaw = ''] = semSinal.split('.')

  const inteiro = inteiroRaw.replace(/^0+(?=\d)/, '')
  const centavos = `${decimalRaw}00`.slice(0, 2)
  const agrupado = inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, '.')

  // −0,00 é 0,00: o sinal só aparece quando há valor de fato
  const ehZero = inteiro === '0' && centavos === '00'
  const sinal = negativo && !ehZero ? '-' : ''

  return `${sinal}R$ ${agrupado},${centavos}`
}

/**
 * Converte a entrada do usuário para o decimal que a API espera.
 *
 * Aceita a forma que o brasileiro digita (`"1.234,50"`, `"1234,5"`) e a de ponto
 * (`"1234.50"`), devolvendo sempre `ponto` como separador decimal. Vazio continua
 * vazio — quem valida o formato final é a API (`decimal:0,2`), e a recusa pousa
 * no campo.
 */
export function paraDecimalDaApi(entrada: string): string {
  const texto = entrada.trim().replace(/\s/g, '')
  if (texto === '') {
    return ''
  }
  if (texto.includes(',')) {
    return texto.replace(/\./g, '').replace(',', '.')
  }
  return texto
}

/**
 * Soma strings decimais SEM passar por ponto flutuante: converte cada uma em
 * centavos INTEIROS (`BigInt`) e devolve a string decimal de duas casas.
 *
 * Existe porque a tela às vezes precisa de um total que o servidor não mandou — a
 * cauda "Outras (+N)" de uma quebra por categoria, por exemplo.
 *
 * **Honestidade sobre o motivo:** o caminho óbvio,
 * `valores.reduce((s, v) => s + Number(v), 0).toFixed(2)`, dá o MESMO resultado em
 * toda a faixa de valores de uma clínica — o `toFixed(2)` arredonda por cima do erro
 * binário, então `0.1 + 0.2` volta a `"0.30"` e a mutação para float não derruba
 * teste de valor realista. As duas divergem em dois pontos, e é por eles que esta
 * versão fica de pé:
 *
 * 1. **Acima de ~R$ 90 bilhões** (2^53 centavos) o float perde a casa do centavo:
 *    `["81985529216486.89", "0.01"]` sai `81985529216486.91` em vez de `...90`.
 *    Fora da escala desta clínica, mas é o tipo de premissa que ninguém revisita.
 * 2. **Casa além da segunda:** aqui é TRUNCADA, como o `bcadd(x, '0', 2)` do
 *    servidor; `toFixed(2)` ARREDONDA. `"0.005"` vira `"0.00"` aqui e `"0.01"` lá.
 *
 * Casas além da segunda são TRUNCADAS de propósito, para casar com o servidor.
 */
export function somarDecimais(valores: readonly string[]): string {
  const total = valores.reduce<bigint>((soma, valor) => soma + emCentavos(valor), 0n)
  const negativo = total < 0n
  const absoluto = (negativo ? -total : total).toString().padStart(3, '0')

  return `${negativo ? '-' : ''}${absoluto.slice(0, -2)}.${absoluto.slice(-2)}`
}

/**
 * Uma string decimal em centavos inteiros — a base do `somarDecimais`.
 *
 * **Valida a FORMA antes de converter, e isso não é zelo decorativo.** A primeira versão
 * só coagia com `String(valor ?? '')` e depois extraía os dígitos — o que INVENTAVA
 * dinheiro em silêncio, porque o JavaScript imprime número pequeno ou enorme em notação
 * científica: `0.0000001` vira `"1e-7"`, cujos dígitos são `1` e `7`, e o total saía
 * **R$ 17,00**. Medido também: `1e21` → R$ 121,00 e `"1e3"` → R$ 13,00 (achado SEC-GF-06
 * do gate). Pelo critério que esta casa já adotou — zerar seria perder dinheiro em
 * silêncio — INVENTAR é pior ainda.
 *
 * O que não casa `DECIMAL_PLANO` não é dinheiro e vale zero. `null`, `undefined`, texto
 * livre e notação científica caem aí, e a tela mostra zero em vez de quebrar com
 * `valor.trim is not a function`.
 *
 * Casas além da segunda são TRUNCADAS, para casar com o `bcadd(x, '0', 2)` do servidor.
 */
function emCentavos(valor: string): bigint {
  const texto = String(valor ?? '').trim()
  if (!DECIMAL_PLANO.test(texto)) {
    return 0n
  }
  const negativo = texto.startsWith('-')
  const semSinal = texto.replace(/^[+-]/, '')
  const [inteiroRaw = '0', decimalRaw = ''] = semSinal.split('.')
  const centavos = `${decimalRaw}00`.slice(0, 2)
  const total = BigInt(inteiroRaw) * 100n + BigInt(centavos)

  return negativo ? -total : total
}

/**
 * Formata uma string decimal como percentual pt-BR (`"2.99"` → `"2,99%"`).
 *
 * Mesma disciplina do `formatarBRL`: manipula a STRING, sem `Number(...)`. A taxa do
 * cartão sai do servidor como decimal de ponto, e mostrá-la crua ("2.99%") numa tela
 * em português é falar americano com quem está no balcão (achado do gate).
 */
export function formatarPercentual(valor: string): string {
  const texto = String(valor ?? '').trim()
  // sem a forma de decimal não há percentual para mostrar — melhor vazio que inventado
  if (!DECIMAL_PLANO.test(texto)) return ''
  return `${texto.replace('.', ',')}%`
}
