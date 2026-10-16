/**
 * O breakpoint de REFLUXO, declarado UMA vez (change agenda-no-celular, D1).
 *
 * Abaixo dele a navegação vira gaveta e a Visão Geral da agenda vira lista; acima, coluna e
 * grade. Dois lugares leem este valor — o shell e a agenda —, e é por isso que ele mora aqui:
 * dois literais `768` espalhados divergem no dia em que alguém mexer num só, e o defeito
 * resultante (barra já é gaveta, grade ainda é tabela) é invisível em teste unitário.
 *
 * **768px** é o corte que separa telefone (390–430) e telefone deitado (~740) de tablet em pé
 * (768+). O tablet em pé cabe na grade com duas ou três colunas, que é utilizável; o telefone
 * deitado, não.
 *
 * O valor é o mesmo do `md` do Tailwind de propósito: o CSS usa `md:`, o JS usa esta constante,
 * e os dois falam do mesmo pixel.
 */
export const LARGURA_DE_REFLUXO = 768

/** A media query correspondente, para quem precisa decidir em JS o que o CSS não alcança. */
export const TELA_ESTREITA = `(max-width: ${LARGURA_DE_REFLUXO - 1}px)`

/**
 * A largura a partir da qual os painéis da agenda ficam LADO A LADO (`xl` do Tailwind).
 *
 * Abaixo dela a página EMPILHA — lista de profissionais em cima, grade embaixo — e é uma
 * decisão diferente da de `LARGURA_DE_REFLUXO`: ali a agenda troca de árvore (tabela → lista);
 * aqui ela continua sendo a mesma grade, só que numa coluna só.
 *
 * A faixa entre os dois (768–1279) foi a que ninguém olhou, e ela cobrou duas vezes: primeiro a
 * agenda **sumiu** (a lista de profissionais crescia sem teto e empurrava a grade 3,6 telas
 * abaixo da dobra — achado do usuário, por print); depois, com o teto, a grade voltou como uma
 * **tira de 5 slots** (244–284px medidos pelo gate em 1024×768 e 1177×757). Duas larguras, duas
 * decisões, e a faixa entre elas é onde os defeitos moram.
 */
export const LARGURA_DE_COLUNAS = 1280

/** A media query correspondente — a página está empilhada. */
export const TELA_EMPILHADA = `(max-width: ${LARGURA_DE_COLUNAS - 1}px)`

/**
 * O `lg` do Tailwind (1024px). Abaixo dele a página de Mensagens é mestre-detalhe, e o toast sobe
 * para o TOPO da tela e mostra só o MAIS RECENTE (change conversa-legivel): dois toasts empilhados
 * no alto de um celular cobriam o cabeçalho inteiro.
 *
 * O CSS usa `max-lg:`; o JS usa esta constante — os dois falam do mesmo pixel.
 */
export const LARGURA_LG = 1024

/** A media query correspondente — a tela está abaixo do `lg`. */
export const TELA_ABAIXO_DE_LG = `(max-width: ${LARGURA_LG - 1}px)`
