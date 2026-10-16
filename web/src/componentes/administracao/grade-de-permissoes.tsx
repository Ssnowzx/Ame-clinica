import { Check, TriangleAlert } from 'lucide-react'
import { Checkbox } from 'radix-ui'
import { useId, useMemo } from 'react'

import { cn } from '@/lib/cn'
import {
  AREA_ROTULO,
  areaDoModulo,
  FLAGS_DE_ESCOPO,
  LIMIAR_DE_COLUNA,
  ORDEM_DAS_ACOES,
  ORDEM_DAS_AREAS,
  PERMISSAO_ADMIN_TOTAL,
  partirPermissao,
  rotuloDaAcao,
  rotuloDaAcaoNoModulo,
  rotuloDoModulo,
} from '@/lib/permissoes-rotulos'

const LEGENDA = 'Permissões por módulo e ação, agrupadas por área do sistema.'

/** SEC-ADM-02 — a consequência, dita por extenso, para o olho (`title`) e para o leitor. */
const AVISO_DE_ADMIN_TOTAL =
  'Equivale a administração total da clínica: quem tiver este nível pode conceder qualquer permissão a qualquer usuário.'

/** Sem a régua de quem edita, toda caixa mexe. */
const TODAS = (): boolean => true

interface GradeDePermissoesProps {
  /** Catálogo completo do servidor (`GET /permissoes`). */
  catalogo: readonly string[]
  /** Permissões marcadas neste nível. */
  selecionadas: ReadonlySet<string>
  aoAlternar: (permissao: string, marcada: boolean) => void
  /**
   * A caixa que a pessoa pode mexer: só a permissão que ela TEM (change `trava-de-usuarios-e-niveis`
   * — o servidor recusa com 403 quem concede o que não tem). Sem a prop, todas.
   */
  podeAlternar?: (permissao: string) => boolean
}

interface ModuloDaGrade {
  modulo: string
  rotulo: string
  acoes: ReadonlySet<string>
  /** Ações deste módulo que não viraram coluna (D1) — vão rotuladas na própria linha. */
  orfas: readonly string[]
}

/**
 * Cabeçalho FIXO (D3): a borda vive na célula, não na tabela — com `border-collapse` ela
 * pertenceria à tabela e rolaria embora, deixando o cabeçalho solto sobre as linhas. Daí o
 * `border-separate` na tabela.
 */
const CABECALHO =
  'sticky top-0 border-b border-linha-forte bg-cabecalho-tabela px-3 py-2 text-rotulo font-medium text-texto-suave'

/** Ordem canônica primeiro; o que o dicionário não prevê vai ao fim, em ordem alfabética. */
function ordenarAcoes(acoes: ReadonlySet<string>): string[] {
  const conhecidas = (ORDEM_DAS_ACOES as readonly string[]).filter((acao) => acoes.has(acao))
  const extras = [...acoes].filter((acao) => !(ORDEM_DAS_ACOES as readonly string[]).includes(acao)).sort()

  return [...conhecidas, ...extras]
}

/**
 * Grade módulo × ação derivada do catálogo do servidor — nunca hardcoded (SEC-ADM-08):
 * módulo/ação desconhecido aparece com o nome cru, jamais é omitido. A célula existe só
 * quando a permissão `modulo.acao` existe no catálogo (pacientes sem excluir → sem
 * célula). `niveis_permissao.editar` leva o aviso de "administração total" (SEC-ADM-02).
 *
 * A FORMA também é derivada (design D1/D2 · change `grade-de-permissoes-legivel`): ação
 * compartilhada por `LIMIAR_DE_COLUNA`+ módulos vira coluna; ação de um módulo só vira caixa
 * ROTULADA na linha dele, em "Outras ações" — é isso que faz a grade caber no `max-w-2xl` do
 * diálogo enquanto o catálogo cresce. Os módulos vêm agrupados por área, com "Outros" para o
 * que o dicionário ainda não classifica.
 */
