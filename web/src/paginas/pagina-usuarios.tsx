import { useMemo, useState } from 'react'

import { PainelAprovacoes } from '@/componentes/administracao/painel-aprovacoes'
import { PainelNiveis } from '@/componentes/administracao/painel-niveis'
import { PainelUsuarios } from '@/componentes/administracao/painel-usuarios'
import { Botao } from '@/componentes/ui/botao'
import { EstadoVazio } from '@/componentes/ui/estado-vazio'
import { useAuthStore } from '@/stores/auth-store'

type Aba = 'usuarios' | 'niveis' | 'aprovacoes'

/**
 * Área de administração de acesso (§4/§12) — Usuários e Níveis de permissão num item só,
 * como o mapa manda. Cada aba é oferecida só com a permissão do seu módulo; a página abre
 * na primeira permitida. Esconder a aba é EXPERIÊNCIA — o servidor decide (a URL direta a
 * cada endpoint responde 403 sem a permissão).
 */
export function PaginaUsuarios() {
  const temPermissao = useAuthStore((estado) => estado.temPermissao)
  const podeVerUsuarios = temPermissao('usuarios.ver')
  const podeVerNiveis = temPermissao('niveis_permissao.ver')

  const abas = useMemo(
    () =>
      [
        podeVerUsuarios ? ({ id: 'usuarios', rotulo: 'Usuários' } as const) : null,
        podeVerNiveis ? ({ id: 'niveis', rotulo: 'Níveis de permissão' } as const) : null,
        // pendências do maker-checker (AP-13) — mesmo módulo dono dos níveis
        podeVerNiveis ? ({ id: 'aprovacoes', rotulo: 'Aprovações' } as const) : null,
      ].filter((aba): aba is Exclude<typeof aba, null> => aba !== null),
    [podeVerUsuarios, podeVerNiveis],
  )

  const [ativa, setAtiva] = useState<Aba | undefined>(abas[0]?.id)

  // sem nenhuma das permissões: acesso negado (a rota já barra; defesa em profundidade)
  if (abas.length === 0) {
    return (
      <EstadoVazio
        titulo="Você não tem acesso a esta tela"
        descricao="Peça ao administrador da clínica a permissão necessária."
      />
    )
  }

  const abaAtual = ativa !== undefined && abas.some((aba) => aba.id === ativa) ? ativa : abas[0].id

  return (
    <section className="flex flex-col gap-6">
      {abas.length > 1 ? (
        <div className="flex gap-2 border-b border-linha" role="tablist" aria-label="Administração de acesso">
          {abas.map(({ id, rotulo }) => (
            <Botao
              key={id}
              id={`aba-${id}`}
              variante="fantasma"
              role="tab"
              aria-selected={abaAtual === id}
              aria-controls={`painel-${id}`}
              tabIndex={abaAtual === id ? 0 : -1}
              className={
                abaAtual === id
                  ? 'rounded-t-controle rounded-b-none border-b-2 border-destaque text-acento'
                  : 'rounded-t-controle rounded-b-none border-b-2 border-transparent text-texto-suave'
              }
              onClick={() => {
                setAtiva(id)
              }}
            >
              {rotulo}
            </Botao>
          ))}
        </div>
      ) : null}

      <div id={`painel-${abaAtual}`} role="tabpanel" aria-labelledby={`aba-${abaAtual}`}>
        {abaAtual === 'usuarios' ? <PainelUsuarios /> : abaAtual === 'niveis' ? <PainelNiveis /> : <PainelAprovacoes />}
      </div>
    </section>
  )
}
