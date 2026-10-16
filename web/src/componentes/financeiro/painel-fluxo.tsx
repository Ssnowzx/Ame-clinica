import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'

import { DialogoTransferencia } from '@/componentes/financeiro/dialogo-transferencia'
import { SaldosDasContas } from '@/componentes/financeiro/saldos-das-contas'
import { AvisoErro } from '@/componentes/ui/aviso-erro'
import { Botao } from '@/componentes/ui/botao'
import { CampoSelect } from '@/componentes/ui/campo-select'
import { CampoTexto } from '@/componentes/ui/campo-texto'
import { DialogConfirmacao } from '@/componentes/ui/dialog-confirmacao'
import { EstadosDaLista } from '@/componentes/cadastro/estados-da-lista'
import { Tabela } from '@/componentes/ui/tabela'
import { usarMutacaoDeTransferencia } from '@/hooks/usar-mutacao-de-transferencia'
import { chaves } from '@/lib/chaves-query'
import { ehDataDeFiltroUtilizavel } from '@/lib/data-de-filtro'
import { cn } from '@/lib/cn'
import { formatarBRL } from '@/lib/dinheiro'
import { somarDias } from '@/lib/grade-agenda'
import { ErroDeApi } from '@/lib/http'
import { possuiTodasAsPermissoes } from '@/lib/permissoes'
import { buscarFluxoCaixa, buscarSaldosDasContas, buscarTransferencia, listarContas } from '@/servicos/financeiro'
import { useAuthStore } from '@/stores/auth-store'
import type { MovimentoDeCaixa, Transferencia } from '@/tipos'

/**
 * Editar a transferência pede TRÊS permissões: a de editar, a de ver — é por `GET
 * /transferencias/{id}` (sob `transferencias.ver`) que a edição lê a `obs` e o `updated_at` — e a
 * de ver as contas, que o diálogo lista para escolher origem e destino (SEC-CDD-02: sem ela, o
 * diálogo abria e nunca deixava salvar). Oferecer o "Editar" a quem não pode concluir é um botão
 * que só produz recusa.
 */
const PERMISSOES_DE_EDITAR_TRANSFERENCIA = ['transferencias.editar', 'transferencias.ver', 'contas.ver'] as const

function doMes(): { de: string; ate: string } {
  const agora = new Date()
  const ano = agora.getFullYear()
  const mes = String(agora.getMonth() + 1).padStart(2, '0')
  const dia = String(agora.getDate()).padStart(2, '0')
  return { de: `${ano}-${mes}-01`, ate: `${ano}-${mes}-${dia}` }
}

function dataLegivel(valor: string): string {
  const [data] = valor.split(' ')
  return data.split('-').reverse().join('/')
}

function CartaoTotal({ rotulo, valor, tom }: { rotulo: string; valor: string; tom: 'entrada' | 'saida' | 'saldo' | 'neutro' }) {
  return (
    <div className="rounded-janela border border-linha bg-superficie p-4">
      <p className="text-rotulo text-texto-suave">{rotulo}</p>
      <p
        className={cn(
          'mt-1 text-titulo font-semibold tabular-nums',
          tom === 'entrada' && 'text-sucesso-texto',
          tom === 'saida' && 'text-perigo-texto',
          (tom === 'saldo' || tom === 'neutro') && 'text-texto',
        )}
      >
        {formatarBRL(valor)}
      </p>
    </div>
  )
}

/**
 * De quem é o saldo de cada linha — a coluna muda de sentido com o filtro, e a tela diz qual é.
 * Sem conta, uma transferência sai de uma conta e entra noutra: o saldo da clínica não muda.
 */
function legendaDoSaldo(nomeDaContaEscolhida: string | null): string {
  return nomeDaContaEscolhida === null
    ? 'Todas as contas: o saldo de cada linha é o da clínica, e a transferência entre contas não o muda.'
    : `Extrato de ${nomeDaContaEscolhida}: o saldo de cada linha é o desta conta, depois do movimento.`
}

/** O NOME da conta — "Conta 3" só quando a lista de contas não a conhece (sem permissão, por exemplo). */
function nomeDaConta(nomes: ReadonlyMap<number, string>, id: number | undefined): string {
  return (id === undefined ? undefined : nomes.get(id)) ?? `Conta ${id ?? '—'}`
}

