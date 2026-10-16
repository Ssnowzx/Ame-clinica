import { somarMeses } from '@/lib/meses'
import {
  MES_DO_PAINEL,
  painelDaAgendaFicticio,
  painelDaEquipeFicticio,
  periodoFicticio,
} from '@/test/dados-paineis'
import type {
  FinanceiroDoProfissional,
  LinhaDeProdutividade,
  MesDaSerieDoProfissional,
  PainelDoProfissional,
} from '@/tipos'

/**
 * Dublês do PAINEL DO PROFISSIONAL (change painel-do-profissional) no formato EXATO do contrato D7:
 * o cabeçalho comum dos painéis no topo, e os blocos `agenda`, `equipe` e `pacientes` SÃO as saídas dos
 * painéis de Indicadores (os mesmos construtores de `dados-paineis.ts`, no recorte de UM profissional).
 * Dinheiro em string decimal, taxa de 0 a 1, série com `sem_dados` e `null` antes do histórico.
 *
 * 100% FICTÍCIOS (LGPD): nenhum nome aqui é de pessoa real.
 *
 * O mês é o do D9 (outubro de 2026, medido até o dia 5, histórico começando em 1º de setembro): a
 * série de seis meses tem maio a agosto SEM DADOS, setembro cheio e outubro PARCIAL.
 */

const ID_DO_PROFISSIONAL = 7
const NOME_DO_PROFISSIONAL = 'Profissional Fictício da Ficha'

const HISTORICO = { inicio_historico: '2026-09', inicio_historico_dia: '2026-09-01' } as const

/** A LINHA do profissional na produtividade do mês inteiro — os campos que o servidor manda. */
export function linhaDeProdutividadeFicticia(sobrescritas: Partial<LinhaDeProdutividade> = {}): LinhaDeProdutividade {
  return {
    profissional: { id: ID_DO_PROFISSIONAL, nome: NOME_DO_PROFISSIONAL, foto_versao: null },
    especialidade: { id: 1, nome: 'Fonoaudiologia Fictícia', cor: '#0F766E' },
    duracao_referencia_min: 40,
    atendimentos_simultaneos: 1,
    minutos_na_grade: 4800,
    minutos_de_vaga: 4800,
    minutos_marcados: 3200,
    minutos_realizados: 2400,
    minutos_ociosos: 1600,
    capacidade_atendimentos: 120,
    marcados: 80,
    realizados: 60,
    faltas: 9,
    liberados: 5,
    em_aberto: 6,
    ocupacao_pct: 67,
    produtividade_pct: 50,
    aproveitamento_pct: 75,
    minutos_em_feriados: 240,
    minutos_em_bloqueios: 60,
    por_dia_da_semana: [1, 2, 3, 4, 5, 6, 7].map((dia) => ({
      dia,
      minutos_na_grade: dia <= 5 ? 960 : 0,
      marcados: dia <= 5 ? 16 : 0,
      minutos_marcados: dia <= 5 ? 640 : 0,
      // a quarta é o dia mais cheio: o título da semana a nomeia
      realizados: dia === 3 ? 18 : dia <= 5 ? 10 : 0,
      minutos_realizados: dia <= 5 ? 400 : 0,
    })),
    ...sobrescritas,
  }
}

/**
 * A série dos seis meses que terminam no mês pedido: antes de setembro, sem dados; o mês pedido, parcial.
 * Cada valor só com o bloco DONO, como o servidor manda: as contagens com a produtividade, o recebido
 * com o financeiro.
 */
function serieFicticia({
  comContagens = true,
  comRecebido = true,
  mes = MES_DO_PAINEL,
}: { comContagens?: boolean; comRecebido?: boolean; mes?: string } = {}): MesDaSerieDoProfissional[] {
  return Array.from({ length: 6 }, (_, indice) => {
    const mesDoBucket = somarMeses(mes, indice - 5)
    const semDados = mesDoBucket < HISTORICO.inicio_historico
    const ehOPedido = indice === 5
    const contagens = {
      realizados: semDados ? null : ehOPedido ? 24 : 61,
      faltas: semDados ? null : ehOPedido ? 3 : 8,
    }
    const recebido = semDados ? null : ehOPedido ? '1840.50' : '4200.00'

    return {
      mes: mesDoBucket,
      parcial: ehOPedido,
      sem_dados: semDados,
      ...(comContagens ? contagens : {}),
      ...(comRecebido ? { recebido } : {}),
    }
  })
}

