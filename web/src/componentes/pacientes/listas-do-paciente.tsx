import { Plus, Trash2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'

import { CampoDoTelefone } from '@/componentes/pacientes/campo-do-telefone'
import { AvisoDePreRequisito } from '@/componentes/ui/aviso-de-pre-requisito'
import { AvisoErro } from '@/componentes/ui/aviso-erro'
import { Botao } from '@/componentes/ui/botao'
import { CampoSelect } from '@/componentes/ui/campo-select'
import { CampoTexto } from '@/componentes/ui/campo-texto'
import { CAMINHOS } from '@/lib/caminhos-dos-cadastros'
import { erroDaLista, erroDoItem, type ErrosDoServidor } from '@/lib/erros'
import { dataHoraLegivel, ROTULOS_DE_CONTATO } from '@/lib/pacientes'
import { TIPOS_DE_CONTATO } from '@/tipos'
import type {
  ConsentimentoDoPaciente,
  ContatoDoPaciente,
  NovoConsentimento,
  ResponsavelDoPaciente,
  TermoVigente,
} from '@/tipos'

/**
 * As três listas do cadastro (§5). O servidor recusa POR ÍNDICE
 * (`responsaveis_json.0.nome`) — e é no item que a mensagem tem que pousar:
 * um erro sobre o terceiro contato exibido "no formulário" é um erro que a
 * recepcionista não consegue resolver.
 */

interface SecaoProps {
  titulo: string
  descricao?: string
  children: ReactNode
  aoAdicionar?: () => void
  rotuloAdicionar?: string
  erroDaSecao?: string
}

function SecaoDeLista({ titulo, descricao, children, aoAdicionar, rotuloAdicionar, erroDaSecao }: SecaoProps) {
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="text-subtitulo font-semibold text-texto">{titulo}</legend>
      {descricao !== undefined ? <p className="text-meta text-texto-suave">{descricao}</p> : null}
      {erroDaSecao !== undefined ? <AvisoErro mensagens={[erroDaSecao]} /> : null}
      {children}
      {aoAdicionar !== undefined ? (
        <Botao type="button" variante="secundario" tamanho="sm" className="self-start" onClick={aoAdicionar}>
          <Plus size={16} aria-hidden="true" />
          {rotuloAdicionar}
        </Botao>
      ) : null}
    </fieldset>
  )
}

function BotaoRemover({ rotulo, aoRemover }: { rotulo: string; aoRemover: () => void }) {
  return (
    <Botao type="button" variante="fantasma" tamanho="sm" aria-label={rotulo} onClick={aoRemover}>
      <Trash2 size={16} aria-hidden="true" />
    </Botao>
  )
}

// ── Responsáveis ─────────────────────────────────────────────────────────────

export interface ListaDeResponsaveisProps {
  responsaveis: ResponsavelDoPaciente[]
  aoMudar: (responsaveis: ResponsavelDoPaciente[]) => void
  erros: ErrosDoServidor
  /** Nascimento indica menoridade: a tela EXPLICA a exigência do servidor (D5) */
  exigido: boolean
  /** A régua da clínica também pode exigir a lista, independentemente da idade */
  exigidoPelaRegua?: boolean
  /**
   * O teto de cada subcampo, do servidor (change `tetos-do-cadastro-na-tela`). Sem ele, os
   * campos das listas seriam os únicos do cadastro a continuar reclamando só no salvar — e a
   * próxima ligação da clínica seria sobre eles.
   */
  limiteDoItem?: (subcampo: string) => number | undefined
  somenteLeitura?: boolean
}

