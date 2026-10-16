import { ArrowLeft, Pencil, Printer } from 'lucide-react'
import { Link } from 'react-router-dom'

import type { Profissional } from '@/tipos'

import { SeletorDeMes } from '@/componentes/indicadores/seletor-de-mes'
import { FotoDoProfissional } from '@/componentes/profissionais/foto-do-profissional'
import { Botao } from '@/componentes/ui/botao'

interface PropsDoCabecalho {
  dados: Profissional | undefined
  carregando: boolean
  ehProprio: boolean
  voltarParaALista: boolean
  podeEditar: boolean
  aoEditar: () => void
  aoMudarAFoto: () => void
  seletor?: { mes: string; mesCorrente: string; trocarMes: (mes: string) => void }
}

/** O topo da ficha: a foto, o nome, a volta — e, fora do papel, o seletor do mês, Imprimir e Editar. */
export function CabecalhoDaFicha(props: PropsDoCabecalho) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <QuemEOProfissional {...props} />
      <ControlesDoTopo dados={props.dados} podeEditar={props.podeEditar} aoEditar={props.aoEditar} seletor={props.seletor} />
    </header>
  )
}

/** A foto (com os controles dela, para quem edita), a volta para a lista, o nome e a situação. */
function QuemEOProfissional({ dados, carregando, ehProprio, voltarParaALista, podeEditar, aoMudarAFoto }: PropsDoCabecalho) {
  return (
    <div className="flex items-center gap-4">
      {dados === undefined ? null : (
        <FotoDoProfissional id={dados.id} nome={dados.nome} fotoVersao={dados.foto_versao} podeEditar={podeEditar} aoMudar={aoMudarAFoto} />
      )}
      <div className="flex flex-col gap-1">
        {voltarParaALista ? (
          <Link
            data-nao-imprimir
            to="/profissionais"
            className="flex w-fit items-center gap-1 rounded-controle text-meta font-medium text-acento hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco"
          >
            <ArrowLeft aria-hidden="true" className="size-3.5" />
            Profissionais
          </Link>
        ) : null}
        <h1 className="text-titulo font-semibold text-texto">{dados?.nome ?? (carregando ? 'Carregando…' : 'Profissional')}</h1>
        {dados === undefined ? null : (
          <p className="text-corpo text-texto-suave">
            {dados.ativo ? 'Ativo' : 'Inativo'}
            {ehProprio ? ' · a sua ficha' : ''}
          </p>
        )}
      </div>
    </div>
  )
}

/**
 * Os controles, todos FORA do papel. `flex-wrap`: em 320 px o seletor, Imprimir e Editar não cabem
 * numa linha — e nada pode empurrar a página para o lado (1.4.10).
 */
function ControlesDoTopo({ dados, podeEditar, aoEditar, seletor }: Pick<PropsDoCabecalho, 'dados' | 'podeEditar' | 'aoEditar' | 'seletor'>) {
  return (
    <div data-nao-imprimir className="flex flex-wrap items-center gap-3">
      {seletor === undefined ? null : (
        <>
          <SeletorDeMes mes={seletor.mes} mesCorrente={seletor.mesCorrente} trocarMes={seletor.trocarMes} rotulo="Mês do painel" />
          <Botao variante="secundario" tamanho="sm" aria-label="Imprimir o painel" onClick={() => window.print()}>
            <Printer aria-hidden="true" className="size-4" />
            Imprimir
          </Botao>
        </>
      )}
      {podeEditar && dados !== undefined ? (
        <Botao variante="secundario" onClick={aoEditar}>
          <Pencil size={16} aria-hidden="true" />
          Editar cadastro
        </Botao>
      ) : null}
    </div>
  )
}
