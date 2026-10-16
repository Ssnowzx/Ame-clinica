import { useQuery } from '@tanstack/react-query'
import { AlertDialog } from 'radix-ui'
import { useId, useRef, useState } from 'react'

import { EditorDeHorarios } from '@/componentes/profissionais/editor-de-horarios'
import { AvisoDePreRequisito } from '@/componentes/ui/aviso-de-pre-requisito'
import { AvisoErro } from '@/componentes/ui/aviso-erro'
import { Botao } from '@/componentes/ui/botao'
import { CampoCheckbox } from '@/componentes/ui/campo-checkbox'
import { CampoSelect } from '@/componentes/ui/campo-select'
import { CampoTexto } from '@/componentes/ui/campo-texto'
import { DialogConfirmacao } from '@/componentes/ui/dialog-confirmacao'
import { CampoTextoLongo } from '@/componentes/ui/campo-texto-longo'
import { usarMutacaoDeProfissional } from '@/hooks/usar-mutacao-de-profissional'
import { CAMINHOS } from '@/lib/caminhos-dos-cadastros'
import { chaves } from '@/lib/chaves-query'
import { devolverOFoco, levarOFocoParaDentro } from '@/lib/foco-do-dialogo'
import {
  formParaMapa,
  mapaParaForm,
  validarHorarios,
  type FormHorarios,
} from '@/lib/horarios-profissional'
import { TEMPO_CATALOGO_MS } from '@/lib/query-client'
import { OPCOES_DE_UF } from '@/lib/ufs'
import { listarEspecialidades } from '@/servicos/catalogos'
import { listarCbos } from '@/servicos/profissionais'
import type { PayloadProfissional, Profissional } from '@/tipos'

interface Formulario {
  nome: string
  conselho: string
  uf_conselho: string
  num_conselho: string
  cbos_id: string
  obs: string
  /** string porque é `<input type="number">`: o vazio tem de sobreviver à digitação */
  atendimentos_simultaneos: string
  mensagens_automaticas: boolean
  ativo: boolean
  especialidades: number[]
  horarios: FormHorarios
}

/** A mudança de regra a confirmar antes de gravar: o título nomeia QUAL regra muda. */
interface Confirmacao {
  titulo: string
  consequencia: string
  rotulo: string
}

const VAZIO: Formulario = {
  nome: '',
  conselho: '',
  uf_conselho: '',
  num_conselho: '',
  cbos_id: '',
  obs: '',
  atendimentos_simultaneos: '1',
  mensagens_automaticas: true,
  ativo: true,
  especialidades: [],
  horarios: {},
}

/**
 * Campo vazio (ou zero, ou lixo) ⇒ **1**, o default do cadastro e a posição segura: quem apagou
 * o número queria "um por vez", não um 422 sobre tipo.
 *
 * Isto NÃO é a faixa reimplementada na tela: valores acima do teto seguem inteiros para o
 * servidor, e é a recusa DELE que pousa no campo (o `max` do input é só defesa em profundidade
 * do navegador). O piso é diferente do teto porque "apagou o campo" é gesto de quem está
 * digitando, não tentativa de desligar a guarda — recusar ali seria ruído, e o valor que ele
 * quer dizer é exatamente o default.
 */
function simultaneosDoFormulario(valor: string): number {
  const numero = Number.parseInt(valor, 10)
  return Number.isFinite(numero) && numero >= 1 ? numero : 1
}

function doProfissional(profissional: Profissional): Formulario {
  return {
    nome: profissional.nome,
    conselho: profissional.conselho ?? '',
    uf_conselho: profissional.uf_conselho ?? '',
    num_conselho: profissional.num_conselho ?? '',
    cbos_id: profissional.cbos_id !== null ? String(profissional.cbos_id) : '',
    obs: profissional.obs ?? '',
    atendimentos_simultaneos: String(profissional.atendimentos_simultaneos ?? 1),
    mensagens_automaticas: profissional.mensagens_automaticas ?? true,
    ativo: profissional.ativo,
    especialidades: profissional.especialidades.map((especialidade) => especialidade.id),
    // mapa vazio = todos os dias (retrocompat); volta a `{}` no payload
    horarios: mapaParaForm(profissional.horarios),
  }
}

