import { ChevronRight, FileText } from 'lucide-react'
import { useId, useState } from 'react'
import { Link } from 'react-router-dom'

import { Botao } from '@/componentes/ui/botao'
import { CampoTexto } from '@/componentes/ui/campo-texto'
import { EstadoVazio } from '@/componentes/ui/estado-vazio'
import { formatarContagem } from '@/lib/numeros'
import { filtrarRelatorios } from '@/lib/relatorios/busca'
import { CATALOGO_DE_RELATORIOS, CATEGORIAS_DE_RELATORIOS, type RelatorioDoCatalogo } from '@/lib/relatorios/catalogo'
import { useAuthStore } from '@/stores/auth-store'

/**
 * O catálogo de relatórios (change `area-de-relatorios`): cartões por categoria, com a
 * busca que acha também pelo NOME ANTIGO do ClinicaÁgil — a recepção decorou "Agenda por
 * Status", e é assim que ela vai procurar. Cada cartão aparece só para quem tem TODAS as
 * permissões do relatório (o servidor decide de verdade: 403 na URL digitada).
 */
export function PaginaRelatorios() {
  const [busca, setBusca] = useState('')
  const idBase = useId()
  const temPermissao = useAuthStore((estado) => estado.temPermissao)

  const permitidos = CATALOGO_DE_RELATORIOS.filter((relatorio) =>
    relatorio.permissoes.every((permissao) => temPermissao(permissao)),
  )
  const visiveis = filtrarRelatorios(permitidos, busca)
  const porCategoria = CATEGORIAS_DE_RELATORIOS.map((categoria) => ({
    ...categoria,
    relatorios: visiveis.filter((relatorio) => relatorio.categoria === categoria.chave),
  })).filter((categoria) => categoria.relatorios.length > 0)

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-4">
        <div>
          <h1 className="text-titulo font-semibold text-texto">Relatórios</h1>
          <p className="mt-1 max-w-2xl text-corpo text-texto-suave">
            O papel da conferência: escolha o relatório, o período e os filtros, e imprima.
          </p>
        </div>
        {permitidos.length > 0 ? (
          <CampoTexto
            rotulo="Buscar relatório"
            type="search"
            autoComplete="off"
            placeholder="Nome de agora, ou o que ele tinha no ClinicaÁgil"
            value={busca}
            className="max-w-md"
            onChange={(evento) => {
              setBusca(evento.target.value)
            }}
          />
        ) : null}
        {/* o leitor de tela ouve quantos cartões restaram a cada tecla — a lista muda em silêncio sem isto */}
        <p className="sr-only" aria-live="polite">
          {formatarContagem(visiveis.length)} {visiveis.length === 1 ? 'relatório' : 'relatórios'}
        </p>
      </header>

      {permitidos.length === 0 ? (
        <EstadoVazio
          nivel={2}
          icone={<FileText className="size-8" />}
          titulo="Nenhum relatório disponível para o seu nível de acesso."
          descricao="Cada relatório fica atrás da permissão do módulo dono do dado. Peça ao administrador da clínica."
        />
      ) : visiveis.length === 0 ? (
        <EstadoVazio
          nivel={2}
          icone={<FileText className="size-8" />}
          titulo="Nenhum relatório com esse nome."
          descricao="Tente o nome de agora ou o que ele tinha no ClinicaÁgil."
          acao={
            <Botao
              variante="secundario"
              onClick={() => {
                setBusca('')
              }}
            >
              Limpar busca
            </Botao>
          }
        />
      ) : (
        porCategoria.map((categoria) => (
          <section key={categoria.chave} aria-labelledby={`${idBase}-${categoria.chave}`} className="flex flex-col gap-3">
            <h2 id={`${idBase}-${categoria.chave}`} className="text-subtitulo font-semibold text-texto">
              {categoria.rotulo}
            </h2>
            <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {categoria.relatorios.map((relatorio) => (
                <li key={relatorio.slug}>
                  <CartaoDeRelatorio relatorio={relatorio} />
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </section>
  )
}

function CartaoDeRelatorio({ relatorio }: { relatorio: RelatorioDoCatalogo }) {
  return (
    <Link
      to={`/relatorios/${relatorio.slug}`}
      className="flex h-full items-start gap-4 rounded-superficie border border-linha bg-superficie p-4 transition-colors duration-(--duracao-1) hover:border-linha-forte hover:bg-fundo focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco"
    >
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-corpo font-semibold text-texto">{relatorio.nome}</span>
        <span className="text-meta text-texto-suave">{relatorio.descricao}</span>
        {relatorio.nomesAntigos.length > 0 ? (
          <span className="text-meta text-texto-suave">
            No ClinicaÁgil: {relatorio.nomesAntigos.join(' · ')}
          </span>
        ) : null}
      </span>
      <ChevronRight aria-hidden="true" className="mt-1 size-4 shrink-0 text-texto-suave" />
    </Link>
  )
}
