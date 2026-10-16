import { ShieldAlert } from 'lucide-react'
import { useState } from 'react'

import { Botao } from '@/componentes/ui/botao'
import { CampoCheckbox } from '@/componentes/ui/campo-checkbox'
import { CampoSelect } from '@/componentes/ui/campo-select'
import { CampoTexto } from '@/componentes/ui/campo-texto'
import { CampoTextoLongo } from '@/componentes/ui/campo-texto-longo'
import { Dialog } from '@/componentes/ui/dialog'
import { ROTULO_DA_COLUNA, ROTULO_DA_PRIORIDADE } from '@/lib/quadro-de-tarefas'
import type {
  ColunaDeTarefa,
  ParticipanteDoMural,
  PayloadTarefa,
  PrioridadeDeTarefa,
  Tarefa,
} from '@/tipos'
import { COLUNAS_DE_TAREFA, PRIORIDADES_DE_TAREFA } from '@/tipos'

export interface ModalTarefaProps {
  aberto: boolean
  aoMudarAberto: (aberto: boolean) => void
  /** null = criar; a edição hidrata do ITEM da lista por prop (sem chave de detalhe) */
  tarefa: Tarefa | null
  /** coluna pré-selecionada quando a criação nasce do `+` de uma coluna */
  colunaInicial?: ColunaDeTarefa
  participantes: readonly ParticipanteDoMural[]
  podeEditar: boolean
  salvando: boolean
  aoSalvar: (payload: PayloadTarefa) => void
}

/**
 * Criar/editar tarefa (spec tarefas-tela): formulário no padrão do design
 * system, erro por campo, multi-seleção de responsáveis e a orientação de
 * minimização SEMPRE visível — o mural é operacional; dado clínico de paciente
 * não entra aqui (LGPD §12/§16).
 *
 * Monte com `key={tarefa?.id ?? 'nova'}`: o estado hidrata UMA vez por abertura.
 */
export function ModalTarefa({
  aberto,
  aoMudarAberto,
  tarefa,
  colunaInicial = 'a_fazer',
  participantes,
  podeEditar,
  salvando,
  aoSalvar,
}: ModalTarefaProps) {
  const [titulo, setTitulo] = useState(tarefa?.titulo ?? '')
  const [descricao, setDescricao] = useState(tarefa?.descricao ?? '')
  const [coluna, setColuna] = useState<ColunaDeTarefa>(tarefa?.coluna ?? colunaInicial)
  const [prioridade, setPrioridade] = useState<PrioridadeDeTarefa>(tarefa?.prioridade ?? 'media')
  const [prazo, setPrazo] = useState(tarefa?.prazo ?? '')
  const [etiquetas, setEtiquetas] = useState(tarefa?.etiquetas ?? '')
  const [responsaveis, setResponsaveis] = useState<number[]>(
    tarefa?.responsaveis.map((r) => r.id) ?? [],
  )
  const [erroTitulo, setErroTitulo] = useState<string | undefined>(undefined)

  const somenteLeitura = tarefa !== null && !podeEditar

  function alternarResponsavel(id: number, marcado: boolean) {
    setResponsaveis((atuais) => (marcado ? [...atuais, id] : atuais.filter((r) => r !== id)))
  }

  function submeter(evento: React.FormEvent) {
    evento.preventDefault()
    const tituloAparado = titulo.trim()
    if (tituloAparado.length < 2) {
      setErroTitulo('Dê um título de pelo menos 2 caracteres.')
      return
    }
    setErroTitulo(undefined)
    aoSalvar({
      titulo: tituloAparado,
      descricao: descricao.trim() === '' ? null : descricao.trim(),
      coluna,
      prioridade,
      prazo: prazo === '' ? null : prazo,
      etiquetas: etiquetas.trim() === '' ? null : etiquetas.trim(),
      responsaveis,
    })
  }

  return (
    <Dialog
      aberto={aberto}
      aoMudarAberto={aoMudarAberto}
      titulo={tarefa === null ? 'Nova tarefa' : somenteLeitura ? tarefa.titulo : 'Editar tarefa'}
      className="max-w-2xl"
    >
      <form onSubmit={submeter} noValidate className="flex flex-col gap-4">
        {/* orientação PERMANENTE de minimização (spec tarefas-tela · LGPD) */}
        <p className="flex items-start gap-2 rounded-controle bg-neutro-100 px-3 py-2 text-meta text-texto-suave">
          <ShieldAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          O mural é operacional. Não registre dado clínico nem pessoal de paciente aqui — o
          prontuário é o lugar certo.
        </p>

        <CampoTexto
          rotulo="Título"
          value={titulo}
          onChange={(evento) => setTitulo(evento.target.value)}
          erro={erroTitulo}
          required
          disabled={somenteLeitura || salvando}
          maxLength={200}
        />

        <CampoTextoLongo
          rotulo="Descrição"
          value={descricao}
          onChange={(evento) => setDescricao(evento.target.value)}
          linhas={3}
          limite={5000}
          disabled={somenteLeitura || salvando}
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <CampoSelect
            rotulo="Coluna"
            value={coluna}
            onChange={(evento) => setColuna(evento.target.value as ColunaDeTarefa)}
            opcoes={COLUNAS_DE_TAREFA.map((valor) => ({ valor, rotulo: ROTULO_DA_COLUNA[valor] }))}
            disabled={somenteLeitura || salvando}
          />
          <CampoSelect
            rotulo="Prioridade"
            value={prioridade}
            onChange={(evento) => setPrioridade(evento.target.value as PrioridadeDeTarefa)}
            opcoes={PRIORIDADES_DE_TAREFA.map((valor) => ({
              valor,
              rotulo: ROTULO_DA_PRIORIDADE[valor],
            }))}
            disabled={somenteLeitura || salvando}
          />
          <CampoTexto
            rotulo="Prazo"
            type="date"
            value={prazo}
            onChange={(evento) => setPrazo(evento.target.value)}
            disabled={somenteLeitura || salvando}
          />
        </div>

        <CampoTexto
          rotulo="Etiquetas"
          value={etiquetas}
          onChange={(evento) => setEtiquetas(evento.target.value)}
          ajuda="Separadas por vírgula — ex.: recepção, compras"
          disabled={somenteLeitura || salvando}
          maxLength={255}
        />

        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1 text-meta font-medium text-texto">
            Responsáveis {responsaveis.length > 0 ? `(${responsaveis.length})` : '— demanda aberta'}
          </legend>
          {participantes.length === 0 ? (
            <p className="text-meta text-texto-suave">Nenhum participante ativo no mural.</p>
          ) : (
            <div className="grid max-h-44 grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2">
              {participantes.map((participante) => (
                <CampoCheckbox
                  key={participante.id}
                  rotulo={participante.nome}
                  marcado={responsaveis.includes(participante.id)}
                  aoMudar={(marcado) => alternarResponsavel(participante.id, marcado)}
                  desabilitado={somenteLeitura || salvando}
                />
              ))}
            </div>
          )}
        </fieldset>

        <div className="flex justify-end gap-2">
          <Botao type="button" variante="secundario" onClick={() => aoMudarAberto(false)}>
            {somenteLeitura ? 'Fechar' : 'Cancelar'}
          </Botao>
          {somenteLeitura ? null : (
            <Botao type="submit" carregando={salvando}>
              {tarefa === null ? 'Criar tarefa' : 'Salvar'}
            </Botao>
          )}
        </div>
      </form>
    </Dialog>
  )
}
