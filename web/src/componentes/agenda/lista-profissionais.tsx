import { Users } from 'lucide-react'

import { cn } from '@/lib/cn'
import { resumoDeHorarios } from '@/lib/horarios-profissional'
import { AvatarDoProfissional } from '@/componentes/agenda/avatar-do-profissional'
import { CampoSelect } from '@/componentes/ui/campo-select'
import type { EspecialidadeDaAgenda, ProfissionalDaAgenda } from '@/tipos'

/**
 * A marca do ESCOLHIDO: o fundo do item ativo da moldura + fio de destaque à esquerda — o MESMO desenho do item
 * ativo da navegação lateral (change botoes-com-nome-na-agenda). Só o fundo era um canal só
 * (1.4.1), e um segundo vocabulário para "escolhido" seria coisa a mais para aprender.
 */
const CLASSE_ESCOLHIDO =
  "bg-moldura-ativo before:absolute before:bottom-1.5 before:left-recuo-fio before:top-1.5 before:w-[3px] before:rounded-pilula before:bg-destaque before:content-['']"

interface ListaProfissionaisProps {
  profissionais: ProfissionalDaAgenda[]
  especialidades: EspecialidadeDaAgenda[]
  /** null = todos (visão geral) */
  selecionado: number | null
  aoSelecionar: (profissionalId: number | null) => void
  /**
   * A página está EMPILHADA (768–1279): a lista vira um seletor de uma linha.
   *
   * Nessa faixa a lista fica EM CIMA da grade, e mesmo com teto de 256px sobravam 244–284px de
   * agenda — cerca de 5 slots (medido pelo gate em 1024×768 e 1177×757). A §2 é explícita: "a
   * tela do dia é a GRADE — o cromo cede espaço a ela". A lista é cromo.
   */
  compacta?: boolean
}

/**
 * Sidebar do §6: profissionais ativos com janela e observação; selecionar
 * filtra a grade. A cor da especialidade vem do CATÁLOGO (o payload do
 * profissional não a traz).
 */
