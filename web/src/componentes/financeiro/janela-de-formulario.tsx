import { AlertDialog } from 'radix-ui'
import { useCallback, useEffect, useId, useRef, type FormEvent, type ReactNode } from 'react'

import { Botao } from '@/componentes/ui/botao'
import { cn } from '@/lib/cn'

export interface JanelaDeFormularioProps {
  titulo: string
  /** A frase de "o que é" (design D8) — VISÍVEL sob o título, não um `sr-only` que só o leitor ouve. */
  descricao: string
  /** Cancelar, Esc — ignorado enquanto salva (fechar no meio do envio perderia a resposta). */
  aoFechar: () => void
  aoSubmeter: () => void
  salvando: boolean
  rotuloSalvar: string
  /** `false` deixa o salvar indisponível; a razão mora no campo que a causa. */
  podeSalvar?: boolean
  /**
   * Para onde o foco volta ao fechar (2.4.3). É uma função porque o alvo certo às vezes só existe
   * DEPOIS de fechar: no cadastro rápido, o botão que abriu a janela some quando o recém-criado
   * vira o interessado escolhido.
   */
  focoAoFechar: () => HTMLElement | null
  /**
   * Janela aberta POR CIMA de outra (o cadastro rápido sobre o lançamento): o véu sobe à camada
   * das janelas, senão a janela de baixo continuaria acesa, sem véu, disputando a atenção.
   */
  empilhada?: boolean
  /**
   * Sem nada para salvar: o pré-requisito invalida o formulário inteiro e o corpo é um aviso
   * (change `o-sistema-avisa-o-que-falta`, D2). O rodapé fica só com "Fechar" — um "Transferir"
   * desabilitado ao lado de um aviso não diz nada que o aviso já não diga.
   */
  semSalvar?: boolean
  /**
   * O corpo espera um dado (as contas da transferência). Quando ele chega, o foco vai ao primeiro campo —
   * ou à saída do aviso — como na abertura: ao abrir, ele tinha caído no "Cancelar" (DQA-AVI-02).
   */
  carregando?: boolean
  /**
   * O aviso que tomou o lugar do formulário: os ids entram na descrição acessível do diálogo, junto da
   * frase do "o que é" (A11Y-AVI-03, padrão APG do alertdialog). O PRIMEIRO é o texto do aviso, que
   * recebe o foco; os demais (a frase de a quem pedir) só descrevem — id ausente da tela é ignorado.
   */
  idsDoAviso?: readonly string[]
  children: ReactNode
}

/**
 * A moldura dos formulários em janela — a mesma receita do `TelaDeCatalogo`, extraída para as
 * janelas novas do caixa (fornecedor, funcionário, transferência):
 *
 * - o foco abre no PRIMEIRO campo (quem abriu veio digitar) e volta a quem abriu ao fechar;
 * - o Esc fecha ao primeiro toque, sem depender da ordem das camadas do Radix (A11Y-CF-02);
 * - o `submit` NÃO sobe: pelo portal, o evento sintético do React atravessaria para o formulário
 *   de BAIXO — no cadastro rápido, salvar o fornecedor registraria o lançamento junto.
 */
export function JanelaDeFormulario({
  titulo,
  descricao,
  aoFechar,
  aoSubmeter,
  salvando,
  rotuloSalvar,
  podeSalvar = true,
  focoAoFechar,
  empilhada = false,
  semSalvar = false,
  carregando = false,
  idsDoAviso,
  children,
}: JanelaDeFormularioProps) {
  const refDoFormulario = useRef<HTMLFormElement>(null)
  const idDaDescricao = useId()
  const carregavaAntes = useRef(carregando)

  /**
   * O primeiro campo; com o aviso no lugar do formulário, o TEXTO do aviso (focável por programa, não
   * acionável): focar a saída fazia o leitor anunciar "Cadastrar conta, link" sem o motivo, e um Enter
   * que ia para o "Cancelar" no instante em que a lista chegava acionava o link (A11Y-AVI-R2-01).
   */
  const primeiroIdDoAviso = idsDoAviso?.[0]
  const focarNoComeco = useCallback((): void => {
    const formulario = refDoFormulario.current
    const aviso = primeiroIdDoAviso === undefined ? null : document.getElementById(primeiroIdDoAviso)
    const alvo =
      aviso
      ?? formulario?.querySelector<HTMLElement>('input:not([type="hidden"]), select, textarea')
      ?? formulario?.querySelector<HTMLElement>('a[href], button:not([disabled])')
    alvo?.focus()
  }, [primeiroIdDoAviso])

  useEffect(() => {
    if (carregavaAntes.current && !carregando) {
      focarNoComeco()
    }
    carregavaAntes.current = carregando
  }, [carregando, focarNoComeco])

  function submeter(evento: FormEvent): void {
    evento.preventDefault()
    evento.stopPropagation()
    if (semSalvar || !podeSalvar || salvando) return
    aoSubmeter()
  }

  return (
    <AlertDialog.Root
      open
      onOpenChange={(aberto) => {
        if (!aberto && !salvando) aoFechar()
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Overlay
          className={cn('fixed inset-0 bg-texto/40', empilhada ? 'z-(--z-dialogo)' : 'z-(--z-scrim)')}
        />
        <AlertDialog.Content
          aria-describedby={[idDaDescricao, ...(idsDoAviso ?? [])].join(' ')}
          className="fixed left-1/2 top-1/2 z-(--z-dialogo) max-h-[90vh] w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-janela bg-superficie-elevada p-6 shadow-e3"
          onOpenAutoFocus={(evento) => {
            evento.preventDefault()
            focarNoComeco()
          }}
          onCloseAutoFocus={(evento) => {
            evento.preventDefault()
            focoAoFechar()?.focus()
          }}
          onKeyDown={(evento) => {
            if (evento.key !== 'Escape' || salvando) return
            evento.stopPropagation()
            aoFechar()
          }}
        >
          <AlertDialog.Title className="text-titulo font-semibold text-texto">{titulo}</AlertDialog.Title>
          <AlertDialog.Description id={idDaDescricao} className="mt-1 text-corpo text-texto-suave">
            {descricao}
          </AlertDialog.Description>

          <form ref={refDoFormulario} onSubmit={submeter} className="mt-5 flex flex-col gap-4">
            {children}

            <div className="mt-2 flex justify-end gap-3">
              <Botao type="button" variante="secundario" tamanho="lg" disabled={salvando} onClick={aoFechar}>
                {semSalvar ? 'Fechar' : 'Cancelar'}
              </Botao>
              {semSalvar ? null : (
                <Botao type="submit" tamanho="lg" carregando={salvando} disabled={!podeSalvar}>
                  {rotuloSalvar}
                </Botao>
              )}
            </div>
          </form>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
