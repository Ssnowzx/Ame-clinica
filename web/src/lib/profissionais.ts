import type { Profissional } from '@/tipos'

/**
 * As opções de um select de profissional: **os ativos**, mais o que já está vinculado ao registro.
 *
 * `GET /profissionais` é o CADASTRO — devolve os desligados também. Sem filtro, a fonoaudióloga
 * que saiu da clínica aparecia como opção para QUALQUER coisa: assinaria, em julho, o prontuário
 * de uma criança que nunca viu.
 *
 * **A regra (decisão do usuário, 2026-07-14): a autoria diz a VERDADE.** Quem realizou a sessão
 * foi ela — fazer outra pessoa assinar no lugar seria FALSIFICAR a autoria do prontuário, que é
 * pior que o problema. Por isso o desligado **continua selecionável quando é ele o vinculado ao
 * registro** (o profissional DO ATENDIMENTO, no caso da evolução; o do pacote, no tratamento), e
 * **só nesse caso** — rotulado, para que ninguém escolha por engano.
 *
 * ⚠️ **Esta função é conveniência de UI, NÃO é a regra.** A regra vive no servidor
 * (`EvolucaoController::validarInvariantes`), que recusa 422 quando um desligado tenta assinar
 * sessão alheia: uma aba velha, um cliente antigo ou um `curl` passariam direto por um `.filter()`
 * no React (§13 — regra é do servidor, nunca só da tela). O gate pegou exatamente isso.
 *
 * **Filtrar aqui, nunca na consulta:** a lista completa é o que diz QUEM ASSINOU uma evolução
 * antiga (*"Registrada por Fulana"*). Filtrar na origem apagaria o nome do autor desligado.
 */
export function opcoesDeProfissional(
  profissionais: Profissional[],
  vinculadoAoRegistro: number | null,
): Array<{ valor: string; rotulo: string }> {
  return profissionais
    .filter((profissional) => profissional.ativo || profissional.id === vinculadoAoRegistro)
    .map((profissional) => ({
      valor: String(profissional.id),
      rotulo: profissional.ativo ? profissional.nome : `${profissional.nome} (desligado)`,
    }))
}