export function GradeDePermissoes({ catalogo, selecionadas, aoAlternar, podeAlternar = TODAS }: GradeDePermissoesProps) {
  const { colunas, grupos, temOrfas } = useMemo(() => {
    const daGrade = catalogo.filter((permissao) => !(FLAGS_DE_ESCOPO as readonly string[]).includes(permissao))

    const porModulo = new Map<string, Set<string>>()
    const modulosPorAcao = new Map<string, number>()
    for (const permissao of daGrade) {
      const { modulo, acao } = partirPermissao(permissao)
      const acoesDoModulo = porModulo.get(modulo) ?? new Set<string>()
      porModulo.set(modulo, acoesDoModulo)
      // o catálogo vem do BANCO: a mesma ação repetida no módulo contaria duas vezes e
      // promoveria sozinha uma ação de módulo único a coluna
      if (acoesDoModulo.has(acao)) continue
      acoesDoModulo.add(acao)
      modulosPorAcao.set(acao, (modulosPorAcao.get(acao) ?? 0) + 1)
    }

    const ehColuna = (acao: string): boolean => (modulosPorAcao.get(acao) ?? 0) >= LIMIAR_DE_COLUNA
    const colunasDaGrade = ordenarAcoes(new Set([...modulosPorAcao.keys()].filter(ehColuna)))

    const modulos: ModuloDaGrade[] = [...porModulo.entries()].map(([modulo, acoes]) => ({
      modulo,
      rotulo: rotuloDoModulo(modulo),
      acoes,
      orfas: ordenarAcoes(new Set([...acoes].filter((acao) => !ehColuna(acao)))),
    }))

    // grupos na ordem de leitura; área sem módulo não desenha cabeçalho vazio
    const gruposDaGrade = ORDEM_DAS_AREAS.map((area) => ({
      area,
      modulos: modulos
        .filter((item) => areaDoModulo(item.modulo) === area)
        .sort((a, b) => a.rotulo.localeCompare(b.rotulo)),
    })).filter((grupo) => grupo.modulos.length > 0)

    return {
      colunas: colunasDaGrade,
      grupos: gruposDaGrade,
      temOrfas: modulos.some((item) => item.orfas.length > 0),
    }
  }, [catalogo])

  const totalDeColunas = 1 + colunas.length + (temOrfas ? 1 : 0)

  return (
    <div
      /* `tabIndex`/`role`/`aria-label`: região rolável alcançável por si — sem isso, rolar sem
         mouse exige tabular por 131 caixas até a que está fora da vista (molde do `grade-agenda`).
         `scroll-pt-12` (48px): o `<thead>` fixo mede 35,2px e o `scroll-margin-top` global do
         `index.css` não age quando o navegador NÃO precisa rolar — voltando com Shift+Tab, o
         foco ia parar DEBAIXO do cabeçalho (2.4.11, achado do gate, medido em 0 de 24px visíveis).
         `scroll-pl` é a contrapartida no eixo X, e ela é obrigatória: `scroll-padding` é
         DIRECIONAL, então a coluna "Módulo" congelada reintroduzia o MESMO 2.4.11 deitado —
         voltando com Shift+Tab a uma caixa da primeira coluna de dados com a grade rolada em X,
         ela fica sob a coluna e o navegador não rola, porque o alvo já está no scrollport
         (medido: 8 paradas em 0 de 24px).
         `--largura-modulo` amarra a largura da coluna e o `scroll-pl` na MESMA fonte, para não
         divergirem quando alguém mexer numa e esquecer a outra. Medido: em texto normal batem
         (128px e 128px); a 200% o layout da tabela concede 230px onde a var pede 256px, então o
         `scroll-pl` SOBRA 26px — erra para o lado seguro (reserva a mais nunca esconde foco).
         O teto `min(11rem, 35vw)` só governa porque a tabela é `table-fixed`. Numa tabela
         `auto`, `width` numa `<th>` é SUGESTÃO: a coluna nunca desce abaixo do próprio
         min-content, e a 200% de texto "Termo de consentimento" e "Status de agendamento"
         fixavam esse piso em 230px — a coluna congelada ocupava o scrollport INTEIRO e a grade
         ficava sem uma única caixa visível (1.4.4), com o foco coberto em 100% das paradas.
         Duas tentativas minhas falharam antes desta, e as duas por não entender a causa: trocar
         `rem` por `vw` (o `vw` calculava certo e era ignorado — o problema nunca foi a unidade,
         foi a palavra mais longa) e `truncate` sozinho, que PIOROU (o `white-space: nowrap` faz
         o min-content virar o texto inteiro sem quebra: 346px). Com `table-fixed` a largura
         pedida passa a valer de fato, o `truncate` finalmente corta o que não cabe, e o
         acoplamento largura ↔ `scroll-pl` deixa de ser aproximado.
         REGRA que sai daqui: foco visível ⟺ `scroll-padding-left` >= largura RENDERIZADA da
         coluna congelada. Enquanto a largura era min-content, o padding encolhia e a coluna
         não — divergiam justo para o lado que esconde.
         `min-w-0`: item de flex não encolhe abaixo do próprio min-content sem isso, e a rolagem
         horizontal vazava para o CORPO do diálogo em 390px. */
      tabIndex={0}
      role="region"
      aria-label={LEGENDA}
      className="[--largura-modulo:min(11rem,35vw)] max-h-96 w-full min-w-0 scroll-pl-(--largura-modulo) scroll-pt-12 overflow-auto rounded-superficie border border-linha-forte bg-superficie focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco"
    >
      <table className="w-full table-fixed border-separate border-spacing-0 text-corpo text-texto">
        <caption className="sr-only">{LEGENDA}</caption>
        <thead>
          <tr>
            {/* canto duplamente fixo: um degrau ACIMA das outras colunas, senão elas cobrem
                "Módulo" ao rolar em X (molde do `grade-agenda`) */}
            <th scope="col" className={cn(CABECALHO, 'sticky left-0 z-(--z-fixo-canto) w-(--largura-modulo) border-r text-left')}>
              Módulo
            </th>
            {colunas.map((acao) => (
              <th key={acao} scope="col" className={cn(CABECALHO, 'z-(--z-fixo) text-center')}>
                {rotuloDaAcao(acao)}
              </th>
            ))}
            {temOrfas ? (
              <th scope="col" className={cn(CABECALHO, 'z-(--z-fixo) text-left')}>
                Outras ações
              </th>
            ) : null}
          </tr>
        </thead>
        {grupos.map((grupo) => (
          /* um `<tbody>` por área + `scope="rowgroup"`: o cabeçalho governa as LINHAS
             seguintes. Com `colgroup` o Chrome expunha a área como `columnheader`, competindo
             com "Módulo" na primeira coluna (1.3.1, achado do gate). */
          <tbody key={grupo.area}>
            <tr>
              <th
                scope="rowgroup"
                colSpan={totalDeColunas}
                className="border-y border-linha-forte bg-cabecalho-tabela px-3 py-2 text-left text-rotulo font-semibold text-texto"
              >
                {/* o rótulo acompanha a rolagem em X: sem isso a banda vira faixa cinza VAZIA
                    quando a grade rola (achado ao vivo do gate, medido a 149px fora da vista) */}
                <span className="sticky left-0 inline-block">{AREA_ROTULO[grupo.area]}</span>
              </th>
            </tr>
            {grupo.modulos.map((item) => (
              <tr key={item.modulo} className="group transition-colors duration-(--duracao-1) hover:bg-hover-de-linha">
                {/* o rótulo da linha acompanha a rolagem em X: em 390px ele saía inteiro de
                    vista e sobrava marcar permissão sem saber de que módulo ela é */}
                {/* `truncate` + `title`: o nome inteiro continua alcançável (e o leitor de tela
                    já o ouve em cada caixa, no `aria-label` "<Módulo>: <Ação>"), mas o
                    min-content deixa de mandar na largura — sem isso o teto acima não vale
                    nada. Molde do nome do profissional na `grade-agenda`. */}
                <th
                  scope="row"
                  title={item.rotulo}
                  className="sticky left-0 z-(--z-fixo) w-(--largura-modulo) truncate border-b border-r border-linha bg-superficie px-3 py-1.5 text-left font-normal text-texto transition-colors duration-(--duracao-1) group-hover:bg-hover-de-linha"
                >
                  {item.rotulo}
                </th>
                {colunas.map((acao) => (
                  <td key={acao} className="border-b border-linha px-2 py-1.5 text-center">
                    {item.acoes.has(acao) ? (
                      <CelulaDePermissao
                        permissao={`${item.modulo}.${acao}`}
                        modulo={item.rotulo}
                        acao={rotuloDaAcaoNoModulo(item.modulo, acao)}
                        marcada={selecionadas.has(`${item.modulo}.${acao}`)}
                        desabilitada={!podeAlternar(`${item.modulo}.${acao}`)}
                        aoAlternar={aoAlternar}
                      />
                    ) : null}
                  </td>
                ))}
                {temOrfas ? (
                  <td className="border-b border-linha px-3 py-1.5">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                      {item.orfas.map((acao) => (
                        <CelulaDePermissao
                          key={acao}
                          permissao={`${item.modulo}.${acao}`}
                          modulo={item.rotulo}
                          acao={rotuloDaAcaoNoModulo(item.modulo, acao)}
                          marcada={selecionadas.has(`${item.modulo}.${acao}`)}
                          desabilitada={!podeAlternar(`${item.modulo}.${acao}`)}
                          aoAlternar={aoAlternar}
                          comRotulo
                        />
                      ))}
                    </div>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  )
}

interface CelulaDePermissaoProps {
  permissao: string
  modulo: string
  acao: string
  marcada: boolean
  desabilitada: boolean
  aoAlternar: (permissao: string, marcada: boolean) => void
  /** Fora das colunas, a ação precisa se dizer: rótulo visível ao lado da caixa (D5). */
  comRotulo?: boolean
}

function CelulaDePermissao({
  permissao,
  modulo,
  acao,
  marcada,
  desabilitada,
  aoAlternar,
  comRotulo = false,
}: CelulaDePermissaoProps) {
  const id = useId()
  const ehAdminTotal = permissao === PERMISSAO_ADMIN_TOTAL
  const idDoAviso = `${id}-aviso`

  return (
    <span className={cn('relative inline-flex items-center justify-center', comRotulo && 'gap-1.5')}>
      {/* alvo de 24×24 por si (2.5.8), com a caixa 20×20 do design system dentro. */}
      <Checkbox.Root
        id={id}
        checked={marcada}
        disabled={desabilitada}
        onCheckedChange={(estado) => {
          aoAlternar(permissao, estado === true)
        }}
        aria-label={`${modulo}: ${acao}`}
        /* a consequência de marcar esta caixa chega a quem NÃO vê o triângulo: o `title` só
           existe para o ponteiro, e o ícone não é focável (achado do gate) */
        aria-describedby={ehAdminTotal ? idDoAviso : undefined}
        className="group/caixa flex size-6 shrink-0 items-center justify-center rounded-controle disabled:cursor-not-allowed"
      >
        <span className="flex size-5 items-center justify-center rounded-caixa border border-borda-campo bg-superficie transition-colors duration-(--duracao-1) group-data-[state=checked]/caixa:border-acento group-data-[state=checked]/caixa:bg-acento group-data-[disabled]/caixa:border-linha-forte group-data-[disabled]/caixa:bg-neutro-desativado">
          <Checkbox.Indicator>
            <Check aria-hidden="true" className="size-3.5 text-sobre-acento" />
          </Checkbox.Indicator>
        </span>
      </Checkbox.Root>
      {comRotulo ? (
        /* `aria-hidden`: o nome acessível já é "<Módulo>: <Ação>" pelo `aria-label`, e o
           gate mediu que o texto visível ao lado sobra como conteúdo estático — o leitor de
           tela anunciaria "…: Reabrir, caixa de seleção, marcada — Reabrir". Escondê-lo da
           árvore mata a duplicata sem perder nada (a palavra visível está DENTRO do nome,
           2.5.3) e sem depender de motor: o `<label for>` nomear um `<button role=checkbox>`
           vale no Chrome e no WebKit, mas o jsdom não o computa e o Gecko não foi testado.
           O `<label>` não é focável, então esconder não cria alvo órfão. */
        <label
          htmlFor={id}
          aria-hidden="true"
          className={cn('text-corpo', desabilitada ? 'cursor-not-allowed text-texto-desativado' : 'cursor-pointer text-texto')}
        >
          {acao}
        </label>
      ) : null}
      {ehAdminTotal ? (
        <>
          <span title={AVISO_DE_ADMIN_TOTAL} className="absolute left-full top-1/2 ml-1 -translate-y-1/2">
            <TriangleAlert aria-hidden="true" className="size-3.5 text-alerta-texto" />
          </span>
          <span id={idDoAviso} className="sr-only">
            {AVISO_DE_ADMIN_TOTAL}
          </span>
        </>
      ) : null}
    </span>
  )
}
