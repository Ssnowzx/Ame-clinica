/** UFs do Brasil — a mesma lista que a API valida (`Rule::in`). Um lugar só. */
export const UFS = [
  'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT',
  'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO',
] as const

export const OPCOES_DE_UF = UFS.map((uf) => ({ valor: uf, rotulo: uf }))
