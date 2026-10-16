import { AlertDialog } from 'radix-ui'
import { useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import { AvisoErro } from '@/componentes/ui/aviso-erro'
import { Botao } from '@/componentes/ui/botao'
import { CampoTexto } from '@/componentes/ui/campo-texto'

export interface DialogConfirmacaoProps {
  aberto: boolean
  aoMudarAberto: (aberto: boolean) => void
  /** NOMEIA o alvo: 'Desmarcar a sessão de Ana S. — qui 14:00?' — nunca "Tem certeza?" */
  titulo: string
  /** Explícita: o que acontece de fato (itens afetados, reversibilidade, efeito no saldo) */
  consequencia: string
  /** Verbo + alvo: 'Desmarcar série' — NUNCA 'Sim'/'OK' */
  rotuloConfirmar: string
  rotuloCancelar?: string
  /** perigo: excluir/desativar/desmarcar · atencao: mudança de regra (ex.: flag desconta_sessao) */
  tom?: 'perigo' | 'atencao'
  /** Erros lançados aqui mantêm o dialog aberto — o consumidor os trata (ex.: toast) */
  aoConfirmar: () => void | Promise<void>
  /** Trava o dialog durante o await; Esc desabilitado enquanto confirma */
  carregando?: boolean
  /**
   * A recusa do servidor, DENTRO do diálogo.
   *
   * Sem isto, um 422 rejeitava a promessa, o diálogo ficava aberto mostrando o
   * mesmo texto de antes, e o único sinal era um toast que passa: para quem
   * clicou, "não aconteceu nada". A mensagem tem que estar onde a pessoa está
   * olhando (gate CR-CA-05).
   */
  erros?: readonly string[]
  /**
   * Exige que o usuário DIGITE esta palavra para poder confirmar.
   *
   * Use quando o erro que a confirmação existe para pegar é, ele próprio, um
   * **clique errado** — trocar a criança de um agendamento (irmãos, nomes parecidos
   * no autocomplete). Um "tem certeza?" de um clique é respondido pelo mesmo reflexo
   * que causou o engano; digitar quebra o automatismo e obriga a olhar de novo.
   *
   * Não use por precaução genérica: fricção que aparece onde o risco não está vira
   * ruído, e o usuário aprende a atravessá-la sem ler.
   */
  palavraDeConfirmacao?: string
  /**
   * Campos que a própria confirmação exige — renderizados ANTES da palavra digitada.
   *
   * Existe para a reabertura de ciclo, onde o **motivo é obrigatório** e faz parte da
   * decisão (ele vai para a trilha de auditoria). Pôr esse campo no fundo da tela, atrás
   * do diálogo, seria o mesmo defeito que o `erros` já conserta: a pessoa está olhando
   * para o diálogo, e é nele que a exigência tem de aparecer.
   *
   * Não é slot de conteúdo livre: o que entra aqui é o que a ação PRECISA para acontecer.
   */
  children?: ReactNode
  /**
   * Trava adicional do confirmar, decidida pelo CONSUMIDOR (ex.: motivo ainda vazio).
   *
   * A palavra digitada prova intenção; ela não prova que os campos de `children` estão
   * preenchidos. Sem esta trava, "REABRIR" com motivo em branco chegaria ao servidor só
   * para voltar 422 — e a exigência estaria escrita na tela sem ser exigida.
   */
  podeConfirmar?: boolean
  /**
   * POR QUE `podeConfirmar` ainda é `false` — em uma frase, na voz do consumidor.
   *
   * O confirmar bloqueado é `aria-disabled` (continua focável) justamente para poder
   * dizer o que falta: sem isto, quem navega por teclado chega a um botão fora da
   * sequência de Tab, e as duas travas independentes (palavra digitada × campo
   * obrigatório) viram adivinhação. A trava da PALAVRA o diálogo explica sozinho.
   */
  motivoDoBloqueio?: string
  /**
   * Destino EXPLÍCITO do foco ao fechar (2.4.3) — mesmo contrato do `Dialog`.
   *
   * O default devolve o foco ao gatilho. Isso quebra quando a ação **apaga o gatilho**:
   * "Reabrir" só existe enquanto o ciclo está fechado, e a reabertura bem-sucedida o
   * tira do DOM antes de ele receber o foco — que cai no `body`, e o leitor de tela
   * fica em silêncio. Fluxos assim resolvem o destino aqui (uma âncora que sobrevive à
   * mutação); retornar `null` cai no default.
   */
  focoAoFechar?: () => HTMLElement | null
}

/**
 * O padrão §2 da especificação — obrigatório antes de TODA ação destrutiva ou
 * de impacto (design-system.md §5.6 · parecer T-ds-06). Radix AlertDialog:
 * focus trap, foco inicial no CANCELAR (Enter no mount não confirma), Esc
 * cancela, foco retorna ao gatilho. LGPD: título usa nome curto, nunca dados
 * sensíveis extras.
 */
export function DialogConfirmacao({
  aberto,
  aoMudarAberto,
  titulo,
  consequencia,
  rotuloConfirmar,
  rotuloCancelar = 'Cancelar',
  tom = 'perigo',
  aoConfirmar,
  carregando = false,
  erros = [],
  palavraDeConfirmacao,
  children,
  podeConfirmar = true,
  motivoDoBloqueio,
  focoAoFechar,
}: DialogConfirmacaoProps) {
  const refCancelar = useRef<HTMLButtonElement>(null)
  // Elemento focado antes da abertura — o foco SEMPRE retorna ao gatilho (2.4.3)
  const refDisparador = useRef<HTMLElement | null>(null)
  const idDoBloqueio = useId()
  const [digitado, setDigitado] = useState('')

  // o texto some junto com o diálogo: reabrir NUNCA nasce pré-confirmado
  useEffect(() => {
    if (!aberto) {
      setDigitado('')
    }
  }, [aberto])

  const exigeTexto = palavraDeConfirmacao !== undefined
  const textoConfere = !exigeTexto || digitado.trim() === palavraDeConfirmacao
  const liberado = textoConfere && podeConfirmar

  /**
   * O que falta, em ordem de leitura — as travas são INDEPENDENTES e podem faltar as
   * duas. Um botão inerte que não diz qual delas o segura é o mesmo defeito do `erros`
   * (a informação existe, mas não onde a pessoa está olhando).
   */
  const motivosDoBloqueio: string[] = []
  if (!podeConfirmar && motivoDoBloqueio !== undefined) {
    motivosDoBloqueio.push(motivoDoBloqueio)
  }
  if (!textoConfere) {
    motivosDoBloqueio.push(`Digite ${palavraDeConfirmacao ?? ''} no campo acima para liberar.`)
  }

  const confirmar = async (): Promise<void> => {
    // cinto e suspensório: o botão já está desabilitado, mas o Enter no campo
    // chegaria aqui por outro caminho — e o custo do engano é um prontuário trocado
    if (!liberado) {
      return
    }
    try {
      await aoConfirmar()
      aoMudarAberto(false)
    } catch {
      // Contrato da prop: a falha já é refletida pelo consumidor (toast/estado
      // do formulário) — aqui só mantemos o dialog aberto para nova tentativa,
      // sem deixar a rejeição escapar como unhandled.
    }
  }

  return (
    <AlertDialog.Root open={aberto} onOpenChange={aoMudarAberto}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay
          className="fixed inset-0 z-(--z-scrim) bg-texto/40"
          onClick={() => {
            if (!carregando) {
              aoMudarAberto(false)
            }
          }}
        />
        <AlertDialog.Content
          // MESMO molde do `Dialog` (dialog.tsx): `max-h-[85vh]` + corpo rolável, porque
          // `fixed` + `-translate-y-1/2` não gera rolagem de página NENHUMA — o que passa
          // da viewport fica inalcançável, e o que passa primeiro é a linha
          // Cancelar/Confirmar. O diálogo com `children` (reabertura de ciclo) estoura o
          // 390×640 e estoura com certeza em zoom 200% (1.4.4/1.4.10). A goteira lateral
          // (`w-[calc(100%-2rem)]`) também vem do irmão.
          className="fixed left-1/2 top-1/2 z-(--z-dialogo) flex max-h-[85vh] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-janela bg-superficie-elevada shadow-e3"
          onOpenAutoFocus={(evento) => {
            evento.preventDefault()
            refDisparador.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
            refCancelar.current?.focus()
          }}
          onCloseAutoFocus={(evento) => {
            evento.preventDefault()
            // O destino explícito VENCE: fluxos cuja ação apaga o próprio gatilho
            // (reabrir um ciclo) devolveriam o foco a um nó fora do DOM — que é `body`.
            const alvoExplicito = focoAoFechar?.() ?? null
            if (alvoExplicito !== null) {
              alvoExplicito.focus()
            } else {
              refDisparador.current?.focus()
            }
            refDisparador.current = null
          }}
          onEscapeKeyDown={(evento) => {
            if (carregando) {
              evento.preventDefault()
            }
          }}
        >
          {/* CORPO ROLÁVEL: o texto, os campos da decisão e a recusa do servidor. */}
          <div className="min-h-0 flex-1 overflow-y-auto p-6">
            <AlertDialog.Title className="text-titulo font-semibold text-texto">{titulo}</AlertDialog.Title>
            <AlertDialog.Description className="mt-2 text-corpo text-texto-suave">
              {consequencia}
            </AlertDialog.Description>

            {children !== undefined ? <div className="mt-4 flex flex-col gap-4">{children}</div> : null}

            {exigeTexto ? (
              <CampoTexto
                rotulo={`Digite ${palavraDeConfirmacao} para confirmar`}
                value={digitado}
                onChange={(evento) => {
                  setDigitado(evento.target.value)
                }}
                autoComplete="off"
                spellCheck={false}
                disabled={carregando}
                className="mt-4"
              />
            ) : null}

            {erros.length > 0 ? <AvisoErro mensagens={erros} className="mt-4" /> : null}
          </div>

          {/* RODAPÉ FIXO: a decisão nunca sai da tela, por mais alto que fique o corpo. */}
          <div className="shrink-0 border-t border-linha px-6 py-4">
            {motivosDoBloqueio.length > 0 ? (
              <p id={idDoBloqueio} className="mb-3 text-meta text-texto-suave">
                {motivosDoBloqueio.join(' ')}
              </p>
            ) : null}

            <div className="flex justify-end gap-3">
              <AlertDialog.Cancel asChild>
                <Botao ref={refCancelar} variante="secundario" tamanho="lg" disabled={carregando}>
                  {rotuloCancelar}
                </Botao>
              </AlertDialog.Cancel>
              <Botao
                variante={tom === 'atencao' ? 'primario' : 'perigo'}
                tamanho="lg"
                carregando={carregando}
                // `aria-disabled`, NÃO `disabled`: a ação primária continua na sequência
                // de Tab para poder dizer o que falta (o clique é inerte pela guarda do
                // `confirmar`). Ver `motivoDoBloqueio`.
                aria-disabled={liberado ? undefined : true}
                aria-describedby={motivosDoBloqueio.length > 0 ? idDoBloqueio : undefined}
                onClick={() => {
                  void confirmar()
                }}
              >
                {rotuloConfirmar}
              </Botao>
            </div>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
