import { ArrowLeft, Search } from 'lucide-react'
import { useId } from 'react'
import type { ReactNode, RefObject } from 'react'
import { Link } from 'react-router-dom'

/**
 * Cabeçalho comum das telas de cadastro (design D7): título, contador, busca e a
 * ação primária. Escrito uma vez porque são nove telas — nove cópias divergem
 * nove vezes.
 */
export interface CabecalhoDeCadastroProps {
  titulo: string
  /**
   * Nível do heading. Default `h1` — é o certo para as telas de catálogo, onde o
   * cabeçalho É o título da página.
   *
   * Existe porque a página do CONVÊNIO monta DUAS telas de catálogo (serviços e regras
   * de limite) na mesma rota: com o `h1` cravado, a página passou a ter dois `h1` e o
   * leitor de tela perdeu a hierarquia (achado A11Y-LP-01). Lá as seções são `h2` sob o
   * `h1` da página — o nome do convênio.
   */
  nivel?: 'h1' | 'h2'
  /**
   * O título como ÂNCORA DE FOCO da seção (2.4.3). Passar a ref torna o heading
   * programaticamente focável (`tabIndex={-1}` — fora da ordem de Tab).
   *
   * Existe porque há ações que **apagam o próprio gatilho**: reabrir um ciclo remove o
   * botão "Reabrir" da tabela, e o foco devolvido a um nó fora do DOM vira `body`. O
   * título da seção é o que sobrevive a qualquer repintura da lista.
   */
  refDoTitulo?: RefObject<HTMLHeadingElement | null>
  /**
   * Link de VOLTAR para a tela-pai (padrão do sistema: `← {rotulo}`, como as fichas e
   * o convênio já fazem). As telas de catálogo de apoio voltam para `/cadastros` — sem
   * ele, a única saída é a seta do navegador. Ausente nas telas de TOPO (Pacientes,
   * Profissionais…), que não têm pai.
   */
  voltar?: { rota: string; rotulo: string }
  /** Texto do contador ("12 pacientes") — ausente enquanto não há dado carregado */
  contador?: string
  /** Ação primária (criar) — o consumidor já a esconde de quem não pode criar */
  acao?: ReactNode
  busca?: {
    rotulo: string
    placeholder: string
    valor: string
    aoMudar: (valor: string) => void
  }
}

export function CabecalhoDeCadastro({
  titulo,
  nivel = 'h1',
  refDoTitulo,
  voltar,
  contador,
  acao,
  busca,
}: CabecalhoDeCadastroProps) {
  const idDaBusca = useId()
  const Titulo = nivel

  return (
    <header className="flex flex-col gap-4">
      {voltar !== undefined ? (
        <Link
          to={voltar.rota}
          className="flex w-fit items-center gap-1.5 text-corpo text-acento underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          {voltar.rotulo}
        </Link>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Titulo
            ref={refDoTitulo}
            tabIndex={refDoTitulo === undefined ? undefined : -1}
            className="text-titulo font-semibold text-texto focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-foco"
          >
            {titulo}
          </Titulo>
          {contador !== undefined ? <p className="mt-1 text-corpo text-texto-suave">{contador}</p> : null}
        </div>
        {acao}
      </div>

      {busca !== undefined ? (
        <div className="relative max-w-md">
          <label className="sr-only" htmlFor={idDaBusca}>
            {busca.rotulo}
          </label>
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-texto-suave"
          />
          <input
            id={idDaBusca}
            type="search"
            value={busca.valor}
            placeholder={busca.placeholder}
            // o termo é o NOME DE UM MENOR: fora do autofill e do corretor
            // ortográfico do navegador, como o `CampoBusca` do DS já faz (T-aes-13)
            autoComplete="off"
            spellCheck={false}
            onChange={(evento) => {
              busca.aoMudar(evento.target.value)
            }}
            className="h-10 w-full rounded-campo border border-borda-campo bg-superficie pl-9 pr-3 text-corpo-lg text-texto placeholder:text-texto-suave focus-visible:border-foco"
          />
        </div>
      ) : null}
    </header>
  )
}
