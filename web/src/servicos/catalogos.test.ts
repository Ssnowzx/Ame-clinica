import { HttpResponse, http as msw } from 'msw'
import { describe, expect, it } from 'vitest'

import { buscarConfiguracaoAgenda } from '@/servicos/catalogos'
import { servidor } from '@/test/servidor-msw'

/** A resposta REAL do endpoint: lista de {chave, tipo, valor} sob `agenda.ver`. */
function comConfiguracoes(linhas: Array<{ chave: string; tipo: string; valor: unknown }>): void {
  servidor.use(
    msw.get('/api/agenda/configuracoes', () => HttpResponse.json({ configuracoes: linhas })),
  )
}

describe('buscarConfiguracaoAgenda — agenda.arrastar_para_remarcar (§13, change arrastar-para-remarcar)', () => {
  it('deve mapear true quando a clínica ligou o gesto', async () => {
    // ARRANGE: o override da clínica chega como booleano tipado
    comConfiguracoes([{ chave: 'agenda.arrastar_para_remarcar', tipo: 'bool', valor: true }])

    // ACT
    const config = await buscarConfiguracaoAgenda()

    // ASSERT
    expect(config.arrastarParaRemarcar).toBe(true)
  })

  it('deve nascer desligado quando a chave não veio (fail-safe D4)', async () => {
    // ARRANGE: clínica que nunca configurou a agenda
    comConfiguracoes([{ chave: 'agenda.granularidade_min', tipo: 'int', valor: 40 }])

    // ACT
    const config = await buscarConfiguracaoAgenda()

    // ASSERT: sem config, sem gesto
    expect(config.arrastarParaRemarcar).toBe(false)
  })

  it('deve cair em false quando o valor não é booleano', async () => {
    // ARRANGE + ACT + ASSERT: valor corrompido NUNCA liga o gesto por engano —
    // o mesmo contrato fail-safe do responsável técnico obrigatório
    for (const lixo of ['true', 'sim', 1, null, {}]) {
      comConfiguracoes([{ chave: 'agenda.arrastar_para_remarcar', tipo: 'bool', valor: lixo }])
      const config = await buscarConfiguracaoAgenda()
      expect(config.arrastarParaRemarcar).toBe(false)
    }
  })

  it('deve preservar os defaults tipados das demais chaves quando só o arrasto veio', async () => {
    // ARRANGE: resposta mínima — as outras chaves caem nos defaults (a grade nunca quebra por config)
    comConfiguracoes([{ chave: 'agenda.arrastar_para_remarcar', tipo: 'bool', valor: true }])

    // ACT
    const config = await buscarConfiguracaoAgenda()

    // ASSERT
    expect(config.granularidadeMin).toBe(40)
    expect(config.fimDeSemana).toBe('nenhum')
    expect(config.visaoPadrao).toBe('dia')
  })
})
