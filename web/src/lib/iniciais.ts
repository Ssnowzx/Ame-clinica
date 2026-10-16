/**
 * Iniciais de um nome para avatar/monograma: primeira + ÚLTIMA palavra ("Clínica Fictícia
 * Exemplo" → "CE"; "Ana Fictícia Souza" → "AS").
 * Era função local do cartão de tarefa; a marca da clínica passou a precisar dela também.
 */
export function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/)
  const primeira = partes[0]?.[0] ?? ''
  const ultima = partes.length > 1 ? (partes[partes.length - 1]?.[0] ?? '') : ''
  return `${primeira}${ultima}`.toUpperCase()
}
