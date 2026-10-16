import { describe, expect, it } from 'vitest'

import { opcoesDeProfissional } from '@/lib/profissionais'
import type { Profissional } from '@/tipos'

function profissional(sobrescritas: Partial<Profissional> = {}): Profissional {
  return {
    id: 1,
    nome: 'Profissional Fictício',
    conselho: null,
    uf_conselho: null,
    num_conselho: null,
    cbos_id: null,
    horarios: {},
    obs: null,
    ativo: true,
    ...sobrescritas,
  } as Profissional
}

describe('opcoesDeProfissional — o desligado só aparece onde ele JÁ está vinculado', () => {
  it('deve OMITIR o desligado quando ele não é o vinculado ao registro', () => {
    // ARRANGE — `GET /profissionais` é o CADASTRO e devolve os desligados. Sem filtro, a
    // fonoaudióloga que saiu aparecia como opção para QUALQUER sessão: assinaria, em julho, o
    // prontuário de uma criança que nunca viu. (A regra de verdade está no servidor — isto aqui
    // é a conveniência da tela.)
    const lista = [profissional({ id: 1 }), profissional({ id: 2, nome: 'Saiu da Clínica', ativo: false })]

    // ACT
    const opcoes = opcoesDeProfissional(lista, null)

    // ASSERT
    expect(opcoes.map((opcao) => opcao.valor)).toEqual(['1'])
  })

  it('deve MANTER o desligado quando é ELE o vinculado ao registro', () => {
    // ARRANGE — a autoria diz a VERDADE: quem atendeu a sessão foi ela, e fazer outra pessoa
    // assinar seria FALSIFICAR o prontuário. Idem no pacote antigo: sumir com a opção faria o
    // select cair no vazio, e salvar gravaria o vazio — o vínculo some em silêncio.
    const lista = [profissional({ id: 1 }), profissional({ id: 2, nome: 'Saiu da Clínica', ativo: false })]

    // ACT
    const opcoes = opcoesDeProfissional(lista, 2)

    // ASSERT — está lá, e a tela DIZ que ele saiu
    expect(opcoes.map((opcao) => opcao.valor)).toEqual(['1', '2'])
    expect(opcoes[1].rotulo).toBe('Saiu da Clínica (desligado)')
  })
})