export function ListaDeResponsaveis({
  responsaveis,
  aoMudar,
  erros,
  exigido,
  exigidoPelaRegua = false,
  limiteDoItem,
  somenteLeitura = false,
}: ListaDeResponsaveisProps) {
  function atualizar(indice: number, campo: keyof ResponsavelDoPaciente, valor: string) {
    aoMudar(responsaveis.map((item, i) => (i === indice ? { ...item, [campo]: valor } : item)))
  }

  return (
    <SecaoDeLista
      titulo="Responsáveis"
      descricao={
        exigido
          ? 'Paciente menor de idade: o cadastro exige pelo menos um responsável.'
          : exigidoPelaRegua
            ? 'Esta clínica exige pelo menos um responsável no cadastro.'
            : 'Quem responde pelo paciente (até 5).'
      }
      erroDaSecao={erroDaLista(erros, 'responsaveis_json')}
      aoAdicionar={
        somenteLeitura || responsaveis.length >= 5
          ? undefined
          : () => {
              aoMudar([...responsaveis, { nome: '', parentesco: '', telefone: '', email: '' }])
            }
      }
      rotuloAdicionar="Adicionar responsável"
    >
      {responsaveis.map((responsavel, indice) => (
        <div key={indice} className="flex flex-col gap-2 rounded-superficie border border-linha-forte p-3">
          {/* a recusa da whitelist chega no ITEM, sem subcampo — sem isto, ela não
              teria onde pousar (parecer code-review §8) */}
          {erroDoItem(erros, 'responsaveis_json', indice) !== undefined ? (
            <AvisoErro mensagens={[erroDoItem(erros, 'responsaveis_json', indice) as string]} />
          ) : null}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr_1fr_1fr_auto]">
          <CampoTexto
            rotulo="Nome"
            limite={limiteDoItem?.('nome')}
            value={responsavel.nome}
            disabled={somenteLeitura}
            onChange={(evento) => {
              atualizar(indice, 'nome', evento.target.value)
            }}
            erro={erroDoItem(erros, 'responsaveis_json', indice, 'nome')}
          />
          <CampoTexto
            rotulo="Parentesco"
            limite={limiteDoItem?.('parentesco')}
            value={responsavel.parentesco}
            disabled={somenteLeitura}
            onChange={(evento) => {
              atualizar(indice, 'parentesco', evento.target.value)
            }}
            erro={erroDoItem(erros, 'responsaveis_json', indice, 'parentesco')}
          />
          <CampoTexto
            rotulo="Telefone"
            limite={limiteDoItem?.('telefone')}
            value={responsavel.telefone ?? ''}
            disabled={somenteLeitura}
            onChange={(evento) => {
              atualizar(indice, 'telefone', evento.target.value)
            }}
            erro={erroDoItem(erros, 'responsaveis_json', indice, 'telefone')}
          />
          <CampoTexto
            rotulo="E-mail"
            limite={limiteDoItem?.('email')}
            type="email"
            value={responsavel.email ?? ''}
            disabled={somenteLeitura}
            onChange={(evento) => {
              atualizar(indice, 'email', evento.target.value)
            }}
            erro={erroDoItem(erros, 'responsaveis_json', indice, 'email')}
          />
            {!somenteLeitura ? (
              <div className="flex items-end pb-1">
                <BotaoRemover
                  rotulo={`Remover responsável ${indice + 1}`}
                  aoRemover={() => {
                    aoMudar(responsaveis.filter((_, i) => i !== indice))
                  }}
                />
              </div>
            ) : null}
          </div>
        </div>
      ))}
    </SecaoDeLista>
  )
}

// ── Contatos ─────────────────────────────────────────────────────────────────

export interface ListaDeContatosProps {
  contatos: ContatoDoPaciente[]
  aoMudar: (contatos: ContatoDoPaciente[]) => void
  erros: ErrosDoServidor
  /** A régua da clínica pode exigir a lista — a tela DIZ isso antes de o servidor recusar */
  exigidoPelaRegua?: boolean
  /** O teto de cada subcampo, do servidor (change `tetos-do-cadastro-na-tela`). */
  limiteDoItem?: (subcampo: string) => number | undefined
  somenteLeitura?: boolean
  /**
   * Diz abaixo de cada telefone para onde o WhatsApp vai, ou que ele não chega (change
   * telefone-que-chega-no-whatsapp). Só no PACIENTE: fornecedor e funcionário usam a mesma lista e
   * não recebem lembrete.
   */
  avisarWhatsapp?: boolean
  /** Com o aviso ligado, diz também se o número está no cadastro de OUTRO paciente (tela interna) */
  conferirRepetido?: boolean
  /** O paciente em edição — não conta como "outro"; `null` na criação */
  pacienteId?: number | null
}

