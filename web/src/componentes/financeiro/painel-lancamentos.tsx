import { useQuery } from '@tanstack/react-query'
import { CircleDollarSign, MessageCircle, Pencil, Receipt, RotateCcw, Trash2 } from 'lucide-react'
import { AlertDialog } from 'radix-ui'
import { useRef, useState } from 'react'

import { EstadosDaLista } from '@/componentes/cadastro/estados-da-lista'
import { DialogoAnexosDoLancamento, SeloComAnexo } from '@/componentes/financeiro/anexos-do-lancamento'
import { DialogoDeCobranca } from '@/componentes/financeiro/cobranca-pelo-whatsapp'
import { FormularioLancamento } from '@/componentes/financeiro/formulario-lancamento'
import { Recibo } from '@/componentes/financeiro/recibo'
import { AvisoErro } from '@/componentes/ui/aviso-erro'
import { Botao } from '@/componentes/ui/botao'
import { CampoCheckbox } from '@/componentes/ui/campo-checkbox'
import { CampoSelect } from '@/componentes/ui/campo-select'
import { DialogConfirmacao } from '@/componentes/ui/dialog-confirmacao'
import { Paginacao } from '@/componentes/ui/paginacao'
import { Tabela } from '@/componentes/ui/tabela'
import { usarMutacaoDeLancamento } from '@/hooks/usar-mutacao-de-lancamento'
import { usarPodeCobrar } from '@/hooks/usar-pode-cobrar'
import { chaves } from '@/lib/chaves-query'
import { cn } from '@/lib/cn'
import { ehCobravel, type LancamentoCobravel } from '@/lib/cobranca-pelo-whatsapp'
import { formatarBRL } from '@/lib/dinheiro'
import { buscarLancamento, listarContas, listarLancamentos } from '@/servicos/financeiro'
import { useAuthStore } from '@/stores/auth-store'
import type { FiltroDeLancamentos, InteressadoTipo, LancamentoCaixa, LancamentoDaLista, TipoLancamento } from '@/tipos'

type Situacao = 'todos' | 'aberto' | 'pago'
type TipoFiltro = 'todos' | TipoLancamento

function dataLegivel(valor: string): string {
  const [data] = valor.split(' ')
  return data.split('-').reverse().join('/')
}

export interface PainelLancamentosProps {
  /**
   * "Novo lançamento" vive no cabeçalho da página (evita a linha de filtros transbordar).
   * Opcionais: na seção Financeiro da FICHA não há criação — o painel só lista/age.
   */
  criando?: boolean
  aoFecharCriar?: () => void
  /**
   * Quando presente, FIXA o filtro por interessado (tipo + id) — é a seção Financeiro da
   * ficha apontando o painel ao paciente. Entra na chave de query, então o cache não
   * colide com a tela global (`chaves.lancamentos` chaveia pelo filtro inteiro).
   */
  interessado?: { tipo: InteressadoTipo; id: number }
}

