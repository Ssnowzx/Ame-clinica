import {
  Banknote,
  Boxes,
  Building2,
  CalendarOff,
  ClipboardList,
  CreditCard,
  DoorOpen,
  FileSignature,
  FolderTree,
  HeartPulse,
  IdCard,
  Landmark,
  ListChecks,
  Stethoscope,
  Tags,
  type LucideIcon,
} from 'lucide-react'

import { CATALOGO_DE_RELATORIOS } from '@/lib/relatorios/catalogo'

/**
 * Os catálogos de apoio, declarados UMA vez: a navegação, o índice de cadastros e
 * as rotas leem daqui. Um catálogo novo entra nesta lista e aparece nos três.
 */
export interface CatalogoDeApoio {
  /** Módulo de permissão (`especialidades.ver`, `salas.criar`…) */
  modulo: string
  rota: string
  rotulo: string
  /** O que a clínica ganha ao cadastrar — não uma repetição do rótulo */
  descricao: string
  icone: LucideIcon
}

export const CATALOGOS_DE_APOIO: readonly CatalogoDeApoio[] = [
  {
    modulo: 'especialidades',
    rota: '/especialidades',
    rotulo: 'Especialidades',
    descricao: 'Tempo de sessão e cor do marcador na grade.',
    icone: HeartPulse,
  },
  {
    modulo: 'salas',
    rota: '/salas',
    rotulo: 'Salas',
    descricao: 'A agenda recusa dois atendimentos na mesma sala e horário.',
    icone: DoorOpen,
  },
  {
    modulo: 'equipamentos',
    rota: '/equipamentos',
    rotulo: 'Equipamentos',
    descricao: 'Quantidade disponível, por especialidade.',
    icone: Boxes,
  },
  {
    modulo: 'convenios',
    rota: '/convenios',
    rotulo: 'Convênios e serviços',
    descricao: 'Convênios da clínica e a tabela de preços de cada um.',
    icone: Tags,
  },
  {
    modulo: 'medicos',
    rota: '/medicos',
    rotulo: 'Médicos solicitantes',
    descricao: 'Quem encaminha o paciente — conselho, UF e CBOS.',
    icone: Stethoscope,
  },
  {
    modulo: 'status_agendamento',
    rota: '/status-agendamento',
    rotulo: 'Status de agendamento',
    descricao: 'REGRA da agenda: o que consome sessão e o que ocupa horário.',
    icone: ListChecks,
  },
  {
    modulo: 'feriados',
    rota: '/feriados',
    rotulo: 'Feriados',
    descricao: 'Dia não cadastrado é dia útil na grade.',
    icone: CalendarOff,
  },
  {
    modulo: 'anamnese_modelos',
    rota: '/anamnese-modelos',
    rotulo: 'Modelos de anamnese',
    descricao: 'A ficha inicial que cada especialidade preenche na 1ª consulta.',
    icone: ClipboardList,
  },
  {
    modulo: 'termos_consentimento',
    rota: '/termos',
    rotulo: 'Termo de consentimento',
    descricao: 'O contrato terapêutico que as famílias aceitam — e a versão em vigor.',
    icone: FileSignature,
  },
  // Os do DINHEIRO (§9). Sem os três primeiros não existe lançamento possível: o
  // formulário de caixa e o "Faturar sessão" da agenda exigem conta, categoria e
  // forma de pagamento, e até aqui não havia por onde cadastrá-los.
  {
    modulo: 'contas',
    rota: '/contas',
    rotulo: 'Contas',
    descricao: 'Onde o dinheiro entra e sai: caixa da recepção, banco, cofre.',
    icone: Landmark,
  },
  {
    modulo: 'tipos_pagamento',
    rota: '/tipos-pagamento',
    rotulo: 'Formas de pagamento',
    descricao: 'Como a família paga: dinheiro, PIX, cartão, transferência.',
    icone: Banknote,
  },
  {
    modulo: 'categorias',
    rota: '/categorias',
    rotulo: 'Categorias do caixa',
    descricao: 'Classifica cada receita e despesa — e o que o contador vai ler.',
    icone: FolderTree,
  },
  {
    modulo: 'cartoes',
    rota: '/cartoes',
    rotulo: 'Cartões',
    descricao: 'Taxa, prazo de recebimento e conta de destino de cada máquina.',
    icone: CreditCard,
  },
  // A QUEM A CLÍNICA PAGA (change `caixa-do-dia-a-dia`): sem eles, o aluguel e o salário saem do
  // caixa sem dono — o lançamento aceitava o interessado, e nada o cadastrava.
  {
    modulo: 'fornecedores',
    rota: '/fornecedores',
    rotulo: 'Fornecedores',
    descricao: 'A quem a clínica paga: aluguel, material, serviços.',
    icone: Building2,
  },
  {
    modulo: 'funcionarios',
    rota: '/funcionarios',
    rotulo: 'Funcionários',
    descricao: 'Quem recebe salário da clínica — escolhido na despesa.',
    icone: IdCard,
  },
]

