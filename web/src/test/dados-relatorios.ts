import { HttpResponse, http as msw } from 'msw'

import type { EnvelopeDeRelatorio } from '@/tipos'

/** Fixtures dos relatórios — 100% FICTÍCIAS (LGPD: nunca dado que possa ser real). */

/** O analítico de "Agendamentos" — colunas com os tipos que a tela formata. */
export function envelopeFicticio(sobrescritas: Partial<EnvelopeDeRelatorio> = {}): EnvelopeDeRelatorio {
  return {
    slug: 'agendamentos',
    titulo: 'Agendamentos',
    periodo: { de: '2026-06-01', ate: '2026-06-30' },
    filtros_aplicados: [{ rotulo: 'Profissional', valor: 'Profissional Fictício A' }],
    colunas: [
      { chave: 'data', rotulo: 'Data', tipo: 'data' },
      { chave: 'hora', rotulo: 'Hora', tipo: 'hora' },
      { chave: 'paciente', rotulo: 'Paciente', tipo: 'texto' },
      { chave: 'status', rotulo: 'Status', tipo: 'texto' },
      { chave: 'valor', rotulo: 'Valor', tipo: 'dinheiro' },
      { chave: 'presenca', rotulo: 'Presença', tipo: 'percentual' },
      { chave: 'quantidade', rotulo: 'Quantidade', tipo: 'numero' },
    ],
    linhas: [
      { data: '2026-06-01', hora: '08:00:00', paciente: 'Paciente Fictício Um', status: 'Finalizado', valor: '1234.50', presenca: 75, quantidade: 1 },
      { data: '2026-06-02', hora: '09:30', paciente: 'Paciente Fictício Dois', status: 'Em Aberto', valor: '80.00', presenca: 100, quantidade: 1 },
      { data: '2026-06-03', hora: '10:00', paciente: null, status: 'Bloqueio', valor: null, presenca: null, quantidade: 1 },
    ],
    grupos: null,
    totais: { valor: '1314.50', quantidade: 3 },
    contagem: 3,
    truncado: false,
    ...sobrescritas,
  }
}

/** O sintético por status — grupos com o total próprio e o total geral. */
export function envelopeSinteticoFicticio(): EnvelopeDeRelatorio {
  return envelopeFicticio({
    filtros_aplicados: [{ rotulo: 'Resultado', valor: 'Sintético por status' }],
    colunas: [
      { chave: 'profissional', rotulo: 'Profissional', tipo: 'texto' },
      { chave: 'quantidade', rotulo: 'Quantidade', tipo: 'numero' },
    ],
    linhas: [],
    grupos: [
      {
        titulo: 'Finalizado',
        linhas: [
          { profissional: 'Profissional Fictício A', quantidade: 8 },
          { profissional: 'Profissional Fictício B', quantidade: 4 },
        ],
        totais: { quantidade: 12 },
      },
      {
        titulo: 'Em Aberto',
        linhas: [{ profissional: 'Profissional Fictício A', quantidade: 3 }],
        totais: { quantidade: 3 },
      },
    ],
    totais: { quantidade: 15 },
    contagem: 15,
  })
}

/** Handlers da área: a execução por slug, com o envelope pedido. */
export function handlersDeRelatorios(envelope: EnvelopeDeRelatorio = envelopeFicticio()) {
  return [
    msw.get('/api/relatorios/:slug', () => HttpResponse.json(envelope)),
  ]
}
