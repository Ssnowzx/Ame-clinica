import { BlocoDoManual } from '@/componentes/manual/bloco-do-manual'
import type { SecaoDoManual as Secao } from '@/lib/manual/tipos'

/**
 * Uma seção do manual: o título (que é a âncora), o resumo e os blocos.
 *
 * O `h2` carrega o `id` E o `tabIndex={-1}` (design D5): o id é o endereço público
 * (`/manual#agenda`), e o `tabIndex` torna o título FOCÁVEL sem entrar na ordem de Tab — é o que
 * permite à página mandar o foco para cá quando alguém escolhe um item do índice. Sem isso, o
 * teclado rola a tela e continua preso no índice, e a próxima tabulação volta para o item
 * seguinte da lista em vez de entrar no texto.
 *
 * `scroll-mt-16` é o mesmo cuidado em pixels: sem margem de rolagem, o título nasce colado no
 * alto e, em tela empilhada, atrás do índice recolhido.
 */
export function SecaoDoManual({ secao }: { secao: Secao }) {
  return (
    // `data-secao` é o que o índice OBSERVA para saber onde o leitor está. Observar o título
    // não serve: ele tem ~30px de altura, e ao pular direto para uma seção nenhum título passa
    // pela faixa de detecção — o índice ficava marcando a seção anterior (visto ao vivo).
    <section data-secao={secao.id} aria-labelledby={secao.id} className="flex flex-col gap-4 scroll-mt-16">
      <header className="flex flex-col gap-1">
        <h2
          id={secao.id}
          tabIndex={-1}
          className="scroll-mt-16 text-titulo font-semibold text-texto focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-foco"
        >
          {secao.titulo}
        </h2>
        <p className="text-corpo text-texto-suave">{secao.resumo}</p>
      </header>

      {secao.blocos.map((bloco, indice) => (
        // índice na chave: dois parágrafos iguais na mesma seção são legítimos (e o texto é
        // estático — a lista nunca é reordenada em tempo de execução)
        <BlocoDoManual key={`${secao.id}-${String(indice)}`} bloco={bloco} />
      ))}
    </section>
  )
}
