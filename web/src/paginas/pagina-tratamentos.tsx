import { useQuery } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { CabecalhoDeCadastro } from '@/componentes/cadastro/cabecalho-de-cadastro'
import { EstadosDaLista } from '@/componentes/cadastro/estados-da-lista'
import { SituacaoDoTratamento } from '@/componentes/tratamentos/situacao-do-tratamento'
import { Botao } from '@/componentes/ui/botao'
import { Paginacao } from '@/componentes/ui/paginacao'
import { Tabela } from '@/componentes/ui/tabela'
import { chaves } from '@/lib/chaves-query'
import { cn } from '@/lib/cn'
import { listarTratamentos } from '@/servicos/tratamentos'
import { useAuthStore } from '@/stores/auth-store'
import type { FiltroDeTratamentos, TratamentoDaLista } from '@/tipos'

/** O que a clínica pergunta — não "o que existe na tabela". */
const RECORTES = [
  // o limiar é da CLÍNICA: a tela diz o que quer, o servidor sabe quanto é
  { id: 'acabando', rotulo: 'Acabando', filtro: { status: 'andamento', acabando: true } },
  { id: 'vencidos', rotulo: 'Vencidos', filtro: { vencido: true } },
  { id: 'parados', rotulo: 'Parados', filtro: { status: 'parado' } },
  { id: 'todos', rotulo: 'Todos', filtro: {} },
] as const satisfies ReadonlyArray<{
  id: string
  rotulo: string
  filtro: Omit<FiltroDeTratamentos, 'pagina' | 'paciente_id'>
}>

/**
 * Os tratamentos, pela pergunta que a clínica faz — **quem está acabando**, **quem
 * venceu**, **quem parou** —, não pela ordem do banco.
 *
 * Um pacote que termina sem ninguém ver é uma sessão dada de graça, ou uma criança
 * que some da agenda sem ninguém ligar para a família.
 *
 * **O filtro é do SERVIDOR.** Filtrar depois de paginar daria resposta errada (a
 * página é uma amostra, não o conjunto), e recalcular `vencido` no navegador usaria
 * o fuso do CLIENTE — a clínica tem o dela (§13).
 */
function NomeDoPaciente({ tratamento }: { tratamento: TratamentoDaLista }) {
  const podeAbrirCadastro = useAuthStore((estado) => estado.temPermissao('pacientes.ver'))
  const nome = tratamento.paciente?.nome_social ?? tratamento.paciente?.nome ?? 'Paciente'

  if (!podeAbrirCadastro) {
    return <span className="text-corpo font-medium text-texto">{nome}</span>
  }

  return (
    <Link
      to={`/pacientes/${tratamento.paciente_id}`}
      className={cn(
        'text-corpo font-medium text-acento underline-offset-2 hover:underline',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco',
      )}
    >
      {nome}
    </Link>
  )
}

/**
 * O vazio fala do RECORTE que está na tela.
 *
 * A descrição era fixa em "Bom sinal: ninguém está prestes a ficar sem sessões" para os
 * quatro filtros — verdade só em "Acabando". Em "Todos" chegava a mentir: base sem
 * tratamento nenhum, e a tela parabenizando a clínica (achado da validação em produção,
 * 2026-08-21). O vazio também não dizia por onde se cria um tratamento; agora diz.
 */
const VAZIO_POR_RECORTE: Record<string, { titulo: string; descricao: string }> = {
  acabando: {
    titulo: 'Nenhum tratamento acabando',
    descricao: 'Bom sinal: ninguém está prestes a ficar sem sessões.',
  },
  vencidos: {
    titulo: 'Nenhum tratamento vencido',
    descricao: 'Nenhum pacote passou da data de validade.',
  },
  parados: {
    titulo: 'Nenhum tratamento parado',
    descricao: 'Nenhum pacote em andamento foi interrompido.',
  },
  todos: {
    titulo: 'Nenhum tratamento neste recorte',
    descricao: 'O tratamento nasce na ficha do paciente, na seção Tratamentos.',
  },
}

