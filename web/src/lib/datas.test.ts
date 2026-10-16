import { afterEach, describe, expect, it, vi } from 'vitest'

import { hojeNaClinica, periodoEmPalavras, TIMEZONE_PADRAO } from '@/lib/datas'

/**
 * GUARDA DO FUSO — "a parede da clínica, nunca o relógio de quem abriu a tela".
 *
 * O defeito que esta guarda impede é banal e caro: alguém "simplifica" `hojeNaClinica()` para
 * `new Date().toISOString().slice(0, 10)` — o atalho mais natural do mundo. Em Brasília (UTC−3),
 * a partir das **21h** isso já devolve **o dia seguinte**: a agenda abre em amanhã, a recepção
 * marca a sessão no dia errado, e de manhã ninguém entende o que aconteceu. O mesmo vale para uma
 * máquina configurada com o fuso de outro país.
 *
 * O sinal aqui é HOSTIL de propósito: um instante em que o dia do NAVEGADOR e o dia da CLÍNICA são
 * diferentes. Se a função passar a olhar o relógio local, o teste fica vermelho.
 */
describe('hojeNaClinica — o dia é o da clínica, não o do navegador', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('deve devolver o dia da CLÍNICA quando o do navegador já virou', () => {
    // ARRANGE — 15/07 às 02:00 UTC. Em São Paulo (UTC−3) ainda é **14/07, 23:00**.
    // É a noite de trabalho de uma clínica brasileira: o defeito acontece TODO DIA, das 21h à
    // meia-noite, e some de manhã — o pior tipo de bug para diagnosticar.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-15T02:00:00Z'))

    // ACT
    const hoje = hojeNaClinica('America/Sao_Paulo')

    // ASSERT
    expect(hoje).toBe('2026-07-14')
    // ...e o atalho que a guarda existe para impedir daria o dia ERRADO:
    expect(new Date().toISOString().slice(0, 10)).toBe('2026-07-15')
  })

  it('deve respeitar o fuso de OUTRO país quando é ele o da clínica', () => {
    // ARRANGE — o fuso é DADO da clínica (§13), não uma constante do código: uma clínica em
    // Tóquio (UTC+9) às 02:00 UTC já está em 15/07.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-15T02:00:00Z'))

    // ACT + ASSERT
    expect(hojeNaClinica('Asia/Tokyo')).toBe('2026-07-15')
    expect(hojeNaClinica('America/Sao_Paulo')).toBe('2026-07-14')
  })

  it('deve cair no fuso padrão quando a configuração vem inválida', () => {
    // ARRANGE — `clinica.timezone` é editável. `Intl` LANÇA com valor inválido, e um throw em
    // render deixaria a agenda EM BRANCO para a clínica inteira (SEC-R2).
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-15T02:00:00Z'))

    // ACT + ASSERT — não explode, e cai na parede brasileira
    expect(hojeNaClinica('Fuso/Inexistente')).toBe(hojeNaClinica(TIMEZONE_PADRAO))
    expect(hojeNaClinica('Fuso/Inexistente')).toBe('2026-07-14')
  })
})

describe('periodoEmPalavras — o título diz o dia da semana que o campo de data não diz', () => {
  it('deve escrever um dia com o dia da semana por extenso', () => {
    // ARRANGE
    const dia = '2026-02-09'

    // ACT
    const texto = periodoEmPalavras(dia)

    // ASSERT
    expect(texto).toBe('segunda-feira, 9 de fevereiro de 2026')
  })

  it('deve escrever a semana como intervalo dentro do mês', () => {
    // ARRANGE + ACT
    const texto = periodoEmPalavras('2026-02-09', '2026-02-15')

    // ASSERT
    expect(texto).toBe('9 a 15 de fevereiro de 2026')
  })

  it('deve nomear os dois meses quando a semana cruza o mês', () => {
    // ARRANGE + ACT
    const texto = periodoEmPalavras('2026-01-26', '2026-02-01')

    // ASSERT
    expect(texto).toBe('26 de janeiro a 1º de fevereiro de 2026')
  })

  it('deve repetir o ano nas duas pontas quando a semana cruza o ano', () => {
    // ARRANGE + ACT
    const texto = periodoEmPalavras('2026-12-28', '2027-01-03')

    // ASSERT
    expect(texto).toBe('28 de dezembro de 2026 a 3 de janeiro de 2027')
  })

  it('deve devolver null para data fora do calendário', () => {
    // ARRANGE + ACT + ASSERT
    expect(periodoEmPalavras('2026-02-30')).toBeNull()
    expect(periodoEmPalavras('banana')).toBeNull()
    expect(periodoEmPalavras('2026-02-09', 'banana')).toBeNull()
  })
})