export function ListaProfissionais({
  profissionais,
  especialidades,
  selecionado,
  aoSelecionar,
  compacta = false,
}: ListaProfissionaisProps) {
  const corPorEspecialidade = new Map(especialidades.map((item) => [item.id, item.cor]))
  // já vêm só os ativos da seleção da agenda (o servidor filtra)
  const ativos = profissionais

  if (compacta) {
    return (
      <nav aria-label="Profissionais" className="w-full max-w-md shrink-0">
        <CampoSelect
          rotulo="Profissional"
          value={selecionado === null ? '' : String(selecionado)}
          opcoes={ativos.map((profissional) => ({
            valor: String(profissional.id),
            rotulo: profissional.nome,
          }))}
          placeholder="Todos os profissionais"
          onChange={(evento) => {
            aoSelecionar(evento.target.value === '' ? null : Number(evento.target.value))
          }}
        />
      </nav>
    )
  }

  return (
    <nav
      aria-label="Profissionais"
      // `w-60 shrink-0` é a coluna de tela larga. Em tela estreita a página EMPILHA, e
      // largura fixa ali estoura a viewport de qualquer jeito — o empilhamento sozinho não
      // resolve (achado da conferência ao vivo, 2026-08-26).
      // a coluna cabe na janela a partir do md (change agenda-no-mouse, D4): com 24
      // profissionais ela era um dos trechos que esticavam a página. Quem ROLA é a <ul>, não
      // esta <nav> — o "Todos os profissionais" é o cabeçalho de fato da coluna e rolava
      // junto com os 24 nomes (achado do gate).
      className="flex w-full shrink-0 flex-col gap-1 xl:w-60 xl:min-h-0"
    >
      {/* A legenda diz o que a escolha FAZ. Sem ela a lista lia como cadastro, e a linha
          "Todos os profissionais" como título (achado do usuário, 2026-09-03). */}
      <p className="px-3 pb-1 text-meta font-semibold uppercase text-texto-suave">Ver a agenda de</p>
      <button
        type="button"
        onClick={() => {
          aoSelecionar(null)
        }}
        aria-pressed={selecionado === null}
        className={cn(
          'relative flex w-full items-center gap-2.5 rounded-controle px-2 py-2 text-left transition-colors duration-(--duracao-1) focus-visible:-outline-offset-2',
          selecionado === null ? CLASSE_ESCOLHIDO : 'hover:bg-moldura-hover',
        )}
      >
        {/* o mesmo lugar do avatar nas demais linhas: "todos" é uma OPÇÃO, não um cabeçalho */}
        <span
          aria-hidden="true"
          className="flex size-8 shrink-0 items-center justify-center rounded-full border-2 border-linha-forte bg-avatar-fundo text-texto-suave"
        >
          <Users className="size-4" />
        </span>
        <span
          className={cn(
            'text-corpo',
            selecionado === null ? 'font-semibold text-acento' : 'text-texto',
          )}
        >
          Todos os profissionais
        </span>
      </button>

      {/*
        A LISTA é quem rola. `px-1` é calha para o anel de foco: ele é `outline-offset: 2px`
        (4px fora da caixa) e `overflow-y:auto` faz o eixo X computar `auto`, recortando nos
        quatro lados — os botões são de largura cheia numa coluna de 240px, então o anel
        ficava cortado à esquerda e à direita (achado do gate).
        Sem `tabIndex` aqui, ao contrário da lista de espera: esta lista é toda de botões, e
        eles já dão o caminho de teclado para rolá-la.
      */}
      {/* O TETO vale ABAIXO do `xl` também, e é ele que devolve a agenda à tela.
          Na faixa 768–1280 os painéis EMPILHAM (`xl:flex-row` só liga a partir do xl) e vale a
          grade de desktop — mas a rolagem da lista só existia no `xl`. Com 29 profissionais
          medi a lista em 2554px e o topo da grade em y=2731 numa janela de 757: a agenda ficava
          3,6 telas abaixo da dobra, ou seja, não existia para quem abre a tela. É a costura
          entre o breakpoint `md` da change `agenda-no-celular` e o `xl` do layout — a faixa
          que nenhum dos dois olhava (achado do usuário, 2026-08-27). */}
      <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto pr-1 xl:max-h-none xl:min-h-0 xl:overflow-y-auto xl:pr-1">
        {ativos.map((profissional) => (
          <li key={profissional.id}>
            <button
              type="button"
              onClick={() => {
                aoSelecionar(profissional.id)
              }}
              aria-pressed={selecionado === profissional.id}
              className={cn(
                'relative flex w-full items-center gap-2.5 rounded-controle px-2 py-2 text-left transition-colors duration-(--duracao-1) focus-visible:-outline-offset-2',
                selecionado === profissional.id ? CLASSE_ESCOLHIDO : 'hover:bg-moldura-hover',
              )}
            >
              <AvatarDoProfissional
                id={profissional.id}
                fotoVersao={profissional.foto_versao ?? null}
                nome={profissional.nome}
                cor={
                  profissional.especialidades[0] === undefined
                    ? null
                    : (corPorEspecialidade.get(profissional.especialidades[0].id) ?? null)
                }
              />
              <span className="flex min-w-0 flex-col">
                <span
                  className={cn(
                    'truncate text-corpo',
                    selecionado === profissional.id ? 'font-semibold text-acento' : 'text-texto',
                  )}
                >
                  {profissional.nome}
                </span>
                {/* sem `truncate`: "Seg–Sex · 08:00–18:00 · turn…" perdia justamente a
                    palavra que diferencia o profissional; quebra em linha */}
                <span className="text-meta tabular-nums text-texto-suave">
                  {resumoDeHorarios(profissional.horarios)}
                </span>
                {profissional.especialidades.length > 0 ? (
                  <span className="truncate text-meta text-texto-suave">
                    {profissional.especialidades.map((item) => item.nome).join(', ')}
                  </span>
                ) : null}
                {profissional.obs != null && profissional.obs !== '' ? (
                  <span className="truncate text-meta text-texto-suave" title={profissional.obs}>
                    {profissional.obs}
                  </span>
                ) : null}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  )
}
