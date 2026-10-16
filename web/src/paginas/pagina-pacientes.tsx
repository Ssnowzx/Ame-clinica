import { useQuery } from '@tanstack/react-query'
import { CircleCheck, TriangleAlert, UserPlus } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

import { BotaoCopiarLinkDeCadastro } from '@/componentes/cadastro/botao-copiar-link-de-cadastro'
import { CabecalhoDeCadastro } from '@/componentes/cadastro/cabecalho-de-cadastro'
import { EstadosDaLista } from '@/componentes/cadastro/estados-da-lista'
import { Botao } from '@/componentes/ui/botao'
import { Etiqueta } from '@/componentes/ui/etiqueta'
import { Segmento } from '@/componentes/ui/segmento'
import { Paginacao } from '@/componentes/ui/paginacao'
import { Tabela } from '@/componentes/ui/tabela'
import { usarDebounce } from '@/hooks/usar-debounce'
import { chaves } from '@/lib/chaves-query'
import { idadeEm, nomeDeExibicao, rotuloDaNecessidade } from '@/lib/pacientes'
import { listarPacientes } from '@/servicos/pacientes'
import { useAuthStore } from '@/stores/auth-store'

const SITUACOES = {
  ativos: true,
  inativos: false,
  todos: undefined,
} as const

type Situacao = keyof typeof SITUACOES

const OPCOES_DE_SITUACAO: ReadonlyArray<{ valor: Situacao; rotulo: string }> = [
  { valor: 'ativos', rotulo: 'Ativos' },
  { valor: 'inativos', rotulo: 'Inativos' },
  { valor: 'todos', rotulo: 'Todos' },
]

/**
 * Lista de pacientes (§5) — paginada e buscada NO SERVIDOR.
 *
 * O termo da busca fica em estado local e **nunca vai para a URL** (design D2):
 * é o nome de uma criança, e a URL vai para o histórico do navegador, para o
 * `Referer` e para o log de acesso. Página e situação, que não identificam
 * ninguém, ficam na URL — e sobrevivem ao recarregamento.
 */
