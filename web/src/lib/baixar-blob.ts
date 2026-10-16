/**
 * Salva um arquivo que desceu pelo caminho AUTENTICADO (blob) com o nome dado — nunca por URL de
 * armazenamento. A âncora é temporária e a URL do blob é revogada depois do clique.
 *
 * @param blob - O conteúdo que a API devolveu
 * @param nome - O nome com que o navegador salva o arquivo
 */
export function baixarBlob(blob: Blob, nome: string): void {
  const url = URL.createObjectURL(blob)
  const ancora = document.createElement('a')
  ancora.href = url
  ancora.download = nome
  ancora.click()
  // revogação ADIADA: síncrona, ela aborta o download em alguns navegadores
  setTimeout(() => {
    URL.revokeObjectURL(url)
  }, 1000)
}
