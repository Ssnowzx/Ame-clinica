import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'

import { cartaoNaGrade } from '@/lib/cartao-na-grade'
import { chaves } from '@/lib/chaves-query'
import { cardFicticio, detalheFicticio } from '@/test/dados-agenda'

/**
 * Gate CR-EVO-R3-05: a finalização pela evolução troca a foto do painel pelo cartão que a GRADE acabou
 * de reler. Só a consulta ATIVA foi relida — a Semana deixada em cache ao ir para o Dia é velha, e o
 * detalhe mora sob o mesmo prefixo sem ser cartão.
 */
describe('cartaoNaGrade', () => {
  it('deve devolver o cartão da grade ATIVA, e não o da inativa velha nem o detalhe', () => {
    // ARRANGE
    const queryClient = new QueryClient()
    const velho = cardFicticio({ id: 7, status_id: 1, updated_at: '2026-07-15T10:00:00.000000Z' })
    const novo = cardFicticio({ id: 7, status_id: 3, updated_at: '2026-07-15T11:00:00.000000Z' })
    const semana = chaves.agenda({ de: '2026-07-13', ate: '2026-07-19', visao: 'semana' })
    const dia = chaves.agenda({ de: '2026-07-15', ate: '2026-07-15', visao: 'dia' })
    queryClient.setQueryData(dia, [novo])
    queryClient.setQueryData(chaves.agendamentoDetalhe(7), detalheFicticio(novo))
    // a Semana, inativa e lida DEPOIS (o pior caso para quem ordena pelo horário da leitura)
    queryClient.setQueryData(semana, [velho])
    // a grade montada na tela: um observador HABILITADO (o desabilitado não conta como ativo); com
    // `staleTime` infinito ele não busca nada — o dado já está no cache
    const observador = new QueryObserver(queryClient, { queryKey: dia, queryFn: () => [novo], staleTime: Infinity })
    const desligar = observador.subscribe(() => undefined)

    // ACT
    const achado = cartaoNaGrade(queryClient, 7)
    desligar()

    // ASSERT
    expect(achado).toEqual(novo)
  })

  it('deve não devolver nada quando nenhuma grade ativa tem o cartão', () => {
    // ARRANGE — o painel fica com a foto (status velho, sem quebrar); as escritas releem antes de gravar
    const queryClient = new QueryClient()
    queryClient.setQueryData(chaves.agenda({ de: '2026-07-15', ate: '2026-07-15' }), [cardFicticio({ id: 7 })])

    // ACT
    const achado = cartaoNaGrade(queryClient, 7)

    // ASSERT
    expect(achado).toBeUndefined()
  })
})