export function ListaDeContatos({
  contatos,
  aoMudar,
  erros,
  limiteDoItem,
  exigidoPelaRegua = false,
  somenteLeitura = false,
  avisarWhatsapp = false,
  conferirRepetido = false,
  pacienteId = null,
}: ListaDeContatosProps) {
  return (
    <SecaoDeLista
      titulo="Contatos"
      descricao={
        exigidoPelaRegua
          ? 'Esta clínica exige pelo menos um contato no cadastro.'
          : 'Telefone, celular, WhatsApp ou e-mail (até 10).'
      }
      erroDaSecao={erroDaLista(erros, 'contatos_json')}
      aoAdicionar={
        somenteLeitura || contatos.length >= 10
          ? undefined
          : () => {
              aoMudar([...contatos, { tipo: 'celular', valor: '', obs: '' }])
            }
      }
      rotuloAdicionar="Adicionar contato"
    >
      {contatos.map((contato, indice) => (
        <div key={indice} className="@container flex flex-col gap-2 rounded-superficie border border-linha-forte p-3">
          {erroDoItem(erros, 'contatos_json', indice) !== undefined ? (
            <AvisoErro mensagens={[erroDoItem(erros, 'contatos_json', indice) as string]} />
          ) : null}
          {/*
            As colunas seguem a largura do CARTÃO, não a da janela (change telefone-estrangeiro): com a
            barra lateral aberta, a janela de 768 px deixava ao Valor 77 px, e o país antes do número
            empurrava a página para o lado. Cartão estreito: um campo por linha; médio: Tipo e Valor
            juntos, Observação embaixo; largo: os quatro numa linha, com o Valor maior.
          */}
          <div className="grid grid-cols-1 gap-3 @min-[32rem]:grid-cols-[minmax(0,10rem)_minmax(0,1fr)_auto] @min-[48rem]:grid-cols-[minmax(0,10rem)_minmax(0,3fr)_minmax(0,2fr)_auto]">
          <CampoSelect
            rotulo="Tipo"
            value={contato.tipo}
            disabled={somenteLeitura}
            onChange={(evento) => {
              aoMudar(
                contatos.map((item, i) =>
                  i === indice ? { ...item, tipo: evento.target.value as ContatoDoPaciente['tipo'] } : item,
                ),
              )
            }}
            opcoes={TIPOS_DE_CONTATO.map((tipo) => ({ valor: tipo, rotulo: ROTULOS_DE_CONTATO[tipo] }))}
            erro={erroDoItem(erros, 'contatos_json', indice, 'tipo')}
          />
          {avisarWhatsapp ? (
            <CampoDoTelefone
              rotulo="Valor"
              tipo={contato.tipo}
              conferirRepetido={conferirRepetido}
              pacienteId={pacienteId}
              limite={limiteDoItem?.('valor')}
              value={contato.valor}
              disabled={somenteLeitura}
              aoMudar={(valor) => {
                aoMudar(contatos.map((item, i) => (i === indice ? { ...item, valor } : item)))
              }}
              erro={erroDoItem(erros, 'contatos_json', indice, 'valor')}
            />
          ) : (
            <CampoTexto
              rotulo="Valor"
              limite={limiteDoItem?.('valor')}
              value={contato.valor}
              disabled={somenteLeitura}
              onChange={(evento) => {
                aoMudar(contatos.map((item, i) => (i === indice ? { ...item, valor: evento.target.value } : item)))
              }}
              erro={erroDoItem(erros, 'contatos_json', indice, 'valor')}
            />
          )}
          <CampoTexto
            rotulo="Observação"
            className="@min-[32rem]:col-span-2 @min-[48rem]:col-span-1"
            limite={limiteDoItem?.('obs')}
            value={contato.obs ?? ''}
            disabled={somenteLeitura}
            onChange={(evento) => {
              aoMudar(contatos.map((item, i) => (i === indice ? { ...item, obs: evento.target.value } : item)))
            }}
            erro={erroDoItem(erros, 'contatos_json', indice, 'obs')}
          />
            {!somenteLeitura ? (
              <div className="flex items-end pb-1">
                <BotaoRemover
                  rotulo={`Remover contato ${indice + 1}`}
                  aoRemover={() => {
                    aoMudar(contatos.filter((_, i) => i !== indice))
                  }}
                />
              </div>
            ) : null}
          </div>
        </div>
      ))}
    </SecaoDeLista>
  )
}

// ── Consentimentos (append-only — D4) ────────────────────────────────────────

