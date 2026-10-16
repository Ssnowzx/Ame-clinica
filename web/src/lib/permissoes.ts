import { FLAGS_DE_ESCOPO } from '@/lib/permissoes-rotulos'

/**
 * O predicado "basta ter QUALQUER uma" — num lugar SÓ. Antes vivia em três
 * cópias literais (ProtegidoPorPermissao, ExigePermissao e um filter anônimo
 * do AppShell), e qualquer evolução da regra ia esquecer uma delas (achado do
 * parecer). Guard de EXPERIÊNCIA: a autorização real continua no servidor.
 * @param temPermissao - O verificador do auth-store
 * @param permissao - Uma permissão, ou uma lista (OU lógico)
 */
export function possuiAlgumaPermissao(
  temPermissao: (permissao: string) => boolean,
  permissao: string | readonly string[],
): boolean {
  return typeof permissao === 'string'
    ? temPermissao(permissao)
    : permissao.some((uma) => temPermissao(uma))
}

/**
 * O predicado "precisa de TODAS" — para a afordância que leva a uma rota que o servidor só abre
 * com várias permissões em E (o lote de vínculos). Link que leva a "acesso negado" é promessa vazia.
 * @param temPermissao - O verificador do auth-store
 * @param permissoes - As permissões exigidas juntas (E lógico)
 */
export function possuiTodasAsPermissoes(
  temPermissao: (permissao: string) => boolean,
  permissoes: readonly string[],
): boolean {
  return permissoes.every((uma) => temPermissao(uma))
}

/** O que a régua precisa saber de um usuário: quem é, de que profissional, e o que pode. */
interface UsuarioNaRegua {
  id: number
  profissional_id: number | null
  permissoes: readonly string[]
}

/**
 * Quem age alcança o usuário? A MESMA régua do servidor (`SemEscalada`, change
 * `trava-de-usuarios-e-niveis`), nos dois eixos: tem tudo o que ele tem, E o alcança no escopo D11 —
 * é ele mesmo, ele não tem vínculo, é do mesmo profissional, ou quem age tem as duas flags. Guard de
 * EXPERIÊNCIA: a pendência que vai promovê-lo só o servidor vê (ali o 403 chega genérico).
 * @param temPermissao - O verificador do auth-store
 * @param eu - Quem age
 * @param alvo - O usuário da linha
 */
export function alcancaOUsuario(
  temPermissao: (permissao: string) => boolean,
  eu: Pick<UsuarioNaRegua, 'id' | 'profissional_id'>,
  alvo: UsuarioNaRegua,
): boolean {
  if (alvo.id === eu.id) {
    return true
  }
  const noEscopo =
    alvo.profissional_id === null
    || alvo.profissional_id === eu.profissional_id
    || possuiTodasAsPermissoes(temPermissao, FLAGS_DE_ESCOPO)

  return noEscopo && possuiTodasAsPermissoes(temPermissao, alvo.permissoes)
}

