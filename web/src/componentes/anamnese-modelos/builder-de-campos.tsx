import { ChevronDown, ChevronUp, CircleAlert, Plus, Trash2, X } from 'lucide-react'
import { useEffect, useId, useRef } from 'react'

import { Botao } from '@/componentes/ui/botao'
import { CampoCheckbox } from '@/componentes/ui/campo-checkbox'
import { CampoSelect } from '@/componentes/ui/campo-select'
import { CampoTexto } from '@/componentes/ui/campo-texto'
import { erroDoItem } from '@/lib/erros'
import type { ErrosDoServidor } from '@/lib/erros'
import {
  campoNovo,
  MAX_CAMPOS,
  TIPOS_DE_CAMPO,
  type CampoEmEdicao,
  type ErrosDoModelo,
} from '@/lib/modelo-de-anamnese'

interface BuilderDeCamposProps {
  campos: CampoEmEdicao[]
  aoMudar: (campos: CampoEmEdicao[]) => void
  /** Erros do SERVIDOR (`campos_json.N.*`) — mapeados por índice. */
  erros: ErrosDoServidor
  /** Erros de CLIENTE (por `_key`) — bloqueiam antes do envio. */
  errosCliente: ErrosDoModelo
}

/**
 * O builder de campos do modelo de anamnese (change anamnese-modelos-tela).
 *
 * Espelha o schema que o `AnamneseModeloRequest` valida: cada campo tem rótulo, tipo,
 * flag de obrigatório e — só no tipo `opcoes` — a lista de opções. O `id` NÃO é editável
 * aqui: nasce do rótulo em `paraCamposJson` e, num campo já existente, é preservado
 * (trocá-lo orfanaria respostas — resíduo `ANM-SNAPSHOT`).
 *
 * A11y (SEC/A11Y): ao adicionar, o foco vai ao rótulo do campo novo; ao remover, a um
 * ponto estável (o vizinho, ou o botão "Adicionar campo") — nunca ao topo da página.
 */
export function BuilderDeCampos({ campos, aoMudar, erros, errosCliente }: BuilderDeCamposProps) {
  const idGeral = useId()
  const refsRotulo = useRef(new Map<number, HTMLInputElement | null>())
  const refAdicionar = useRef<HTMLButtonElement>(null)
  const focarRef = useRef<number | null>(null)

  // foco pós-commit: o `_key` marcado em adicionar/remover recebe o foco depois do render
  useEffect(() => {
    const key = focarRef.current
    if (key === null) {
      return
    }
    focarRef.current = null
    refsRotulo.current.get(key)?.focus()
  })

  function atualizarCampo(key: number, parciais: Partial<CampoEmEdicao>): void {
    aoMudar(campos.map((campo) => (campo._key === key ? { ...campo, ...parciais } : campo)))
  }

  function adicionar(): void {
    if (campos.length >= MAX_CAMPOS) {
      return
    }
    const novo = campoNovo()
    focarRef.current = novo._key
    aoMudar([...campos, novo])
  }

  function remover(key: number): void {
    const indice = campos.findIndex((campo) => campo._key === key)
    const restantes = campos.filter((campo) => campo._key !== key)
    const vizinho = restantes[indice - 1] ?? restantes[indice]
    if (vizinho !== undefined) {
      focarRef.current = vizinho._key
    } else {
      refAdicionar.current?.focus()
    }
    aoMudar(restantes)
  }

  function mover(key: number, direcao: -1 | 1): void {
    const indice = campos.findIndex((campo) => campo._key === key)
    const destino = indice + direcao
    if (destino < 0 || destino >= campos.length) {
      return
    }
    const copia = [...campos]
    const [movido] = copia.splice(indice, 1)
    copia.splice(destino, 0, movido)
    aoMudar(copia)
  }

  function mudarTipo(campo: CampoEmEdicao, tipo: CampoEmEdicao['tipo']): void {
    const parciais: Partial<CampoEmEdicao> = { tipo }
    // ao virar "opções", semeia uma opção vazia para o usuário ver o formato
    if (tipo === 'opcoes' && campo.opcoes.length === 0) {
      parciais.opcoes = ['']
    }
    atualizarCampo(campo._key, parciais)
  }

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="px-1 text-rotulo font-medium text-texto">Campos do modelo</legend>

      {errosCliente.geralCampos !== undefined ? (
        <p id={idGeral} role="alert" className="flex items-center gap-1.5 text-meta text-perigo-texto">
          <CircleAlert aria-hidden="true" className="size-3.5 shrink-0" />
          {errosCliente.geralCampos}
        </p>
      ) : null}

      <ol className="flex flex-col gap-3">
        {campos.map((campo, indice) => {
          const doCliente = errosCliente.porCampo.get(campo._key)
          const erroRotulo = doCliente?.rotulo ?? erroDoItem(erros, 'campos_json', indice, 'rotulo')
          const erroOpcoes = doCliente?.opcoes ?? erroDoItem(erros, 'campos_json', indice, 'opcoes')

          return (
            <li
              key={campo._key}
              className="flex flex-col gap-3 rounded-superficie border border-linha-forte bg-fundo p-4"
            >
              <div className="flex items-center justify-between">
                <span className="text-meta font-medium text-texto-suave">Campo {indice + 1}</span>
                <div className="flex items-center gap-1">
                  <Botao
                    type="button"
                    variante="fantasma"
                    tamanho="sm"
                    onClick={() => {
                      mover(campo._key, -1)
                    }}
                    disabled={indice === 0}
                    aria-label={`Mover o campo ${indice + 1} para cima`}
                  >
                    <ChevronUp aria-hidden="true" className="size-4" />
                  </Botao>
                  <Botao
                    type="button"
                    variante="fantasma"
                    tamanho="sm"
                    onClick={() => {
                      mover(campo._key, 1)
                    }}
                    disabled={indice === campos.length - 1}
                    aria-label={`Mover o campo ${indice + 1} para baixo`}
                  >
                    <ChevronDown aria-hidden="true" className="size-4" />
                  </Botao>
                  <Botao
                    type="button"
                    variante="fantasma"
                    tamanho="sm"
                    onClick={() => {
                      remover(campo._key)
                    }}
                    aria-label={`Remover o campo ${indice + 1}`}
                  >
                    <Trash2 aria-hidden="true" className="size-4 text-perigo-texto" />
                  </Botao>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <CampoTexto
                  ref={(elemento) => {
                    refsRotulo.current.set(campo._key, elemento)
                  }}
                  rotulo="Rótulo do campo"
                  obrigatorio
                  value={campo.rotulo}
                  onChange={(evento) => {
                    atualizarCampo(campo._key, { rotulo: evento.target.value })
                  }}
                  erro={erroRotulo}
                />
                <CampoSelect
                  rotulo="Tipo"
                  value={campo.tipo}
                  onChange={(evento) => {
                    mudarTipo(campo, evento.target.value as CampoEmEdicao['tipo'])
                  }}
                  opcoes={TIPOS_DE_CAMPO.map(({ valor, rotulo }) => ({ valor, rotulo }))}
                />
              </div>

              <CampoCheckbox
                rotulo="Resposta obrigatória"
                marcado={campo.obrigatorio}
                aoMudar={(marcado) => {
                  atualizarCampo(campo._key, { obrigatorio: marcado })
                }}
              />

              {campo.tipo === 'opcoes' ? (
                <EditorDeOpcoes
                  campo={campo}
                  erro={erroOpcoes}
                  aoMudar={(opcoes) => {
                    atualizarCampo(campo._key, { opcoes })
                  }}
                />
              ) : null}
            </li>
          )
        })}
      </ol>

      <div>
        <Botao
          ref={refAdicionar}
          type="button"
          variante="secundario"
          tamanho="sm"
          onClick={adicionar}
          disabled={campos.length >= MAX_CAMPOS}
        >
          <Plus aria-hidden="true" className="size-4" />
          Adicionar campo
        </Botao>
      </div>
    </fieldset>
  )
}

