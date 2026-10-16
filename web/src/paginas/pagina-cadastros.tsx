import { ChevronRight } from 'lucide-react'
import { Link } from 'react-router-dom'

import { ProtegidoPorPermissao } from '@/componentes/protegido-por-permissao'
import { CATALOGOS_DE_APOIO } from '@/lib/catalogos'

/**
 * O índice dos cadastros de apoio.
 *
 * Treze itens soltos no menu lateral fariam dele uma lista sem fim — o
 * "amontoado" que a clínica reclama do sistema antigo (§2). Um item só, e a grade
 * continua sendo a casa. Estes cadastros se mexem uma vez e ficam meses parados;
 * a agenda é diária. A navegação reflete a frequência, não o organograma.
 */
export function PaginaCadastros() {
  return (
    <section className="flex flex-col gap-6">
      <header>
        <h1 className="text-display font-semibold text-texto">Cadastros</h1>
        <p className="mt-2 max-w-2xl text-corpo text-texto-suave">
          O que a agenda e o financeiro consomem. Cadastro em dia é grade que não mente.
        </p>
      </header>

      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {CATALOGOS_DE_APOIO.map(({ modulo, rota, rotulo, descricao, icone: Icone }) => (
          <ProtegidoPorPermissao key={rota} permissao={`${modulo}.ver`}>
            <li>
              <Link
                to={rota}
                className="flex items-center gap-4 rounded-superficie border border-linha bg-superficie p-4 transition-colors duration-(--duracao-1) hover:border-linha-forte hover:bg-fundo focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco"
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-controle bg-acento-suave text-acento">
                  <Icone aria-hidden="true" className="size-5" />
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="text-corpo font-semibold text-texto">{rotulo}</span>
                  <span className="text-meta text-texto-suave">{descricao}</span>
                </span>
                <ChevronRight aria-hidden="true" className="ml-auto size-4 shrink-0 text-texto-suave" />
              </Link>
            </li>
          </ProtegidoPorPermissao>
        ))}
      </ul>
    </section>
  )
}
