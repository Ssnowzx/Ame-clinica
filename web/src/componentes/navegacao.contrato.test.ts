import { describe, expect, it } from 'vitest'

import { ITENS_DE_NAVEGACAO } from '@/componentes/navegacao'

/**
 * GUARDA DE CONTRATO — **destino aberto é decisão, nunca esquecimento**.
 *
 * `ItemDeNavegacao.permissao` é opcional desde a change `manual-do-operador`: o Manual não
 * exige permissão porque não há dado da clínica para autorizar (a tela não faz uma única
 * chamada de API). O preço de tornar o campo opcional é que ESQUECER de preenchê-lo passa a
 * compilar — e um item novo sem permissão publicaria um destino aberto sem que ninguém
 * percebesse na revisão.
 *
 * Esta guarda fixa a lista EXATA de rotas que podem nascer sem permissão. Ela não julga se a
 * decisão é boa; ela obriga a decisão a ser TOMADA, e a aparecer no diff.
 *
 * O que ela NÃO cobre: a autorização de verdade, que é do servidor. Item de menu é experiência
 * — quem digitar a URL de uma rota protegida continua batendo no guard e no 403.
 */
const ROTAS_SEM_PERMISSAO = ['/manual']

describe('Navegação — contrato dos destinos abertos', () => {
  it('deve manter sem permissão exatamente as rotas declaradas', () => {
    // ARRANGE + ACT
    const abertas = ITENS_DE_NAVEGACAO.filter((item) => item.permissao === undefined).map(
      (item) => item.rota,
    )

    // ASSERT: lista EXATA — item novo sem permissão reprova aqui até virar decisão explícita
    expect(abertas).toEqual(ROTAS_SEM_PERMISSAO)
  })

  it('deve exigir permissão em todo destino que lê dado da clínica', () => {
    // ARRANGE + ACT
    const semPermissao = ITENS_DE_NAVEGACAO.filter(
      (item) => item.permissao === undefined && !ROTAS_SEM_PERMISSAO.includes(item.rota),
    )

    // ASSERT
    expect(semPermissao).toEqual([])
  })

  it('deve dar um grupo a todo destino de operação — a barra os desenha por grupo', () => {
    // ARRANGE + ACT
    const semGrupo = ITENS_DE_NAVEGACAO.filter((item) => item.secao !== 'sistema' && item.grupo === undefined)

    // ASSERT: item sem grupo não aparece em grupo nenhum — sumiria da barra em silêncio
    expect(semGrupo.map((item) => item.rotulo)).toEqual([])
  })

  it('deve manter o Manual acima de Configurações no rodapé de sistema', () => {
    // ARRANGE + ACT: a ordem do array é a ordem da tela — o manual vem antes do que ele explica
    const sistema = ITENS_DE_NAVEGACAO.filter((item) => item.secao === 'sistema').map(
      (item) => item.rotulo,
    )

    // ASSERT
    expect(sistema).toEqual(['Manual', 'Configurações'])
  })
})
