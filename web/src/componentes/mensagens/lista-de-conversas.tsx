import { MessageSquare } from 'lucide-react'

import { Botao } from '@/componentes/ui/botao'
import { Segmento } from '@/componentes/ui/segmento'
import { EstadoVazio } from '@/componentes/ui/estado-vazio'
import { Paginacao } from '@/componentes/ui/paginacao'
import { cn } from '@/lib/cn'
import type { Conversa, FiltroDeConversas } from '@/tipos'

const FILTROS: ReadonlyArray<{ valor: FiltroDeConversas; rotulo: string }> = [
  { valor: 'ativas', rotulo: 'Ativas' },
  { valor: 'nao_lidas', rotulo: 'Não lidas' },
  { valor: 'nao_vinculadas', rotulo: 'Sem paciente' },
  { valor: 'arquivadas', rotulo: 'Arquivadas' },
]

/** "hoje 14:30" / "12/03 09:15" — o formato que se lê de relance numa lista. */
function quando(iso: string | null): string {
  if (iso === null) return ''
  const data = new Date(iso)
  const hoje = new Date()
  const mesmoDia = data.toDateString() === hoje.toDateString()
  const hora = data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  return mesmoDia ? hora : `${data.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${hora}`
}

/**
 * A lista de conversas (change mensageria-whatsapp).
 *
 * DA CRIANÇA SAI SÓ O NOME. Nada de idade, necessidade ou marcador clínico: esta lista fica
 * aberta o dia inteiro numa tela de balcão, à vista de quem passa na recepção.
 */
export function ListaDeConversas({
  conversas,
  selecionada,
  filtro,
  onFiltro,
  onSelecionar,
  pagina,
  ultimaPagina,
  total,
  onPagina,
}: {
  conversas: Conversa[]
  selecionada: number | null
  filtro: FiltroDeConversas
  onFiltro: (filtro: FiltroDeConversas) => void
  onSelecionar: (id: number) => void
  pagina: number
  ultimaPagina: number
  total: number
  onPagina: (pagina: number) => void
}) {
  return (
    <div className="flex h-full flex-col">
      {/*
        `role="group"` com `aria-pressed`, NÃO `role="tab"`. Tabs prometem três coisas ao
        leitor de tela — um painel associado, uma parada de Tab só e navegação por setas — e
        nenhuma delas existia aqui: era ARIA mentindo ("aba 2 de 4") para o que é um FILTRO
        da mesma lista. É o padrão que `pagina-pacientes.tsx` já usa.
      */}
      {/*
        ROLAGEM HORIZONTAL: os quatro rótulos não cabem nos 320 px da coluna, e sem isto o
        `overflow-hidden` do painel corta "Arquivadas" pela metade. Quebrar em duas linhas
        (o comportamento anterior) empurrava a lista para baixo e desalinhava as pílulas.
        Não precisa de `tabIndex`: os próprios chips são focáveis, então a região rolável
        é alcançável por teclado.
      */}
      <div className="flex overflow-x-auto border-b border-linha px-2 py-2">
        <Segmento rotulo="Filtrar conversas" opcoes={FILTROS} valor={filtro} aoMudar={onFiltro} />
      </div>

      {conversas.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-4">
          <EstadoVazio
            titulo={filtro === 'ativas' ? 'Nenhuma conversa ainda' : 'Nada com este filtro'}
            descricao={
              filtro === 'ativas'
                ? 'As conversas aparecem aqui assim que uma família escrever para o número da clínica.'
                : 'Nenhuma conversa se encaixa no filtro escolhido.'
            }
            icone={<MessageSquare className="size-8" />}
            acao={
              filtro === 'ativas' ? undefined : (
                <Botao variante="secundario" onClick={() => onFiltro('ativas')}>
                  Ver todas as conversas
                </Botao>
              )
            }
            className="border-0 p-4"
          />
        </div>
      ) : (
        <ul className="flex-1 overflow-y-auto">
          {conversas.map((conversa) => (
            <li key={conversa.id}>
              <button
                type="button"
                // o endereço do item: é para ele que o foco volta quando a conversa fecha
                data-conversa={conversa.id}
                onClick={() => onSelecionar(conversa.id)}
                aria-current={selecionada === conversa.id ? 'true' : undefined}
                className={cn(
                  'flex w-full items-center gap-3 border-b border-linha px-3 py-3 text-left',
                  // anel INTERNO: com offset negativo dentro de `overflow-hidden` as
                  // laterais eram cortadas e sobravam duas barras soltas
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-foco',
                  // `selecao` é o papel semântico da linha escolhida (o mesmo da tabela do
                  // DS); `acento-suave` é superfície de acento e ficava a ~1,09:1 do branco.
                  // E `hover-de-linha` é o token cujo papel documentado é "hover de linha".
                  selecionada === conversa.id ? 'bg-selecao' : 'hover:bg-hover-de-linha',
                )}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-corpo font-medium text-texto">
                    {/* nome da criança OU telefone — nunca dado clínico */}
                    {conversa.paciente?.nome ?? conversa.nome_perfil ?? conversa.telefone}
                  </p>
                  {/* o TRECHO é o que faz decidir de relance qual conversa espera resposta */}
                  <p className="truncate text-meta text-texto-suave">
                    {conversa.trecho ?? (conversa.paciente === null ? 'Sem paciente vinculado' : conversa.telefone)}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="text-meta text-texto-suave">{quando(conversa.ultima_mensagem_em)}</span>
                  {conversa.nao_lidas > 0 && (
                    <span
                      className="rounded-pilula bg-acento px-2 py-0.5 text-meta font-semibold text-sobre-acento"
                      aria-label={`${conversa.nao_lidas} não lidas`}
                    >
                      {conversa.nao_lidas}
                    </span>
                  )}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      {ultimaPagina > 1 && (
        <div className="border-t border-linha px-3 py-2">
          {/* o componente do DS: `aria-current`, janela numérica e o total em role="status" */}
          <Paginacao pagina={pagina} totalPaginas={ultimaPagina} totalItens={total} aoMudar={onPagina} />
        </div>
      )}
    </div>
  )
}
