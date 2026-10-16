/**
 * A data já é utilizável numa consulta?
 *
 * `<input type="date">` emite `onChange` a CADA tecla do ano: digitar 2026 produz
 * `0002-…`, `0020-…`, `0202-…` e só então `2026-…`. Sem esta guarda, o filtro dispara
 * quatro requisições, três delas com ano impossível — em produção isso pintou a tela do
 * Financeiro de vermelho com o erro do validador enquanto a recepção digitava a data
 * (achado da validação em produção, 2026-08-21).
 *
 * @param valor - O `value` cru do input (`AAAA-MM-DD` ou vazio)
 * @returns `true` só quando a data está completa e num ano plausível
 */
export function ehDataDeFiltroUtilizavel(valor: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) {
    return false
  }

  // o piso não é estético: ano com zero à esquerda é sempre digitação em andamento,
  // nunca intenção — a clínica não tem movimento financeiro no ano 202
  const ano = Number(valor.slice(0, 4))
  return ano >= 1900 && ano <= 2999
}
