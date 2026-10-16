import { useCallback, useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'

import { IndiceDoManual } from '@/componentes/manual/indice-do-manual'
import { SecaoDoManual } from '@/componentes/manual/secao-do-manual'
import { usarTelaEmpilhada } from '@/hooks/usar-tela-estreita'
import { SECOES_DO_MANUAL } from '@/lib/manual/conteudo'
import type { SecaoDoManual as Secao } from '@/lib/manual/tipos'

/**
 * O MANUAL do sistema (change `manual-do-operador`).
 *
 * Uma tela de LEITURA: índice de um lado, texto do outro, e nenhuma consulta ao servidor — o
 * manual é conteúdo do produto, não dado da clínica. É por isso que ela dispensa permissão: não
 * há o que autorizar quando não há o que ler do banco.
 *
 * Dois arranjos (design D4): acima de 1280 o índice é uma coluna FIXA que acompanha a rolagem;
 * abaixo, um bloco recolhido acima do texto — em tela apertada, um índice de vinte itens
 * empurraria o começo do manual para baixo da dobra.
 */
export function PaginaManual() {
  const empilhada = usarTelaEmpilhada()
  const [indiceAberto, abrirIndice] = useState(false)
  const [secaoCorrente, marcarSecao] = useSecaoVisivel(SECOES_DO_MANUAL)
  const levarParaSecao = useLevarParaSecao()

  useFocoNaAncora(levarParaSecao)

  const indice = (
    <IndiceDoManual
      secoes={SECOES_DO_MANUAL}
      secaoCorrente={secaoCorrente}
      // o sub-índice manda a SEÇÃO em `aoEscolher` (para a marcação) e a PARTE aqui (para o foco)
      levarPara={(id) => {
        levarParaSecao(id, false)
      }}
      aoEscolher={(id) => {
        // fechar: escolher um destino e o índice continuar aberto por cima do texto é a mesma
        // armadilha da gaveta de navegação que não fecha ao navegar (só a versão recolhida abre)
        abrirIndice(false)
        // marcar na hora, sem esperar o observador: ele só entrega no próximo quadro desenhado,
        // e o leitor que acabou de escolher um destino vê o índice apontando o anterior
        marcarSecao(id)
        // o FOCO é levado aqui, e não deixado por conta da mudança de endereço: o clique num
        // link de âncora não passa pelo roteador, então esperar o endereço mudar para reagir
        // amarraria o teclado a um detalhe de como o navegador trata fragmentos. Rolar é do
        // navegador (o `#` nativo já faz, respeitando a margem de rolagem do título).
        levarParaSecao(id, false)
      }}
    />
  )

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-display font-semibold text-texto">Manual do sistema</h1>
        <p className="mt-2 max-w-3xl text-corpo-lg text-texto-suave">
          Como usar o sistema no dia a dia da clínica, tela por tela. Escolha um assunto no índice —
          ou role a página, que ela segue a ordem de quem está começando.
        </p>
      </header>

      {/* ÍNDICE RECOLHIDO — só em tela empilhada. `<details>` porque abrir e fechar é do
          navegador: funciona no teclado sem uma linha de JavaScript, e sem depender de estado
          para o conteúdo existir. */}
      {empilhada ? (
        <details
          open={indiceAberto}
          onToggle={(evento) => {
            abrirIndice(evento.currentTarget.open)
          }}
          className="rounded-superficie border border-linha bg-superficie p-3"
        >
          {/* `py-1`: sem ele o alvo media 21px e só passava 2.5.8 pela exceção de espaçamento,
              com 1,5px de folga — margem fina demais para depender dela (achado A11Y N-03) */}
          <summary className="cursor-pointer rounded-controle px-1 py-1 text-corpo font-semibold text-texto marker:text-texto-suave">
            Índice do manual
          </summary>
          <nav aria-label="Índice do manual" className="mt-3">
            {indice}
          </nav>
        </details>
      ) : null}

      <div className="flex gap-8">
        {/* ÍNDICE FIXO — acompanha a leitura em tela larga. `sticky` + altura máxima da moldura
            do shell: índice mais alto que a janela precisa rolar POR DENTRO, senão o fim dele
            fica inalcançável. */}
        {empilhada ? null : (
          <nav
            aria-label="Índice do manual"
            // o índice se move por dentro para manter o item corrente à vista; a marca diz a ele
            // QUAL elemento rolar, para nunca tocar na rolagem do documento
            data-scroller-do-indice=""
            // `--respiro-do-shell` (24px), não `--moldura-do-shell` (112px): a moldura desconta a
            // altura do cabeçalho, que neste shell NÃO é sticky — ele rola junto. O desconto
            // indevido comia 88px e o índice terminava na seção 15 de 21, sem nada dizendo que
            // continuava (achado design-qa A2). É a mesma medida da barra lateral do shell.
            className="sticky top-3 max-h-[calc(100dvh-var(--respiro-do-shell))] w-64 shrink-0 self-start overflow-y-auto rounded-superficie border border-linha bg-superficie p-3"
            /*
             * SOMBRAS DE ROLAGEM — o índice não cabe em laptop nenhum (21 seções mais as sete
             * abas de Configurações) e cortava sem nenhum sinal: no macOS a barra de rolagem é
             * sobreposta e some em repouso, então a lista simplesmente "acabava" (achado
             * design-qa, rodada 2). Técnica de CSS puro: dois gradientes `local` (que rolam com o
             * conteúdo) cobrem duas sombras `scroll` (fixas) — a sombra só aparece do lado em que
             * ainda há conteúdo escondido.
             */
            style={{
              background: [
                'linear-gradient(var(--superficie) 30%, transparent) local top',
                'linear-gradient(transparent, var(--superficie) 70%) local bottom',
                // a sombra deriva do token de TEXTO, nunca de um literal: cor crua em `style` é
                // proibida pelo contrato do design system, e a guarda pegou a primeira versão
                'radial-gradient(farthest-side at 50% 0, color-mix(in srgb, var(--texto) 14%, transparent), transparent) scroll top',
                'radial-gradient(farthest-side at 50% 100%, color-mix(in srgb, var(--texto) 14%, transparent), transparent) scroll bottom',
              ].join(', '),
              backgroundSize: '100% 24px, 100% 24px, 100% 8px, 100% 8px',
              backgroundRepeat: 'no-repeat',
            }}
          >
            {/* `texto-suave`, não `texto-desativado`: aquele token é de estado DESABILITADO e
                mede 2,48:1 sobre a superfície — abaixo do piso AA de 4,5 (achado A11Y BLOQ-01).
                Aqui o rótulo está ativo: ele NOMEIA o índice. */}
            <p className="px-3 pb-2 text-meta font-semibold uppercase tracking-wide text-texto-suave">
              Neste manual
            </p>
            {indice}
          </nav>
        )}

        {/* O TEXTO. `max-w-3xl` é medida de leitura: linha longa demais faz o olho perder a
            volta, e este é um texto para ler, não uma tabela para varrer. */}
        <div className="flex min-w-0 max-w-3xl flex-col gap-12">
          {SECOES_DO_MANUAL.map((secao) => (
            <SecaoDoManual key={secao.id} secao={secao} />
          ))}
        </div>
      </div>
    </div>
  )
}

