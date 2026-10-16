import { LogOut, Menu, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { Dialog } from 'radix-ui'
import { useRef, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'

import { AvatarDoUsuario } from '@/componentes/avatar-do-usuario'
import { ContadoresNotificacao } from '@/componentes/contadores-notificacao'
import { MarcaDaClinica } from '@/componentes/marca-da-clinica'
import { GRUPOS_DE_OPERACAO, ITENS_DE_NAVEGACAO, type ItemDeNavegacao } from '@/componentes/navegacao'
import { Botao } from '@/componentes/ui/botao'
import { DicaVisual } from '@/componentes/ui/dica-visual'
import { usarMolduraDoShell } from '@/hooks/usar-moldura-do-shell'
import { usarPreferenciaDeLayout } from '@/hooks/usar-preferencia-de-layout'
import { usarTelaEstreita } from '@/hooks/usar-tela-estreita'
import { usarTemaDaClinica } from '@/hooks/usar-tema-da-clinica'
import { cn } from '@/lib/cn'
import { possuiAlgumaPermissao } from '@/lib/permissoes'
import { useAuthStore } from '@/stores/auth-store'

const ID_CONTEUDO = 'conteudo-principal'
const ID_NAVEGACAO = 'navegacao-principal'

/**
 * Moldura do produto (§4): uma barra lateral FLUTUANTE de altura cheia (cartão
 * arredondado, descolado das bordas, fixo na rolagem) com a marca no topo e a
 * navegação; e uma barra sobre o CONTEÚDO com os contadores e a sessão.
 *
 * As duas barras não se cruzam: a lateral é só navegação e marca; os utilitários
 * (notificações + conta) moram na barra do conteúdo, à direita.
 *
 * A lateral tem DOIS blocos: a operação do dia (Agenda → Auditoria), que rola
 * quando não cabe, e um rodapé ancorado com o que é sistema (Manual e
 * Configurações) — quem consulta o manual ou parametriza a clínica não disputa
 * a fila com quem atende. O controle de
 * recolher mora na LINHA da borda, na metade da altura do cartão: endereço fixo,
 * igual nos dois estados, e o topo fica inteiro para a marca.
 *
 * A lateral recolhe para um TRILHO de ícones e devolve a largura à tela — a
 * agenda é onde a clínica passa o dia. Recolher não esconde destino nenhum: o
 * rótulo continua no DOM (`sr-only`), então o nome acessível é o mesmo nos dois
 * estados e a dica visual só devolve aos olhos o que o leitor de tela já ouve.
 */
export function AppShell() {
  const usuario = useAuthStore((estado) => estado.usuario)
  const logout = useAuthStore((estado) => estado.logout)
  const navigate = useNavigate()
  const temPermissao = useAuthStore((estado) => estado.temPermissao)
  const [recolhido, alternarMenu] = usarPreferenciaDeLayout('menu')

  /*
   * Em tela estreita a navegação não ocupa coluna — vira gaveta (design D1/D2).
   *
   * A preferência de recolher continua existindo e continua SALVA; ela só não manda aqui
   * (D3). O padrão da preferência é "expandido", então deixá-la mandar em tela estreita
   * devolveria o defeito para a maioria dos usuários, e o conserto pareceria não ter
   * funcionado.
   *
   * **A garantia do D3 é ESTRUTURAL, não uma condição.** A primeira versão escrevia
   * `recolhido && !telaEstreita`, que parecia a guarda e não era: `emTrilho` só é lido pela
   * COLUNA, e a coluna não renderiza em tela estreita. A mutação que apagava o
   * `&& !telaEstreita` sobrevivia a tudo — porque era equivalente. O que de fato garante o D3
   * é a gaveta passar `emTrilho={false}` fixo, e isso o teste derruba.
   */
  const telaEstreita = usarTelaEstreita()
  const [gavetaAberta, abrirGaveta] = useState(false)
  /*
   * O gatilho da gaveta mora na barra do TOPO, e a gaveta é montada noutro ramo da árvore —
   * então ele não pode ser um `Dialog.Trigger`, e o Radix não tem como saber para onde
   * devolver o foco ao fechar. Sem esta referência, `Esc` fecha e joga o foco no `<body>`:
   * quem navega por teclado volta ao começo da página e refaz o caminho inteiro.
   */
  const gatilhoDaGaveta = useRef<HTMLButtonElement>(null)
  // a moldura que as telas de altura contida descontam da viewport é MEDIDA neste cabeçalho
  const cabecalho = useRef<HTMLElement>(null)
  usarMolduraDoShell(cabecalho)
  // a cor da clínica vale enquanto o shell estiver montado: ao sair, o login volta ao Padrão
  usarTemaDaClinica(usuario?.marca.tema)

  // filtrado AQUI (mesmo helper dos guards), e não item a item no JSX: as duas
  // listas precisam saber se SOBROU item — o filete só separa quando há o que
  // separar, e uma ul vazia não pode ficar de espaçador invisível
  // `permissao` ausente = destino sem dado a autorizar (o Manual) — visível a todo usuário
  // autenticado. Quem policia o esquecimento é a guarda de contrato da navegação, não este
  // filtro: aqui, item sem permissão é um item que já foi decidido.
  const itensVisiveis = ITENS_DE_NAVEGACAO.filter(
    ({ permissao }) => permissao === undefined || possuiAlgumaPermissao(temPermissao, permissao),
  )
  const itensDeOperacao = itensVisiveis.filter((item) => item.secao !== 'sistema')
  const itensDeSistema = itensVisiveis.filter((item) => item.secao === 'sistema')

  async function sair() {
    await logout()
    navigate('/login', { replace: true })
  }

  return (
    // p-3 dá o RESPIRO que faz as barras flutuarem (descoladas das bordas); gap-3
    // separa a lateral do conteúdo. O fundo da página aparece nas frestas.
    <div className="flex min-h-screen gap-3 bg-fundo p-3">
      {/* primeiro alvo tabulável da página (2.4.1). ACIMA da barra lateral (`z-fixo-canto` > `z-fixo`):
          no mesmo z, a barra — que vem depois no DOM — cobria o link focado (A11Y-IND-03) */}
      <a
        href={`#${ID_CONTEUDO}`}
        className="sr-only rounded-controle bg-superficie px-4 py-2 text-corpo text-acento focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-(--z-fixo-canto) focus:shadow-e2"
      >
        Pular para o conteúdo
      </a>

      {/* BARRA LATERAL FLUTUANTE — cartão de altura cheia que se fixa na rolagem
          (sticky) e ocupa a viewport menos o respiro (p-3 em cima e embaixo). */}
      {/*
        A navegação em DOIS arranjos, um por vez.

        Coluna acima do breakpoint; GAVETA abaixo (design D1). O conteúdo é o mesmo
        componente nos dois — duplicá-lo criaria o defeito que o requisito proíbe: um destino
        que existe num arranjo e não no outro, invisível até alguém abrir o celular.
      */}
      {telaEstreita ? null : (
        <nav
          id={ID_NAVEGACAO}
          aria-label="Navegação principal"
          className={cn(
            'sticky top-3 z-(--z-fixo) flex h-[calc(100dvh-var(--respiro-do-shell))] shrink-0 flex-col gap-3 self-start',
            'rounded-janela border border-moldura-linha bg-moldura p-3 shadow-e2',
            // a assinatura da clínica (change tema-da-clinica): um fio no alto do cartão, recuado
            // das quinas. No Padrão `--assinatura` é `none` e nada é desenhado
            "before:pointer-events-none before:absolute before:inset-x-6 before:top-0 before:h-[3px] before:rounded-b-pilula before:bg-(image:--assinatura) before:content-['']",
            // 160ms na curva do DS: a 100ms sem curva o recolher "pula" de largura em vez
            // de deslizar — o movimento é o que faz a barra parecer fluida, não a pressa
            'transition-[width] duration-(--duracao-2) ease-padrao motion-reduce:transition-none',
            recolhido ? 'w-16' : 'w-64',
          )}
        >
          <ConteudoDaNavegacao
            emTrilho={recolhido}
            podeRecolher
            recolhido={recolhido}
            alternarMenu={alternarMenu}
            itensDeOperacao={itensDeOperacao}
            itensDeSistema={itensDeSistema}
          />
        </nav>
      )}

      {/*
        A GAVETA — a navegação em tela estreita (design D2).

        Reusa o `Dialog` do Radix, que é o mecanismo que esta base já usa nos diálogos: foco
        preso, `Esc` que fecha devolvendo o foco ao gatilho, e o resto da aplicação marcado
        como inerte para leitor de tela. Escrever isso à mão com `<details>` é mais curto e
        mais fácil de errar — gaveta sem foco preso deixa o Tab passear pela página atrás
        dela, e o leitor lê as duas.

        Só é montada em tela estreita: o `null` acima garante que a coluna e a gaveta nunca
        coexistem no DOM.
      */}
      {telaEstreita ? (
        <Dialog.Root open={gavetaAberta} onOpenChange={abrirGaveta}>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-(--z-scrim) bg-texto/40" />
            <Dialog.Content
              id={ID_NAVEGACAO}
              aria-label="Navegação principal"
              onCloseAutoFocus={(evento) => {
                evento.preventDefault()
                gatilhoDaGaveta.current?.focus()
              }}
              className="fixed inset-y-0 left-0 z-(--z-dialogo) flex w-72 max-w-[85vw] flex-col gap-3 overflow-y-auto bg-moldura p-3 shadow-e3"
            >
              {/* O título é `sr-only` porque a marca já diz visualmente onde se está — mas o
                  Radix exige um `Dialog.Title` para o nome acessível, e sem ele o leitor de
                  tela anuncia a gaveta sem dizer o que ela é. */}
              <Dialog.Title className="sr-only">Navegação principal</Dialog.Title>
              <ConteudoDaNavegacao
                emTrilho={false}
                podeRecolher={false}
                recolhido={recolhido}
                alternarMenu={alternarMenu}
                itensDeOperacao={itensDeOperacao}
                itensDeSistema={itensDeSistema}
                aoNavegar={() => {
                  abrirGaveta(false)
                }}
              />
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      ) : null}

      {/* COLUNA DO CONTEÚDO — a barra de utilitários no topo, o conteúdo abaixo. */}
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        {/* Barra sobre o conteúdo (banner): contadores à esquerda, sessão à direita.
            Cartão arredondado como a lateral — a moldura fala a mesma língua. */}
        {/* `@container`: os contadores decidem mostrar o rótulo pela largura DESTA barra, não pela
            da janela. As duas divergem — recolher a navegação libera ~200px para a barra sem mudar o
            viewport —, então um limiar por janela esconde rótulo que caberia E mostra rótulo que não
            cabe. Medido antes de mexer: com os 8 contadores COM rótulo (849px) + a sessão (179px), a
            soma estoura o disponível a partir de ~1490px de janela. */}
        {/* Em barra ESTREITA (celular pequeno, < 30rem de barra) os respiros encolhem: o espaço que
            sobra para os contadores é o que a sessão não ocupa, e cada 8px conta (change
            barra-do-topo-no-celular). */}
        <header
          ref={cabecalho}
          className="@container flex items-center justify-between gap-2 rounded-janela border border-moldura-linha bg-moldura px-3 py-2 shadow-e2 @min-[30rem]:gap-4 @min-[30rem]:px-4">
          {/*
            O GATILHO da gaveta, só em tela estreita.

            Mora na barra do topo porque em tela estreita não há barra lateral onde pendurá-lo,
            e é o PRIMEIRO elemento dela: quem navega por teclado alcança a navegação antes dos
            contadores, como alcançaria a lateral antes do conteúdo em tela larga.
          */}
          {telaEstreita ? (
            <Botao
              variante="secundario"
              tamanho="sm"
              aria-label="Abrir a navegação"
              aria-haspopup="dialog"
              aria-expanded={gavetaAberta}
              aria-controls={ID_NAVEGACAO}
              ref={gatilhoDaGaveta}
              onClick={() => {
                abrirGaveta(true)
              }}
              className="shrink-0 px-2"
            >
              <Menu aria-hidden="true" className="size-5" />
            </Botao>
          ) : null}

          {/* os contadores vivem numa PÍLULA suave — agrupados, deixam de parecer
              ícones soltos.
              `min-w-0`: quando falta espaço, quem cede é ESTE lado — os contadores têm degradação
              própria (o rótulo sai e sobram ícone e número); a sessão não tem nenhuma.
              `overflow-x-auto` é o ÚLTIMO recurso, abaixo de todas as reduções: sem ele, a caixa
              encolhe mas o conteúdo derrama, e em janela muito estreita (~775px) o nome do usuário
              era desenhado POR CIMA dos contadores — pior que a quebra de linha que esta faixa
              consertou (achado da verificação ao vivo). Rolar mantém o contador ALCANÇÁVEL; cortar
              o esconderia, e contador que ninguém vê é contador que ninguém olha. */}
          {/*
            `relative` NÃO é decoração: sem ele a caixa não RECORTA os filhos absolutos.
            
            Os rótulos dos contadores são `sr-only`, que em Tailwind é `position: absolute`.
            Filho absoluto só é recortado pelo `overflow` de um ancestral POSICIONADO — num
            contêiner `static` ele escapa e estica o DOCUMENTO. Medido em janela de 500px:
            `documentElement.scrollWidth` era 549 (o rótulo "Informativos" pousava em
            `left: 549`), e a página inteira rolava de lado por causa de um texto invisível.
            Com `relative`, 500. Achado no passe de zoom da change agenda-no-celular.
          */}
          <div className="relative min-w-0 overflow-x-auto rounded-pilula border border-linha bg-fundo px-2.5 py-1">
            <ContadoresNotificacao />
          </div>

          {/* `shrink-0`: a sessão é a ÚLTIMA a ceder. Sem isto o flex escolhia esmagá-la, e o nome
              do usuário quebrava em duas linhas numa janela de 1494px — o defeito que esta faixa
              consertou (o conteúdo da página nunca teve parte nisso). */}
          <div className="flex shrink-0 items-center gap-2 @min-[30rem]:gap-3">
            {/* a porta do profissional SEM profissionais.ver: quem tem vínculo
                sempre alcança a PRÓPRIA ficha (own-show no servidor) */}
            {usuario?.profissional_id != null ? (
              <NavLink
                to={`/profissionais/${usuario.profissional_id}`}
                className="rounded-controle text-corpo font-medium text-acento hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco"
              >
                Minha ficha
              </NavLink>
            ) : null}
            {/* o nome TRUNCA em vez de quebrar: uma linha sempre, com reticências no aperto —
                duas linhas empurram a altura da barra inteira.
                O TETO (`max-w-48`) é o que faz o `truncate` morder: `text-overflow: ellipsis` só
                age em caixa RESTRINGIDA, e num pai `shrink-0` sem teto a caixa é do tamanho do
                texto — as reticências nunca apareciam, e um nome longo ("Maria Aparecida dos Santos
                Nascimento Fernandes…", medido em 502px) empurrava o Sair PARA FORA da barra e dava
                scroll horizontal ao documento (achado CR-FX-02 do gate, reproduzido por medição).
                O `title` devolve o nome inteiro a quem passa o mouse.
                Em barra ESTREITA (< 30rem) o nome sai da vista — `sr-only`, não `hidden`: o leitor de
                tela continua ouvindo quem está logado — e sobram avatar e Sair. Medido em 360px antes
                disto: a sessão ocupava 224px fixos e a pílula dos contadores ficava com 22px, um
                fiapo que rolava sem mostrar nada; em 320px a barra estourava a largura da página
                (change barra-do-topo-no-celular). */}
            <span className="flex min-w-0 items-center gap-2">
              <AvatarDoUsuario />
              <span
                className="sr-only text-corpo font-medium text-texto @min-[30rem]:not-sr-only @min-[30rem]:max-w-48 @min-[30rem]:truncate"
                title={usuario?.nome}
              >
                {usuario?.nome}
              </span>
            </span>
            <Botao variante="fantasma" tamanho="sm" onClick={() => void sair()}>
              <LogOut aria-hidden="true" className="size-4" />
              Sair
            </Botao>
          </div>
        </header>

        {/* O respiro da página é do SHELL: p-3 aqui + p-3 do container = 1.5rem em
            torno do conteúdo (nenhuma tela cuida do próprio respiro). */}
        <main id={ID_CONTEUDO} className="min-w-0 flex-1 p-3">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

/**
 * Um destino da barra — o MESMO desenho na lista de operação e no rodapé de
 * sistema (o rodapé não é um segundo tipo de item, é o mesmo item ancorado).
 */
interface ConteudoDaNavegacaoProps {
  /** Trilho de ícones: só existe em tela larga com a preferência recolhida (design D3). */
  emTrilho: boolean
  /**
   * O controle de recolher só faz sentido onde HÁ coluna para recolher.
   *
   * Na gaveta ele é um botão flutuante órfão — posicionado `absolute` na borda de uma barra
   * que não existe ali — e oferece uma ação sem efeito: a gaveta já tem a largura toda. Foi
   * o teste do D3 que o encontrou dentro da gaveta.
   */
  podeRecolher: boolean
  recolhido: boolean
  alternarMenu: () => void
  itensDeOperacao: ItemDeNavegacao[]
  itensDeSistema: ItemDeNavegacao[]
  /**
   * Chamado ao acionar um destino — só a GAVETA passa, e passa para se fechar.
   *
   * O `NavLink` não fecha o `Dialog` sozinho no roteamento client-side: a rota troca por
   * baixo e a gaveta fica por cima, com o resto da aplicação `aria-hidden`. Quem clicou vê o
   * menu parado e conclui que o clique não pegou.
   *
   * A coluna NÃO passa: em tela larga não há o que fechar, e chamar `abrirGaveta(false)` ali
   * mexeria num estado que aquele arranjo não usa.
   */
  aoNavegar?: () => void
}

/**
 * O CONTEÚDO da navegação, sem a moldura.
 *
 * Extraído na change `agenda-no-celular` porque a navegação passou a ter dois arranjos —
 * coluna em tela larga, gaveta em tela estreita — e o requisito é explícito: nenhum destino
 * pode existir num arranjo e faltar no outro. Duplicar a lista seria criar exatamente esse
 * defeito, e ele só apareceria no dia em que alguém abrisse o celular.
 */
function ConteudoDaNavegacao({
  emTrilho,
  podeRecolher,
  recolhido,
  alternarMenu,
  itensDeOperacao,
  itensDeSistema,
  aoNavegar,
}: ConteudoDaNavegacaoProps) {
  return (
    <>
      {/* RECOLHER — o controle mora na LINHA da borda, na metade da altura do
          cartão. Fora do fluxo, ele devolve o topo inteiro à marca e fica no
          MESMO ponto da tela nos dois estados: quem recolhe não precisa procurar
          onde reexpandir. (O `sticky` da barra já é o bloco que contém o
          absoluto — daí não haver `relative` aqui.)
          PRIMEIRO no DOM de propósito: o Tab o alcança antes dos destinos, e o
          elemento não remonta ao alternar — quem recolheu pelo teclado continua
          com o foco nele. */}
      {podeRecolher ? (
      <Botao
        variante="secundario"
        tamanho="sm"
        aria-expanded={!recolhido}
        aria-controls={ID_NAVEGACAO}
        aria-label={emTrilho ? 'Expandir a navegação' : 'Recolher a navegação'}
        onClick={alternarMenu}
        // Centrado por `top-[calc(50%-1rem)]` (1rem = metade do h-8), NUNCA por
        // `-translate-y-1/2`: o `active:translate-y-px` da base do Botao escreve a
        // MESMA var de translate e vencia no clique (especificidade 0,2,0 contra
        // 0,1,0) — o controle despencava ~17px no mousedown e o mouseup podia cair
        // fora dele, engolindo o clique (achado do parecer). Sem translate-y
        // próprio, o active volta a ser o nudge de 1px de todo botão.
        // `z-(--z-fixo-canto)`: os itens de menu são `relative` e vêm DEPOIS no
        // DOM — no mesmo nível, quem vem depois cobre, e o clique na metade do
        // botão que cruza a linha do item ia parar no ITEM (medido no navegador).
        // `-right-4` (metade do w-8) em vez de `translate-x-1/2`: um `transform` no
        // botão faria a `DicaVisual` (position: fixed) virar absoluta em relação a
        // ele — a dica saía da tela (achado ao vivo, change botoes-com-nome-na-agenda).
        // O alvo é MAIOR que o desenho — 32px desenhados, ::after invisível de
        // 46px de altura × 38px de largura (AA 2.5.8 pede 24) — e ENVIESADO para
        // fora: `after:left-0` porque o lado de dentro é território dos itens e da
        // barra de rolagem da lista, e folga ali roubava o clique deles.
        className="absolute -right-4 top-[calc(50%-1rem)] z-(--z-fixo-canto) h-8 w-8 rounded-pilula px-0 text-texto-suave shadow-e1 transition-[color,background-color,box-shadow] hover:bg-acento-suave hover:text-acento hover:shadow-e2 after:absolute after:-inset-y-2 after:left-0 after:-right-2 after:content-['']"
      >
        {emTrilho ? (
          <PanelLeftOpen aria-hidden="true" className="size-4" />
        ) : (
          <PanelLeftClose aria-hidden="true" className="size-4" />
        )}
        {/* o nome que o leitor de tela já ouve, devolvido aos olhos: um círculo com
            ícone na borda do cartão não dizia o que faz (change botoes-com-nome-na-agenda) */}
        <DicaVisual>{emTrilho ? 'Expandir a navegação' : 'Recolher a navegação'}</DicaVisual>
      </Botao>
      ) : null}

      {/* MARCA — a âncora visual da barra, e agora dona do topo inteiro. No
          trilho ela sai: 64px não comportam nome nem logo sem espremer. */}
      {emTrilho ? null : (
        <div className="flex h-20 min-w-0 items-center">
          <MarcaDaClinica className="max-w-full" />
        </div>
      )}

      {/* OPERAÇÃO — rola quando os itens não cabem. O rodapé de sistema fica
          fora desta caixa: ele não rola junto, é âncora. Vazia, a lista some —
          uma ul sem item viraria espaçador invisível de cartão inteiro. */}
      {itensDeOperacao.length === 0 ? null : (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
          {GRUPOS_DE_OPERACAO.map((grupo) => ({
            ...grupo,
            itens: itensDeOperacao.filter((item) => item.grupo === grupo.chave),
          }))
            .filter((grupo) => grupo.itens.length > 0)
            .map((grupo, indice) => (
              <div
                key={grupo.chave}
                className={cn('flex flex-col gap-0.5', emTrilho && indice > 0 && 'border-t border-linha pt-3')}
              >
                {/* O rótulo do grupo: visível na coluna, sr-only no trilho (o filete separa).
                    `aria-hidden` porque o NOME acessível é o `aria-label` da lista — sem isso o
                    leitor de tela ouviria "Atendimento" duas vezes. */}
                <p
                  aria-hidden="true"
                  className={cn(
                    'px-3 pb-1 text-meta font-semibold uppercase text-rotulo-de-grupo',
                    emTrilho && 'sr-only',
                  )}
                >
                  {grupo.rotulo}
                </p>
                <ul aria-label={grupo.rotulo} className="flex flex-col gap-0.5">
                  {grupo.itens.map((item) => (
                    <ItemDeMenu key={item.rota} item={item} recolhido={emTrilho} aoNavegar={aoNavegar} />
                  ))}
                </ul>
              </div>
            ))}
        </div>
      )}

      {/* SISTEMA — ancorado no fim do cartão (mt-auto segura o fundo mesmo sem a
          lista de operação), separado por um filete que diz que o assunto mudou.
          O filete só existe se houver o que separar — nos DOIS sentidos: sem
          permissão de sistema não há rodapé; sem item de operação não há filete
          (borda solta é ruído). O aria-label dá à lista o agrupamento que o
          filete comunica aos olhos — sem ele o leitor de tela ouve só "lista, 1
          item", órfã depois do menu (achado do parecer). */}
      {itensDeSistema.length === 0 ? null : (
        <ul
          aria-label="Sistema"
          className={cn(
            'mt-auto flex shrink-0 flex-col gap-0.5',
            itensDeOperacao.length > 0 && 'border-t border-linha pt-3',
          )}
        >
          {itensDeSistema.map((item) => (
            <ItemDeMenu key={item.rota} item={item} recolhido={emTrilho} aoNavegar={aoNavegar} />
          ))}
        </ul>
      )}
    </>
  )
}

function ItemDeMenu({
  item,
  recolhido,
  aoNavegar,
}: {
  item: ItemDeNavegacao
  recolhido: boolean
  aoNavegar?: () => void
}) {
  const { rotulo, rota, icone: Icone } = item

  return (
    <li>
      {/* o NavLink já marca aria-current="page" no item ativo — a cor
          (pílula suave + texto de acento) vem acompanhada de PESO
          (font-semibold), nunca só cor (1.4.1) */}
      <NavLink
        to={rota}
        onClick={aoNavegar}
        className={({ isActive }) =>
          cn(
            // foco por DENTRO: o contêiner rola e cortava o anel nas laterais (gate r3)
            'relative flex items-center gap-2.5 rounded-controle px-3 py-2 text-corpo transition-colors duration-(--duracao-1) focus-visible:-outline-offset-2',
            recolhido && 'justify-center px-0',
            isActive
              ? "bg-moldura-ativo font-semibold text-acento before:absolute before:bottom-1.5 before:left-recuo-fio before:top-1.5 before:w-[3px] before:rounded-pilula before:bg-destaque before:content-['']"
              : 'text-texto-suave hover:bg-moldura-hover hover:text-texto',
          )
        }
      >
        <Icone aria-hidden="true" className="size-4 shrink-0" />
        {/* o rótulo NÃO sai do DOM ao recolher: sem ele, o trilho seria uma
            fileira de ícones anônimos para quem usa leitor de tela */}
        <span className={cn(recolhido && 'sr-only')}>{rotulo}</span>
        {recolhido ? <DicaVisual>{rotulo}</DicaVisual> : null}
      </NavLink>
    </li>
  )
}
