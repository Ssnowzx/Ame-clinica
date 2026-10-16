import { CircleAlert, ShieldAlert } from 'lucide-react'
import { Link } from 'react-router-dom'

import { EstadoVazio } from '@/componentes/ui/estado-vazio'

/** Os estados da FICHA (não do painel): endereço sem profissional e acesso negado. */

/** O aviso de endereço sem profissional (id inválido ou apagado), com a volta para a lista. */
export function EnderecoInvalido({ texto }: { texto: string }) {
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-3 rounded-superficie border border-linha-forte border-l-[3px] border-l-perigo-texto bg-superficie p-6"
    >
      <div className="flex items-start gap-2">
        <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-perigo-texto" />
        <p className="text-corpo text-texto">{texto}</p>
      </div>
      <Link
        to="/profissionais"
        className="rounded-controle text-corpo font-medium text-acento hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco"
      >
        Voltar aos profissionais
      </Link>
    </div>
  )
}

/** Sem `profissionais.ver` e sem ser o próprio: o acesso negado padrão — sem chamar a API. */
export function FichaSemAcesso() {
  return (
    <div className="p-8">
      <EstadoVazio
        titulo="Você não tem acesso a esta ficha"
        descricao="A ficha de um profissional abre para quem tem a permissão do módulo — ou para o próprio profissional."
        icone={<ShieldAlert className="size-8" />}
      />
    </div>
  )
}
