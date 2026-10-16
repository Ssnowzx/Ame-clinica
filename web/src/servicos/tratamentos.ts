import { garantirCsrf, http, putComVersao } from '@/lib/http'
import type {
  FiltroDeTratamentos,
  PaginaDeApi,
  PayloadTratamento,
  TratamentoDaLista,
  TratamentoDetalhe,
} from '@/tipos'

/**
 * O saldo (`sessoes_saldo`) e o vencimento (`vencido`) vêm CALCULADOS. A tela os
 * exibe e não os refaz: o vencimento usa o fuso da clínica (§13) e o saldo é o
 * mesmo número que a agenda usa para recusar um agendamento sem sessões. Duas
 * contas para o mesmo número garantem que uma delas estará errada na hora errada.
 */
export async function listarTratamentos(
  filtro: FiltroDeTratamentos = {},
): Promise<PaginaDeApi<TratamentoDaLista>> {
  const { data } = await http.get<PaginaDeApi<TratamentoDaLista>>('/api/tratamentos', {
    params: {
      page: filtro.pagina ?? 1,
      ...(filtro.por_pagina !== undefined ? { per_page: filtro.por_pagina } : {}),
      ...(filtro.paciente_id !== undefined ? { paciente_id: filtro.paciente_id } : {}),
      ...(filtro.profissional_id !== undefined ? { profissional_id: filtro.profissional_id } : {}),
      ...(filtro.status !== undefined ? { status: filtro.status } : {}),
      ...(filtro.vencido !== undefined ? { vencido: filtro.vencido ? 1 : 0 } : {}),
      ...(filtro.saldo_max !== undefined ? { saldo_max: filtro.saldo_max } : {}),
      // recorte "Acabando" pelo limiar da CLÍNICA: a tela diz o que quer, o servidor sabe
      // quanto é (§13). Antes ela mandava `saldo_max` com uma constante própria.
      //
      // `1`, nunca `true`: em QUERY STRING todo valor vira texto, e a regra `boolean` do
      // Laravel compara em modo ESTRITO contra [true,false,0,1,'0','1'] — a string `'true'`
      // que o axios põe no fio devolve 422 e a aba abre em erro. No corpo JSON um booleano
      // de verdade passaria; aqui não é corpo. É o idioma que a linha do `vencido` já usa.
      ...(filtro.acabando === true ? { acabando: 1 } : {}),
    },
  })
  return data
}

/**
 * `matricula`, `guia`, `pedido_emitido_em` e o override semanal só existem AQUI — a
 * listagem não os traz (por isso o tipo do detalhe é outro, e não o da lista).
 */
export async function buscarTratamento(id: number): Promise<TratamentoDetalhe> {
  const { data } = await http.get<TratamentoDetalhe>(`/api/tratamentos/${id}`)
  return data
}

export async function criarTratamento(payload: PayloadTratamento): Promise<TratamentoDetalhe> {
  await garantirCsrf()
  const { data } = await http.post<TratamentoDetalhe>('/api/tratamentos', payload)
  return data
}

export async function atualizarTratamento(
  id: number,
  payload: PayloadTratamento, versao: string): Promise<TratamentoDetalhe> {
  const data = await putComVersao<TratamentoDetalhe>(`/api/tratamentos/${id}`, payload, versao)
  return data
}

export async function excluirTratamento(id: number): Promise<void> {
  await garantirCsrf()
  await http.delete(`/api/tratamentos/${id}`)
}
