/**
 * O REGISTRO das seções da ficha do paciente (change ficha-do-paciente, Decisão 1).
 *
 * Uma seção NÃO é um `switch` espalhado: é um item deste registro, e dele saem a
 * navegação lateral, o roteamento e o slot reservado. Cada item declara:
 * - `permissao`: a seção filtra pelo RBAC (como o `app-shell` faz na nav principal);
 * - `reservada`: `null` = construída; um motivo = slot reservado (Decisão 2 — a
 *   indisponibilidade é DADO derivado daqui, nunca uma tela morta que finge funcionar).
 *
 * Acender uma seção no futuro (o Financeiro na Fase 4) é **mudar este registro**,
 * não recodificar a página — é o que impede a regra #4 do ROADMAP de ser re-armada.
 */
export interface SecaoDaFicha {
  /** slug no path (`/pacientes/:id/:secao`) */
  id: string
  rotulo: string
  /** permissão do RBAC que a seção exige */
  permissao: string
  /** `null` = construída; texto = reservada, com o motivo/fase para o usuário */
  reservada: string | null
}

export const SECOES_DA_FICHA: readonly SecaoDaFicha[] = [
  { id: 'painel', rotulo: 'Painel', permissao: 'pacientes.ver', reservada: null },
  { id: 'cadastro', rotulo: 'Cadastro', permissao: 'pacientes.ver', reservada: null },
  { id: 'agendamentos', rotulo: 'Agendamentos', permissao: 'agenda.ver', reservada: null },
  // Fase 4 fechou (financeiro-tela): a seção lista os lançamentos do paciente reusando o
  // painel de financeiro filtrado por interessado (change financeiro-na-ficha).
  { id: 'financeiro', rotulo: 'Financeiro', permissao: 'lancamentos.ver', reservada: null },
  // Acesa com parecer pré-código (SEC-PF, GO-COM-CONDIÇÕES): linha do tempo
  // metadados-só; a evolução abre sob demanda pela leitura AUDITADA (art. 11).
  { id: 'prontuario', rotulo: 'Prontuário', permissao: 'evolucoes.ver', reservada: null },
  // Fase 5 — acesa com parecer pré-código (SEC-ANM): lista só-metadados, leitura auditada
  // sob demanda, respostas escapadas por JSX e fora da URL (art. 11).
  { id: 'anamnese', rotulo: 'Anamnese', permissao: 'anamneses.ver', reservada: null },
  // Acesa (presenca-na-ficha): ASSIDUIDADE derivada, calculada no servidor (§13).
  // O check-in real (meio · por quem) segue na Fase 2.
  { id: 'presenca', rotulo: 'Presença', permissao: 'agenda.ver', reservada: null },
  // Acesa (anexos-do-paciente, parecer SEC-AX): domínio próprio com upload validado
  // por conteúdo, arquivo cifrado, download auditado e soft-delete (retenção).
  { id: 'anexos', rotulo: 'Anexos', permissao: 'anexos.ver', reservada: null },
  // Acesa (aceite-do-regulamento, FA-08): LEITURA da situação do aceite diante da
  // versão em vigor + histórico. Registrar continua sendo edição do cadastro.
  { id: 'termo', rotulo: 'Contrato/Termo', permissao: 'pacientes.ver', reservada: null },
]

/** As seções que a permissão do usuário permite — a nav e o roteamento só oferecem estas. */
export function secoesPermitidas(temPermissao: (permissao: string) => boolean): SecaoDaFicha[] {
  return SECOES_DA_FICHA.filter((secao) => temPermissao(secao.permissao))
}

/** A seção pedida no path, ou `undefined` (id desconhecido). */
export function acharSecao(id: string | undefined): SecaoDaFicha | undefined {
  return id === undefined ? undefined : SECOES_DA_FICHA.find((secao) => secao.id === id)
}
