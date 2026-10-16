import { ChevronDown, LoaderCircle } from 'lucide-react'
import { Fragment, useEffect, useId, useRef, useState } from 'react'

import { cn } from '@/lib/cn'
import { EnvelopeCampo, descreverCampo, type BaseCampo } from '@/componentes/ui/envelope-campo'

export interface OpcaoDeBusca {
  valor: number
  rotulo: string
}

/**
 * Um bloco nomeado de opções ("Recentes", "Todos"). Existe porque a lista de um
 * catálogo grande tem uma parte PROVÁVEL e um resto — e misturar as duas obriga a
 * ler tudo para achar o que quase sempre está nas primeiras linhas.
 */
export interface SecaoDeBusca {
  nome: string
  opcoes: readonly OpcaoDeBusca[]
}

/**
 * Lista simples ou seções? Pergunta pela FORMA do primeiro item — lista vazia é
 * simples por definição (não há seção nenhuma para nomear).
 */
function ehListaDeSecoes(
  lista: readonly OpcaoDeBusca[] | readonly SecaoDeBusca[],
): lista is readonly SecaoDeBusca[] {
  return lista.length > 0 && 'opcoes' in lista[0]!
}

export interface CampoBuscaProps extends BaseCampo {
  /** Opção escolhida (o consumidor é o dono do estado) */
  selecionado: OpcaoDeBusca | null
  /** Só dispara em SELEÇÃO EXPLÍCITA — digitar NUNCA escolhe (T-aes-09) */
  aoSelecionar: (opcao: OpcaoDeBusca | null) => void
  /** Termo digitado; o consumidor faz o debounce e a consulta */
  termo: string
  aoDigitar: (termo: string) => void
  /** Lista simples, ou seções nomeadas (o componente aceita as duas formas) */
  opcoes: readonly OpcaoDeBusca[] | readonly SecaoDeBusca[]
  carregando?: boolean
  /** A consulta do consumidor falhou — a caixa diz isso em vez de ficar muda */
  falhou?: boolean
  /**
   * A busca não achou ninguém, mas existe cadastro **inativo** que casa com o termo — quem diz
   * isso é o SERVIDOR (change `paciente-inativo-com-saida`), e só a quem pode vê-lo.
   *
   * Sumiço sem motivo ensina a recepção a concluir que o cadastro se perdeu — e a cadastrar a
   * mesma criança de novo, que é a duplicata contra a qual o aviso de homônimo existe. O
   * componente NUNCA infere isto sozinho: sem o sinal, o vazio é o vazio de sempre.
   */
  existeInativo?: boolean
  /**
   * O campo NAVEGA em vez de guardar a escolha ("pesquisar outro paciente"): escolher
   * limpa o texto em vez de exibir o rótulo.
   *
   * Sem isto o consumidor não consegue limpar sozinho — `escolher()` chama `aoSelecionar`
   * e, logo depois, `aoDigitar(rotulo)`, que sobrescreve qualquer limpeza. E o rótulo que
   * sobra num campo que não remonta vira busca 300ms depois: nome de MENOR na query string
   * sem ninguém ter digitado (achado SEC-BPL-02).
   */
  limparAoEscolher?: boolean
  /**
   * Chamado na PRIMEIRA abertura da caixa. O `aberto` é estado interno do componente,
   * e sem este aviso o consumidor só tinha duas opções: consultar desde a montagem
   * (puxando dado de gente que ninguém pediu — achado CR-BPL-02) ou não listar nada.
   */
  aoAbrir?: () => void
  /**
   * Chamado quando a rolagem se aproxima do fim — o consumidor decide se há mais
   * página e busca. O componente não guarda página nem consulta nada: ele avisa.
   */
  aoAproximarDoFim?: () => void
  /** Desenha a linha de carregamento no fim e trava novos avisos de rolagem */
  carregandoMais?: boolean
  placeholder?: string
  desabilitado?: boolean
  className?: string
}

