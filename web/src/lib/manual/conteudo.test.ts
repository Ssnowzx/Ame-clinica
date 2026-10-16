import { describe, expect, it } from 'vitest'

import { ITENS_DE_NAVEGACAO } from '@/componentes/navegacao'
import { SECOES_DO_MANUAL } from '@/lib/manual/conteudo'
import type { BlocoDoManual } from '@/lib/manual/tipos'

/**
 * O manual é escrito para o OPERADOR — e isso é testável em duas frentes: o vocabulário do texto
 * e a cobertura do sistema.
 */

/** Todo o texto visível do manual, num pedaço só. */
function textoVisivel(): string {
  const doBloco = (bloco: BlocoDoManual): string => {
    switch (bloco.tipo) {
      case 'paragrafo':
      case 'subtitulo':
      case 'dica':
      case 'atencao':
        return bloco.texto
      case 'passos':
        return bloco.passos.join(' ')
      case 'lista':
        return bloco.itens.map((item) => `${item.termo} ${item.descricao}`).join(' ')
      case 'captura':
        return ''
    }
  }

  return SECOES_DO_MANUAL.map(
    (secao) => `${secao.titulo} ${secao.resumo} ${secao.blocos.map(doBloco).join(' ')}`,
  ).join('\n')
}

describe('Manual — linguagem de operador', () => {
  it.each([
    ['endpoint', /\bendpoints?\b/i],
    ['tenant', /\btenants?\b/i],
    ['migration', /\bmigrations?\b/i],
    ['permissão em código', /\b[a-z_]+\.(ver|criar|editar|excluir)\b/],
    // o número solto é legítimo (o teto do desmarque em lote vai "de 1 a 200"); o que não pode
    // aparecer é ele como CÓDIGO — "erro 422", "status 500"
    ['código HTTP', /\b(erro|erros|código|status|http)\s*(200|201|401|403|404|422|500)\b/i],
    ['token/API/backend', /\b(token|api|backend|frontend|deploy|json)\b/i],
    // "tabela de preços" é palavra da clínica, não de programador — o que não pode aparecer no
    // texto é o banco de dados e seus parentes
    ['banco de dados', /\b(banco de dados|chave estrangeira|schema|query|cache)\b/i],
  ])('deve não usar %s no texto visível', (_rotulo, proibido) => {
    // ARRANGE + ACT
    const texto = textoVisivel()

    // ASSERT: quem lê está com a mãe de uma criança na frente, esperando
    expect(texto).not.toMatch(proibido)
  })

  it('deve escrever cada seção de verdade — nenhuma casca vazia', () => {
    // ARRANGE + ACT
    const vazias = SECOES_DO_MANUAL.filter(
      (secao) => secao.blocos.length < 2 || secao.resumo.trim().length < 20,
    )

    // ASSERT
    expect(vazias.map((secao) => secao.id)).toEqual([])
  })

  it('deve não admitir no texto que uma figura é anterior à tela', () => {
    // ARRANGE: a spec do manual manda REFAZER a captura da tela que mudou — não confessar que ela
    // envelheceu. "(A figura acima é anterior a este ajuste.)" passou por um gate inteiro em
    // 2026-09-11 antes de alguém recapturar; a frase é o sintoma, e a rede pega o sintoma.
    const confissao = /\b(figura|imagem|captura)\b[^.]{0,40}\b(anterior|antiga|desatualizada|velha)\b/i

    // ACT
    const texto = textoVisivel()

    // ASSERT
    expect(texto).not.toMatch(confissao)
  })

  it('deve manter os endereços dos subtítulos únicos e sem colidir com os das seções', () => {
    // ARRANGE + ACT: subtítulo COM id também é endereço (`/manual#usuarios-escopo`) e entra no
    // índice — repetido, ou igual ao de uma seção, disputa o mesmo link (re-review r4, CR4b-12)
    const idsDeSecao = new Set(SECOES_DO_MANUAL.map((secao) => secao.id))
    const idsDeSubtitulo = SECOES_DO_MANUAL.flatMap((secao) =>
      secao.blocos.flatMap((bloco) => (bloco.tipo === 'subtitulo' && bloco.id !== undefined ? [bloco.id] : [])),
    )

    // ASSERT
    expect(new Set(idsDeSubtitulo).size).toBe(idsDeSubtitulo.length)
    expect(idsDeSubtitulo.filter((id) => idsDeSecao.has(id))).toEqual([])
    expect(idsDeSubtitulo.every((id) => /^[a-z][a-z0-9-]*$/.test(id))).toBe(true)
  })

  it('deve manter os endereços das seções únicos e estáveis', () => {
    // ARRANGE + ACT: o id é endereço público (`/manual#agenda`) — id repetido faz duas seções
    // disputarem o mesmo link, e o navegador leva sempre para a primeira
    const ids = SECOES_DO_MANUAL.map((secao) => secao.id)

    // ASSERT
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.every((id) => /^[a-z][a-z0-9-]*$/.test(id))).toBe(true)
  })
})

/**
 * A cobertura: **todo destino do menu tem seção no manual**.
 *
 * O mapa é explícito de propósito. Casar por semelhança de nome deixaria a guarda passar com
 * qualquer seção parecida; assim, um destino NOVO no sistema quebra a suíte até alguém escrever
 * (ou apontar) a seção que o explica.
 */
const SECAO_DE_CADA_DESTINO: Record<string, string> = {
  '/agenda': 'agenda',
  '/lista-espera': 'lista-de-espera',
  '/pacientes': 'pacientes',
  '/cadastros-recebidos': 'cadastros-recebidos',
  '/profissionais': 'profissionais',
  '/tratamentos': 'tratamentos',
  '/financeiro': 'financeiro',
  '/tarefas': 'tarefas',
  '/mensagens': 'mensagens',
  '/indicadores': 'indicadores',
  '/relatorios': 'relatorios',
  '/cadastros': 'cadastros',
  '/usuarios': 'usuarios',
  '/auditoria': 'auditoria',
  '/configuracoes': 'configuracoes',
  // o próprio manual: quem está lendo já chegou — a seção que serve a ele é a de primeiros passos
  '/manual': 'primeiros-passos',
}

describe('Manual — cobertura do sistema', () => {
  it('deve ter seção para cada destino da navegação', () => {
    // ARRANGE
    const ids = new Set(SECOES_DO_MANUAL.map((secao) => secao.id))

    // ACT
    const semSecao = ITENS_DE_NAVEGACAO.filter((item) => {
      const secao = SECAO_DE_CADA_DESTINO[item.rota]
      return secao === undefined || !ids.has(secao)
    })

    // ASSERT
    expect(semSecao.map((item) => item.rota)).toEqual([])
  })

  it('deve não deixar o mapa de cobertura falar de destino que não existe mais', () => {
    // ARRANGE
    const rotas = new Set(ITENS_DE_NAVEGACAO.map((item) => item.rota))

    // ACT: o mapa é a lista de promessas do manual — promessa órfã esconde destino removido
    const orfaos = Object.keys(SECAO_DE_CADA_DESTINO).filter((rota) => !rotas.has(rota))

    // ASSERT
    expect(orfaos).toEqual([])
  })
})