export interface FormularioProfissionalProps {
  aberto: boolean
  aoFechar: () => void
  /** Edição quando presente */
  profissional?: Profissional | null
}

/**
 * Cadastro do profissional (§5). O conselho é opcional — mas o TRIO (conselho,
 * UF, número) anda junto: a API exige um quando outro vem. A janela alimenta a
 * grade; as especialidades N:M decidem o que a agenda aceita marcar com ele.
 */
export function FormularioProfissional({ aberto, aoFechar, profissional = null }: FormularioProfissionalProps) {
  const editando = profissional !== null
  const refDisparador = useRef<HTMLElement | null>(null)
  const refConteudo = useRef<HTMLDivElement>(null)
  const [form, setForm] = useState<Formulario>(profissional !== null ? doProfissional(profissional) : VAZIO)
  const [errosCliente, setErrosCliente] = useState<Map<string, string>>(new Map())
  /**
   * A consequência a confirmar antes de gravar — `null` = nada de REGRA mudou (§2/§13).
   *
   * "Atendimentos ao mesmo tempo" não é preferência: ele decide o que a agenda ACEITA. Subir
   * afrouxa a guarda que impede marcar duas crianças por engano no mesmo horário; descer fecha
   * horários que a recepção vinha usando. O cadastro de salas já confirmava o irmão dele — aqui
   * faltava, justamente no campo que motivou a change (parecer SEC-AG-05).
   */
  const [aConfirmar, setAConfirmar] = useState<Confirmacao | null>(null)
  const { criar, atualizar, erros, gravando } = usarMutacaoDeProfissional()
  const idDoCatalogoVazio = useId()

  const especialidades = useQuery({
    queryKey: chaves.especialidades(),
    queryFn: listarEspecialidades,
    staleTime: TEMPO_CATALOGO_MS,
    enabled: aberto,
  })

  const cbos = useQuery({
    queryKey: chaves.cbos(),
    queryFn: listarCbos,
    staleTime: TEMPO_CATALOGO_MS,
    enabled: aberto,
  })

  /**
   * O catálogo de especialidades CHEGOU vazio: é a causa de a agenda não ter o que marcar com o
   * profissional (change `o-sistema-avisa-o-que-falta`). Antes, a seção ficava só com o título, sem
   * nenhuma caixa e sem dizer por quê. Sai da consulta que o formulário já faz.
   */
  const catalogoDeEspecialidadesVazio = especialidades.isSuccess && especialidades.data.length === 0

  const erroDasEspecialidades = [...erros.campos]
    .find(([chave]) => chave === 'especialidades' || chave.startsWith('especialidades.'))?.[1]

  function montarPayload(): PayloadProfissional {
    return {
      nome: form.nome,
      conselho: form.conselho !== '' ? form.conselho : null,
      uf_conselho: form.uf_conselho !== '' ? form.uf_conselho : null,
      num_conselho: form.num_conselho !== '' ? form.num_conselho : null,
      cbos_id: form.cbos_id !== '' ? Number(form.cbos_id) : null,
      obs: form.obs !== '' ? form.obs : null,
      atendimentos_simultaneos: simultaneosDoFormulario(form.atendimentos_simultaneos),
      mensagens_automaticas: form.mensagens_automaticas,
      ativo: form.ativo,
      especialidades: form.especialidades,
      // mapa VAZIO = todos os dias na janela padrão (o servidor aceita `{}`)
      horarios: formParaMapa(form.horarios),
    }
  }

  function submeter(evento: React.FormEvent) {
    evento.preventDefault()

    // validação de cliente (início<fim, sem sobreposição) — bloqueia antes da rede
    const validacao = validarHorarios(form.horarios)
    setErrosCliente(validacao)
    if (validacao.size > 0) {
      return
    }

    const confirmacao = confirmacaoDaRegra()
    if (confirmacao !== null) {
      setAConfirmar(confirmacao)
      return
    }

    gravar()
  }

  /**
   * O que a clínica VAI VER ACONTECER, em número — `null` quando o número não mudou. A frase NÃO
   * promete o que o sistema não faz: baixar o número não desmarca ninguém.
   */
  function consequenciaDosSimultaneos(cadastro: Profissional): string | null {
    const nova = simultaneosDoFormulario(form.atendimentos_simultaneos)
    const atual = cadastro.atendimentos_simultaneos ?? 1
    if (nova === atual) {
      return null
    }

    return nova > 1
      ? `${cadastro.nome} passa a atender ${nova} crianças no mesmo horário. Os agendamentos já marcados não mudam.`
      : `${cadastro.nome} volta a atender uma criança por vez. Os agendamentos já marcados continuam de pé; só as marcações novas no mesmo horário passam a ser recusadas.`
  }

  /**
   * Desmarcar a caixa cala o WhatsApp de TODAS as famílias do profissional, inclusive das sessões
   * já marcadas (change mensagens-automaticas-por-profissional). Um clique por engano viraria
   * famílias sem lembrete em silêncio; por isso confirma, dizendo o que continua saindo.
   */
  function consequenciaDasMensagens(cadastro: Profissional): string | null {
    if (form.mensagens_automaticas === (cadastro.mensagens_automaticas ?? true)) {
      return null
    }

    return form.mensagens_automaticas
      ? `As famílias atendidas por ${cadastro.nome} voltam a receber pelo WhatsApp o lembrete da véspera e a confirmação do primeiro agendamento.`
      : `As famílias atendidas por ${cadastro.nome} deixam de receber pelo WhatsApp o lembrete da véspera e a confirmação do primeiro agendamento, inclusive das sessões já marcadas. Os avisos de remarcação e de cancelamento continuam saindo quando a recepção pedir.`
  }

  /**
   * Só na EDIÇÃO: um profissional novo nasce com o valor que a pessoa acabou de escolher, e
   * confirmar o que ela está criando é o ruído que faz clicar sem ler.
   */
  function confirmacaoDaRegra(): Confirmacao | null {
    if (!editando || profissional === null) {
      return null
    }
    const simultaneos = consequenciaDosSimultaneos(profissional)
    const mensagens = consequenciaDasMensagens(profissional)
    if (simultaneos === null && mensagens === null) {
      return null
    }

    const consequencia = [simultaneos, mensagens].filter((frase) => frase !== null).join(' ')

    return simultaneos === null
      ? { titulo: 'Mudar as mensagens automáticas?', consequencia, rotulo: 'Mudar as mensagens' }
      : { titulo: 'Mudar a regra de atendimento?', consequencia, rotulo: 'Mudar a regra' }
  }

  function gravar() {
    if (editando && profissional !== null) {
      atualizar.mutate(
        { id: profissional.id, payload: montarPayload(), versao: profissional.updated_at },
        { onSuccess: aoFechar },
      )
      return
    }
    criar.mutate(montarPayload(), { onSuccess: aoFechar })
  }

  return (
    <AlertDialog.Root open={aberto} onOpenChange={(estado) => !estado && aoFechar()}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-(--z-scrim) bg-texto/40" />
        {/* sem `AlertDialog.Cancel`, o Radix não leva o foco para dentro nem sabe a quem devolvê-lo (A11Y-AVI-02) */}
        <AlertDialog.Content
          ref={refConteudo}
          onOpenAutoFocus={(evento) => {
            levarOFocoParaDentro(evento, refConteudo.current, refDisparador)
          }}
          onCloseAutoFocus={(evento) => {
            devolverOFoco(evento, refDisparador)
          }}
          className="fixed left-1/2 top-1/2 z-(--z-dialogo) max-h-[90vh] w-full max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-janela bg-superficie-elevada p-6 shadow-e3"
        >
          <AlertDialog.Title className="text-titulo font-semibold text-texto">
            {editando ? 'Editar profissional' : 'Novo profissional'}
          </AlertDialog.Title>
          <AlertDialog.Description className="sr-only">
            Preencha os dados do profissional executante.
          </AlertDialog.Description>

          <form onSubmit={submeter} className="mt-5 flex flex-col gap-4">
            <AvisoErro mensagens={erros.gerais} />

            <CampoTexto
              rotulo="Nome"
              obrigatorio
              value={form.nome}
              onChange={(evento) => {
                setForm((atual) => ({ ...atual, nome: evento.target.value }))
              }}
              erro={erros.campos.get('nome')}
            />

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <CampoTexto
                rotulo="Conselho"
                value={form.conselho}
                placeholder="CRP, CREFITO…"
                onChange={(evento) => {
                  setForm((atual) => ({ ...atual, conselho: evento.target.value }))
                }}
                ajuda="Opcional — mas UF e número vêm junto."
                erro={erros.campos.get('conselho')}
              />
              <CampoSelect
                rotulo="UF do conselho"
                value={form.uf_conselho}
                onChange={(evento) => {
                  setForm((atual) => ({ ...atual, uf_conselho: evento.target.value }))
                }}
                opcoes={OPCOES_DE_UF}
                placeholder="—"
                erro={erros.campos.get('uf_conselho')}
              />
              <CampoTexto
                rotulo="Número do conselho"
                value={form.num_conselho}
                onChange={(evento) => {
                  setForm((atual) => ({ ...atual, num_conselho: evento.target.value }))
                }}
                erro={erros.campos.get('num_conselho')}
              />
            </div>

            <CampoSelect
              rotulo="CBOS"
              value={form.cbos_id}
              onChange={(evento) => {
                setForm((atual) => ({ ...atual, cbos_id: evento.target.value }))
              }}
              opcoes={(cbos.data ?? []).map((item) => ({
                valor: String(item.id),
                rotulo: `${item.codigo} — ${item.nome}`,
              }))}
              placeholder="Sem CBOS"
              erro={erros.campos.get('cbos_id')}
            />

            <EditorDeHorarios
              horarios={form.horarios}
              aoMudar={(horarios) => {
                setForm((atual) => ({ ...atual, horarios }))
              }}
              errosCliente={errosCliente}
              erros={erros}
            />

            {/* Junto dos HORÁRIOS, e não de conselho/CBOS: é regra de AGENDA, e quem procura
                o campo está pensando na grade (change atendimento-em-grupo). O rótulo diz "ao
                mesmo tempo" porque "quantos atende" sozinho se confunde com "por dia". */}
            <CampoTexto
              rotulo="Atendimentos ao mesmo tempo"
              type="number"
              min={1}
              max={10}
              value={form.atendimentos_simultaneos}
              onChange={(evento) => {
                setForm((atual) => ({ ...atual, atendimentos_simultaneos: evento.target.value }))
              }}
              ajuda="Quantas crianças este profissional atende no mesmo horário. Deixe 1 — ou em branco — para atender uma por vez."
              erro={erros.campos.get('atendimentos_simultaneos')}
            />

            {/* o aviso DESCREVE o grupo (`aria-describedby`): parágrafo solto ao lado é relação só
                visual, e quem usa leitor de tela chegaria a um grupo sem caixa nenhuma sem ouvir o porquê.
                O caminho vai em TEXTO (design D7): o aviso fica depois de nome, conselho e horários, e
                seguir um link fecharia o diálogo e apagaria tudo o que foi digitado (gate CR-AVI-03) */}
            <fieldset
              className="flex flex-col gap-2"
              aria-describedby={catalogoDeEspecialidadesVazio ? idDoCatalogoVazio : undefined}
            >
              <legend className="text-meta font-medium text-texto">Especialidades que atende</legend>
              {catalogoDeEspecialidadesVazio ? (
                <p id={idDoCatalogoVazio} className="text-meta text-texto-suave">
                  <AvisoDePreRequisito
                    para={CAMINHOS.especialidade}
                    oQueFalta="Nenhuma especialidade cadastrada ainda — e a agenda só marca sessão com o profissional que atende alguma."
                    semLink
                  />
                </p>
              ) : null}
              {/* a recusa de FK inválida chega indexada (`especialidades.0`) —
                  casar só a chave exata deixaria o motivo invisível (parecer SEC-04) */}
              {erroDasEspecialidades !== undefined ? <AvisoErro mensagens={[erroDasEspecialidades]} /> : null}
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                {(especialidades.data ?? []).map((especialidade) => (
                  <CampoCheckbox
                    key={especialidade.id}
                    rotulo={especialidade.nome}
                    marcado={form.especialidades.includes(especialidade.id)}
                    aoMudar={(marcado) => {
                      setForm((atual) => ({
                        ...atual,
                        especialidades: marcado
                          ? [...atual.especialidades, especialidade.id]
                          : atual.especialidades.filter((id) => id !== especialidade.id),
                      }))
                    }}
                  />
                ))}
              </div>
            </fieldset>

            <CampoTextoLongo
              rotulo="Observação"
              value={form.obs}
              limite={2000}
              onChange={(evento) => {
                setForm((atual) => ({ ...atual, obs: evento.target.value }))
              }}
              erro={erros.campos.get('obs')}
            />

            {/* Junto de "Ativo": as duas caixas dizem se o profissional entra num automatismo da
                clínica (a grade, o WhatsApp). A ajuda diz o que continua — sem isso, quem desmarca
                acha que a família nunca mais recebe nada (change mensagens-automaticas-por-profissional) */}
            <CampoCheckbox
              rotulo="Enviar mensagens automáticas às famílias"
              marcado={form.mensagens_automaticas}
              aoMudar={(marcado) => {
                setForm((atual) => ({ ...atual, mensagens_automaticas: marcado }))
              }}
              ajuda="Lembrete da véspera e confirmação do primeiro agendamento, pelo WhatsApp. Desmarque se o profissional confirma com as famílias por conta própria. Os avisos de remarcação e de cancelamento continuam saindo quando a recepção pedir."
              erro={erros.campos.get('mensagens_automaticas')}
            />

            <CampoCheckbox
              rotulo="Ativo"
              marcado={form.ativo}
              aoMudar={(marcado) => {
                setForm((atual) => ({ ...atual, ativo: marcado }))
              }}
              ajuda="Inativo some da grade da agenda."
            />

            <div className="mt-2 flex justify-end gap-3">
              <Botao type="button" variante="secundario" tamanho="lg" onClick={aoFechar} disabled={gravando}>
                Cancelar
              </Botao>
              <Botao type="submit" tamanho="lg" carregando={gravando}>
                {editando ? 'Salvar' : 'Cadastrar'}
              </Botao>
            </div>
          </form>
        </AlertDialog.Content>
      </AlertDialog.Portal>

      {/* mudança de REGRA: tom `atencao` e a consequência em português de balcão, no mesmo
          molde do cadastro de salas e do `particular` do convênio (§2) */}
      <DialogConfirmacao
        aberto={aConfirmar !== null}
        aoMudarAberto={(estado) => {
          if (!estado) setAConfirmar(null)
        }}
        titulo={aConfirmar?.titulo ?? ''}
        consequencia={aConfirmar?.consequencia ?? ''}
        rotuloConfirmar={aConfirmar?.rotulo ?? ''}
        tom="atencao"
        carregando={gravando}
        erros={erros.gerais}
        aoConfirmar={() => {
          setAConfirmar(null)
          gravar()
        }}
      />
    </AlertDialog.Root>
  )
}
