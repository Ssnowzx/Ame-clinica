import { http } from '@/lib/http'
import type {
  ConfiguracaoAgenda,
  Especialidade,
  FimDeSemana,
  ItemPendenciaDeRetorno,
  Notificacoes,
  PaginaDeApi,
  Profissional,
  VisaoAgenda,
} from '@/tipos'

/**
 * O CADASTRO de profissionais (`profissionais.ver`) — não é o que a grade desenha.
 *
 * Tipar isto como `ProfissionalDaAgenda` fazia o tipo MENTIR: aquele tipo promete "só ativos, sem
 * cadastro", e esta rota devolve o cadastro inteiro, inativos inclusive. O próximo a escrever
 * `.filter(p => p.ativo)` aqui levaria um erro de TS e "consertaria" apagando o filtro (gate).
 */
export async function listarProfissionais(): Promise<Profissional[]> {
  const { data } = await http.get<Profissional[]>('/api/profissionais')
  return data
}

export async function listarEspecialidades(): Promise<Especialidade[]> {
  const { data } = await http.get<Especialidade[]>('/api/especialidades')
  return data
}

export async function buscarNotificacoes(): Promise<Notificacoes> {
  const { data } = await http.get<Notificacoes>('/api/notificacoes')
  return data
}

/**
 * A fila de RETORNOS (protocolo-de-pendencias) — pacientes em tratamento ativo que pararam
 * de ser agendados. A resposta traz `janela_dias` junto: a tela explica o critério vigente
 * sem ler a configuração crua.
 */
export async function listarPendenciasDeRetorno(filtro: {
  pagina?: number
}): Promise<PaginaDeApi<ItemPendenciaDeRetorno> & { janela_dias: number }> {
  const { data } = await http.get<PaginaDeApi<ItemPendenciaDeRetorno> & { janela_dias: number }>(
    '/api/pendencias-de-retorno',
    { params: { page: filtro.pagina ?? 1 } },
  )

  return data
}

interface LinhaConfiguracao {
  chave: string
  tipo: string
  valor: unknown
}

const CONFIGURACAO_PADRAO: ConfiguracaoAgenda = {
  granularidadeMin: 40,
  fimDeSemana: 'nenhum',
  visaoPadrao: 'dia',
  janelaPadraoInicio: '08:00',
  janelaPadraoFim: '19:00',
  timezone: 'America/Sao_Paulo',
  responsavelTecnicoObrigatorio: false,
  statusAoSalvarEvolucao: 0,
  arrastarParaRemarcar: false,
}

/**
 * Configurações de EXIBIÇÃO da grade — endpoint sob `agenda.ver` (T-sag-02):
 * a tela nunca exige `configuracoes.ver`, que daria o catálogo inteiro.
 * A API devolve uma LISTA de {chave, valor}; aqui vira objeto tipado, e valor
 * inesperado cai no default (fail-safe — a grade nunca quebra por config).
 */
export async function buscarConfiguracaoAgenda(): Promise<ConfiguracaoAgenda> {
  const { data } = await http.get<{ configuracoes: LinhaConfiguracao[] }>('/api/agenda/configuracoes')
  const porChave = new Map(data.configuracoes.map((linha) => [linha.chave, linha.valor]))

  const texto = (chave: string, padrao: string): string => {
    const valor = porChave.get(chave)
    return typeof valor === 'string' && valor !== '' ? valor : padrao
  }

  const granularidade = porChave.get('agenda.granularidade_min')
  const statusAoSalvar = porChave.get('evolucoes.status_ao_salvar')
  const fimDeSemana = texto('agenda.fim_de_semana', CONFIGURACAO_PADRAO.fimDeSemana)
  const visaoPadrao = texto('agenda.visao_padrao', CONFIGURACAO_PADRAO.visaoPadrao)

  const FINS_VALIDOS: FimDeSemana[] = ['nenhum', 'sabado', 'domingo', 'ambos']
  const VISOES_VALIDAS: VisaoAgenda[] = ['dia', 'semana', 'geral']

  return {
    granularidadeMin:
      typeof granularidade === 'number' && granularidade > 0
        ? granularidade
        : CONFIGURACAO_PADRAO.granularidadeMin,
    fimDeSemana: (FINS_VALIDOS as string[]).includes(fimDeSemana)
      ? (fimDeSemana as FimDeSemana)
      : CONFIGURACAO_PADRAO.fimDeSemana,
    visaoPadrao: (VISOES_VALIDAS as string[]).includes(visaoPadrao)
      ? (visaoPadrao as VisaoAgenda)
      : CONFIGURACAO_PADRAO.visaoPadrao,
    janelaPadraoInicio: texto('agenda.janela_padrao_inicio', CONFIGURACAO_PADRAO.janelaPadraoInicio),
    janelaPadraoFim: texto('agenda.janela_padrao_fim', CONFIGURACAO_PADRAO.janelaPadraoFim),
    timezone: texto('clinica.timezone', CONFIGURACAO_PADRAO.timezone),
    // fail-safe como o resto: valor inesperado NÃO liga a obrigatoriedade (ligá-la por
    // engano travaria o registro de toda evolução da clínica)
    responsavelTecnicoObrigatorio: porChave.get('evolucoes.responsavel_tecnico_obrigatorio') === true,
    // o id do status (0 = desligada); valor inesperado desliga — a tela nunca promete por engano
    statusAoSalvarEvolucao: typeof statusAoSalvar === 'number' && statusAoSalvar > 0 ? statusAoSalvar : 0,
    // fail-safe (D4): só o booleano `true` liga o gesto — chave ausente, string
    // "true" ou lixo deixam o arrasto DESLIGADO (sem config, sem gesto)
    arrastarParaRemarcar: porChave.get('agenda.arrastar_para_remarcar') === true,
  }
}