export function PaginaPacientes() {
  const navigate = useNavigate()
  const [parametros, setParametros] = useSearchParams()
  const temPermissao = useAuthStore((estado) => estado.temPermissao)
  const [busca, setBusca] = useState('')

  const termo = usarDebounce(busca)

  const situacaoDaUrl = parametros.get('situacao')
  const situacao: Situacao = situacaoDaUrl === 'inativos' || situacaoDaUrl === 'todos' ? situacaoDaUrl : 'ativos'

  const paginaDaUrl = Number(parametros.get('pagina'))
  const pagina = Number.isInteger(paginaDaUrl) && paginaDaUrl > 0 ? paginaDaUrl : 1

  const filtro = { busca: termo, ativo: SITUACOES[situacao], pagina }
  const pacientes = useQuery({
    queryKey: chaves.pacientes(filtro),
    queryFn: () => listarPacientes(filtro),
  })

  const podeCriar = temPermissao('pacientes.criar')
  const paginaDeDados = pacientes.data

  function atualizarUrl(mudancas: Record<string, string | null>) {
    const proximos = new URLSearchParams(parametros)
    for (const [chave, valor] of Object.entries(mudancas)) {
      if (valor === null) {
        proximos.delete(chave)
      } else {
        proximos.set(chave, valor)
      }
    }
    setParametros(proximos, { replace: true })
  }

  return (
    <section className="flex flex-col gap-5">
      <CabecalhoDeCadastro
        titulo="Pacientes"
        contador={
          paginaDeDados !== undefined
            ? `${paginaDeDados.total} ${paginaDeDados.total === 1 ? 'paciente' : 'pacientes'}`
            : undefined
        }
        busca={{
          rotulo: 'Buscar paciente pelo nome',
          placeholder: 'Buscar pelo nome…',
          valor: busca,
          aoMudar: (valor) => {
            setBusca(valor)
            atualizarUrl({ pagina: null }) // outro termo, outra primeira página
          },
        }}
        acao={
          <div className="flex flex-wrap items-center gap-2">
            {/* o link do cadastro pelo link ao lado de Cadastrar: é aqui que a atendente está
                quando a família pergunta "posso preencher em casa?" */}
            <BotaoCopiarLinkDeCadastro />
            {podeCriar ? (
              <Botao
                tamanho="lg"
                onClick={() => {
                  navigate('/pacientes/novo')
                }}
              >
                <UserPlus size={18} aria-hidden="true" />
                Cadastrar paciente
              </Botao>
            ) : null}
          </div>
        }
      />

      <Segmento
        rotulo="Situação"
        className="self-start"
        opcoes={OPCOES_DE_SITUACAO}
        valor={situacao}
        aoMudar={(valor) => {
          atualizarUrl({ situacao: valor === 'ativos' ? null : valor, pagina: null })
        }}
      />

      <EstadosDaLista
        carregando={pacientes.isPending}
        erro={pacientes.isError}
        aoTentarNovamente={() => {
          void pacientes.refetch()
        }}
        vazio={paginaDeDados !== undefined && paginaDeDados.data.length === 0}
        // O vazio distingue TRÊS casos, não dois: busca sem acerto, RECORTE sem ninguém e
        // base realmente vazia. Antes a distinção era só pelo termo, então a aba "Inativos"
        // sem ninguém dizia "Nenhum paciente cadastrado. Cadastre o primeiro para começar a
        // agendar." — com pacientes ATIVOS existindo. A recepção leria isso e cadastraria
        // de novo quem já está lá (achado da validação em produção, 2026-08-21).
        vazioTitulo={
          termo !== ''
            ? 'Nenhum paciente encontrado.'
            : situacao === 'ativos'
              ? 'Nenhum paciente ativo.'
              : situacao === 'inativos'
                ? 'Nenhum paciente inativo.'
                : 'Nenhum paciente cadastrado.'
        }
        vazioDescricao={
          termo !== ''
            ? 'Confira o nome ou mude o filtro de situação.'
            : situacao === 'todos'
              ? 'Cadastre o primeiro para começar a agendar.'
              : 'Troque o filtro de situação para ver os demais.'
        }
        vazioAcao={
          podeCriar && termo === '' && situacao === 'todos' ? (
            <Botao
              onClick={() => {
                navigate('/pacientes/novo')
              }}
            >
              Cadastrar paciente
            </Botao>
          ) : undefined
        }
      >
        {paginaDeDados !== undefined ? (
          <>
            {/* a lista é MINIMIZADA pelo servidor: sem CPF, responsáveis,
                contatos ou endereço — o cadastro só existe no detalhe */}
            <Tabela legenda={`Pacientes — página ${paginaDeDados.current_page} de ${paginaDeDados.last_page}`}>
              <Tabela.Cabecalho>
                <Tabela.Linha>
                  <Tabela.CelulaCabecalho>Paciente</Tabela.CelulaCabecalho>
                  <Tabela.CelulaCabecalho>Idade</Tabela.CelulaCabecalho>
                  <Tabela.CelulaCabecalho>Necessidade</Tabela.CelulaCabecalho>
                  {/* em "Ativos"/"Inativos" a coluna repetiria o filtro em toda linha (design-qa
                      DQ-07): ela só informa quando a lista mistura os dois */}
                  {situacao === 'todos' ? <Tabela.CelulaCabecalho>Situação</Tabela.CelulaCabecalho> : null}
                  <Tabela.CelulaCabecalho>
                    <span className="sr-only">Alerta de cadastro</span>
                  </Tabela.CelulaCabecalho>
                </Tabela.Linha>
              </Tabela.Cabecalho>
              <Tabela.Corpo>
                {paginaDeDados.data.map((paciente) => (
                  <Tabela.Linha key={paciente.id}>
                    <Tabela.Celula>
                      <Link
                        to={`/pacientes/${paciente.id}`}
                        className="font-medium text-acento underline-offset-2 hover:underline"
                      >
                        {nomeDeExibicao(paciente)}
                      </Link>
                    </Tabela.Celula>
                    <Tabela.Celula>{idadeEm(paciente.nascimento)}</Tabela.Celula>
                    <Tabela.Celula>{rotuloDaNecessidade(paciente.necessidade)}</Tabela.Celula>
                    {situacao === 'todos' ? (
                      <Tabela.Celula>
                        {paciente.ativo ? (
                          <Etiqueta tom="sucesso" icone={CircleCheck}>Ativo</Etiqueta>
                        ) : (
                          <Etiqueta tom="neutro">Inativo</Etiqueta>
                        )}
                      </Tabela.Celula>
                    ) : null}
                    <Tabela.Celula>
                      {/* pré-cadastro do balcão (pre-cadastro-de-paciente): a ficha
                          ainda deve nascimento/necessidade — completar faz sumir */}
                      {paciente.cadastro_incompleto ? (
                        <Etiqueta tom="alerta" icone={TriangleAlert}>Cadastro incompleto</Etiqueta>
                      ) : null}
                    </Tabela.Celula>
                  </Tabela.Linha>
                ))}
              </Tabela.Corpo>
            </Tabela>

            {paginaDeDados.last_page > 1 ? (
              <Paginacao
                pagina={paginaDeDados.current_page}
                totalPaginas={paginaDeDados.last_page}
                totalItens={paginaDeDados.total}
                aoMudar={(proxima) => {
                  atualizarUrl({ pagina: proxima === 1 ? null : String(proxima) })
                }}
              />
            ) : null}
          </>
        ) : null}
      </EstadosDaLista>
    </section>
  )
}
