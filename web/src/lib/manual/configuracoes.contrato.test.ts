import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { SECOES_DO_MANUAL } from '@/lib/manual/conteudo'

/**
 * GUARDA DE CONTRATO — **configuração nova no sistema, explicação nova no manual**.
 *
 * A seção Configurações do manual descreve cada ajuste: o que faz, qual é o padrão, o que muda
 * quando alguém mexe. Isso envelhece do pior jeito possível: silenciosamente. Uma change
 * acrescenta uma chave no catálogo, ela aparece na tela da administradora, e o manual segue
 * dizendo que aquela aba tem três opções quando já tem quatro.
 *
 * A lista abaixo é a declaração explícita do que o manual cobre. Chave nova no catálogo derruba
 * este teste até alguém escrever o parágrafo dela — que é exatamente o momento em que a decisão
 * está fresca na cabeça de quem a tomou.
 *
 * O que ela NÃO cobre: se o texto ainda está CERTO (o padrão pode mudar sem a chave mudar de
 * nome). Para isso não há teste — há a revisão do manual junto com a change, e o gatilho
 * `MANUAL-CAPTURAS-ENVELHECEM` em `docs/GATILHOS.md`.
 */

/** O catálogo mora no `api/`, e é dele que a tela de Configurações se abastece. */
const CATALOGO = join(process.cwd(), '..', 'api', 'app', 'Support', 'Configuracoes', 'CatalogoConfiguracoes.php')

/** As chaves que a seção Configurações do manual explica hoje, na ordem das abas. */
const CHAVES_EXPLICADAS = [
  // aba Clínica
  'clinica.nome',
  'clinica.timezone',
  'clinica.identidade',
  'clinica.fonte_do_nome',
  'clinica.tema',
  'cadastro_online.ativo',
  'cadastro_online.retencao_dias',
  'indicadores.comparar_a_partir_de',
  // aba Agenda
  'agenda.permitir_retroativo',
  'agenda.arrastar_para_remarcar',
  'agenda.permitir_reposicao_de_reposicao',
  'agenda.conflito_paciente',
  'agenda.faltas_consecutivas_limite',
  'agenda.pendencia_retorno_dias',
  'agenda.encadeamento_ativo',
  'agenda.encadeamento_status_id',
  'agenda.status_desmarque_id',
  'agenda.desmarque_em_lote_maximo',
  'agenda.baixa_em_lote_maximo',
  'agenda.corte_manha_tarde',
  'agenda.granularidade_min',
  'agenda.fim_de_semana',
  'agenda.visao_padrao',
  'agenda.janela_padrao_inicio',
  'agenda.janela_padrao_fim',
  // aba Atendimento
  'tratamentos.bloquear_duplicado_mesmo_servico',
  'tratamentos.pedido_aviso_antecedencia_dias',
  'tratamentos.saldo_alerta_sessoes',
  'evolucoes.prazo_dias',
  'evolucoes.trava_carencia_dias',
  'evolucoes.responsavel_tecnico_obrigatorio',
  'evolucoes.bloquear_apos_status',
  'evolucoes.status_ao_salvar',
  // aba Financeiro
  'financeiro.lancar_convenio_no_caixa',
  'financeiro.contabil_padrao',
  'financeiro.desconto_maximo_pct',
  'financeiro.mensagem_cobranca',
  // aba Comunicação
  'whatsapp.automatico',
  'whatsapp.limite_mensal',
  'whatsapp.pre_selecionado',
  'lembretes.antecedencia_horas',
  'lembretes.template',
  'lembretes.em_lote',
  'lembretes.segunda_na_sexta',
  'lembretes.repescagem',
  'lembretes.repescagem_ate',
  'lembretes.incluir_reservas',
  'lembretes.acao_desmarque',
  'lembretes.status_desmarque_familia_id',
  'lembretes.resposta_confirmou',
  'lembretes.resposta_desmarque',
  'mensagens.template_desmarque',
  'mensagens.template_confirmacao',
  'mensagens.template_remarcacao',
  'mensagens.template_cancelamento',
  'mensagens.avisos_por_familia_dia',
  'mensagens.retencao_dias',
  'notificacoes.a_partir_de',
  // aba Segurança
  'seguranca.aprovacao_dupla',
  'seguranca.segregacao_financeira',
]

function chavesDoCatalogo(): string[] {
  const fonte = readFileSync(CATALOGO, 'utf8')
  const inicio = fonte.indexOf('private const BASE = [')
  const fim = fonte.indexOf('/** @var array<string, array{tipo: string, default: mixed}> extensões de teste */')

  return [...fonte.slice(inicio, fim).matchAll(/^ {8}'([a-z_]+\.[a-z_]+)' =>/gm)].map((achado) => achado[1])
}

describe('Manual — contrato com o catálogo de configurações', () => {
  it('deve encontrar o catálogo de configurações do sistema', () => {
    // ARRANGE + ACT + ASSERT: sem o arquivo, esta guarda passaria vazia e enganaria — reprova
    expect(existsSync(CATALOGO), `catálogo não encontrado em ${CATALOGO}`).toBe(true)
  })

  it('deve explicar no manual toda configuração que a clínica pode mudar', () => {
    // ARRANGE
    const doCatalogo = chavesDoCatalogo()

    // ACT
    const semExplicacao = doCatalogo.filter((chave) => !CHAVES_EXPLICADAS.includes(chave))

    // ASSERT: configuração nova pede parágrafo novo na seção Configurações do manual
    expect(doCatalogo.length).toBeGreaterThan(30)
    expect(semExplicacao).toEqual([])
  })

  it('deve não explicar configuração que o sistema não tem mais', () => {
    // ARRANGE
    const doCatalogo = chavesDoCatalogo()

    // ACT: texto órfão é pior que texto faltando — ensina a procurar um ajuste que não existe
    const orfas = CHAVES_EXPLICADAS.filter((chave) => !doCatalogo.includes(chave))

    // ASSERT
    expect(orfas).toEqual([])
  })

  it('deve manter uma parte endereçável por aba de configuração', () => {
    // ARRANGE
    const configuracoes = SECOES_DO_MANUAL.find((secao) => secao.id === 'configuracoes')

    // ACT
    const partes = (configuracoes?.blocos ?? [])
      .filter((bloco) => bloco.tipo === 'subtitulo')
      .flatMap((bloco) => (bloco.id === undefined ? [] : [bloco.id]))

    // ASSERT: as sete abas da tela, cada uma com endereço próprio no índice
    expect(partes).toEqual([
      'configuracoes-clinica',
      'configuracoes-agenda',
      'configuracoes-atendimento',
      'configuracoes-financeiro',
      'configuracoes-comunicacao',
      'configuracoes-seguranca',
      'configuracoes-cadastro',
    ])
  })
})
