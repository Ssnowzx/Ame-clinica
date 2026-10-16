import type { TratamentoDaSelecao } from '@/tipos'

/**
 * O mínimo que o rótulo precisa da especialidade — o catálogo da agenda serve isto e mais.
 * Pedir a forma inteira faria o teste (e qualquer outro chamador) montar cor e tempo de sessão
 * para produzir um texto que não usa nenhum dos dois.
 */
type NomeDeEspecialidade = { id: number; nome: string }

/**
 * O pacote como o CAIXA o nomeia: o da agenda mais QUEM atende e por qual convênio.
 * `TratamentoDaLista` (a listagem de `/tratamentos`) já tem essa forma.
 */
type TratamentoDoPagamento = TratamentoDaSelecao & { profissional_id: number; convenio_id: number }

/**
 * Os catálogos que dão nome ao pacote do pagamento. Cada um chega sob a SUA permissão, e o que
 * não chegou fica vazio: a parte do rótulo que dependia dele sai, nunca vira um nome inventado.
 */
export interface NomesDoTratamento {
  especialidades: readonly NomeDeEspecialidade[]
  profissionais: readonly NomeDeEspecialidade[]
  convenios: readonly NomeDeEspecialidade[]
}

/**
 * O rótulo BASE de um pacote: especialidade, saldo e situação — nesta ordem.
 *
 * A especialidade vem PRIMEIRO porque é o que a clínica lê para decidir. A lista mostrava só o
 * código interno e o saldo, e havia criança com três pacotes iguais assim — pedido de 2026-09-09:
 * "fica horrível de identificar qual especialidade o paciente vai fazer".
 *
 * O nome sai do catálogo que a tela já carregou (design D1). Sem catálogo — ou com a especialidade
 * fora dele —, cai para o identificador interno: é o rótulo de ANTES desta change, nunca um rótulo
 * sem nome.
 */
function baseDoRotulo(
  tratamento: TratamentoDaSelecao,
  especialidades: readonly NomeDeEspecialidade[],
  nomesDoMeio: ReadonlyArray<string | undefined> = [],
): string {
  const nome = especialidades.find((item) => item.id === tratamento.especialidade_id)?.nome
  /*
   * REALIZADAS/total, como o resto do produto — e NÃO saldo/total, como este campo dizia.
   *
   * "1/10 sessões" aparece no card da grade, no painel do agendamento e no cartão do pacote na
   * ficha da criança, e nos três significa UMA sessão FEITA de dez. Só aqui significava uma
   * RESTANDO de dez: mesmo desenho, leitura invertida, na mesma tela do card. Enquanto o rótulo
   * começava por `#140` isso passava; posto o nome da especialidade na frente, a recepção lê os
   * dois números lado a lado. O saldo continua dito por extenso onde é decisão ("Faltam N
   * sessões", no painel e na ficha).
   *
   * `sessoes_realizadas` não vem na rota de seleção (whitelist mínima): é derivado do par que vem.
   */
  const realizadas = tratamento.sessoes_total - tratamento.sessoes_saldo
  const partes = [
    nome ?? `#${String(tratamento.id)}`,
    // profissional e convênio, no rótulo do caixa; o nome que não chegou sai, não vira código
    ...nomesDoMeio.filter((parte): parte is string => parte !== undefined),
    `${String(realizadas)}/${String(tratamento.sessoes_total)} sessões`,
  ]
  if (tratamento.vencido) {
    partes.push('vencido')
  }
  // `parado`/`finalizado` são as palavras do próprio cadastro de tratamentos
  if (tratamento.status !== 'andamento') {
    partes.push(tratamento.status)
  }
  return partes.join(' · ')
}

/**
 * O rótulo do pacote na lista do formulário, com o identificador interno SÓ como desempate.
 *
 * Com a guia mensal do convênio, pacote repetido da mesma especialidade é rotina — e duas opções
 * com o mesmo texto são pior do que o código que a clínica pediu para tirar (design D4).
 *
 * O desempate olha a lista INTEIRA do paciente, não a recortada por especialidade: quem empata
 * continua empatando depois de qualquer filtro, e o rótulo de um pacote não pode mudar conforme o
 * campo ao lado.
 */
export function rotuloDoTratamento(
  tratamento: TratamentoDaSelecao,
  especialidades: readonly NomeDeEspecialidade[],
  todos: readonly TratamentoDaSelecao[],
): string {
  return comDesempate(tratamento, todos, (item) => baseDoRotulo(item, especialidades))
}

/**
 * O rótulo do pacote no LANÇAMENTO DE CAIXA: especialidade · profissional · convênio · saldo.
 *
 * O caixa pergunta outra coisa que a agenda. Lá a especialidade já foi escolhida no campo ao
 * lado; aqui a pergunta é "de quem é este dinheiro", e é pelo tratamento escolhido que o
 * pagamento chega ao profissional em "Recebido por profissional" (change
 * `recebido-por-profissional`). A mesma criança costuma ter a mesma especialidade com duas
 * terapeutas, ou por dois convênios.
 */
export function rotuloDoTratamentoDoPagamento(
  tratamento: TratamentoDoPagamento,
  nomes: NomesDoTratamento,
  todos: readonly TratamentoDoPagamento[],
): string {
  return comDesempate(tratamento, todos, (item) =>
    baseDoRotulo(item, nomes.especialidades, [
      nomes.profissionais.find((profissional) => profissional.id === item.profissional_id)?.nome,
      nomes.convenios.find((convenio) => convenio.id === item.convenio_id)?.nome,
    ]),
  )
}

/** O identificador interno SÓ quando outro pacote da lista ficaria com o mesmo texto (design D4). */
function comDesempate<Tratamento extends { id: number }>(
  tratamento: Tratamento,
  todos: readonly Tratamento[],
  base: (item: Tratamento) => string,
): string {
  const rotulo = base(tratamento)
  const empatado = todos.some((outro) => outro.id !== tratamento.id && base(outro) === rotulo)
  return empatado ? `${rotulo} · #${String(tratamento.id)}` : rotulo
}