function financeiroFicticio(sobrescritas: Partial<FinanceiroDoProfissional> = {}): FinanceiroDoProfissional {
  return {
    base: 'caixa',
    recebido: { atual: '1840.50', anterior: '1500.00' },
    por_forma: [
      { forma: 'Pix', valor: '1200.00' },
      { forma: 'Cartão de crédito', valor: '640.50' },
    ],
    por_convenio: [
      { convenio: 'Particular', valor: '1600.50' },
      { convenio: 'Convênio Fictício Particular Beta', valor: '240.00' },
    ],
    sem_pagamento: {
      quantidade: 2,
      itens: [
        { atendimento_id: 501, data: '2026-10-02', paciente: 'Paciente Fictício Sem Pagamento', valor: '150.00' },
        { atendimento_id: 502, data: '2026-10-03', paciente: 'Paciente Fictícia Sem Valor', valor: null },
      ],
    },
    ...sobrescritas,
  }
}

/** Os blocos de Indicadores no recorte de UM profissional: os números de um, não os da clínica. */
function agendaDoProfissional() {
  return painelDaAgendaFicticio({
    ocupacao: { atual: 0.8, anterior: 0.75, profissionais_com_grade: 1, profissionais: 1 },
    realizadas: { atual: 24, anterior: 20 },
    sessoes_passadas: { atual: 30, anterior: 26 },
    faltas: { atual: { quantidade: 3, taxa: 0.1 }, anterior: { quantidade: 2, taxa: 0.0769 } },
    desmarques: { atual: { quantidade: 2, taxa: 0.0667 }, anterior: { quantidade: 3, taxa: 0.1154 } },
    por_convenio: [
      { nome: 'Convênio Fictício Alfa', particular: false, sessoes: 18, faltas: 2, desmarques: 1, taxa: 0.1667 },
      { nome: 'Particular', particular: true, sessoes: 12, faltas: 1, desmarques: 1, taxa: 0.1667 },
    ],
  })
}

function equipeDoProfissional() {
  const equipe = painelDaEquipeFicticio()

  return {
    ...equipe,
    evolucoes: { em_dia: { atual: 0.92, anterior: 0.88 }, atrasadas: 2, profissionais_com_atraso: 1, sem_evolucao: 5, prazo_dias: 3 },
    profissionais: equipe.profissionais.filter((linha) => linha.id === ID_DO_PROFISSIONAL),
  }
}

/** O painel INTEIRO — quem tem todas as permissões, com o financeiro. */
export function painelDoProfissionalFicticio(sobrescritas: Partial<PainelDoProfissional> = {}): PainelDoProfissional {
  return {
    profissional: { id: ID_DO_PROFISSIONAL, nome: NOME_DO_PROFISSIONAL, foto_versao: null },
    periodo: periodoFicticio(),
    ...HISTORICO,
    agenda: agendaDoProfissional(),
    produtividade: linhaDeProdutividadeFicticia(),
    equipe: equipeDoProfissional(),
    // a fila de espera NÃO vem no painel do profissional (é da clínica, D7)
    // no FORMATO da API: o painel do profissional só traz os pacotes no fim (os números de pacientes
    // da clínica inteira saem da resposta)
    pacientes: { pacotes_no_fim: 2 },
    serie: serieFicticia(),
    financeiro: financeiroFicticio(),
    ...sobrescritas,
  }
}

type BlocoDoPainel = 'agenda' | 'produtividade' | 'equipe' | 'pacientes' | 'financeiro'

/**
 * O painel com SÓ os blocos pedidos — as chaves dos outros AUSENTES, como o servidor manda. A série segue a
 * regra do servidor: vem com a produtividade OU com o financeiro, e cada valor só com o bloco dono. Sem
 * `agenda.ver` (`veAgenda: false`), o "sem pagamento" do financeiro vem só com a quantidade.
 */
export function painelSo(blocos: readonly BlocoDoPainel[], { veAgenda = true }: { veAgenda?: boolean } = {}): PainelDoProfissional {
  const comContagens = blocos.includes('produtividade')
  const comRecebido = blocos.includes('financeiro')
  const { agenda, produtividade, equipe, pacientes, financeiro, serie: _serie, ...cabecalho } = painelDoProfissionalFicticio()
  const todos = {
    agenda,
    produtividade,
    equipe,
    pacientes,
    financeiro:
      financeiro === undefined || veAgenda
        ? financeiro
        : { ...financeiro, sem_pagamento: { quantidade: financeiro.sem_pagamento.quantidade } },
  }

  return {
    ...cabecalho,
    ...Object.fromEntries(Object.entries(todos).filter(([chave]) => (blocos as readonly string[]).includes(chave))),
    ...(comContagens || comRecebido ? { serie: serieFicticia({ comContagens, comRecebido }) } : {}),
  }
}
