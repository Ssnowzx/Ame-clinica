import { useEffect, useRef } from 'react'

/**
 * O foco ficou sem lugar? O item clicado virou `display: none` — uns navegadores devolvem o foco
 * ao `<body>`, outros o deixam num elemento que não tem mais caixa na tela.
 */
function focoPerdido(): boolean {
  const ativo = document.activeElement
  return ativo === null || ativo === document.body || ativo.getClientRects().length === 0
}

/** Em que pé está a conversa aberta. */
interface EstadoDaConversa {
  pronta: boolean
  falhou: boolean
}

/**
 * O foco no mestre-detalhe da página de Mensagens (change conversa-legivel, A11Y-CL-03).
 *
 * Abaixo de `lg` a lista e a conversa não coexistem: abrir uma conversa esconde o item clicado,
 * e voltar esconde o botão Voltar. Nos dois casos o foco caía no `<body>`, e quem usa teclado ou
 * leitor de tela recomeçava do topo da página.
 *
 * - **Ao abrir pela lista**, o foco vai ao NOME da conversa (o `h2`), e não ao Voltar: o leitor
 *   de tela anuncia de quem é a conversa que abriu — é o "título da tela nova", o mesmo padrão da
 *   troca de rota —, e o próximo Tab segue para a ficha e as ações. Com o foco no Voltar, a
 *   primeira coisa ouvida seria a saída, e um Enter a mais desfazia a abertura. Em tela larga o
 *   item clicado continua visível e focado, e nada se move (`focoPerdido`).
 * - **Se a conversa não carrega**, não há nome para focar: o foco vai ao Voltar do erro, a única
 *   saída da tela (A11Y-CL2-04).
 * - **Ao fechar a conversa** — pelo Voltar da tela OU pelo voltar do navegador (gesto, botão,
 *   `history.back`), que nunca passam pelo mesmo caminho —, o foco vai ao item da conversa que
 *   fechou; se ela não está nesta página da lista (chegou-se por um link do centro de
 *   notificações), ao título da página (A11Y-CL2-03). Por isso a regra olha a TRANSIÇÃO de
 *   `selecionada` (de X para nada), e não um clique.
 */
function useFocoDoMestreDetalhe(selecionada: number | null, conversa: EstadoDaConversa) {
  const refDaLista = useRef<HTMLElement>(null)
  const refDoH1 = useRef<HTMLHeadingElement>(null)
  const refDoTitulo = useRef<HTMLHeadingElement>(null)
  const refDoVoltarDoErro = useRef<HTMLButtonElement>(null)
  const anterior = useRef(selecionada)
  const focarAoAbrir = useRef(false)

  useEffect(() => {
    const fechada = anterior.current
    anterior.current = selecionada
    if (selecionada !== null || fechada === null) return
    const item = refDaLista.current?.querySelector<HTMLElement>(`[data-conversa="${fechada}"]`) ?? null
    ;(item ?? refDoH1.current)?.focus()
  }, [selecionada])

  const { pronta, falhou } = conversa
  useEffect(() => {
    if (!focarAoAbrir.current || (!pronta && !falhou)) return
    focarAoAbrir.current = false
    if (focoPerdido()) {
      ;(pronta ? refDoTitulo.current : refDoVoltarDoErro.current)?.focus()
    }
  }, [selecionada, pronta, falhou])

  return {
    refDaLista,
    refDoH1,
    refDoTitulo,
    refDoVoltarDoErro,
    /** Chamar ao abrir uma conversa pela lista. */
    aoAbrir: () => {
      focarAoAbrir.current = true
    },
  }
}

export { useFocoDoMestreDetalhe as usarFocoDoMestreDetalhe }
