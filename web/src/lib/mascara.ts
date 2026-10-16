/**
 * Máscara de formato fixo — `0` é dígito, o resto é separador literal.
 *
 * Uma implementação só, porque o produto já tem dois formatos fixos (CEP agora, data desde a
 * change `cadastro-online-do-paciente`) e vai ter mais. O que ela promete é o que o design
 * system exige: **o formulário guarda dígitos, a tela mostra separador**. Guardar às vezes
 * `88501050` e às vezes `88501-050` faria o mesmo endereço parecer dois na busca e no relatório
 * — e ninguém descobriria por um erro, só por uma conta que não fecha.
 */

/** `'00000-000'`, `'88501050'` → `'88501-050'`. Só dígitos entram. */
export function aplicarMascara(formato: string, digitado: string): string {
  const digitos = digitosDaMascara(formato, digitado)

  let saida = ''
  let proximo = 0

  for (const simbolo of formato) {
    if (proximo >= digitos.length) break

    if (simbolo === '0') {
      saida += digitos[proximo]
      proximo += 1
    } else {
      // separador só entra quando ainda há dígito para depois dele: senão `88501` viraria
      // `88501-`, e apagar o último dígito ficaria impossível (o hífen voltaria sozinho)
      saida += simbolo
    }
  }

  return saida
}

/** Os dígitos que o formato comporta, venha o valor digitado, colado com separador ou do banco. */
export function digitosDaMascara(formato: string, valor: string): string {
  const cabem = [...formato].filter((simbolo) => simbolo === '0').length

  return valor.replace(/\D/g, '').slice(0, cabem)
}
