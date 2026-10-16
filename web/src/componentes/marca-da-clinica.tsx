import { useState } from 'react'

import { cn } from '@/lib/cn'
import { iniciais } from '@/lib/iniciais'
import { fonteDaMarca } from '@/lib/configuracoes-rotulos'
import { useAuthStore } from '@/stores/auth-store'

/** O nome do produto — o fallback quando a clínica não configurou nome nem logo. */
const NOME_DO_PRODUTO = 'Xclinicas'

interface VisualDaMarcaProps {
  nome: string
  /** chave da fonte curada (`padrao` | `serifada` | …) */
  fonte: string
  /** exibir a logo (identidade `logo` COM arquivo) — senão, o nome na fonte */
  usaLogo: boolean
  /** cache-bust da imagem (`logo_atualizado_em` do servidor) */
  logoVersao: string | null
  className?: string
}

/**
 * A marca da clínica, PURA de estado global — o shell a alimenta pelo `/me` e o
 * preview da aba Clínica pela escolha ainda não salva (spec administracao-tela).
 * Vive no TOPO da barra lateral, dona do bloco inteiro (o controle de recolher
 * saiu para a borda do cartão) — h-20 dá presença sem inflar a barra.
 */
export function VisualDaMarca({ nome, fonte, usaLogo, logoVersao, className }: VisualDaMarcaProps) {
  // drift (linha com logo mas arquivo ausente → 404 na imagem): cai para o nome,
  // nunca para o ícone quebrado do navegador
  const [logoFalhou, setLogoFalhou] = useState(false)

  const ehDoProduto = nome.trim() === ''
  const nomeEfetivo = ehDoProduto ? NOME_DO_PRODUTO : nome.trim()
  const mostraLogo = usaLogo && logoVersao !== null && !logoFalhou

  if (mostraLogo) {
    return (
      <img
        src={`/api/clinica/logo?v=${logoVersao}`}
        alt={nomeEfetivo}
        // h-20 (80px): pedido explícito do usuário em 2026-07-23 — a marca é a
        // âncora visual da barra, não um selo discreto
        className={cn('h-20 max-w-96 object-contain', className)}
        onError={() => {
          setLogoFalhou(true)
        }}
      />
    )
  }

  // Monograma + nome em até DUAS linhas: "Clínica Fictícia Exem…" cortado numa linha parecia
  // inacabado (revisão de design, 2026-09-02). O monograma é decorativo (aria-hidden); o nome
  // completo continua no `title` para o caso raro de três linhas.
  return (
    <span className={cn('flex min-w-0 items-center gap-3', className)}>
      {/* sem nome configurado, a marca é a do PRODUTO (change tema-xclinicas): o símbolo de verdade,
          e não um "X" em monograma que imita a marca */}
      {ehDoProduto ? (
        <img src="/marca/simbolo.svg" alt="" aria-hidden="true" className="size-10 shrink-0" />
      ) : (
        <span
          aria-hidden="true"
          className="flex size-10 shrink-0 items-center justify-center rounded-controle bg-acento text-corpo-lg font-semibold text-sobre-acento"
          style={{ fontFamily: fonteDaMarca(fonte) }}
        >
          {iniciais(nomeEfetivo)}
        </span>
      )}
      <p
        className="line-clamp-2 min-w-0 text-corpo-lg font-semibold text-texto"
        style={{ fontFamily: fonteDaMarca(fonte) }}
        title={nomeEfetivo}
      >
        {nomeEfetivo}
      </p>
    </span>
  )
}

/**
 * A marca que o SHELL exibe — lê a `marca` do `/me` (auth-store): o shell é de
 * todo autenticado, sem exigir `configuracoes.ver` (spec identidade-da-clinica).
 *
 * Mora no TOPO da barra lateral flutuante — é a âncora visual da barra. O
 * chamador dá a medida por `className` (o `cn` de dentro resolve o conflito com o
 * padrão): a lateral embrulha num bloco `h-20` e passa `max-w-full` — presença
 * sem espremer o trilho (recolhida, a marca sai: 64px não a comportam).
 */
export function MarcaDaClinica({ className }: { className?: string } = {}) {
  const marca = useAuthStore((estado) => estado.usuario?.marca)

  return (
    <VisualDaMarca
      nome={marca?.nome ?? ''}
      fonte={marca?.fonte ?? 'padrao'}
      usaLogo={marca?.identidade === 'logo'}
      logoVersao={marca?.logo_versao ?? null}
      className={className}
    />
  )
}
