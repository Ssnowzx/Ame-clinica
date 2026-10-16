/**
 * CPF ou CNPJ num campo só — o documento do fornecedor (change `caixa-do-dia-a-dia`).
 *
 * O formulário guarda DÍGITOS, a tela mostra com pontuação: a mesma escolha do CEP. A máscara de
 * formato fixo (`aplicarMascara`) não serve aqui porque o formato depende de quantos dígitos há:
 * até 11 é CPF, de 12 a 14 é CNPJ. Quem confere o dígito verificador é o SERVIDOR; a tela só não
 * deixa o formato atrapalhar quem digita ou cola `12.345.678/0001-95` de uma nota.
 */

/** Quantos dígitos cabem no maior dos dois (CNPJ). */
export const DIGITOS_DO_CNPJ = 14

/** Os dígitos do documento, venha ele digitado, colado com pontuação ou do banco. */
export function digitosDoDocumento(valor: string): string {
  return valor.replace(/\D/g, '').slice(0, DIGITOS_DO_CNPJ)
}

/** `12345678909` → `123.456.789-09`; `12345678000195` → `12.345.678/0001-95`; parcial, até onde houver. */
export function formatarCpfOuCnpj(valor: string): string {
  const digitos = digitosDoDocumento(valor)

  if (digitos.length <= 11) {
    return digitos
      .replace(/^(\d{3})(\d)/, '$1.$2')
      .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
      .replace(/^(\d{3})\.(\d{3})\.(\d{3})(\d)/, '$1.$2.$3-$4')
  }

  return digitos
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/^(\d{2})\.(\d{3})\.(\d{3})(\d)/, '$1.$2.$3/$4')
    .replace(/^(\d{2})\.(\d{3})\.(\d{3})\/(\d{4})(\d)/, '$1.$2.$3/$4-$5')
}
