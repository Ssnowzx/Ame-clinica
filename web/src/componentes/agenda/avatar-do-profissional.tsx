import { useState } from 'react'

import { cn } from '@/lib/cn'
import { normalizarCorMarcador } from '@/lib/cor-status'
import { iniciais } from '@/lib/iniciais'

export interface AvatarDoProfissionalProps {
  nome: string
  /** Hex da especialidade principal (`especialidades.cor`); `null` = anel neutro. */
  cor: string | null
  /** Com `id` + `fotoVersao`, mostra a FOTO do cadastro (`/api/profissionais/{id}/foto`). */
  id?: number
  fotoVersao?: string | null
  tamanho?: 'sm' | 'md' | 'lg'
  className?: string
}

const TAMANHOS = {
  sm: 'size-6 text-meta',
  md: 'size-8 text-meta',
  lg: 'size-16 text-corpo-lg',
} as const

/**
 * O profissional com rosto: a FOTO do cadastro quando há uma, senão as iniciais — sempre num
 * círculo com o ANEL na cor da especialidade (o marcador fino da §2 virando presença). Decorativo
 * (`aria-hidden`, `alt=""`): o nome e a especialidade continuam em texto ao lado.
 *
 * Se a imagem falhar (arquivo sumiu, sessão caiu), cai nas iniciais — a versão que falhou fica
 * anotada para não tentar de novo até a foto mudar.
 */
export function AvatarDoProfissional({
  nome,
  cor,
  id,
  fotoVersao = null,
  tamanho = 'md',
  className,
}: AvatarDoProfissionalProps) {
  const [versaoQueFalhou, setVersaoQueFalhou] = useState<string | null>(null)
  const mostraFoto = id !== undefined && fotoVersao !== null && versaoQueFalhou !== fotoVersao

  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex shrink-0 items-center justify-center overflow-hidden rounded-pilula border-2 border-linha-forte bg-avatar-fundo font-semibold text-texto',
        TAMANHOS[tamanho],
        className,
      )}
      style={cor === null ? undefined : { borderColor: normalizarCorMarcador(cor) }}
    >
      {mostraFoto ? (
        <img
          src={`/api/profissionais/${id}/foto?v=${fotoVersao}`}
          alt=""
          loading="lazy"
          decoding="async"
          className="size-full object-cover"
          onError={() => {
            setVersaoQueFalhou(fotoVersao)
          }}
        />
      ) : (
        iniciais(nome)
      )}
    </span>
  )
}