export interface ListaDeConsentimentosProps {
  /** Já registrados — vêm do servidor, com o aceite carimbado por ELE */
  registrados: ConsentimentoDoPaciente[]
  /** Novos desta edição (ainda não salvos): quem os data é o servidor */
  novos: NovoConsentimento[]
  /** A régua em vigor (FA-08). `null` = a clínica ainda não publicou nenhuma versão */
  termoVigente: TermoVigente | null
  /**
   * A leitura da régua CHEGOU. Enquanto carrega — ou se falhou (rede, 403) — `termoVigente: null` não
   * prova "nenhum termo publicado": não se oferece registro nem se afirma que ela falta (gate
   * CR-AVI-08). Obrigatória, sem padrão: um valor presumido faria quem esquecesse de passá-la afirmar
   * a falta.
   */
  termoLido: boolean
  /**
   * A leitura do termo FALHOU (e não só ainda não chegou): o registro do aceite não pode sumir calado —
   * a tela diz que não carregou e oferece tentar de novo (gate CR-AVI-R2-01). Sem isto, cai no silêncio.
   */
  aoTentarLerOTermo?: () => void
  aoAdicionar: (consentimento: NovoConsentimento) => void
  aoRemoverNovo: (indice: number) => void
  erros: ErrosDoServidor
  somenteLeitura?: boolean
}

/** O que a linha do aceite mostra: título e, quando versionado, a versão. */
function rotuloDoTermo(termo: string, versao?: number): string {
  return versao === undefined ? termo : `${termo} — v${versao}`
}

/**
 * Consentimento é PROVA (design D4 — revisto no gate).
 *
 * O instante do aceite é carimbado **pelo servidor**: o relógio do balcão não
 * data a prova de consentimento de um menor (SEC-01/SEC-10). E o que já foi
 * registrado não se edita nem se remove — a API é append-only nesta lista
 * (SEC-02: o `PUT` do cadastro inteiro, montado sobre cache velho, apagava em
 * silêncio o aceite que outra aba tinha acabado de gravar). Retificação pertence
 * ao fluxo de direitos do titular, que não existe no v1.
 *
 * Desde a change `aceite-do-regulamento` (FA-08), o TERMO também não se digita: o
 * aceite é sempre o da versão VIGENTE do contrato terapêutico, que a clínica publica
 * em `/termos`. Sem versão publicada, esta seção diz o próximo passo em vez de
 * oferecer um formulário que o servidor recusaria.
 */
export function ListaDeConsentimentos({
  registrados,
  novos,
  termoVigente,
  termoLido,
  aoTentarLerOTermo,
  aoAdicionar,
  aoRemoverNovo,
  erros,
  somenteLeitura = false,
}: ListaDeConsentimentosProps) {
  return (
    <SecaoDeLista
      titulo="Consentimentos"
      descricao="O aceite registrado aqui é o do termo em vigor. O servidor data a prova ao salvar; consentimento registrado não se edita nem se remove."
      erroDaSecao={erroDaLista(erros, 'consentimentos_json')}
    >
      {registrados.map((consentimento, indice) => (
        <div key={`registrado-${indice}`} className="rounded-superficie border border-linha-forte p-3">
          <p className="text-corpo font-medium text-texto">
            {rotuloDoTermo(consentimento.termo, consentimento.versao)}
          </p>
          <p className="text-meta text-texto-suave">
            Aceito por {consentimento.responsavel} em {dataHoraLegivel(consentimento.aceito_em)}
          </p>
        </div>
      ))}

      {novos.map((consentimento, indice) => {
        // o payload leva SÓ os novos: a recusa indexada do servidor é deste item. A lista
        // cobre TODOS os campos que o servidor recusa por presença — inclusive os que a
        // tela nunca envia: se um dia alguém os mandar, a recusa pousa aqui em vez de
        // sobrar só no toast, que passa (achado CR-7 do gate).
        const mensagens = [
          erroDoItem(erros, 'consentimentos_json', indice, 'termo'),
          erroDoItem(erros, 'consentimentos_json', indice, 'termo_id'),
          erroDoItem(erros, 'consentimentos_json', indice, 'versao'),
          erroDoItem(erros, 'consentimentos_json', indice, 'forma'),
          erroDoItem(erros, 'consentimentos_json', indice, 'registrado_por'),
          erroDoItem(erros, 'consentimentos_json', indice, 'responsavel'),
          erroDoItem(erros, 'consentimentos_json', indice, 'aceito_em'),
          erroDoItem(erros, 'consentimentos_json', indice),
        ].filter((mensagem): mensagem is string => mensagem !== undefined)

        return (
          <div
            key={`novo-${indice}`}
            className="flex flex-wrap items-center justify-between gap-3 rounded-superficie border border-acento p-3"
          >
            <div>
              <p className="text-corpo font-medium text-texto">
                {termoVigente === null
                  ? 'Termo em vigor'
                  : rotuloDoTermo(termoVigente.titulo, termoVigente.versao)}
              </p>
              <p className="text-meta text-texto-suave">
                Aceito por {consentimento.responsavel} · a salvar (o servidor data o aceite)
              </p>
              {mensagens.map((mensagem) => (
                <p key={mensagem} role="alert" className="text-meta text-perigo-texto">
                  {mensagem}
                </p>
              ))}
            </div>
            {!somenteLeitura ? (
              <BotaoRemover
                rotulo={`Remover consentimento de ${consentimento.responsavel}`}
                aoRemover={() => {
                  aoRemoverNovo(indice)
                }}
              />
            ) : null}
          </div>
        )
      })}

      {somenteLeitura ? null : !termoLido ? (
        aoTentarLerOTermo === undefined ? null : <TermoNaoCarregou aoTentarDeNovo={aoTentarLerOTermo} />
      ) : termoVigente === null ? (
        <SemTermoPublicado />
      ) : (
        <NovoConsentimentoCampo termoVigente={termoVigente} aoAdicionar={aoAdicionar} />
      )}
    </SecaoDeLista>
  )
}

