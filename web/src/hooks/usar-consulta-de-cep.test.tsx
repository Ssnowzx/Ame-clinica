import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ResultadoDoCep } from '@/servicos/cep'

import { usarConsultaDeCep } from '@/hooks/usar-consulta-de-cep'
import { consultarCep } from '@/servicos/cep'

vi.mock('@/servicos/cep', () => ({ consultarCep: vi.fn() }))

const ENDERECO = {
  logradouro: 'Rua Fictícia das Acácias',
  bairro: 'Centro Fictício',
  cidade: 'Lages',
  uf: 'SC',
}

/** Uma consulta que só responde quando o teste mandar — é assim que a corrida se encena. */
function pendente() {
  let resolver!: (resultado: ResultadoDoCep) => void
  const promessa = new Promise<ResultadoDoCep>((resolve) => {
    resolver = resolve
  })
  return { promessa, resolver }
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.mocked(consultarCep).mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('usarConsultaDeCep', () => {
  it('deve manter a API IMPERATIVA — montar não é gatilho de nada', async () => {
    /*
     * ARRANGE — este teste guarda a SUPERFÍCIE do hook, não o comportamento da tela, e a
     * redação anterior mentia sobre isso.
     *
     * Ele dizia provar "abrir a ficha de uma criança não reescreve o endereço dela" montando
     * o hook e vendo que nada disparou. Mas o hook não recebe valor de CEP: montar sem valor
     * e afirmar que nada saiu é a assinatura da função, não o comportamento. O code review
     * provou o buraco plantando o `useEffect` proibido na SEÇÃO e vendo os 1741 testes da casa
     * passarem.
     *
     * A invariante de verdade está em `paginas/cep-no-cadastro.test.tsx` ("Abrir ficha gravada
     * NÃO consulta o CEP"), que monta a ficha gravada e vigia o terceiro — e que mata aquela
     * mutação. O que sobra aqui é útil e modesto: se alguém acrescentar um efeito DENTRO do
     * hook, este teste cai.
     */
    const aoPreencher = vi.fn()

    // ACT
    renderHook(() => usarConsultaDeCep({ aoPreencher }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })

    // ASSERT
    expect(consultarCep).not.toHaveBeenCalled()
    expect(aoPreencher).not.toHaveBeenCalled()
  })

  it('deve consultar e preencher quando a pessoa completa o CEP', async () => {
    // ARRANGE
    vi.mocked(consultarCep).mockResolvedValue({ tipo: 'encontrado', endereco: ENDERECO })
    const aoPreencher = vi.fn()
    const { result } = renderHook(() => usarConsultaDeCep({ aoPreencher }))

    // ACT
    act(() => {
      result.current.aoDigitarCep('88501050')
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })

    // ASSERT
    await waitFor(() => {
      expect(aoPreencher).toHaveBeenCalledWith(ENDERECO)
    })
    expect(result.current.estado).toBe('preenchido')
  })

  it('NÃO deve consultar com o CEP incompleto', async () => {
    // ARRANGE
    const { result } = renderHook(() => usarConsultaDeCep({ aoPreencher: vi.fn() }))

    // ACT
    act(() => {
      result.current.aoDigitarCep('885010')
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })

    // ASSERT
    expect(consultarCep).not.toHaveBeenCalled()
    expect(result.current.estado).toBe('ocioso')
  })

  it('deve escrever SÓ os quatro campos do CEP — nunca número nem complemento', async () => {
    // ARRANGE — número e complemento são o que só quem mora ali sabe, e o que a consulta
    // não é capaz de repor se apagar
    vi.mocked(consultarCep).mockResolvedValue({ tipo: 'encontrado', endereco: ENDERECO })
    const aoPreencher = vi.fn()
    const { result } = renderHook(() => usarConsultaDeCep({ aoPreencher }))

    // ACT
    act(() => {
      result.current.aoDigitarCep('88501050')
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })

    // ASSERT
    await waitFor(() => {
      expect(aoPreencher).toHaveBeenCalled()
    })
    expect(Object.keys(vi.mocked(aoPreencher).mock.calls[0][0] as object).sort()).toEqual([
      'bairro',
      'cidade',
      'logradouro',
      'uf',
    ])
  })

  it('deve descartar a resposta ATRASADA de um CEP já superado', async () => {
    // ARRANGE — digitar um CEP, ver o erro e digitar outro é o caso normal, e a rede não
    // promete ordem de chegada. Sem a guarda, o endereço da criança fica sendo o do CEP
    // errado, em silêncio.
    const primeira = pendente()
    const segunda = pendente()
    vi.mocked(consultarCep)
      .mockReturnValueOnce(primeira.promessa)
      .mockReturnValueOnce(segunda.promessa)

    const aoPreencher = vi.fn()
    const { result } = renderHook(() => usarConsultaDeCep({ aoPreencher }))

    // ACT — CEP A, depois CEP B; B responde primeiro e A responde por último
    act(() => {
      result.current.aoDigitarCep('88501050')
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })
    act(() => {
      result.current.aoDigitarCep('01001000')
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })

    await act(async () => {
      segunda.resolver({ tipo: 'encontrado', endereco: { ...ENDERECO, cidade: 'São Paulo', uf: 'SP' } })
      primeira.resolver({ tipo: 'encontrado', endereco: ENDERECO })
      await vi.advanceTimersByTimeAsync(0)
    })

    // ASSERT — o endereço final é o do SEGUNDO CEP, e o primeiro não escreveu nada
    await waitFor(() => {
      expect(aoPreencher).toHaveBeenCalledTimes(1)
    })
    expect(aoPreencher).toHaveBeenCalledWith(expect.objectContaining({ cidade: 'São Paulo', uf: 'SP' }))
  })

  it('deve respeitar a régua: campo escondido pela clínica não é preenchido', async () => {
    // ARRANGE — a clínica que não usa bairro não o recebe da consulta
    vi.mocked(consultarCep).mockResolvedValue({ tipo: 'encontrado', endereco: ENDERECO })
    const aoPreencher = vi.fn()
    const { result } = renderHook(() =>
      usarConsultaDeCep({ aoPreencher, campoVisivel: (campo) => campo !== 'endereco_bairro' }),
    )

    // ACT
    act(() => {
      result.current.aoDigitarCep('88501050')
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })

    // ASSERT
    await waitFor(() => {
      expect(aoPreencher).toHaveBeenCalled()
    })
    expect(vi.mocked(aoPreencher).mock.calls[0][0]).not.toHaveProperty('bairro')
    expect(vi.mocked(aoPreencher).mock.calls[0][0]).toHaveProperty('cidade', 'Lages')
  })

  it('NÃO deve alterar campo nenhum quando o CEP não existe', async () => {
    // ARRANGE
    vi.mocked(consultarCep).mockResolvedValue({ tipo: 'nao_encontrado' })
    const aoPreencher = vi.fn()
    const { result } = renderHook(() => usarConsultaDeCep({ aoPreencher }))

    // ACT
    act(() => {
      result.current.aoDigitarCep('99999999')
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })

    // ASSERT
    await waitFor(() => {
      expect(result.current.estado).toBe('nao_encontrado')
    })
    expect(aoPreencher).not.toHaveBeenCalled()
    expect(result.current.mensagem).toContain('preencha o endereço à mão')
  })

  it('NÃO deve alterar campo nenhum quando o serviço está fora do ar', async () => {
    // ARRANGE — a clínica não pode parar de atender porque um terceiro caiu
    vi.mocked(consultarCep).mockResolvedValue({ tipo: 'indisponivel' })
    const aoPreencher = vi.fn()
    const { result } = renderHook(() => usarConsultaDeCep({ aoPreencher }))

    // ACT
    act(() => {
      result.current.aoDigitarCep('88501050')
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })

    // ASSERT
    await waitFor(() => {
      expect(result.current.estado).toBe('indisponivel')
    })
    expect(aoPreencher).not.toHaveBeenCalled()
    expect(result.current.mensagem).toContain('o cadastro salva igual')
  })

  it('NÃO deve mandar informar o número quando o Número não está na tela', async () => {
    /*
     * ARRANGE — achado do passe de navegador (04/09/2026): o formulário público desta clínica
     * publica CEP e Logradouro e NÃO publica o Número, e o anúncio mandava a família preencher
     * um campo que não existe ali. Instrução que aponta para o nada é pior que instrução
     * nenhuma: quem lê procura, não acha, e conclui que a tela está quebrada.
     */
    vi.mocked(consultarCep).mockResolvedValue({ tipo: 'encontrado', endereco: ENDERECO })
    const { result } = renderHook(() =>
      usarConsultaDeCep({ aoPreencher: vi.fn(), campoVisivel: (campo) => campo !== 'endereco_numero' }),
    )

    // ACT
    act(() => {
      result.current.aoDigitarCep('88501050')
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })

    // ASSERT
    await waitFor(() => {
      expect(result.current.estado).toBe('preenchido')
    })
    expect(result.current.mensagem).not.toContain('número')
    expect(result.current.mensagem).toContain('preenchidos pelo CEP')
  })

  it('deve mandar informar o número quando o Número ESTÁ na tela', async () => {
    // ARRANGE — o outro lado do mesmo achado: onde o campo existe, a instrução continua
    vi.mocked(consultarCep).mockResolvedValue({ tipo: 'encontrado', endereco: ENDERECO })
    const { result } = renderHook(() => usarConsultaDeCep({ aoPreencher: vi.fn() }))

    // ACT
    act(() => {
      result.current.aoDigitarCep('88501050')
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })

    // ASSERT
    await waitFor(() => {
      expect(result.current.estado).toBe('preenchido')
    })
    expect(result.current.mensagem).toContain('Informe o número')
  })

  it('deve NOMEAR na frase os campos que mudaram', async () => {
    // ARRANGE — achado A11Y-CEP-03: "Endereço preenchido" não diz o que mudou, e quem usa
    // leitor de tela tinha de TABULAR pelos campos para descobrir — o trabalho que a change
    // queria poupar
    vi.mocked(consultarCep).mockResolvedValue({ tipo: 'encontrado', endereco: ENDERECO })
    const { result } = renderHook(() => usarConsultaDeCep({ aoPreencher: vi.fn() }))

    // ACT
    act(() => {
      result.current.aoDigitarCep('88501050')
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })

    // ASSERT
    await waitFor(() => {
      expect(result.current.estado).toBe('preenchido')
    })
    expect(result.current.mensagem).toBe(
      'Logradouro, bairro, cidade e UF preenchidos pelo CEP. Informe o número.',
    )
  })

  it('NÃO deve prometer no plural o que preencheu no singular', async () => {
    // ARRANGE — a borda pública desta clínica publica só o Logradouro: "campos" no plural
    // para um campo só (achado A11Y-CEP-03)
    vi.mocked(consultarCep).mockResolvedValue({ tipo: 'encontrado', endereco: ENDERECO })
    const { result } = renderHook(() =>
      usarConsultaDeCep({ aoPreencher: vi.fn(), campoVisivel: (campo) => campo === 'endereco_logradouro' }),
    )

    // ACT
    act(() => {
      result.current.aoDigitarCep('88501050')
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })

    // ASSERT
    await waitFor(() => {
      expect(result.current.estado).toBe('preenchido')
    })
    expect(result.current.mensagem).toBe('Logradouro preenchido pelo CEP. Confira.')
  })

  it('NÃO deve apagar o que a pessoa digitou quando o CEP é geral de cidade', async () => {
    /*
     * ARRANGE — achado A11Y-CEP-01 agravante C, o de PERDA DE DADO.
     *
     * CEP geral de cidade (comum em cidade pequena) volta com logradouro e bairro em branco.
     * A regra "o CEP substitui os quatro" apagava a rua e o bairro que a recepção tinha
     * acabado de digitar, e o anúncio ainda dizia "endereço preenchido". A ficha salvava com
     * endereço em branco e ninguém era avisado.
     */
    vi.mocked(consultarCep).mockResolvedValue({
      tipo: 'encontrado',
      endereco: { logradouro: '', bairro: '', cidade: 'Porto Seguro', uf: 'BA' },
    })
    const aoPreencher = vi.fn()
    const { result } = renderHook(() => usarConsultaDeCep({ aoPreencher }))

    // ACT
    act(() => {
      result.current.aoDigitarCep('45810000')
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })

    // ASSERT — só o que o CEP respondeu é escrito; o resto fica com quem mora lá
    await waitFor(() => {
      expect(aoPreencher).toHaveBeenCalled()
    })
    expect(vi.mocked(aoPreencher).mock.calls[0][0]).toEqual({ cidade: 'Porto Seguro', uf: 'BA' })
    expect(result.current.mensagem).toBe('Cidade e UF preenchidos pelo CEP. Informe o número.')
  })

  it('NÃO deve deixar a rua do CEP ANTERIOR colada na cidade nova', async () => {
    /*
     * ARRANGE — achado IMPORTANTE 3 da rodada 2, o espelho da perda de dado.
     *
     * CEP de rua em Lages, depois CEP geral de Porto Seguro: a guarda "vazio não sobrescreve"
     * deixava "Rua Fictícia das Acácias / Centro Fictício" colados em "Porto Seguro / BA" —
     * um endereço que não existe, com a tela parecendo completa.
     *
     * A distinção é a origem: o que a CONSULTA escreveu se limpa; o que a PESSOA digitou não.
     */
    vi.mocked(consultarCep)
      .mockResolvedValueOnce({ tipo: 'encontrado', endereco: ENDERECO })
      .mockResolvedValueOnce({
        tipo: 'encontrado',
        endereco: { logradouro: '', bairro: '', cidade: 'Porto Seguro', uf: 'BA' },
      })
    const aoPreencher = vi.fn()
    const { result } = renderHook(() => usarConsultaDeCep({ aoPreencher }))

    // ACT — o primeiro CEP escreve os quatro; o segundo só responde cidade e UF
    act(() => {
      result.current.aoDigitarCep('88501050')
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })
    await waitFor(() => {
      expect(aoPreencher).toHaveBeenCalledTimes(1)
    })

    act(() => {
      result.current.aoDigitarCep('45810000')
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })

    // ASSERT — a rua e o bairro do CEP velho SAEM
    await waitFor(() => {
      expect(aoPreencher).toHaveBeenCalledTimes(2)
    })
    expect(vi.mocked(aoPreencher).mock.calls[1][0]).toEqual({
      cidade: 'Porto Seguro',
      uf: 'BA',
      logradouro: '',
      bairro: '',
    })
  })

  it('deve preservar o que a PESSOA digitou quando o CEP não o responde', async () => {
    // ARRANGE — o outro lado: sem consulta anterior, nada foi escrito pela consulta, então
    // nada é limpo — o que está na tela é da pessoa
    vi.mocked(consultarCep).mockResolvedValue({
      tipo: 'encontrado',
      endereco: { logradouro: '', bairro: '', cidade: 'Porto Seguro', uf: 'BA' },
    })
    const aoPreencher = vi.fn()
    const { result } = renderHook(() => usarConsultaDeCep({ aoPreencher }))

    // ACT
    act(() => {
      result.current.aoDigitarCep('45810000')
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })

    // ASSERT — nenhuma chave de logradouro/bairro no payload: eles nem são tocados
    await waitFor(() => {
      expect(aoPreencher).toHaveBeenCalled()
    })
    expect(vi.mocked(aoPreencher).mock.calls[0][0]).toEqual({ cidade: 'Porto Seguro', uf: 'BA' })
  })

  it('deve levar o foco para o Número depois de preencher', async () => {
    // ARRANGE — o Número é o único campo do endereço que consulta nenhuma responde.
    // O CEP precisa estar COM FOCO, que é o que acontece quando uma pessoa digita: a guarda
    // exige que o disparo tenha vindo de um campo, e não do `body` (achado A11Y-CEP-11).
    vi.mocked(consultarCep).mockResolvedValue({ tipo: 'encontrado', endereco: ENDERECO })
    const cep = document.createElement('input')
    const numero = document.createElement('input')
    document.body.append(cep, numero)
    cep.focus()
    const { result } = renderHook(() =>
      usarConsultaDeCep({ aoPreencher: vi.fn(), refDoNumero: { current: numero } }),
    )

    // ACT
    act(() => {
      result.current.aoDigitarCep('88501050')
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })

    // ASSERT
    await waitFor(() => {
      expect(document.activeElement).toBe(numero)
    })
    cep.remove()
    numero.remove()
  })

  it('NÃO deve mover o foco quando o CEP foi preenchido SEM foco (autofill)', async () => {
    /*
     * ARRANGE — achado A11Y-CEP-11. Preenchimento automático do navegador escreve no campo
     * sem focá-lo: `document.activeElement` é `body` antes e depois, a igualdade passava, e o
     * foco pulava para o Número sem ninguém ter tocado no formulário — num caminho em que a
     * pessoa nunca focou o CEP e portanto nunca leu o aviso que torna o movimento conforme.
     */
    vi.mocked(consultarCep).mockResolvedValue({ tipo: 'encontrado', endereco: ENDERECO })
    const numero = document.createElement('input')
    document.body.append(numero)
    const { result } = renderHook(() =>
      usarConsultaDeCep({ aoPreencher: vi.fn(), refDoNumero: { current: numero } }),
    )

    // ACT — ninguém focou nada
    act(() => {
      result.current.aoDigitarCep('88501050')
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })

    // ASSERT
    await waitFor(() => {
      expect(result.current.estado).toBe('preenchido')
    })
    expect(document.activeElement).not.toBe(numero)
    numero.remove()
  })

  it('deve consultar UMA vez quando dois CEPs COMPLETOS entram dentro da janela', async () => {
    /*
     * ARRANGE — a versão anterior deste teste não media debounce nenhum (achado do code
     * review): ela mandava `'8850105'`, com 7 dígitos, que nunca agenda coisa alguma. O que
     * ela media era a guarda de `cepCompleto`, já coberta pelo teste acima — e trocar o
     * `setTimeout` por execução imediata a deixava passar.
     *
     * Dois valores COMPLETOS dentro dos 400 ms: só o segundo pode ir à rede.
     */
    vi.mocked(consultarCep).mockResolvedValue({ tipo: 'encontrado', endereco: ENDERECO })
    const { result } = renderHook(() => usarConsultaDeCep({ aoPreencher: vi.fn() }))

    // ACT
    act(() => {
      result.current.aoDigitarCep('88501050')
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200) // ainda dentro da janela
    })
    act(() => {
      result.current.aoDigitarCep('01001000')
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })

    // ASSERT — uma consulta só, e do SEGUNDO CEP
    await waitFor(() => {
      expect(consultarCep).toHaveBeenCalledTimes(1)
    })
    expect(vi.mocked(consultarCep).mock.calls[0][0]).toBe('01001000')
  })

  it('NÃO deve consultar quando a clínica esconde TODOS os campos de destino', async () => {
    // ARRANGE — minimização (parecer SEC-CEP-05): sem campo para receber a resposta, mandar
    // o CEP da criança ao terceiro é coleta sem finalidade
    const { result } = renderHook(() =>
      usarConsultaDeCep({ aoPreencher: vi.fn(), campoVisivel: () => false }),
    )

    // ACT
    act(() => {
      result.current.aoDigitarCep('88501050')
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })

    // ASSERT
    expect(consultarCep).not.toHaveBeenCalled()
    expect(result.current.estado).toBe('ocioso')
  })
})
