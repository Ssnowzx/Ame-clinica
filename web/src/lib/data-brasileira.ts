/**
 * Data em português, sempre — inclusive quando o navegador está em inglês
 * (change `cadastro-online-do-paciente`).
 *
 * É o defeito que a referência tem e que não vamos copiar: a página do sistema que estamos
 * substituindo renderiza a data como `mm/dd/yyyy` porque usa o campo nativo do navegador, e o
 * navegador segue o idioma do aparelho. Numa página aberta por famílias brasileiras, `03/04` deixa
 * de ter significado — ninguém sabe se é 3 de abril ou 4 de março, e o erro só aparece meses
 * depois, quando a criança tem a idade errada no cadastro.
 *
 * Por isso o campo é de TEXTO com máscara, e não `type="date"`: o formato passa a ser nosso, e não
 * do aparelho de quem preenche.
 */

/** `1503` → `15/03`; `15032018` → `15/03/2018`. Só dígitos entram. */
export function mascararDataBrasileira(digitado: string): string {
  const digitos = digitado.replace(/\D/g, '').slice(0, 8)

  if (digitos.length <= 2) return digitos
  if (digitos.length <= 4) return `${digitos.slice(0, 2)}/${digitos.slice(2)}`

  return `${digitos.slice(0, 2)}/${digitos.slice(2, 4)}/${digitos.slice(4)}`
}

/**
 * `15/03/2018` → `2018-03-15`, que é o formato que a API fala. Devolve `null` para data
 * incompleta ou impossível.
 *
 * A checagem de existência é literal (`31/02` não vira `03/03`): uma data que "corrige sozinha"
 * grava silenciosamente outra coisa, e o cadastro de uma criança não é lugar para adivinhação.
 */
export function paraDataDaApi(brasileira: string): string | null {
  const partes = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(brasileira.trim())

  if (partes === null) return null

  const [, dia, mes, ano] = partes
  const data = new Date(Number(ano), Number(mes) - 1, Number(dia))

  const existe =
    data.getFullYear() === Number(ano) &&
    data.getMonth() === Number(mes) - 1 &&
    data.getDate() === Number(dia)

  return existe ? `${ano}-${mes}-${dia}` : null
}

/**
 * Quantos anos completos essa data brasileira representa hoje — `null` quando ela não é uma data.
 *
 * A tela usa isto para saber QUANDO pedir responsável. O servidor faz a mesma conta e é ele quem
 * decide: aqui é conveniência para a família não descobrir a exigência só ao enviar.
 */
export function idadeEm(brasileira: string): number | null {
  const daApi = paraDataDaApi(brasileira)

  if (daApi === null) return null

  const nascimento = new Date(`${daApi}T00:00:00`)
  const hoje = new Date()

  let anos = hoje.getFullYear() - nascimento.getFullYear()
  const aindaNaoFezAniversario =
    hoje.getMonth() < nascimento.getMonth() ||
    (hoje.getMonth() === nascimento.getMonth() && hoje.getDate() < nascimento.getDate())

  if (aindaNaoFezAniversario) anos -= 1

  return anos
}
