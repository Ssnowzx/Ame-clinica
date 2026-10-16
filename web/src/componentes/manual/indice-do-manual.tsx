import { cn } from '@/lib/cn'
import type { BlocoDoManual, SecaoDoManual } from '@/lib/manual/tipos'

/** Os subtítulos endereçáveis de uma seção — os que têm `id`. */
function subtitulosComEndereco(secao: SecaoDoManual): Array<{ id: string; texto: string }> {
  return secao.blocos
    .filter((bloco): bloco is Extract<BlocoDoManual, { tipo: 'subtitulo' }> => bloco.tipo === 'subtitulo')
    .flatMap((bloco) => (bloco.id === undefined ? [] : [{ id: bloco.id, texto: bloco.texto }]))
}

export interface IndiceDoManualProps {
  secoes: readonly SecaoDoManual[]
  /** O id da seção que o leitor está lendo — `null` quando ainda não se sabe */
  secaoCorrente: string | null
  /** Chamado ao escolher um destino: quem está em tela empilhada usa para fechar o índice */
  aoEscolher: (id: string) => void
  /**
   * Leva a leitura a um ponto DENTRO da seção (um subtítulo endereçável).
   *
   * Separado de `aoEscolher` porque as duas coisas são diferentes: o índice marca a SEÇÃO, e o
   * foco vai para a PARTE. Passar o id do subtítulo como se fosse o da seção apagava a marcação
   * do índice inteiro.
   */
  levarPara?: (id: string) => void
}

/**
 * A LISTA de links do índice — uma só, usada nos dois arranjos da página (design D4).
 *
 * Ela existe separada da página pelo mesmo motivo que a navegação do shell: em tela larga o
 * índice é uma coluna fixa, em tela empilhada é um bloco recolhível, e duplicar a lista criaria
 * o defeito de uma seção existir num arranjo e faltar no outro — invisível até alguém abrir o
 * celular.
 *
 * Os links são âncoras de verdade (`#id`), e não botões: o endereço de uma seção pode ser
 * copiado da barra do navegador e mandado para um colega. Quem move o FOCO para a seção é a
 * página, ouvindo a mudança do endereço.
 */
export function IndiceDoManual({ secoes, secaoCorrente, aoEscolher, levarPara }: IndiceDoManualProps) {
  return (
    <ol className="flex flex-col gap-0.5">
      {secoes.map((secao, indice) => {
        const corrente = secao.id === secaoCorrente
        const subitens = subtitulosComEndereco(secao)

        return (
          <li key={secao.id}>
            <a
              href={`#${secao.id}`}
              // o NÍVEL no DOM: o índice tem dois, e quem lê a lista de fora (teste, e um dia
              // uma busca) precisa distinguir seção de parte de seção sem contar indentação
              data-nivel="secao"
              // `page` é para navegação entre PÁGINAS; aqui o leitor está dentro de uma só, e o
              // valor certo para "este é o item corrente da lista" é `true`
              aria-current={corrente ? 'true' : undefined}
              onClick={() => {
                aoEscolher(secao.id)
              }}
              className={cn(
                'flex items-baseline gap-2 rounded-controle px-3 py-1.5 text-corpo transition-colors duration-(--duracao-1)',
                // marcação NUNCA só por cor (1.4.1): a corrente ganha peso junto com o fundo
                corrente
                  ? 'bg-acento-suave font-semibold text-acento'
                  : 'text-texto-suave hover:bg-hover-de-linha hover:text-texto',
              )}
            >
              {/* o numeral é o ENDEREÇO da seção ("veja a seção 12"), não decoração — e
                  `texto-desativado` mede 2,48:1, reprovando 1.4.3. `aria-hidden` não isenta:
                  o critério é sobre o que se ENXERGA (achado A11Y BLOQ-01). */}
              <span aria-hidden="true" className="text-meta tabular-nums text-texto-suave">
                {indice + 1}
              </span>
              <span>{secao.titulo}</span>
            </a>

            {/* SUB-ÍNDICE — só das seções que têm partes endereçáveis (hoje, as abas de
                Configurações). Sempre visível, e não só quando a seção é a corrente: quem abre
                o manual para achar UMA configuração precisa vê-la no índice antes de chegar
                perto dela. */}
            {subitens.length === 0 ? null : (
              <ol className="mb-1 ml-6 flex flex-col gap-0.5 border-l border-linha pl-2">
                {subitens.map((subitem) => (
                  <li key={subitem.id}>
                    <a
                      href={`#${subitem.id}`}
                      data-nivel="subsecao"
                      onClick={() => {
                        // marca a SEÇÃO-MÃE, não o subtítulo: quem recebe é o índice, que
                        // compara com `secao.id` — passar o id do subtítulo apagava a marcação
                        // do índice inteiro até o observador corrigir (e para sempre onde ele
                        // não existe). O foco continua indo para o subtítulo.
                        aoEscolher(secao.id)
                        levarPara?.(subitem.id)
                      }}
                      // `py-1.5`: com `py-1` o alvo media 24,2px — passava 2.5.8 por 0,2px, e
                      // sem rede (os sub-itens têm 2px de vão entre si)
                      className="block rounded-controle px-2 py-1.5 text-meta text-texto-suave transition-colors duration-(--duracao-1) hover:bg-hover-de-linha hover:text-texto"
                    >
                      {subitem.texto}
                    </a>
                  </li>
                ))}
              </ol>
            )}
          </li>
        )
      })}
    </ol>
  )
}
