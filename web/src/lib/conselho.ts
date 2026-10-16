/**
 * O registro no conselho, montado só com as partes que EXISTEM.
 *
 * Três telas concatenavam `conselho/uf num` direto na interpolação, e duas delas
 * checavam apenas o `conselho`. Como `uf_conselho` é opcional no cadastro (14 dos 20
 * profissionais de produção estão sem), a tela exibia literalmente **`CRP/null 12/20988`**
 * para o usuário final — `null` virando texto por interpolação, o defeito mais visível da
 * validação em produção de 2026-08-21.
 *
 * @param registro - As três partes como vêm da API (qualquer uma pode faltar)
 * @returns "CRP/SP 12345", "CRP 12345" (sem UF), "CRP/SP" (sem número) ou `null` quando
 *          não há conselho — cabe ao chamador decidir o que mostrar no lugar (em geral "—")
 */
export function registroNoConselho(registro: {
  conselho: string | null
  uf_conselho: string | null
  num_conselho: string | null
}): string | null {
  const sigla = registro.conselho?.trim()
  if (sigla === undefined || sigla === '') {
    return null
  }

  const uf = registro.uf_conselho?.trim()
  const numero = registro.num_conselho?.trim()

  const comUf = uf === undefined || uf === '' ? sigla : `${sigla}/${uf}`
  return numero === undefined || numero === '' ? comUf : `${comUf} ${numero}`
}
