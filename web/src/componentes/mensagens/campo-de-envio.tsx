import { Paperclip, Send } from 'lucide-react'
import { useId, useRef, useState } from 'react'

import { AvisoDePreRequisito } from '@/componentes/ui/aviso-de-pre-requisito'
import { Botao } from '@/componentes/ui/botao'
import { CampoSelect } from '@/componentes/ui/campo-select'
import { CampoTexto } from '@/componentes/ui/campo-texto'
import { descreverCampo } from '@/componentes/ui/envelope-campo'
import { CAMINHOS } from '@/lib/caminhos-dos-cadastros'
import type { Conversa, PayloadDeEnvio, TemplateDeMensagem } from '@/tipos'

/**
 * O campo de escrita — consciente da janela de 24h (change mensageria-whatsapp, D5).
 *
 * Com a janela FECHADA, ele não mostra um campo de texto que o servidor vai recusar: mostra o
 * seletor de template, com prévia e os campos das variáveis. Deixar a recepção escrever para
 * tomar 422 depois é o que faz alguém achar que o sistema quebrou.
 */
export function CampoDeEnvio({
  conversa,
  templates,
  templatesCarregados,
  enviando,
  bloqueio = null,
  onEnviar,
  onArquivo,
}: {
  conversa: Conversa
  templates: TemplateDeMensagem[]
  /**
   * A lista de templates já chegou do servidor. Enquanto carrega (ou se a leitura falhou), lista
   * vazia NÃO quer dizer "nenhum aprovado" — e o aviso de pré-requisito mentiria. Obrigatória, sem
   * padrão (gate CR-AVI-04): um `true` presumido faria quem esquecesse de passá-la afirmar o vazio.
   */
  templatesCarregados: boolean
  enviando: boolean
  /** Motivo pelo qual não dá para enviar agora — o campo fica visível e desabilitado. */
  bloqueio?: string | null
  onEnviar: (payload: PayloadDeEnvio) => void
  onArquivo: (arquivo: File) => void
}) {
  const [texto, setTexto] = useState('')
  const [escolhido, setEscolhido] = useState('')
  const [variaveis, setVariaveis] = useState<Record<string, string>>({})
  const inputArquivo = useRef<HTMLInputElement>(null)

  const idDoBloqueio = useId()
  const impedido = bloqueio !== null
  const aprovados = templates.filter((template) => template.aprovado)
  const template = aprovados.find((item) => item.nome === escolhido) ?? null
  const faltaVariavel = template !== null && template.variaveis.some((chave) => (variaveis[chave] ?? '') === '')

  /*
   * Sem template aprovado, nada sai fora da janela (change o-sistema-avisa-o-que-falta). O seletor
   * não fica mudo: a ajuda dele diz o que falta e o caminho — e é ela, a razão junto da causa, que o
   * "Enviar template" indisponível aponta pelo `aria-describedby`.
   */
  const idDoSeletor = useId()
  const semTemplateAprovado = templatesCarregados && aprovados.length === 0
  const ajudaDoSeletor = semTemplateAprovado ? (
    <AvisoDePreRequisito
      para={CAMINHOS.whatsapp}
      oQueFalta="Nenhum template aprovado pela Meta foi sincronizado — e, fora da janela de 24 h, só template aprovado é entregue."
    />
  ) : (
    // no celular a dica sai da VISTA (continua sendo a descrição do campo): o relógio logo
    // acima já diz a mesma coisa, e as duas linhas eram da lista de mensagens
    <span className="max-lg:sr-only">Fora da janela de 24 h, a Meta só entrega template aprovado.</span>
  )
  const motivosDoTemplate = [
    impedido ? idDoBloqueio : null,
    semTemplateAprovado ? descreverCampo(idDoSeletor, { ajuda: ajudaDoSeletor }) : null,
  ].filter((id): id is string => id !== null && id !== undefined)

  const avisoDeBloqueio = impedido ? (
    <p id={idDoBloqueio} role="status" className="rounded-campo bg-alerta-suave px-3 py-1.5 text-meta text-alerta-texto">
      {bloqueio}
    </p>
  ) : null

  if (!conversa.janela_aberta) {
    return (
      <form
        // no celular o respiro encolhe: cada 8 px aqui é da lista de mensagens (change
        // conversa-legivel); `relative` segura o `sr-only` da ajuda dentro do formulário
        className="relative space-y-3 border-t border-linha bg-superficie p-3 max-lg:space-y-2 max-lg:p-2"
        onSubmit={(evento) => {
          evento.preventDefault()
          if (template === null || faltaVariavel) return
          onEnviar({ tipo: 'template', template: template.nome, variaveis })
          setEscolhido('')
          setVariaveis({})
        }}
      >
        <CampoSelect
          id={idDoSeletor}
          rotulo="Template aprovado"
          value={escolhido}
          onChange={(evento) => {
            setEscolhido(evento.target.value)
            setVariaveis({})
          }}
          placeholder="Escolha um template…"
          opcoes={aprovados.map((item) => ({ valor: item.nome, rotulo: item.nome }))}
          ajuda={ajudaDoSeletor}
        />

        {template !== null && (
          <>
            {template.variaveis.map((chave) => (
              <CampoTexto
                key={chave}
                rotulo={`Variável {{${chave}}}`}
                value={variaveis[chave] ?? ''}
                onChange={(evento) => setVariaveis((atual) => ({ ...atual, [chave]: evento.target.value }))}
              />
            ))}
            {/* a prévia mostra o texto FINAL: é ele que a família vai ler */}
            <p className="rounded-campo bg-fundo p-2 text-corpo text-texto" data-testid="previa-do-template">
              {template.variaveis.reduce(
                (corpo, chave) => corpo.replaceAll(`{{${chave}}}`, variaveis[chave] ?? `{{${chave}}}`),
                template.corpo ?? '',
              )}
            </p>
          </>
        )}

        {avisoDeBloqueio}

        {/*
          `aria-disabled`, não `disabled`: o botão continua FOCÁVEL e o motivo continua
          alcançável por leitor de tela. Com `disabled`, o elemento sai do ciclo de foco no
          instante do clique e o foco cai no `<body>` (achado do gate de a11y) — a pessoa
          perde o lugar e o porquê ao mesmo tempo.
        */}
        <Botao
          type="submit"
          carregando={enviando}
          aria-disabled={template === null || faltaVariavel || impedido || undefined}
          aria-describedby={motivosDoTemplate.length > 0 ? motivosDoTemplate.join(' ') : undefined}
          onClick={(evento) => {
            if (template === null || faltaVariavel || impedido) evento.preventDefault()
          }}
        >
          <Send className="size-4" aria-hidden /> Enviar template
        </Botao>
      </form>
    )
  }

  return (
    <form
      className="space-y-2 border-t border-linha bg-superficie p-3 max-lg:p-2"
      onSubmit={(evento) => {
        evento.preventDefault()
        if (texto.trim() === '') return
        onEnviar({ tipo: 'texto', corpo: texto.trim() })
        setTexto('')
      }}
    >
      <input
        ref={inputArquivo}
        type="file"
        className="sr-only"
        // FORA da ordem de tabulação: o gatilho é o botão ao lado. Focável, ele era uma
        // parada de Tab de 1×1 px onde o anel de foco simplesmente sumia da tela — e com
        // o MESMO nome acessível do botão, dois nós indistinguíveis para a AT.
        tabIndex={-1}
        aria-hidden="true"
        onChange={(evento) => {
          const arquivo = evento.target.files?.[0]
          if (arquivo !== undefined) onArquivo(arquivo)
          evento.target.value = ''
        }}
      />
      {avisoDeBloqueio}

      <div className="flex items-end gap-2">
        <Botao
          type="button"
          variante="secundario"
          onClick={() => {
            if (!impedido) inputArquivo.current?.click()
          }}
          aria-disabled={impedido || undefined}
          aria-describedby={impedido ? idDoBloqueio : undefined}
          aria-label="Anexar arquivo"
        >
          <Paperclip className="size-4" aria-hidden />
        </Botao>

        <div className="flex-1">
          <CampoTexto
            rotulo="Mensagem para a família"
            value={texto}
            disabled={impedido}
            placeholder="Escreva para a família…"
            onChange={(evento) => setTexto(evento.target.value)}
          />
        </div>

        <Botao
          type="submit"
          carregando={enviando}
          aria-disabled={texto.trim() === '' || impedido || undefined}
          aria-describedby={impedido ? idDoBloqueio : undefined}
          onClick={(evento) => {
            if (texto.trim() === '' || impedido) evento.preventDefault()
          }}
          // `relative` segura o `sr-only` (absoluto) dentro do botão. Abaixo de `lg` o botão é só o
          // ícone: o losango do tema Xclinicas (o "ponto de chegada" depois do RÓTULO) sai junto
          className="relative max-lg:px-3 max-lg:after:hidden"
        >
          <Send className="size-4" aria-hidden />
          {/* no celular o campo de escrever precisa da largura (sobravam 155 px): a palavra sai da
              vista e continua sendo o nome do botão (change conversa-legivel) */}
          <span className="max-lg:sr-only">Enviar</span>
        </Botao>
      </div>
    </form>
  )
}