export function PaginaTratamentos() {
  // chegada pela FICHA do profissional (`?profissional_id=`): a lista recorta por
  // ele e a volta aponta para a ficha — valor de URL não confiável (lixo → ignora)
  const [parametros] = useSearchParams()
  const profissionalBruto = Number(parametros.get('profissional_id'))
  const profissionalDaFicha =
    Number.isInteger(profissionalBruto) && profissionalBruto > 0 ? profissionalBruto : null

  const [recorte, setRecorte] = useState<(typeof RECORTES)[number]['id']>(
    // vindo da ficha, a pergunta é "TODOS os pacotes deste profissional" — não "quem
    // está acabando na clínica inteira"
    profissionalDaFicha !== null ? 'todos' : 'acabando',
  )
  const [pagina, setPagina] = useState(1)

  const escolhido = RECORTES.find(({ id }) => id === recorte) ?? RECORTES[0]
  const filtro: FiltroDeTratamentos = {
    ...escolhido.filtro,
    ...(profissionalDaFicha !== null ? { profissional_id: profissionalDaFicha } : {}),
    pagina,
  }

  const consulta = useQuery({
    queryKey: chaves.tratamentos(filtro),
    queryFn: () => listarTratamentos(filtro),
  })

  const tratamentos = consulta.data?.data ?? []
  const total = consulta.data?.total ?? 0

  return (
    <section className="flex flex-col gap-6">
      {profissionalDaFicha !== null ? (
        <Link
          to={`/profissionais/${profissionalDaFicha}`}
          className="flex w-fit items-center gap-1 rounded-controle text-meta font-medium text-acento hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco"
        >
          <ArrowLeft aria-hidden="true" className="size-3.5" />
          Ficha do profissional
        </Link>
      ) : null}
      <CabecalhoDeCadastro
        titulo={profissionalDaFicha !== null ? 'Tratamentos do profissional' : 'Tratamentos'}
        contador={consulta.isSuccess ? `${total} tratamentos` : undefined}
      />

      <div className="flex flex-wrap gap-2" role="group" aria-label="Recorte da lista">
        {RECORTES.map(({ id, rotulo }) => (
          <Botao
            key={id}
            variante={id === recorte ? 'primario' : 'secundario'}
            tamanho="sm"
            aria-pressed={id === recorte}
            onClick={() => {
              setRecorte(id)
              setPagina(1)
            }}
          >
            {rotulo}
          </Botao>
        ))}
      </div>

      <EstadosDaLista
        carregando={consulta.isPending}
        erro={consulta.isError}
        aoTentarNovamente={() => {
          void consulta.refetch()
        }}
        vazio={consulta.isSuccess && tratamentos.length === 0}
        vazioTitulo={VAZIO_POR_RECORTE[recorte].titulo}
        vazioDescricao={VAZIO_POR_RECORTE[recorte].descricao}
      >
        <Tabela legenda={`${total} tratamentos`}>
          <Tabela.Cabecalho>
            <Tabela.Linha>
              <Tabela.CelulaCabecalho scope="col">Paciente</Tabela.CelulaCabecalho>
              <Tabela.CelulaCabecalho scope="col">Sessões e situação</Tabela.CelulaCabecalho>
              <Tabela.CelulaCabecalho scope="col">Início</Tabela.CelulaCabecalho>
            </Tabela.Linha>
          </Tabela.Cabecalho>
          <Tabela.Corpo>
            {tratamentos.map((tratamento) => (
              <Tabela.Linha key={tratamento.id}>
                <Tabela.Celula>
                  {/* o nome vem do servidor por whitelist — o cadastro do menor
                      (nascimento, necessidade) NÃO é exigido para ver a lista. Por
                      isso o LINK para o cadastro só existe para quem pode abri-lo:
                      oferecer um caminho que termina em "acesso negado" é mentir. */}
                  <NomeDoPaciente tratamento={tratamento} />
                </Tabela.Celula>
                <Tabela.Celula>
                  <SituacaoDoTratamento tratamento={tratamento} />
                </Tabela.Celula>
                <Tabela.Celula>
                  {tratamento.data_inicio === null
                    ? '—'
                    : tratamento.data_inicio.split('-').reverse().join('/')}
                </Tabela.Celula>
              </Tabela.Linha>
            ))}
          </Tabela.Corpo>
        </Tabela>

        {consulta.data !== undefined && consulta.data.last_page > 1 ? (
          <Paginacao
            pagina={consulta.data.current_page}
            totalPaginas={consulta.data.last_page}
            totalItens={total}
            aoMudar={setPagina}
          />
        ) : null}
      </EstadosDaLista>
    </section>
  )
}
