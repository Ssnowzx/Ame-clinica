import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Suspense, type ComponentType } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BarreiraDeErro } from '@/componentes/barreira-de-erro'
import { JANELA_DA_RECARGA_MS, marcarRecargaPorVersaoNova } from '@/lib/preferencias-locais'
import { instalarRecargaPorVersaoNova, paginaSobDemanda, type Recarga } from '@/lib/versao-nova'

/** Um relógio parado e uma recarga que só anota — o jsdom não navega. */
function recargaFalsa(agora = 1_000_000): Recarga & { vezes: () => number } {
  const recarregar = vi.fn()

  return { recarregar, agora: () => agora, vezes: () => recarregar.mock.calls.length }
}

/** O import de uma versão VELHA: o arquivo não existe mais no servidor (404). */
function importDaVersaoVelha(): Promise<{ PaginaDeTeste: ComponentType }> {
  return Promise.reject(new TypeError('Failed to fetch dynamically imported module: /assets/pagina-velha.js'))
}

function renderizarSobDemanda(recarga: Recarga, recarregarDaBarreira = vi.fn()) {
  const Pagina = paginaSobDemanda(importDaVersaoVelha, 'PaginaDeTeste', recarga)
  render(
    <BarreiraDeErro recarregar={recarregarDaBarreira}>
      <Suspense fallback={<p>Carregando a tela</p>}>
        <Pagina />
      </Suspense>
    </BarreiraDeErro>,
  )

  return { recarregarDaBarreira }
}

beforeEach(() => {
  window.sessionStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('versão nova publicada com a página aberta (PERF-12)', () => {
  it('deve recarregar a página UMA vez quando o código da tela não vem, sem pintar o erro', async () => {
    // ARRANGE
    const recarga = recargaFalsa()

    // ACT
    renderizarSobDemanda(recarga)

    // ASSERT — a recarga sai, e a tela segura o carregando até a página ir embora
    await vi.waitFor(() => expect(recarga.vezes()).toBe(1))
    expect(screen.getByText('Carregando a tela')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('não deve recarregar de novo se a página acabou de recarregar — e a barreira oferece recarregar', async () => {
    // ARRANGE — a recarga desta janela já aconteceu: o código continua não vindo (rede, servidor)
    const recarga = recargaFalsa()
    marcarRecargaPorVersaoNova(recarga.agora() - 1_000)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    // ACT
    const { recarregarDaBarreira } = renderizarSobDemanda(recarga)

    // ASSERT — nada de laço: nenhuma recarga automática, e a mensagem diz o que houve
    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent('O sistema foi atualizado enquanto esta tela estava aberta.')
    expect(recarga.vezes()).toBe(0)

    // ACT — "Tentar novamente" recarrega (remontar repetiria o import rejeitado)
    await userEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))

    // ASSERT
    expect(recarregarDaBarreira).toHaveBeenCalledTimes(1)
  })

  it('deve recarregar outra vez numa falha nova depois da janela', () => {
    // ARRANGE — uma recarga antiga, de outro redeploy
    const agora = 5_000_000
    marcarRecargaPorVersaoNova(agora - JANELA_DA_RECARGA_MS - 1)

    // ACT + ASSERT
    expect(marcarRecargaPorVersaoNova(agora)).toBe(true)
    expect(marcarRecargaPorVersaoNova(agora + 1)).toBe(false)
  })

  it('não deve recarregar quando o armazenamento recusa — sem memória não há guarda contra laço', () => {
    // ARRANGE — modo privativo, cota estourada
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('armazenamento bloqueado')
    })

    // ACT + ASSERT
    expect(marcarRecargaPorVersaoNova()).toBe(false)
  })

  it('deve atender o vite:preloadError cancelando o erro e recarregando uma vez só', () => {
    // ARRANGE
    const recarga = recargaFalsa()
    const desligar = instalarRecargaPorVersaoNova(window, recarga)

    // ACT — duas falhas seguidas (o pré-carregamento e o import da mesma tela)
    const primeiro = new Event('vite:preloadError', { cancelable: true })
    const segundo = new Event('vite:preloadError', { cancelable: true })
    window.dispatchEvent(primeiro)
    window.dispatchEvent(segundo)
    desligar()

    // ASSERT — a primeira recarrega e cancela o erro; a segunda não vira laço e deixa o erro seguir
    expect(recarga.vezes()).toBe(1)
    expect(primeiro.defaultPrevented).toBe(true)
    expect(segundo.defaultPrevented).toBe(false)
  })

  it('deve segurar a tela quando o build devolve vazio porque o evento foi cancelado', async () => {
    // ARRANGE — o pré-carregamento do build resolve VAZIO depois do `preventDefault`
    const recarga = recargaFalsa()
    const vazio = (): Promise<{ PaginaDeTeste: ComponentType } | undefined> => Promise.resolve(undefined)
    const Pagina = paginaSobDemanda(vazio, 'PaginaDeTeste', recarga)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    // ACT
    render(
      <BarreiraDeErro recarregar={vi.fn()}>
        <Suspense fallback={<p>Carregando a tela</p>}>
          <Pagina />
        </Suspense>
      </BarreiraDeErro>,
    )
    // o React segura a troca do "carregando" pelo conteúdo por até 300 ms: espera passar disso, ou um
    // erro que viesse logo depois não seria visto (a mutação "módulo vazio vira erro" sobrevivia a 50 ms)
    await new Promise((resolver) => setTimeout(resolver, 700))

    // ASSERT — nada de "Algo deu errado": a página já está indo embora
    expect(screen.getByText('Carregando a tela')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