/**
 * Sem termo publicado, o aceite não tem régua (o servidor recusaria). O caminho é por permissão
 * (change o-sistema-avisa-o-que-falta): quem publica termo lê ONDE publicar; quem não publica lê a
 * quem pedir — "publique" para quem leva 403 lá é mandar a uma porta fechada.
 *
 * Sem link, de propósito (design D7): este aviso fica no fim do cadastro, e o formulário não guarda o
 * que foi digitado ao sair da página — seguir um link aqui apagaria o cadastro da criança inteiro. O
 * caminho escrito é o do mapa de cadastros, o mesmo da ficha.
 */
/** A leitura do termo falhou: o aceite não pode ser registrado AGORA — dizer, em vez de sumir (CR-AVI-R2-01). */
function TermoNaoCarregou({ aoTentarDeNovo }: { aoTentarDeNovo: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-superficie border border-dashed border-linha-forte p-3">
      <p className="text-meta text-texto-suave">
        Não foi possível carregar o termo em vigor; o aceite não pode ser registrado agora.
      </p>
      <Botao type="button" variante="secundario" tamanho="sm" onClick={aoTentarDeNovo}>
        Tentar de novo
      </Botao>
    </div>
  )
}

function SemTermoPublicado() {
  return (
    <p className="rounded-superficie border border-dashed border-linha-forte p-3 text-meta text-texto-suave">
      <AvisoDePreRequisito
        para={CAMINHOS.termo}
        oQueFalta="Nenhum termo publicado — o aceite das famílias só se registra depois que o contrato terapêutico é publicado."
        semLink
      />
    </p>
  )
}

/**
 * Registrar o aceite é dizer QUEM aceitou — o termo é a régua em vigor, exibida como
 * rótulo. O campo de texto livre saiu na change `aceite-do-regulamento` (FA-08).
 */
function NovoConsentimentoCampo({
  termoVigente,
  aoAdicionar,
}: {
  termoVigente: TermoVigente
  aoAdicionar: (dados: NovoConsentimento) => void
}) {
  const [responsavel, setResponsavel] = useState('')

  return (
    <div className="grid grid-cols-1 gap-3 rounded-superficie border border-dashed border-linha-forte p-3 md:grid-cols-[1fr_1fr_auto]">
      <div className="flex flex-col justify-end pb-1">
        <span className="text-rotulo font-medium text-texto-suave">Termo em vigor</span>
        <span className="text-corpo text-texto">
          {rotuloDoTermo(termoVigente.titulo, termoVigente.versao)}
        </span>
      </div>
      <CampoTexto
        rotulo="Responsável que aceitou"
        value={responsavel}
        onChange={(evento) => {
          setResponsavel(evento.target.value)
        }}
      />
      <div className="flex items-end pb-1">
        <Botao
          type="button"
          variante="secundario"
          tamanho="sm"
          disabled={responsavel.trim() === ''}
          onClick={() => {
            aoAdicionar({ responsavel: responsavel.trim() })
            setResponsavel('')
          }}
        >
          <Plus size={16} aria-hidden="true" />
          Registrar aceite
        </Botao>
      </div>
    </div>
  )
}
