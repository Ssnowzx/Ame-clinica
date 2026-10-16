import { CircleAlert, CircleCheck, TriangleAlert, X, type LucideIcon } from 'lucide-react'
import { Toast } from 'radix-ui'
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import { usarTelaAbaixoDeLg } from '@/hooks/usar-tela-estreita'
import { cn } from '@/lib/cn'

export interface OpcoesToast {
  tom: 'sucesso' | 'erro' | 'aviso'
  titulo: string
  /** Texto tratado, string plana — NUNCA dump de resposta do servidor (T-ds-05) */
  descricao?: string
}

interface ItemToast extends OpcoesToast {
  id: number
}

interface ContextoToastValor {
  notificar: (opcoes: OpcoesToast) => void
}

const ContextoToast = createContext<ContextoToastValor | null>(null)

const APARENCIA_POR_TOM: Record<OpcoesToast['tom'], { classe: string; icone: LucideIcon; iconeClasse: string }> = {
  sucesso: { classe: 'border-l-sucesso-texto', icone: CircleCheck, iconeClasse: 'text-sucesso-texto' },
  erro: { classe: 'border-l-perigo-texto', icone: CircleAlert, iconeClasse: 'text-perigo-texto' },
  aviso: { classe: 'border-l-alerta-texto', icone: TriangleAlert, iconeClasse: 'text-alerta-texto' },
}

function ItemDeToast({ item, aoFechar }: { item: ItemToast; aoFechar: (id: number) => void }) {
  const aparencia = APARENCIA_POR_TOM[item.tom]
  const Icone = aparencia.icone

  return (
    <Toast.Root
      /*
       * SEM `role` aqui — de propósito (achado A11Y-RCD-10).
       *
       * O `Toast.Root` do Radix renderiza um `<li>` dentro do `<ol>` do viewport, e o
       * anúncio sai por um `ToastAnnounce` SEPARADO, cuja politeness vem do `type`. Pôr
       * `role="alert"`/`role="status"` no `<li>` era redundante para o anúncio e destruía
       * a semântica da lista: o axe acusa `serious` — "<ol> must only directly contain
       * <li>" — em toda tela que mostre um toast.
       *
       * `type` (não `role`) governa a politeness: foreground = assertive (só erro
       * interrompe), background = polite (§5.8).
       */
      type={item.tom === 'erro' ? 'foreground' : 'background'}
      duration={item.tom === 'erro' ? 8000 : 5000}
      onOpenChange={(aberto) => {
        if (!aberto) {
          aoFechar(item.id)
        }
      }}
      className={cn(
        // abaixo do `lg` o respiro encolhe: no topo, um toast de duas linhas cabe sobre a barra do
        // shell sem invadir o cabeçalho da tela (o da conversa começa em 88 px)
        'pointer-events-auto flex items-start gap-3 rounded-superficie border border-linha-forte bg-superficie p-4 shadow-e2 max-lg:p-3',
        'border-l-[3px]',
        aparencia.classe,
      )}
    >
      <Icone aria-hidden="true" className={cn('mt-0.5 size-4 shrink-0', aparencia.iconeClasse)} />
      <div className="flex-1">
        <Toast.Title className="text-corpo font-medium text-texto">{item.titulo}</Toast.Title>
        {item.descricao !== undefined ? (
          <Toast.Description className="mt-1 text-corpo text-texto-suave">{item.descricao}</Toast.Description>
        ) : null}
      </div>
      <Toast.Close
        aria-label="Fechar notificação"
        className="inline-flex size-6 shrink-0 items-center justify-center rounded-controle text-texto-suave transition-colors duration-(--duracao-1) hover:bg-hover-de-linha"
      >
        <X aria-hidden="true" className="size-3.5" />
      </Toast.Close>
    </Toast.Root>
  )
}

/**
 * Provedor global de toasts (design-system.md §5.8). Viewport fixo no canto
 * inferior direito (no alto, abaixo de `lg`); fio de 3px no tom (assinatura §1.3). Regra: toast nunca é
 * o único registro de um erro — o formulário/tabela reflete o estado também.
 */
export function ProvedorToast({ children }: { children: ReactNode }) {
  const [itens, setItens] = useState<ItemToast[]>([])
  const proximoId = useRef(0)

  const notificar = useCallback((opcoes: OpcoesToast) => {
    proximoId.current += 1
    const id = proximoId.current
    setItens((atuais) => [...atuais, { ...opcoes, id }])
  }, [])

  const fechar = useCallback((id: number) => {
    setItens((atuais) => atuais.filter((item) => item.id !== id))
  }, [])

  // O provedor re-renderiza a cada toast; sem memo, todo consumidor de
  // usarToast re-renderizaria junto (custo gratuito na grade da agenda, §16)
  const valor = useMemo(() => ({ notificar }), [notificar])

  /*
   * Abaixo do `lg` o toast mora no TOPO, sobre o cabeçalho: empilhados, dois ou três cobriam a
   * barra inteira (CRL2-05). Lá ele vira FILA — só o mais antigo pendente aparece, e o próximo
   * entra quando ele fecha (pelo tempo, pelo X ou pelo Esc).
   *
   * Fila, e NÃO substituição (CRL3-01): a agenda emite três toasts no mesmo tique — sucesso, o
   * aviso de que a criança já tem outro atendimento e o resultado do aviso à família —, e o do
   * meio é o ÚNICO registro da sobreposição. Substituir apagava justamente ele. Cada um monta ao
   * entrar, então conta a PRÓPRIA duração a partir dali e é anunciado pelo leitor de tela nessa
   * hora. Em tela larga eles se empilham no canto, como sempre.
   */
  const telaAbaixoDeLg = usarTelaAbaixoDeLg()
  const visiveis = telaAbaixoDeLg ? itens.slice(0, 1) : itens

  return (
    <ContextoToast.Provider value={valor}>
      {/* label do Provider prefixa cada anúncio; o do Viewport nomeia a região
          (o {hotkey} é substituído pelo Radix) — ambos em pt-BR (regra do repo) */}
      <Toast.Provider swipeDirection="right" label="Notificação">
        {children}
        {visiveis.map((item) => (
          <ItemDeToast key={item.id} item={item} aoFechar={fechar} />
        ))}
        {/*
          A largura nunca passa da tela (A11Y-CL-05): `w-96` fixo dava 384 px num celular de 320,
          e o aviso saía pela lateral. Abaixo de `lg` o viewport sobe para o TOPO (A11Y-CL-06):
          embaixo ele cobria o campo de escrever da conversa e a barra de ações das telas.
        */}
        <Toast.Viewport
          label="Notificações ({hotkey})"
          className="fixed bottom-4 right-4 z-(--z-toast) flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2 outline-none max-lg:bottom-auto max-lg:top-3"
        />
      </Toast.Provider>
    </ContextoToast.Provider>
  )
}

/**
 * Hook global de notificação: `const { notificar } = usarToast()`.
 * @throws Error se usado fora de <ProvedorToast>
 */
function useToastInterno(): ContextoToastValor {
  const contexto = useContext(ContextoToast)
  if (contexto === null) {
    throw new Error('usarToast exige <ProvedorToast> no topo da árvore')
  }
  return contexto
}

export { useToastInterno as usarToast }