/**
 * Campo de escolha COM BUSCA (padrão combobox do WAI-ARIA APG).
 *
 * Existe para catálogos que não cabem numa lista — escolher um paciente entre
 * centenas. Listas curtas continuam no `<select>` nativo (`CampoSelect`): o
 * combobox não é moda, é necessidade.
 *
 * **Regra dura (parecer T-aes-09):** o valor selecionado só muda por **escolha
 * explícita** de uma opção. Texto digitado nunca vira id — marcar no menor
 * errado é incidente de LGPD, não deslize de usabilidade. Sair do campo sem
 * escolher restaura o rótulo do que estava selecionado.
 */
export function CampoBusca({
  rotulo,
  erro,
  ajuda,
  obrigatorio = false,
  selecionado,
  aoSelecionar,
  termo,
  aoDigitar,
  opcoes,
  carregando = false,
  falhou = false,
  existeInativo = false,
  limparAoEscolher = false,
  aoAbrir,
  aoAproximarDoFim,
  carregandoMais = false,
  placeholder,
  desabilitado = false,
  className,
}: CampoBuscaProps) {
  const id = useId()
  const idDaLista = `${id}-lista`

  // O consumidor manda lista simples OU seções; daqui para baixo existe só UMA forma.
  // A lista ACHATADA é o que o teclado percorre: as setas não sabem que há seções — a
  // fronteira entre elas é visual e semântica, nunca um obstáculo para navegar.
  const secoes: readonly SecaoDeBusca[] = ehListaDeSecoes(opcoes) ? opcoes : [{ nome: '', opcoes }]
  const achatadas = secoes.flatMap((secao) => [...secao.opcoes])
  // assinatura do MODO (que seções existem), não do conteúdo: acrescentar uma página
  // por rolagem não muda os nomes, então não mexe no realce; trocar busca ⇄ lista muda
  const modo = secoes.map((secao) => secao.nome).join('|')
  const [aberto, setAberto] = useState(false)
  /**
   * `-1` = NADA realçado, e é o estado inicial de propósito.
   *
   * Enquanto a lista só abria depois de 2 letras digitadas, começar em `0` era inofensivo:
   * não havia opção nenhuma, e o Enter caía fora do `if`. Com a lista abrindo POPULADA
   * (change busca-de-paciente-com-lista), o mesmo `0` passou a significar "a primeira
   * criança está escolhida": focar o campo e apertar Enter para submeter o formulário
   * marcava alguém que o usuário nunca apontou — a violação exata da T-aes-09 que esta
   * change escreveu na spec (achado CR-BPL-01). Com `-1`, o Enter atravessa e o formulário
   * submete, que é a intenção de quem apertou.
   */
  const [indiceAtivo, setIndiceAtivo] = useState(-1)
  const referenciaDoCampo = useRef<HTMLDivElement>(null)
  // última escolha CONFIRMADA — digitar por cima desfaz a seleção (o rótulo e o
  // id nunca divergem), mas desistir deve devolver o campo ao estado anterior
  const ultimaEscolha = useRef<OpcaoDeBusca | null>(selecionado)

  // O realce reseta quando a BUSCA muda, ou quando o MODO muda (a lista vira busca e
  // vice-versa: conjunto tão diferente quanto digitar) — nunca pela identidade do array
  // de opções, que o pai recria a cada render: um re-render qualquer (uma query de fundo
  // resolvendo, uma página nova chegando pela rolagem) jogaria o realce de volta na 1ª
  // opção, e o Enter marcaria no paciente errado entre homônimos (gate agenda-escrita, I-01).
  useEffect(() => {
    setIndiceAtivo(-1)
  }, [termo, modo])

  useEffect(() => {
    if (selecionado !== null) {
      ultimaEscolha.current = selecionado
    }
  }, [selecionado])

  /**
   * Sair do campo sem escolher: campo vazio = limpou de propósito; campo com
   * texto solto = desistiu — volta ao que estava escolhido (id E rótulo juntos).
   */
  function fecharSemEscolher() {
    setAberto(false)

    if (termo.trim() === '') {
      aoSelecionar(null)
      ultimaEscolha.current = null
      aoDigitar('')
      return
    }

    const anterior = selecionado ?? ultimaEscolha.current
    if (anterior !== null) {
      aoSelecionar(anterior)
      aoDigitar(anterior.rotulo)
      return
    }

    aoDigitar('')
  }

  useEffect(() => {
    function aoClicarFora(evento: MouseEvent) {
      if (aberto && referenciaDoCampo.current?.contains(evento.target as Node) === false) {
        fecharSemEscolher()
      }
    }
    document.addEventListener('mousedown', aoClicarFora)
    return () => {
      document.removeEventListener('mousedown', aoClicarFora)
    }
  })

  function escolher(opcao: OpcaoDeBusca) {
    aoSelecionar(opcao)
    aoDigitar(limparAoEscolher ? '' : opcao.rotulo)
    setAberto(false)
  }

  function aoTeclar(evento: React.KeyboardEvent<HTMLInputElement>) {
    if (evento.key === 'ArrowDown' || evento.key === 'ArrowUp') {
      evento.preventDefault()
      if (!aberto) {
        setAberto(true)
        return
      }
      const passo = evento.key === 'ArrowDown' ? 1 : -1
      setIndiceAtivo((atual) => {
        if (achatadas.length === 0) {
          return -1
        }
        // saindo do "nada realçado": para baixo entra na primeira, para cima na última.
        // A aritmética modular não serve aqui — `-1 + 1` daria 0 para baixo (certo) mas
        // `-1 - 1` daria o penúltimo índice para cima (errado, e sem ninguém perceber)
        if (atual < 0) {
          return passo === 1 ? 0 : achatadas.length - 1
        }
        return (atual + passo + achatadas.length) % achatadas.length
      })
      return
    }

    // `indiceAtivo < 0` = ninguém realçado: o Enter NÃO é nosso, é do formulário
    if (evento.key === 'Enter' && aberto && indiceAtivo >= 0) {
      const opcao = achatadas[indiceAtivo]
      if (opcao !== undefined) {
        evento.preventDefault()
        escolher(opcao)
      }
      return
    }

    if (evento.key === 'Escape' && aberto) {
      evento.preventDefault()
      fecharSemEscolher()
      return
    }

    if (evento.key === 'Tab' && aberto) {
      fecharSemEscolher()
    }
  }

  // "sem resultado" só quando a busca REALMENTE rodou (o servidor exige 2+
  // caracteres): com 1 letra, dizer "nenhum resultado" seria mentira
  //
  // ...e o texto que é o RÓTULO de quem já está escolhido também não é busca — é o campo
  // exibindo a escolha (card em edição, paciente que veio pré-selecionado, ou o instante
  // seguinte a escolher da lista). Focar o campo aí não pode anunciar "nenhum resultado"
  // para alguém que ESTÁ selecionado.
  const termoEhARotuloDaEscolha = selecionado !== null && termo.trim() === selecionado.rotulo.trim()
  // `!falhou`: busca que CAIU não é busca que voltou vazia. Sem isto a caixa dizia as duas
  // coisas ao mesmo tempo — "não foi possível carregar" e "nenhum resultado para 'ana'" —, e
  // a segunda é uma afirmação sobre o cadastro que ninguém chegou a consultar.
  const semResultado =
    aberto &&
    !carregando &&
    !falhou &&
    !termoEhARotuloDaEscolha &&
    achatadas.length === 0 &&
    termo.trim().length >= 2

  // No modo LISTA (campo vazio) o catálogo pode vir vazio ou a consulta pode falhar, e nenhum
  // dos dois era dito: a caixa simplesmente não abria, com o placeholder prometendo "escolher"
  // (achado CR-BPL-04). Catálogo vazio não é "nenhum resultado para ''" — é outra frase.
  // `termo` VAZIO, não "menos de 2 letras": com 1 letra a busca ainda não rodou e o catálogo
  // pode estar a caminho — dizer "nada para escolher" ali seria a mesma mentira que o
  // "nenhum resultado" prematuro. A moldura sem conteúdo continua escondida (contrato antigo).
  // o QUARTO vazio, mutuamente exclusivo com os três anteriores: existe cadastro, mas desligado
  const soTemInativo = semResultado && existeInativo

  const catalogoVazio =
    aberto && !carregando && !falhou && !termoEhARotuloDaEscolha && achatadas.length === 0 && termo.trim() === ''
  const avisoDeFalha = aberto && falhou && achatadas.length === 0

  return (
    <EnvelopeCampo id={id} rotulo={rotulo} erro={erro} ajuda={ajuda} obrigatorio={obrigatorio} className={className}>
      <div ref={referenciaDoCampo} className="relative">
        <input
          id={id}
          type="text"
          role="combobox"
          // `expanded`/`controls` falam do LISTBOX, e ele só existe quando há opção: a caixa que
          // mostra só uma mensagem não é uma lista (achado A11Y-PIS-01 do gate)
          aria-expanded={aberto && achatadas.length > 0}
          aria-controls={aberto && achatadas.length > 0 ? idDaLista : undefined}
          aria-autocomplete="list"
          aria-activedescendant={aberto && achatadas[indiceAtivo] !== undefined ? `${id}-opcao-${indiceAtivo}` : undefined}
          aria-invalid={erro !== undefined ? true : undefined}
          aria-describedby={descreverCampo(id, { ajuda, erro })}
          required={obrigatorio}
          disabled={desabilitado}
          // o termo é o NOME DE UM MENOR: fora do histórico do navegador e do
          // corretor ortográfico (T-aes-13)
          autoComplete="off"
          spellCheck={false}
          value={termo}
          placeholder={placeholder}
          onChange={(evento) => {
            aoDigitar(evento.target.value)
            setAberto(true)
            // digitar DESFAZ a escolha anterior — o rótulo e o id nunca divergem
            if (selecionado !== null && evento.target.value !== selecionado.rotulo) {
              aoSelecionar(null)
            }
          }}
          onFocus={() => {
            setAberto(true)
            aoAbrir?.()
          }}
          onKeyDown={aoTeclar}
          className={cn(
            'h-10 w-full bg-superficie px-3 pr-9 text-corpo-lg text-texto',
            'rounded-campo border transition-colors duration-(--duracao-1)',
            'placeholder:text-texto-suave focus-visible:border-foco',
            'disabled:cursor-not-allowed disabled:bg-neutro-desativado disabled:text-texto-desativado',
            erro !== undefined ? 'border-perigo-texto' : 'border-borda-campo',
          )}
        />

        <span aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2">
          {carregando ? (
            <LoaderCircle className="size-4 animate-spin text-texto-suave" />
          ) : (
            <ChevronDown className="size-4 text-texto-suave" />
          )}
        </span>

        {/* `div` com papéis ARIA, e não `ul`/`li`: um `role="group"` dentro de um
            `listbox` precisa CONTER as opções, e `<li role="group">` com `<li
            role="option">` dentro é ARIA válido e HTML inválido ao mesmo tempo.
            Papel explícito em caixa neutra resolve os dois. */}
        {/* O listbox só EXISTE quando há opção: `role="listbox"` sem nenhuma `option` dentro é
            ARIA inválido (1.3.1 — `aria-required-children`), e era o que acontecia em TODOS os
            estados de vazio, não só no novo (achado A11Y-PIS-01). Escondê-lo por classe não
            bastaria: o papel continua na árvore que o leitor de tela percorre. */}
        {aberto && achatadas.length > 0 ? (
          <div
            id={idDaLista}
            role="listbox"
            aria-label={rotulo}
            onScroll={(evento) => {
              if (aoAproximarDoFim === undefined || carregandoMais) return
              const alvo = evento.currentTarget
              // 80% da rolagem: pedir a próxima página ANTES de bater no fim é o que faz a
              // lista parecer contínua em vez de engasgar a cada tela
              if (alvo.scrollTop + alvo.clientHeight >= alvo.scrollHeight * 0.8) {
                aoAproximarDoFim()
              }
            }}
            className="absolute z-(--z-menu) mt-1 max-h-64 w-full overflow-auto rounded-campo border border-linha-forte bg-superficie-elevada py-1 shadow-e2"
          >
            {secoes.map((secao, indiceDaSecao) => {
              // o deslocamento do índice GLOBAL: a seção não reindexa nada, só se posiciona
              const deslocamento = secoes
                .slice(0, indiceDaSecao)
                .reduce((soma, anterior) => soma + anterior.opcoes.length, 0)

              const listaDeOpcoes = secao.opcoes.map((opcao, indiceNaSecao) => {
                const indice = deslocamento + indiceNaSecao
                return (
                  <div
                    key={opcao.valor}
                    id={`${id}-opcao-${indice}`}
                    role="option"
                    aria-selected={selecionado?.valor === opcao.valor}
                    onMouseDown={(evento) => {
                      evento.preventDefault() // não roubar o foco do campo antes do clique
                    }}
                    onClick={() => {
                      escolher(opcao)
                    }}
                    onMouseEnter={() => {
                      setIndiceAtivo(indice)
                    }}
                    className={cn(
                      'cursor-pointer px-3 py-2 text-corpo',
                      indice === indiceAtivo ? 'bg-acento-suave text-acento' : 'text-texto',
                    )}
                  >
                    {opcao.rotulo}
                  </div>
                )
              })

              if (secao.nome === '') {
                return <Fragment key="lista-simples">{listaDeOpcoes}</Fragment>
              }

              return (
                // o nome vai no `group`; o cabeçalho visual é `aria-hidden` para que quem
                // ouve receba o nome UMA vez, e não duas
                <div key={secao.nome} role="group" aria-label={secao.nome}>
                  <p aria-hidden="true" className="px-3 pb-1 pt-2 text-meta font-medium uppercase tracking-wide text-texto-suave">
                    {secao.nome}
                  </p>
                  {listaDeOpcoes}
                </div>
              )
            })}

            {carregandoMais ? (
              <p role="presentation" className="flex items-center gap-2 px-3 py-2 text-corpo text-texto-suave">
                <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                Carregando mais…
              </p>
            ) : null}
          </div>
        ) : null}

        {/* As mensagens vivem FORA do listbox, e por norma: `role="listbox"` sem nenhuma `option`
            dentro é ARIA inválido (1.3.1), e era assim que os vazios eram desenhados — o achado
            A11Y-PIS-01 do gate, que valia para os três antigos e ganharia um quarto aqui. Como
            `role="status"`, a caixa ainda ANUNCIA a troca de mensagem a quem ouve, sem roubar o
            foco (4.1.3 — A11Y-PIS-02): passar de "nenhum resultado" para "existe cadastro
            inativo" é justamente o que a pessoa precisa receber. */}
        <div
          role="status"
          className={cn(
            'absolute z-(--z-menu) mt-1 max-h-64 w-full overflow-auto rounded-campo border border-linha-forte bg-superficie-elevada py-1 shadow-e2',
            (!aberto || (!semResultado && !catalogoVazio && !avisoDeFalha)) && 'hidden',
          )}
        >
          {semResultado && !soTemInativo ? (
            <p className="px-3 py-2 text-corpo text-texto-suave">Nenhum resultado para “{termo}”.</p>
          ) : null}

          {soTemInativo ? (
            <p className="px-3 py-2 text-corpo text-texto-suave">
              Nenhum paciente ativo com esse nome. Existe cadastro{' '}
              <strong className="font-semibold">inativo</strong> que corresponde — reative na ficha
              dele, em Pacientes › Inativos.
            </p>
          ) : null}

          {catalogoVazio ? (
            <p className="px-3 py-2 text-corpo text-texto-suave">Nada para escolher aqui ainda.</p>
          ) : null}

          {avisoDeFalha ? (
            <p className="px-3 py-2 text-corpo text-perigo-texto">
              Não foi possível carregar a lista. Tente de novo.
            </p>
          ) : null}
        </div>
      </div>
    </EnvelopeCampo>
  )
}