function descreverMovimento(movimento: MovimentoDeCaixa, nomes: ReadonlyMap<number, string>): { rotulo: string; detalhe: string; valor: string; tom: 'entrada' | 'saida' | 'neutro'; data: string } {
  if (movimento.movimento === 'transferencia') {
    return {
      rotulo: 'Transferência',
      detalhe: `${nomeDaConta(nomes, movimento.conta_origem_id)} → ${nomeDaConta(nomes, movimento.conta_destino_id)}`,
      valor: movimento.valor ?? '0.00',
      tom: 'neutro',
      data: movimento.data ?? '',
    }
  }
  return {
    rotulo: movimento.movimento === 'receita' ? 'Receita' : 'Despesa',
    detalhe: movimento.interessado?.nome ?? '—',
    valor: movimento.valor_liquido ?? '0.00',
    tom: movimento.movimento === 'receita' ? 'entrada' : 'saida',
    data: movimento.pago_em ?? '',
  }
}

export function PainelFluxo() {
  const [de, setDe] = useState(() => doMes().de)
  const [ate, setAte] = useState(() => doMes().ate)
  const [contaId, setContaId] = useState('')

  const contas = useQuery({ queryKey: chaves.contas(), queryFn: listarContas })
  // a MESMA consulta dos cartões (mesma chave: um pedido só). Quem vê o fluxo sem ver o cadastro de
  // contas ainda conhece as contas pelos saldos — sem isso, o cartão escolhido deixava o seletor
  // em "Todas as contas" com o extrato filtrado por baixo
  const saldos = useQuery({ queryKey: chaves.saldosDasContas(), queryFn: buscarSaldosDasContas })
  const nomesDasContas = new Map([
    ...(saldos.data?.contas ?? []).map((conta): [number, string] => [conta.id, conta.nome]),
    ...(contas.data ?? []).map((conta): [number, string] => [conta.id, conta.nome]),
  ])

  // a transferência se corrige ONDE aparece (design D7): na linha dela, aqui no Fluxo
  const podeEditarTransferencia = useAuthStore((estado) =>
    possuiTodasAsPermissoes(estado.temPermissao, PERMISSOES_DE_EDITAR_TRANSFERENCIA),
  )
  const podeExcluirTransferencia = useAuthStore((estado) => estado.temPermissao('transferencias.excluir'))
  const temAcoes = podeEditarTransferencia || podeExcluirTransferencia
  const { erros, limparErros, notificar, excluir } = usarMutacaoDeTransferencia()
  const queryClient = useQueryClient()
  const [emEdicao, setEmEdicao] = useState<Transferencia | null>(null)
  const [abrindoId, setAbrindoId] = useState<number | null>(null)
  const [aExcluir, setAExcluir] = useState<MovimentoDeCaixa | null>(null)
  const refDisparador = useRef<HTMLElement | null>(null)
  // a linha excluída leva junto o botão que abriu a confirmação: o foco pousa no início do painel
  const refDoInicio = useRef<HTMLInputElement>(null)
  const excluiu = useRef(false)

  /** A edição lê a transferência AGORA — o extrato não traz a `obs` nem o `updated_at` do `PUT`. */
  async function abrirEdicao(id: number, disparador: HTMLElement): Promise<void> {
    refDisparador.current = disparador
    setAbrindoId(id)
    try {
      setEmEdicao(await buscarTransferencia(id))
    } catch {
      notificar({ tom: 'erro', titulo: 'Não foi possível abrir a transferência. Tente de novo em instantes.' })
      // CR-CDD-07: a falha mais provável é a transferência ter sido excluída por outra pessoa — sem
      // reconsultar, a linha velha ficava na tela e o "Editar" falhava sempre. Refaz o extrato E os
      // saldos (a chave dos saldos mora sob a do extrato): a transferência sumida mexe nos dois
      void queryClient.invalidateQueries({ queryKey: ['fluxo-caixa'] })
    } finally {
      setAbrindoId(null)
    }
  }

  const parametros = { de, ate, ...(contaId === '' ? {} : { contaId: Number(contaId) }) }
  const consulta = useQuery({
    queryKey: chaves.fluxoCaixa(parametros),
    queryFn: () => buscarFluxoCaixa(de, ate, contaId === '' ? undefined : Number(contaId)),
    // não basta "não vazio": o input emite a cada tecla do ano, e `0002-08-01` é uma data
    // sintaticamente válida que o servidor recusa — quatro 422 por data digitada
    enabled: ehDataDeFiltroUtilizavel(de) && ehDataDeFiltroUtilizavel(ate),
    // segura o resultado anterior enquanto o novo período carrega: sem isto os quatro
    // cartões de total SOMEM a cada troca de data e sobra uma tabela só com cabeçalho,
    // que parece defeito (o mesmo achado da validação em produção)
    placeholderData: (anterior) => anterior,
  })

  // 422 (janela máxima / teto de movimentos): a mensagem é ACIONÁVEL — refine o
  // intervalo. Não é o EstadoErro genérico "tente novamente" (repetir não resolve).
  const erro422 =
    consulta.error instanceof ErroDeApi && consulta.error.motivo === 'invalido'
      ? Object.values(consulta.error.camposInvalidos)[0]?.[0] ?? consulta.error.message
      : null

  const totais = consulta.data?.totais
  const movimentos = consulta.data?.movimentos ?? []
  const saldoAnterior = consulta.data?.saldo_anterior
  const contaEscolhida = contaId === '' ? null : Number(contaId)

  return (
    <div className="flex flex-col gap-5">
      <SaldosDasContas
        contaEscolhida={contaEscolhida}
        aoEscolherConta={(escolhida) => {
          setContaId(escolhida === null ? '' : String(escolhida))
        }}
      />

      <div className="flex flex-wrap items-end gap-4">
        <CampoTexto
          ref={refDoInicio}
          rotulo="De"
          type="date"
          value={de}
          className="w-40"
          onChange={(evento) => {
            setDe(evento.target.value)
          }}
        />
        <CampoTexto
          rotulo="Até"
          type="date"
          value={ate}
          className="w-40"
          onChange={(evento) => {
            setAte(evento.target.value)
          }}
        />
        <CampoSelect
          rotulo="Conta"
          className="min-w-44"
          value={contaId}
          onChange={(evento) => {
            setContaId(evento.target.value)
          }}
          opcoes={[
            { valor: '', rotulo: 'Todas as contas' },
            ...[...nomesDasContas].map(([id, nome]) => ({ valor: String(id), rotulo: nome })),
          ]}
        />
      </div>

      {erro422 !== null ? <AvisoErro mensagens={[erro422]} /> : null}

      {totais !== undefined ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <CartaoTotal rotulo="Entradas" valor={totais.entradas} tom="entrada" />
          <CartaoTotal rotulo="Saídas" valor={totais.saidas} tom="saida" />
          <CartaoTotal rotulo="Saldo do período" valor={totais.saldo_do_periodo} tom="saldo" />
          <CartaoTotal rotulo="Transferido" valor={totais.transferido} tom="neutro" />
        </div>
      ) : null}

      <EstadosDaLista
        carregando={consulta.isPending && erro422 === null}
        erro={consulta.isError && erro422 === null}
        aoTentarNovamente={() => {
          void consulta.refetch()
        }}
        vazio={consulta.isSuccess && movimentos.length === 0}
        vazioTitulo="Sem movimentos no período"
        vazioDescricao={
          saldoAnterior === undefined
            ? 'Nenhum lançamento pago ou transferência entre estas datas.'
            : `Nenhum lançamento pago ou transferência entre estas datas. O saldo segue em ${formatarBRL(saldoAnterior)}.`
        }
      >
        <div className="flex flex-col gap-2">
          <p className="text-meta text-texto-suave">
            {legendaDoSaldo(contaEscolhida === null ? null : nomeDaConta(nomesDasContas, contaEscolhida))}
          </p>
          <Tabela legenda={`${movimentos.length} movimentos`}>
            <Tabela.Cabecalho>
              <Tabela.Linha>
                <Tabela.CelulaCabecalho scope="col">Data</Tabela.CelulaCabecalho>
                <Tabela.CelulaCabecalho scope="col">Movimento</Tabela.CelulaCabecalho>
                <Tabela.CelulaCabecalho scope="col">Detalhe</Tabela.CelulaCabecalho>
                <Tabela.CelulaCabecalho scope="col" className="text-right">
                  Valor
                </Tabela.CelulaCabecalho>
                <Tabela.CelulaCabecalho scope="col" className="text-right">
                  Saldo
                </Tabela.CelulaCabecalho>
                {temAcoes ? <Tabela.CelulaCabecalho scope="col">Ações</Tabela.CelulaCabecalho> : null}
              </Tabela.Linha>
            </Tabela.Cabecalho>
            <Tabela.Corpo>
              {saldoAnterior === undefined ? null : (
                // de onde a primeira linha parte: o saldo no fim do dia anterior ao período — do servidor
                <Tabela.Linha className="bg-fundo hover:bg-fundo">
                  <Tabela.CelulaCabecalho scope="row" colSpan={4} className="border-b-0 text-texto">
                    {`Saldo anterior, no fim de ${dataLegivel(somarDias(consulta.data?.de ?? de, -1))}`}
                  </Tabela.CelulaCabecalho>
                  <Tabela.Celula numerica className="font-semibold">
                    {formatarBRL(saldoAnterior)}
                  </Tabela.Celula>
                  {temAcoes ? <Tabela.Celula /> : null}
                </Tabela.Linha>
              )}
              {movimentos.map((movimento, indice) => {
                const linha = descreverMovimento(movimento, nomesDasContas)
                const transferenciaId = movimento.movimento === 'transferencia' ? movimento.transferencia_id : undefined
                return (
                  <Tabela.Linha key={`${movimento.movimento}-${movimento.lancamento_id ?? movimento.transferencia_id ?? indice}`}>
                    <Tabela.Celula>{linha.data === '' ? '—' : dataLegivel(linha.data)}</Tabela.Celula>
                    <Tabela.Celula>
                      <span
                        className={cn(
                          'text-corpo',
                          linha.tom === 'entrada' && 'text-sucesso-texto',
                          linha.tom === 'saida' && 'text-perigo-texto',
                          linha.tom === 'neutro' && 'text-texto-suave',
                        )}
                      >
                        {linha.rotulo}
                      </span>
                    </Tabela.Celula>
                    <Tabela.Celula>{linha.detalhe}</Tabela.Celula>
                    <Tabela.Celula numerica>
                      <span className="font-medium">{formatarBRL(linha.valor)}</span>
                    </Tabela.Celula>
                    <Tabela.Celula numerica>{formatarBRL(movimento.saldo)}</Tabela.Celula>
                    {temAcoes ? (
                      <Tabela.Celula>
                        {/* só a transferência se corrige daqui; o lançamento pago tem a aba dele */}
                        {transferenciaId === undefined ? null : (
                          <div className="flex gap-2">
                            {podeEditarTransferencia ? (
                              <Botao
                                variante="secundario"
                                tamanho="sm"
                                carregando={abrindoId === transferenciaId}
                                onClick={(evento) => {
                                  void abrirEdicao(transferenciaId, evento.currentTarget)
                                }}
                              >
                                <Pencil aria-hidden="true" className="size-3.5" />
                                Editar
                              </Botao>
                            ) : null}
                            {podeExcluirTransferencia ? (
                              <Botao
                                variante="perigo-suave"
                                tamanho="sm"
                                onClick={() => {
                                  limparErros()
                                  excluiu.current = false
                                  setAExcluir(movimento)
                                }}
                              >
                                <Trash2 aria-hidden="true" className="size-3.5" />
                                Excluir
                              </Botao>
                            ) : null}
                          </div>
                        )}
                      </Tabela.Celula>
                    ) : null}
                  </Tabela.Linha>
                )
              })}
            </Tabela.Corpo>
          </Tabela>
        </div>
      </EstadosDaLista>

      {emEdicao !== null ? (
        <DialogoTransferencia
          transferencia={emEdicao}
          aoFechar={() => {
            setEmEdicao(null)
          }}
          focoAoFechar={() => refDisparador.current}
        />
      ) : null}

      <DialogConfirmacao
        aberto={aExcluir !== null}
        aoMudarAberto={(aberto) => {
          if (!aberto) setAExcluir(null)
        }}
        titulo={aExcluir === null ? '' : `Excluir a transferência de ${formatarBRL(aExcluir.valor ?? '0.00')}?`}
        consequencia={
          aExcluir === null
            ? ''
            : `O dinheiro volta a constar na conta de origem: ${nomeDaConta(nomesDasContas, aExcluir.conta_origem_id)} deixa de ter mandado ${formatarBRL(aExcluir.valor ?? '0.00')} para ${nomeDaConta(nomesDasContas, aExcluir.conta_destino_id)}. As entradas e as saídas do período não mudam.`
        }
        rotuloConfirmar="Excluir transferência"
        tom="perigo"
        carregando={excluir.isPending}
        erros={erros.gerais}
        focoAoFechar={() => (excluiu.current ? refDoInicio.current : null)}
        aoConfirmar={() =>
          new Promise<void>((resolver, rejeitar) => {
            const id = aExcluir?.transferencia_id
            if (id === undefined) {
              resolver()
              return
            }
            excluir.mutate(id, {
              onSuccess: () => {
                excluiu.current = true
                setAExcluir(null)
                resolver()
              },
              onError: () => {
                rejeitar(new Error('recusado'))
              },
            })
          })
        }
      />
    </div>
  )
}
