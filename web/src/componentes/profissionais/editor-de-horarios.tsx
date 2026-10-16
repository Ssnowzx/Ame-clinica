import { Plus, X } from 'lucide-react'

import { Botao } from '@/componentes/ui/botao'
import { CampoCheckbox } from '@/componentes/ui/campo-checkbox'
import { CampoTexto } from '@/componentes/ui/campo-texto'
import type { ErrosDoServidor } from '@/lib/erros'
import {
  DIAS_SEMANA_HORARIOS,
  MAX_INTERVALOS_DIA,
  intervaloNovo,
  type FormHorarios,
} from '@/lib/horarios-profissional'

interface EditorDeHorariosProps {
  horarios: FormHorarios
  aoMudar: (horarios: FormHorarios) => void
  /** Erros de CLIENTE por chave `${dia}.${indice}.inicio|fim`. */
  errosCliente: Map<string, string>
  /** Erros do SERVIDOR (`horarios.<dia>.<indice>.inicio|fim`). */
  erros: ErrosDoServidor
}

/**
 * Editor de horários de atendimento por dia (change horarios-por-dia-do-profissional). Marque o
 * dia e adicione um ou mais intervalos (turno partido). Deixe todos desmarcados = atende todos os
 * dias na janela padrão da clínica. Validação (início<fim, sem sobreposição) espelha o servidor.
 */
export function EditorDeHorarios({ horarios, aoMudar, errosCliente, erros }: EditorDeHorariosProps) {
  function alternarDia(dia: number, marcado: boolean): void {
    if (marcado) {
      aoMudar({ ...horarios, [dia]: [intervaloNovo()] })
      return
    }
    const resto = { ...horarios }
    delete resto[dia]
    aoMudar(resto)
  }

  function adicionarIntervalo(dia: number): void {
    aoMudar({ ...horarios, [dia]: [...(horarios[dia] ?? []), intervaloNovo()] })
  }

  function removerIntervalo(dia: number, indice: number): void {
    const restantes = (horarios[dia] ?? []).filter((_, i) => i !== indice)
    if (restantes.length === 0) {
      // sem intervalo o dia não atende — desmarca o dia
      const resto = { ...horarios }
      delete resto[dia]
      aoMudar(resto)
      return
    }
    aoMudar({ ...horarios, [dia]: restantes })
  }

  function definirCampo(dia: number, indice: number, campo: 'inicio' | 'fim', valor: string): void {
    aoMudar({
      ...horarios,
      [dia]: (horarios[dia] ?? []).map((intervalo, i) =>
        i === indice ? { ...intervalo, [campo]: valor } : intervalo,
      ),
    })
  }

  function erroDe(dia: number, indice: number, campo: 'inicio' | 'fim'): string | undefined {
    return errosCliente.get(`${dia}.${indice}.${campo}`) ?? erros.campos.get(`horarios.${dia}.${indice}.${campo}`)
  }

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-meta font-medium text-texto">Horários de atendimento</legend>
      <p className="text-meta text-texto-suave">
        Marque os dias e informe os horários (mais de um por dia para turno partido). Deixe todos
        desmarcados para atender em todos os dias na janela padrão da clínica.
      </p>

      <div className="flex flex-col gap-2">
        {DIAS_SEMANA_HORARIOS.map((dia) => {
          const intervalos = horarios[dia.valor]
          const atende = intervalos !== undefined

          return (
            <div key={dia.valor} className="rounded-superficie border border-linha bg-fundo p-3">
              <CampoCheckbox
                rotulo={dia.rotulo}
                marcado={atende}
                aoMudar={(marcado) => {
                  alternarDia(dia.valor, marcado)
                }}
              />

              {atende ? (
                <ul className="mt-2 flex flex-col gap-2 pl-7">
                  {intervalos.map((intervalo, indice) => (
                    <li key={indice} className="flex items-end gap-2">
                      <CampoTexto
                        rotulo="Início"
                        type="time"
                        value={intervalo.inicio}
                        onChange={(evento) => {
                          definirCampo(dia.valor, indice, 'inicio', evento.target.value)
                        }}
                        erro={erroDe(dia.valor, indice, 'inicio')}
                      />
                      <span aria-hidden="true" className="pb-2.5 text-texto-suave">
                        –
                      </span>
                      <CampoTexto
                        rotulo="Fim"
                        type="time"
                        value={intervalo.fim}
                        onChange={(evento) => {
                          definirCampo(dia.valor, indice, 'fim', evento.target.value)
                        }}
                        erro={erroDe(dia.valor, indice, 'fim')}
                      />
                      <Botao
                        type="button"
                        variante="fantasma"
                        tamanho="sm"
                        onClick={() => {
                          removerIntervalo(dia.valor, indice)
                        }}
                        aria-label={`Remover o intervalo ${indice + 1} de ${dia.rotulo}`}
                      >
                        <X aria-hidden="true" className="size-4" />
                      </Botao>
                    </li>
                  ))}
                  <li>
                    <Botao
                      type="button"
                      variante="fantasma"
                      tamanho="sm"
                      onClick={() => {
                        adicionarIntervalo(dia.valor)
                      }}
                      disabled={intervalos.length >= MAX_INTERVALOS_DIA}
                    >
                      <Plus aria-hidden="true" className="size-4" />
                      Adicionar intervalo
                    </Botao>
                  </li>
                </ul>
              ) : null}
            </div>
          )
        })}
      </div>
    </fieldset>
  )
}
