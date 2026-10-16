import { HttpResponse, http as msw, type HttpHandler } from 'msw'

import type { CategoriaNoDre, ConfiguracaoDoDre } from '@/tipos'

/**
 * Fixtures do DRE (change `dre-gerencial`) — 100% FICTÍCIAS. A escada é um recorte da do servidor
 * (`EscadaDoDre`), com a mesma forma: grupos com as suas linhas e subtotais.
 */

function categoriasFicticias(): CategoriaNoDre[] {
  return [
    { id: 1, nome: 'Sessões', tipo: 'receita', linha_dre: null, linha_efetiva: 'servicos', updated_at: 'v-sessoes', subcategorias: [] },
    { id: 2, nome: 'Aluguel', tipo: 'despesa', linha_dre: null, linha_efetiva: 'administrativas', updated_at: 'v-aluguel', subcategorias: [] },
    {
      id: 3,
      nome: 'Pessoal',
      tipo: 'despesa',
      linha_dre: 'pessoal',
      linha_efetiva: 'pessoal',
      updated_at: 'v-pessoal',
      subcategorias: [
        { id: 31, nome: 'Salários', linha_dre: null, linha_efetiva: 'pessoal', updated_at: 'v-salarios' },
        { id: 32, nome: 'Tarifa do banco', linha_dre: 'administrativas', linha_efetiva: 'administrativas', updated_at: 'v-tarifa' },
      ],
    },
  ]
}

export function configuracaoDoDreFicticia(categorias: CategoriaNoDre[] = categoriasFicticias()): ConfiguracaoDoDre {
  return {
    escada: [
      { tipo: 'grupo', codigo: 'receita_bruta', rotulo: 'Receita bruta', linhas: ['servicos', 'outras_receitas'], explicacao: 'Tudo o que entrou pela atividade da clínica.' },
      { tipo: 'grupo', codigo: 'deducoes', rotulo: '(−) Deduções', linhas: ['impostos'], explicacao: 'Os impostos sobre o faturamento.' },
      { tipo: 'subtotal', codigo: 'receita_liquida', rotulo: 'Receita líquida', explicacao: 'O que sobra depois dos impostos.' },
      { tipo: 'grupo', codigo: 'despesas_operacionais', rotulo: '(−) Despesas operacionais', linhas: ['pessoal', 'administrativas'], explicacao: 'O custo de manter a clínica aberta.' },
      { tipo: 'subtotal', codigo: 'resultado_operacional', rotulo: 'Resultado operacional', explicacao: 'O lucro (ou prejuízo) da operação.' },
    ],
    linhas: [
      { codigo: 'servicos', rotulo: 'Prestação de serviços', natureza: 'receita', explicacao: 'O que as famílias e os convênios pagam.' },
      { codigo: 'outras_receitas', rotulo: 'Outras receitas operacionais', natureza: 'receita', explicacao: 'O que não é atendimento.' },
      { codigo: 'impostos', rotulo: 'Impostos sobre o faturamento', natureza: 'despesa', explicacao: 'Simples Nacional, ISS.' },
      { codigo: 'pessoal', rotulo: 'Despesas com pessoal', natureza: 'despesa', explicacao: 'Salários e encargos.' },
      { codigo: 'administrativas', rotulo: 'Despesas administrativas', natureza: 'despesa', explicacao: 'Aluguel, luz, água, contador.' },
    ],
    padrao: { receita: 'servicos', despesa: 'administrativas' },
    categorias,
    no_padrao: categorias.filter((categoria) => categoria.linha_dre === null).length,
  }
}

export interface ServidorDoDre {
  envios: Array<{ caminho: string; corpo: Record<string, unknown>; versao: string | null }>
  leituras: number
}

/**
 * `GET /api/dre/linhas` e os dois `PUT` da linha, COM estado, como o de verdade: a troca muda a linha
 * em vigor e a versão, e a próxima leitura já mostra o item no lugar novo.
 */
export function handlersDoDre(): { handlers: HttpHandler[]; registro: ServidorDoDre } {
  const registro: ServidorDoDre = { envios: [], leituras: 0 }
  const categorias = categoriasFicticias()

  const padraoDa = (tipo: CategoriaNoDre['tipo']): string => (tipo === 'receita' ? 'servicos' : 'administrativas')

  return {
    registro,
    handlers: [
      msw.get('/api/dre/linhas', () => {
        registro.leituras += 1
        return HttpResponse.json(configuracaoDoDreFicticia(categorias))
      }),
      msw.put('/api/categorias/:id/linha-dre', async ({ request, params }) => {
        const corpo = (await request.json()) as { linha_dre: string | null }
        registro.envios.push({ caminho: `/categorias/${String(params.id)}`, corpo, versao: request.headers.get('If-Match') })
        const categoria = categorias.find((candidata) => candidata.id === Number(params.id))
        if (categoria === undefined) return HttpResponse.json({ message: 'Não encontrada.' }, { status: 404 })
        categoria.linha_dre = corpo.linha_dre
        categoria.linha_efetiva = corpo.linha_dre ?? padraoDa(categoria.tipo)
        categoria.updated_at = `${categoria.updated_at}+1`
        for (const subcategoria of categoria.subcategorias) {
          if (subcategoria.linha_dre === null) subcategoria.linha_efetiva = categoria.linha_efetiva
        }
        return HttpResponse.json({ id: categoria.id, linha_dre: categoria.linha_dre, updated_at: categoria.updated_at })
      }),
      msw.put('/api/subcategorias/:id/linha-dre', async ({ request, params }) => {
        const corpo = (await request.json()) as { linha_dre: string | null }
        registro.envios.push({ caminho: `/subcategorias/${String(params.id)}`, corpo, versao: request.headers.get('If-Match') })
        const mae = categorias.find((candidata) => candidata.subcategorias.some((sub) => sub.id === Number(params.id)))
        const subcategoria = mae?.subcategorias.find((sub) => sub.id === Number(params.id))
        if (mae === undefined || subcategoria === undefined) return HttpResponse.json({ message: 'Não encontrada.' }, { status: 404 })
        subcategoria.linha_dre = corpo.linha_dre
        subcategoria.linha_efetiva = corpo.linha_dre ?? mae.linha_efetiva
        subcategoria.updated_at = `${subcategoria.updated_at}+1`
        return HttpResponse.json({ id: subcategoria.id, linha_dre: subcategoria.linha_dre, updated_at: subcategoria.updated_at })
      }),
    ],
  }
}