/** Sub-editor das opções de um campo `tipo: 'opcoes'`. */
function EditorDeOpcoes({
  campo,
  erro,
  aoMudar,
}: {
  campo: CampoEmEdicao
  erro?: string
  aoMudar: (opcoes: string[]) => void
}) {
  const idErro = useId()
  // foco (paridade com o builder de campos): ao adicionar, vai à opção nova; ao remover,
  // à opção vizinha (ou ao botão "Adicionar opção") — nunca ao `body`.
  const refsOpcao = useRef(new Map<number, HTMLInputElement | null>())
  const refAdicionar = useRef<HTMLButtonElement>(null)
  const focarIndice = useRef<number | null>(null)

  useEffect(() => {
    const indice = focarIndice.current
    if (indice === null) {
      return
    }
    focarIndice.current = null
    refsOpcao.current.get(indice)?.focus()
  })

  function definir(indice: number, valor: string): void {
    aoMudar(campo.opcoes.map((opcao, i) => (i === indice ? valor : opcao)))
  }

  function adicionar(): void {
    focarIndice.current = campo.opcoes.length
    aoMudar([...campo.opcoes, ''])
  }

  function remover(indice: number): void {
    const restantes = campo.opcoes.filter((_, i) => i !== indice)
    if (restantes.length === 0) {
      refAdicionar.current?.focus()
    } else {
      focarIndice.current = indice > 0 ? indice - 1 : 0
    }
    aoMudar(restantes)
  }

  return (
    <div className="flex flex-col gap-2 rounded-controle border border-linha bg-superficie p-3">
      <span className="text-meta font-medium text-texto-suave">Opções</span>
      <ul className="flex flex-col gap-2">
        {campo.opcoes.map((opcao, indice) => (
          <li key={indice} className="flex items-center gap-2">
            <input
              ref={(elemento) => {
                refsOpcao.current.set(indice, elemento)
              }}
              value={opcao}
              onChange={(evento) => {
                definir(indice, evento.target.value)
              }}
              aria-label={`Opção ${indice + 1}`}
              aria-invalid={erro !== undefined ? true : undefined}
              aria-describedby={erro !== undefined ? idErro : undefined}
              className="h-9 w-full rounded-campo border border-borda-campo bg-superficie px-3 text-corpo text-texto placeholder:text-texto-suave focus-visible:border-foco"
            />
            <Botao
              type="button"
              variante="fantasma"
              tamanho="sm"
              onClick={() => {
                remover(indice)
              }}
              aria-label={`Remover a opção ${indice + 1}`}
            >
              <X aria-hidden="true" className="size-4" />
            </Botao>
          </li>
        ))}
      </ul>
      {erro !== undefined ? (
        <p id={idErro} role="alert" className="flex items-center gap-1.5 text-meta text-perigo-texto">
          <CircleAlert aria-hidden="true" className="size-3.5 shrink-0" />
          {erro}
        </p>
      ) : null}
      <div>
        <Botao ref={refAdicionar} type="button" variante="fantasma" tamanho="sm" onClick={adicionar}>
          <Plus aria-hidden="true" className="size-4" />
          Adicionar opção
        </Botao>
      </div>
    </div>
  )
}