/**
 * Manda o FOCO para a seção do endereço (design D5).
 *
 * Vale para os dois caminhos: clicar num item do índice (que muda o `#` da URL) e abrir
 * `/manual#agenda` direto. Rolar sem mover o foco deixaria quem navega por teclado no índice —
 * a próxima tabulação voltaria para o item seguinte da lista, e não para o texto que a pessoa
 * pediu para ler.
 *
 * `preventScroll` no foco e a rolagem por `scrollIntoView`: assim quem decide o COMO da rolagem
 * é esta função (suave, e instantânea para quem pediu menos movimento), não o navegador.
 */
function useFocoNaAncora(levarParaSecao: (id: string, rolar: boolean) => void): void {
  const { hash } = useLocation()

  useEffect(() => {
    const id = hash.replace('#', '')
    if (id !== '') {
      // aqui a rolagem É nossa: abrir `/manual#agenda` direto não passa por clique nenhum, e sem
      // rolar a pessoa cai no topo do manual com o foco numa seção que ela não está vendo
      levarParaSecao(id, true)
    }
  }, [hash, levarParaSecao])
}

/**
 * Leva o leitor a uma seção: o FOCO sempre, a rolagem quando ninguém mais vai rolar.
 *
 * `preventScroll` no foco para a rolagem ser uma decisão, e não um efeito colateral dele — e
 * suave, salvo para quem pediu menos movimento no sistema operacional.
 */
function useLevarParaSecao(): (id: string, rolar: boolean) => void {
  return useCallback((id: string, rolar: boolean) => {
    const alvo = document.getElementById(id)
    if (alvo === null) {
      return
    }

    alvo.focus({ preventScroll: true })

    if (rolar) {
      alvo.scrollIntoView({
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        block: 'start',
      })
    }
  }, [])
}

/**
 * Qual seção o leitor está lendo — para o índice marcar (design D6).
 *
 * Observa as SEÇÕES (`data-secao`), não os títulos. Observar o título parecia natural e estava
 * errado: com ~30px de altura, ele atravessa a faixa de detecção só quando a rolagem passa
 * devagar por cima dele. Pulando direto de uma seção para outra pelo índice, nenhum título
 * cruzava a faixa e o índice continuava marcando a seção anterior — defeito visto ao vivo, com
 * a página em "Tarefas" e o índice apontando "Primeiros passos".
 *
 * A faixa (`rootMargin`) começa logo abaixo do topo e termina no primeiro terço da janela: é a
 * altura onde o olho está lendo. Entre as seções que a cruzam vence a que COMEÇOU por último —
 * a de cima já ficou para trás, mesmo que ainda apareça um pedaço dela.
 *
 * DEGRADA: onde não existe `IntersectionObserver` (jsdom, navegador antigo) o índice
 * simplesmente não marca nada e continua inteiro navegável. Marcação é conveniência.
 */
function useSecaoVisivel(secoes: readonly Secao[]): [string | null, (id: string) => void] {
  const [corrente, definirCorrente] = useState<string | null>(null)

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') {
      return
    }

    const observador = new IntersectionObserver(
      (entradas) => {
        const visiveis = entradas.filter((entrada) => entrada.isIntersecting)
        if (visiveis.length === 0) {
          return
        }

        const maisRecente = visiveis.reduce((anterior, atual) =>
          anterior.boundingClientRect.top >= atual.boundingClientRect.top ? anterior : atual,
        )
        const id = maisRecente.target.getAttribute('data-secao')
        if (id !== null) {
          definirCorrente(id)
        }
      },
      { rootMargin: '-72px 0px -66% 0px' },
    )

    for (const secao of secoes) {
      const bloco = document.querySelector(`[data-secao="${secao.id}"]`)
      if (bloco !== null) {
        observador.observe(bloco)
      }
    }

    return () => {
      observador.disconnect()
    }
  }, [secoes])

  return [corrente, definirCorrente]
}
