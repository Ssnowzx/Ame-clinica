/** Uma alteração de campo na trilha — rótulo humano + antes/depois (já mascarado no servidor). */
export interface AlteracaoAuditoria {
  campo: string
  de: unknown
  para: unknown
}

/** Uma linha da trilha de auditoria (payload de GET /api/auditoria). */
export interface LinhaAuditoria {
  id: number
  entidade: string
  entidade_id: number
  acao: string
  /**
   * Nome do autor, já resolvido pelo servidor: o nome da pessoa, "Sistema" (rotina agendada,
   * console), "Formulário público" (alguém sem sessão, pela porta pública do auto-cadastro) ou
   * "Família, pelo WhatsApp" (o toque no botão do lembrete — change lembrete-com-botoes-de-resposta).
   */
  autor: string
  /** A origem, para filtrar e destacar sem precisar reconhecer o texto do nome. */
  autor_tipo: 'usuario' | 'sistema' | 'externa' | 'whatsapp'
  /** "Y-m-d H:i:s" no fuso da clínica. */
  criado_em: string
  alteracoes: AlteracaoAuditoria[]
}