export function PainelLancamentos({ criando = false, aoFecharCriar, interessado }: PainelLancamentosProps) {
  const [situacao, setSituacao] = useState<Situacao>('todos')
  const [tipo, setTipo] = useState<TipoFiltro>('todos')
  const [contaId, setContaId] = useState<string>('')
  const [pagina, setPagina] = useState(1)

  // diálogos: um id por intenção (editar/recibo/pagar/estornar/excluir)
  const [detalheId, setDetalheId] = useState<number | null>(null)
  const [modoDetalhe, setModoDetalhe] = useState<'editar' | 'recibo' | null>(null)
  const [aPagar, setAPagar] = useState<LancamentoCaixa | null>(null)
  const [aEstornar, setAEstornar] = useState<LancamentoCaixa | null>(null)
  const [aExcluir, setAExcluir] = useState<LancamentoCaixa | null>(null)
  const [excluirGrupo, setExcluirGrupo] = useState(false)
  // a cobrança pelo WhatsApp (cobranca-pelo-whatsapp) e os anexos a partir do selo
  // (anexo-no-lancamento): o selo guarda QUEM o abriu — se o último anexo for excluído, o selo
  // some da linha e o foco volta para o painel, nunca para o `body`
  const [aCobrar, setACobrar] = useState<LancamentoCobravel | null>(null)
  const [anexosDe, setAnexosDe] = useState<{ lancamento: LancamentoDaLista; gatilho: HTMLElement } | null>(null)
  const refDoPainel = useRef<HTMLDivElement>(null)

  const podePagar = useAuthStore((estado) => estado.temPermissao('lancamentos.pagar'))
  const podeEditar = useAuthStore((estado) => estado.temPermissao('lancamentos.editar'))
  const podeExcluir = useAuthStore((estado) => estado.temPermissao('lancamentos.excluir'))
  const podeCobrar = usarPodeCobrar()

  const { erros, pagar, estornar, excluir, baixando, excluindo } = usarMutacaoDeLancamento()

  const contas = useQuery({ queryKey: chaves.contas(), queryFn: listarContas })

  const filtro: FiltroDeLancamentos = {
    pagina,
    ...(tipo === 'todos' ? {} : { tipo }),
    ...(situacao === 'todos' ? {} : { pago: situacao === 'pago' }),
    ...(contaId === '' ? {} : { conta_id: Number(contaId) }),
    ...(interessado !== undefined
      ? { interessado_tipo: interessado.tipo, interessado_id: interessado.id }
      : {}),
  }

  const consulta = useQuery({
    queryKey: chaves.lancamentos(filtro),
    queryFn: () => listarLancamentos(filtro),
  })

  // detalhe (traz `obs`) para editar ou emitir recibo — gcTime: 0 (gatilho CHAVE-DETALHE)
  const detalhe = useQuery({
    queryKey: chaves.lancamento(detalheId ?? 0),
    queryFn: () => buscarLancamento(detalheId as number),
    enabled: detalheId !== null,
    gcTime: 0,
  })

  const lancamentos = consulta.data?.data ?? []
  const total = consulta.data?.total ?? 0
  const temAcoes = podeEditar || podeExcluir || podePagar || podeCobrar

  function trocarFiltro(mudanca: () => void): void {
    mudanca()
    setPagina(1)
  }

  function fecharDetalhe(): void {
    setDetalheId(null)
    setModoDetalhe(null)
  }

  return (
    // `tabIndex={-1}`: o destino do foco quando o selo que abriu os anexos sumiu da linha
    <div ref={refDoPainel} tabIndex={-1} className="flex flex-col gap-5 outline-none">
      <div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Situação">
            {(
              [
                { id: 'todos', rotulo: 'Todos' },
                { id: 'aberto', rotulo: 'Em aberto' },
                { id: 'pago', rotulo: 'Pagos' },
              ] as const
            ).map(({ id, rotulo }) => (
              <Botao
                key={id}
                variante={id === situacao ? 'primario' : 'secundario'}
                tamanho="sm"
                aria-pressed={id === situacao}
                onClick={() => {
                  trocarFiltro(() => {
                    setSituacao(id)
                  })
                }}
              >
                {rotulo}
              </Botao>
            ))}
          </div>

          <div className="flex flex-wrap gap-2" role="group" aria-label="Tipo">
            {(
              [
                { id: 'todos', rotulo: 'Todos' },
                { id: 'receita', rotulo: 'Receitas' },
                { id: 'despesa', rotulo: 'Despesas' },
              ] as const
            ).map(({ id, rotulo }) => (
              <Botao
                key={id}
                variante={id === tipo ? 'primario' : 'secundario'}
                tamanho="sm"
                aria-pressed={id === tipo}
                onClick={() => {
                  trocarFiltro(() => {
                    setTipo(id)
                  })
                }}
              >
                {rotulo}
              </Botao>
            ))}
          </div>

          <CampoSelect
            rotulo="Conta"
            className="min-w-44"
            value={contaId}
            onChange={(evento) => {
              trocarFiltro(() => {
                setContaId(evento.target.value)
              })
            }}
            opcoes={[
              { valor: '', rotulo: 'Todas as contas' },
              ...(contas.data ?? []).map((conta) => ({ valor: String(conta.id), rotulo: conta.nome })),
            ]}
          />
      </div>

      <EstadosDaLista
        carregando={consulta.isPending}
        erro={consulta.isError}
        aoTentarNovamente={() => {
          void consulta.refetch()
        }}
        vazio={consulta.isSuccess && lancamentos.length === 0}
        vazioTitulo="Nenhum lançamento neste recorte"
        vazioDescricao="Ajuste os filtros ou registre um novo lançamento."
      >
        <Tabela legenda={`${total} lançamentos`}>
          <Tabela.Cabecalho>
            <Tabela.Linha>
              <Tabela.CelulaCabecalho scope="col">Vencimento</Tabela.CelulaCabecalho>
              <Tabela.CelulaCabecalho scope="col">Tipo</Tabela.CelulaCabecalho>
              <Tabela.CelulaCabecalho scope="col">Interessado</Tabela.CelulaCabecalho>
              <Tabela.CelulaCabecalho scope="col">Líquido</Tabela.CelulaCabecalho>
              <Tabela.CelulaCabecalho scope="col">Situação</Tabela.CelulaCabecalho>
              {temAcoes ? <Tabela.CelulaCabecalho scope="col">Ações</Tabela.CelulaCabecalho> : null}
            </Tabela.Linha>
          </Tabela.Cabecalho>
          <Tabela.Corpo>
            {lancamentos.map((lancamento) => {
              const pago = lancamento.pago_em !== null
              return (
                <Tabela.Linha key={lancamento.id}>
                  <Tabela.Celula>{dataLegivel(lancamento.vencimento)}</Tabela.Celula>
                  <Tabela.Celula>
                    <span
                      className={cn(
                        'inline-flex items-center gap-1.5 text-corpo',
                        lancamento.tipo === 'receita' ? 'text-sucesso-texto' : 'text-perigo-texto',
                      )}
                    >
                      <span
                        aria-hidden="true"
                        className={cn(
                          'size-2 rounded-full',
                          lancamento.tipo === 'receita' ? 'bg-sucesso-texto' : 'bg-perigo',
                        )}
                      />
                      {lancamento.tipo === 'receita' ? 'Receita' : 'Despesa'}
                    </span>
                  </Tabela.Celula>
                  <Tabela.Celula>{lancamento.interessado?.nome ?? '—'}</Tabela.Celula>
                  <Tabela.Celula>
                    <span className="font-medium tabular-nums">{formatarBRL(lancamento.liquido)}</span>
                    {lancamento.parcelas_total !== null ? (
                      <span className="ml-1 text-meta text-texto-suave">
                        ({lancamento.parcela}/{lancamento.parcelas_total})
                      </span>
                    ) : null}
                  </Tabela.Celula>
                  <Tabela.Celula>
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={cn(
                          'inline-flex rounded-controle px-2 py-0.5 text-meta font-medium',
                          pago ? 'bg-sucesso-suave text-sucesso-texto' : 'bg-neutro-100 text-texto-suave',
                        )}
                      >
                        {pago ? `Pago em ${dataLegivel(lancamento.pago_em as string)}` : 'Em aberto'}
                      </span>
                      {lancamento.tem_anexo ? (
                        <SeloComAnexo
                          aoAbrir={(gatilho) => {
                            setAnexosDe({ lancamento, gatilho })
                          }}
                        />
                      ) : null}
                    </div>
                  </Tabela.Celula>
                  {temAcoes ? (
                    <Tabela.Celula>
                      {/* CICLO FECHADO — por que estas ações NÃO consultam o ciclo aqui.
                          `em_ciclo_fechado` é booleano de DETALHE (SEC-FC-09): a API o
                          mantém fora da listagem porque pintá-lo numa página de 100 linhas
                          custaria 100 consultas, e porque a linha da lista não pode virar
                          oráculo do calendário do convênio para quem não tem `convenios.ver`.
                          Buscar `/convenios/{id}/ciclos` a partir daqui seria exatamente o
                          oráculo que o parecer proíbe.
                          Quem some com "Salvar" é o formulário de edição, que carrega o
                          detalhe; nas demais ações o servidor recusa com 422 e a mensagem
                          aparece DENTRO do diálogo em que a pessoa está (D7). */}
                      <div className="flex flex-wrap gap-2">
                        {podePagar && !pago ? (
                          <Botao
                            variante="secundario"
                            tamanho="sm"
                            onClick={() => {
                              setAPagar(lancamento)
                            }}
                          >
                            <CircleDollarSign aria-hidden="true" className="size-3.5" />
                            Pagar
                          </Botao>
                        ) : null}
                        {podeCobrar && ehCobravel(lancamento) ? (
                          <Botao
                            variante="secundario"
                            tamanho="sm"
                            aria-label="Cobrar pelo WhatsApp"
                            onClick={() => {
                              setACobrar(lancamento)
                            }}
                          >
                            <MessageCircle aria-hidden="true" className="size-3.5" />
                            Cobrar
                          </Botao>
                        ) : null}
                        {podePagar && pago ? (
                          <Botao
                            variante="secundario"
                            tamanho="sm"
                            onClick={() => {
                              setAEstornar(lancamento)
                            }}
                          >
                            <RotateCcw aria-hidden="true" className="size-3.5" />
                            Estornar
                          </Botao>
                        ) : null}
                        {pago ? (
                          <Botao
                            variante="secundario"
                            tamanho="sm"
                            onClick={() => {
                              setDetalheId(lancamento.id)
                              setModoDetalhe('recibo')
                            }}
                          >
                            <Receipt aria-hidden="true" className="size-3.5" />
                            Recibo
                          </Botao>
                        ) : null}
                        {podeEditar ? (
                          <Botao
                            variante="secundario"
                            tamanho="sm"
                            onClick={() => {
                              setDetalheId(lancamento.id)
                              setModoDetalhe('editar')
                            }}
                          >
                            <Pencil aria-hidden="true" className="size-3.5" />
                            Editar
                          </Botao>
                        ) : null}
                        {podeExcluir && !pago ? (
                          <Botao
                            variante="perigo-suave"
                            tamanho="sm"
                            onClick={() => {
                              setExcluirGrupo(false)
                              setAExcluir(lancamento)
                            }}
                          >
                            <Trash2 aria-hidden="true" className="size-3.5" />
                            Excluir
                          </Botao>
                        ) : null}
                      </div>
                    </Tabela.Celula>
                  ) : null}
                </Tabela.Linha>
              )
            })}
          </Tabela.Corpo>
        </Tabela>

        {consulta.data !== undefined && consulta.data.last_page > 1 ? (
          <Paginacao
            pagina={consulta.data.current_page}
            totalPaginas={consulta.data.last_page}
            totalItens={total}
            aoMudar={setPagina}
          />
        ) : null}
      </EstadosDaLista>

      {/* Novo lançamento — sem detalhe a carregar (o botão vive no cabeçalho da página).
          Na ficha `criando` é sempre false; o fallback só satisfaz o tipo. */}
      {criando ? (
        <FormularioLancamento lancamento={null} aoFechar={aoFecharCriar ?? (() => undefined)} />
      ) : null}

      {/* Editar / Recibo — dependem do detalhe (com obs). Enquanto carrega, não monta. */}
      {modoDetalhe === 'editar' && detalhe.data !== undefined ? (
        <FormularioLancamento lancamento={detalhe.data} aoFechar={fecharDetalhe} />
      ) : null}
      {modoDetalhe === 'recibo' && detalhe.data !== undefined ? (
        <Recibo lancamento={detalhe.data} aoFechar={fecharDetalhe} />
      ) : null}

      {aCobrar !== null ? (
        <DialogoDeCobranca
          lancamento={aCobrar}
          aoFechar={() => {
            setACobrar(null)
          }}
        />
      ) : null}
      {anexosDe !== null ? (
        <DialogoAnexosDoLancamento
          lancamento={anexosDe.lancamento}
          aoFechar={() => {
            setAnexosDe(null)
          }}
          focoAoFechar={() => (anexosDe.gatilho.isConnected ? null : refDoPainel.current)}
        />
      ) : null}

      <DialogConfirmacao
        aberto={aPagar !== null}
        aoMudarAberto={(aberto) => {
          if (!aberto) setAPagar(null)
        }}
        titulo={aPagar !== null ? `Dar baixa em ${formatarBRL(aPagar.liquido)}?` : ''}
        consequencia="O lançamento passa a pago na data de hoje (fuso da clínica) e entra no fluxo de caixa."
        rotuloConfirmar="Dar baixa"
        tom="atencao"
        carregando={baixando}
        erros={erros.gerais}
        aoConfirmar={() =>
          new Promise<void>((resolver, rejeitar) => {
            if (aPagar === null) {
              resolver()
              return
            }
            pagar.mutate(aPagar.id, {
              onSuccess: () => {
                setAPagar(null)
                resolver()
              },
              onError: () => {
                rejeitar(new Error('recusado'))
              },
            })
          })
        }
      />

      <DialogConfirmacao
        aberto={aEstornar !== null}
        aoMudarAberto={(aberto) => {
          if (!aberto) setAEstornar(null)
        }}
        titulo={aEstornar !== null ? `Estornar o pagamento de ${formatarBRL(aEstornar.liquido)}?` : ''}
        consequencia="O lançamento volta para em aberto e sai do fluxo de caixa do período — é o caminho de correção."
        rotuloConfirmar="Estornar"
        tom="atencao"
        carregando={baixando}
        erros={erros.gerais}
        aoConfirmar={() =>
          new Promise<void>((resolver, rejeitar) => {
            if (aEstornar === null) {
              resolver()
              return
            }
            estornar.mutate(aEstornar.id, {
              onSuccess: () => {
                setAEstornar(null)
                resolver()
              },
              onError: () => {
                rejeitar(new Error('recusado'))
              },
            })
          })
        }
      />

      {/* Excluir — só de NÃO-pago. Parcelado oferece estender às parcelas em aberto. */}
      {aExcluir !== null ? (
        <AlertDialog.Root
          open
          onOpenChange={(aberto) => {
            if (!aberto && !excluindo) setAExcluir(null)
          }}
        >
          <AlertDialog.Portal>
            <AlertDialog.Overlay className="fixed inset-0 z-(--z-scrim) bg-texto/40" />
            <AlertDialog.Content className="fixed left-1/2 top-1/2 z-(--z-dialogo) w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-janela bg-superficie-elevada p-6 shadow-e3">
              <AlertDialog.Title className="text-titulo font-semibold text-texto">
                Excluir o lançamento de {formatarBRL(aExcluir.liquido)}?
              </AlertDialog.Title>
              <AlertDialog.Description className="mt-2 text-corpo text-texto-suave">
                Esta ação não pode ser desfeita. Lançamento pago não pode ser excluído — estorne antes.
              </AlertDialog.Description>

              {aExcluir.grupo_parcelamento !== null ? (
                <CampoCheckbox
                  className="mt-4"
                  rotulo="Aplicar às demais parcelas em aberto"
                  marcado={excluirGrupo}
                  aoMudar={setExcluirGrupo}
                  desabilitado={excluindo}
                />
              ) : null}

              {erros.gerais.length > 0 ? <AvisoErro mensagens={erros.gerais} className="mt-4" /> : null}

              <div className="mt-6 flex justify-end gap-3">
                <Botao
                  variante="secundario"
                  tamanho="lg"
                  disabled={excluindo}
                  onClick={() => {
                    setAExcluir(null)
                  }}
                >
                  Cancelar
                </Botao>
                <Botao
                  variante="perigo"
                  tamanho="lg"
                  carregando={excluindo}
                  onClick={() => {
                    excluir.mutate(
                      { id: aExcluir.id, aplicarNoGrupo: excluirGrupo },
                      {
                        onSuccess: () => {
                          setAExcluir(null)
                        },
                      },
                    )
                  }}
                >
                  Excluir
                </Botao>
              </div>
            </AlertDialog.Content>
          </AlertDialog.Portal>
        </AlertDialog.Root>
      ) : null}
    </div>
  )
}
