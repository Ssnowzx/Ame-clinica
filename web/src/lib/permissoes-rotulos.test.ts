import { describe, expect, it } from 'vitest'

import { areaDoModulo, ORDEM_DAS_AREAS, rotuloDaAcao, rotuloDaAcaoNoModulo } from '@/lib/permissoes-rotulos'

/**
 * Espelho dos módulos que existem em `PermissaoCatalogo::PERMISSOES` (api/) hoje — sem as
 * flags de escopo, que vivem fora da grade. Módulo novo do catálogo cai em "Outros" DE
 * PROPÓSITO (o dicionário atrasa, nada some); o que este espelho impede é a queda por
 * ESQUECIMENTO nos módulos que já existiam quando o dicionário nasceu.
 */
const MODULOS_DO_CATALOGO = [
  'usuarios',
  'niveis_permissao',
  'configuracoes',
  'auditoria',
  'especialidades',
  'convenios',
  'servicos',
  'salas',
  'equipamentos',
  'medicos',
  'anamnese_modelos',
  'status_agendamento',
  'profissionais',
  'pacientes',
  'tratamentos',
  'agenda',
  'feriados',
  'lista_espera',
  'atendimentos',
  'evolucoes',
  'anamneses',
  'contas',
  'cartoes',
  'tipos_pagamento',
  'categorias',
  'fornecedores',
  'funcionarios',
  'lancamentos',
  'fluxo_caixa',
  'ciclos',
  'transferencias',
  'informativos',
  'anexos',
  'termos_consentimento',
  'tarefas',
  'mensagens',
]

/**
 * Provado por mutação (2026-08-26): tirando `ciclos` de `AREA_POR_MODULO`, o primeiro teste
 * cai com `expected [ 'ciclos' ] to deeply equal []`.
 */
describe('areaDoModulo — agrupamento da grade de permissões (D2)', () => {
  it('deve classificar todo módulo do catálogo vigente fora de "Outros"', () => {
    // ARRANGE — o catálogo de hoje, espelhado acima

    // ACT
    const semArea = MODULOS_DO_CATALOGO.filter((modulo) => areaDoModulo(modulo) === 'outros')

    // ASSERT
    expect(semArea).toEqual([])
  })

  it('deve devolver "outros" para módulo que o dicionário não conhece', () => {
    // ARRANGE — um módulo que ainda não existe (change futura)

    // ACT
    const area = areaDoModulo('modulo_que_ainda_nao_existe')

    // ASSERT
    expect(area).toBe('outros')
  })

  it('deve manter "outros" como a última área da ordem', () => {
    // ARRANGE / ACT
    const ultima = ORDEM_DAS_AREAS[ORDEM_DAS_AREAS.length - 1]

    // ASSERT — o grupo de queda fecha a grade, nunca abre
    expect(ultima).toBe('outros')
  })
})

describe('rotuloDaAcaoNoModulo — a permissão que se diz pelo efeito (painel-do-profissional)', () => {
  it('deve rotular repasse.ver_proprio pelo efeito, por extenso', () => {
    // ARRANGE + ACT — a spec do rbac manda a grade dizer o que a caixa concede
    const rotulo = rotuloDaAcaoNoModulo('repasse', 'ver_proprio')

    // ASSERT
    expect(rotulo).toBe('Ver o que recebeu pelos próprios atendimentos')
  })

  it('deve cair no rótulo da ação quando a permissão não tem rótulo próprio', () => {
    // ARRANGE + ACT — o por extenso é de UMA permissão: outro módulo com a mesma ação não o herda
    const doRepasse = rotuloDaAcaoNoModulo('repasse', 'ver')
    const deOutroModulo = rotuloDaAcaoNoModulo('agenda', 'ver_proprio')

    // ASSERT
    expect(doRepasse).toBe(rotuloDaAcao('ver'))
    expect(deOutroModulo).toBe('Ver o próprio')
  })
})