/** As permissões de leitura de todos os catálogos — o índice aparece com QUALQUER uma. */
export const PERMISSOES_DE_CADASTRO: readonly string[] = CATALOGOS_DE_APOIO.map(
  ({ modulo }) => `${modulo}.ver`,
)

/**
 * As permissões que abrem `GET /agenda/selecao` — as MESMAS da rota (whitelist de nomes de
 * profissionais, especialidades, status). `repasse.ver` entrou com o "Recebido por
 * profissional": a faturista escolhe o profissional do fechamento sem permissão de agenda.
 */
export const PERMISSOES_DA_SELECAO_DA_AGENDA: readonly string[] = [
  'agenda.ver',
  'agenda.criar',
  'lista_espera.criar',
  'lista_espera.editar',
  'repasse.ver',
]

/**
 * Os módulos DONOS das quatro vistas do dashboard (§11, T-not-13: sem permissão
 * guarda-chuva) — o item Indicadores aparece com QUALQUER uma; cada bloco da
 * página só monta (e só busca) com a do seu módulo. A vista financeira pertence
 * a `fluxo_caixa.ver` (totais-do-caixa, D1) — `lancamentos.ver` sozinha não
 * monta bloco nenhum, então não abre porta.
 */
export const PERMISSOES_DE_INDICADORES: readonly string[] = [
  'agenda.ver',
  'atendimentos.ver',
  'pacientes.ver',
  'fluxo_caixa.ver',
]

/**
 * O lote "Vincular pagamentos ao tratamento" (change `vincular-pagamentos-ao-tratamento`, D4): as
 * TRÊS juntas, as mesmas da listagem no servidor — é quem pode aplicar o vínculo no lançamento
 * PAGO (`editar` + `pagar`) e ver de quem é o pacote (`tratamentos.ver`). A rota, o link do
 * Financeiro e o do aviso do relatório leem esta lista. A ROTA as encadeia por extenso (a guarda
 * de rotas só reconhece `ExigePermissao` colado ao `path`), e o `app.test` tira uma de cada vez
 * desta lista para provar que as duas não divergem.
 */
export const PERMISSOES_DO_VINCULO_EM_LOTE: readonly string[] = [
  // `lancamentos.ver` (SEC-VPT-02): a lista mostra criança e valor, o que a lista de lançamentos mostra
  'lancamentos.ver',
  'lancamentos.editar',
  'lancamentos.pagar',
  'tratamentos.ver',
]

/**
 * A união das permissões de TODOS os relatórios do catálogo (`lib/relatorios/catalogo.ts`) —
 * o item "Relatórios" do menu aparece com QUALQUER uma; cada cartão e cada rota continuam
 * exigindo TODAS as do seu relatório (T-not-13: sem permissão guarda-chuva). Derivada do
 * catálogo, e não escrita à mão: uma segunda lista divergiria no primeiro relatório novo.
 */
export const PERMISSOES_DE_RELATORIOS: readonly string[] = [
  ...new Set(CATALOGO_DE_RELATORIOS.flatMap((relatorio) => relatorio.permissoes)),
]
