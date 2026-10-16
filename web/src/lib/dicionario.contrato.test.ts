import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { rotuloDaAcao, rotuloDoModulo } from '@/lib/permissoes-rotulos'

/**
 * GUARDA DO DICIONÁRIO — identificador de máquina não chega à tela.
 *
 * Os três dicionários do produto (configurações, permissões, auditoria) têm fallback para a
 * CHAVE CRUA, e isso é deliberado: catálogo novo do servidor nunca some da tela. O preço é
 * que a chave aparece para o usuário até alguém traduzi-la — e ninguém traduz, porque nada
 * reprova. A validação em produção de 2026-08-21 encontrou o resultado em três setores ao
 * mesmo tempo: `whatsapp.limite_mensal` e mais oito na aba "Outros" de Configurações,
 * `assinar_por_outro`/`fluxo_caixa`/`anexos` na grade de permissões, `enviou_logo` e
 * `clinica` na Auditoria.
 *
 * Esta guarda cobra a tradução de todo identificador que o PRÓPRIO CÓDIGO já conhece — os
 * que aparecem em constantes, tipos e catálogos do front. Não alcança chave que só existe
 * no banco (o fallback continua sendo a rede de segurança para essas), mas alcança tudo que
 * nasce junto com uma change nova, que é de onde vieram os onze casos.
 */

const RAIZ = join(process.cwd(), 'src')

function fontes(diretorio: string): string[] {
  return readdirSync(diretorio, { withFileTypes: true }).flatMap((entrada) => {
    const caminho = join(diretorio, entrada.name)
    if (entrada.isDirectory()) return fontes(caminho)
    return entrada.name.endsWith('.ts') || entrada.name.endsWith('.tsx') ? [caminho] : []
  })
}

const CODIGO = fontes(RAIZ)
  .filter((caminho) => !caminho.includes('.test.'))
  .map((caminho) => readFileSync(caminho, 'utf-8'))
  .join('\n')

describe('Dicionário — nenhum identificador de máquina sem rótulo', () => {
  it('deve traduzir toda permissão que o código nomeia', () => {
    // ARRANGE: chave de PERMISSÃO e chave de CONFIGURAÇÃO têm a mesma forma (`modulo.acao`),
    // então extrair por forma confunde as duas — `agenda.permitir_retroativo` é config e
    // apareceria como "ação sem rótulo". Aqui só o que está em contexto SINTÁTICO de
    // permissão: `temPermissao('x.y')`, `permissao: 'x.y'`, `permissao="x.y"` e as listas
    // de `PERMISSOES_*`.
    const contextos = [
      /temPermissao\('([a-z_]+\.[a-z_]+)'\)/g,
      /permissao:\s*'([a-z_]+\.[a-z_]+)'/g,
      /permissao="([a-z_]+\.[a-z_]+)"/g,
      /PERMISSOES_[A-Z_]+[^=]*=\s*\[([^\]]*)\]/g,
    ]

    const permissoes = new Set<string>()
    for (const padrao of contextos.slice(0, 3)) {
      for (const achado of CODIGO.matchAll(padrao)) permissoes.add(achado[1]!)
    }
    for (const lista of CODIGO.matchAll(contextos[3]!)) {
      for (const achado of lista[1]!.matchAll(/'([a-z_]+\.[a-z_]+)'/g)) permissoes.add(achado[1]!)
    }

    // ACT + ASSERT
    const semRotulo: string[] = []
    for (const bruta of permissoes) {
      const [modulo, acao] = bruta.split('.')
      if (modulo === undefined || acao === undefined) continue
      if (rotuloDoModulo(modulo) === modulo) semRotulo.push(`${bruta} → módulo "${modulo}" sem rótulo`)
      if (rotuloDaAcao(acao) === acao) semRotulo.push(`${bruta} → ação "${acao}" sem rótulo`)
    }

    expect(
      [...new Set(semRotulo)].sort(),
      'Permissão sem rótulo pt-BR: a grade de níveis mostra a chave crua ao administrador.',
    ).toEqual([])
  })

  /*
   * A guarda das configurações MUDOU DE LADO (change secoes-das-configuracoes).
   *
   * O front não tem mais dicionário de configurações: `rotulo` e `secao` vêm na leitura, e
   * quem cobra que toda chave os declare é `api/tests/Unit/CatalogoConfiguracoesTest.php`,
   * sobre o catálogo de verdade. A guarda da VOLTA — impedir que o dicionário renasça aqui —
   * está em `api/tests/Feature/DicionarioDeConfiguracoesTest.php`.
   */
})
