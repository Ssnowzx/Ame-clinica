import { useQuery } from '@tanstack/react-query'
import { useId, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import type { SaldoDaConta } from '@/tipos'

import { DialogoSaldoDeAbertura } from '@/componentes/financeiro/dialogo-saldo-de-abertura'
import { Botao } from '@/componentes/ui/botao'
import { EstadoErro } from '@/componentes/ui/estado-erro'
import { EstadoVazio } from '@/componentes/ui/estado-vazio'
import { Etiqueta } from '@/componentes/ui/etiqueta'
import { Skeleton } from '@/componentes/ui/skeleton'
import { chaves } from '@/lib/chaves-query'
import { cn } from '@/lib/cn'
import { dataLegivel } from '@/lib/datas'
import { formatarBRL } from '@/lib/dinheiro'
import { possuiTodasAsPermissoes } from '@/lib/permissoes'
import { buscarSaldosDasContas } from '@/servicos/financeiro'
import { useAuthStore } from '@/stores/auth-store'

/**
 * Mudar a abertura exige as DUAS (design D5): quem edita a conta sem ver o caixa não mexe no
 * número que não pode ver. Sem as duas, a ação some — o convite vira só a explicação.
 */
const PERMISSOES_DA_ABERTURA = ['contas.editar', 'fluxo_caixa.ver'] as const

/** De onde o número vem, numa frase (spec `financeiro-tela`). */
export const ORIGEM_DO_VALOR_DAS_CONTAS =
  'O saldo de hoje é o saldo de abertura de cada conta, mais o que foi pago e transferido desde então. Escolha uma conta para ver só o extrato dela.'

/** Zero em qualquer grafia decimal — comparação de TEXTO, nunca soma. */
const ZERO_DECIMAL = /^[+-]?0+(\.0+)?$/

/** A conta nunca teve abertura: parte de zero e soma tudo — e pode não bater com o banco. */
function semAbertura(conta: SaldoDaConta): boolean {
  return conta.saldo_inicial_em === null && ZERO_DECIMAL.test(conta.saldo_inicial)
}

/** O sinal vem escrito na string do servidor — ler o texto não é somar. */
function ehNegativo(valor: string): boolean {
  return valor.trim().startsWith('-') && !ZERO_DECIMAL.test(valor.trim())
}

/** A moldura comum dos cartões: o escolhido ganha o acento, e `aria-pressed` diz o mesmo sem cor. */
function classesDoCartao(escolhido: boolean): string {
  return cn(
    'flex flex-col rounded-janela border bg-superficie',
    escolhido ? 'border-acento ring-1 ring-acento' : 'border-linha',
  )
}

const CLASSES_DO_ALVO =
  'flex w-full flex-col items-start gap-1 rounded-janela px-4 py-4 text-left transition-colors duration-(--duracao-1) hover:bg-fundo focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco'

interface CartaoDaContaProps {
  conta: SaldoDaConta
  escolhida: boolean
  aoEscolher: () => void
  podeDefinirAbertura: boolean
  aoDefinirAbertura: (disparador: HTMLElement) => void
}

function CartaoDaConta({ conta, escolhida, aoEscolher, podeDefinirAbertura, aoDefinirAbertura }: CartaoDaContaProps) {
  const nuncaAberta = semAbertura(conta)
  const rotuloDaAcao = nuncaAberta ? 'Definir saldo de abertura' : 'Ajustar abertura'

  return (
    <li className={classesDoCartao(escolhida)}>
      <button type="button" aria-pressed={escolhida} onClick={aoEscolher} className={cn(CLASSES_DO_ALVO, 'rounded-b-none')}>
        <span className="flex w-full items-center justify-between gap-2">
          <span className="truncate text-rotulo text-texto-suave">{conta.nome}</span>
          {conta.ativo ? null : (
            <Etiqueta tamanho="sm" className="shrink-0">
              Inativa
            </Etiqueta>
          )}
        </span>
        <span
          className={cn('text-titulo font-semibold tabular-nums', ehNegativo(conta.saldo) ? 'text-perigo-texto' : 'text-texto')}
        >
          {formatarBRL(conta.saldo)}
        </span>
      </button>
      <div className="mt-auto flex flex-col items-start gap-2 border-t border-linha px-4 py-3">
        {nuncaAberta ? (
          <p className="text-meta text-alerta-texto">Sem saldo de abertura: o número parte de zero e pode não bater com o banco.</p>
        ) : (
          <p className="text-meta text-texto-suave">
            {conta.saldo_inicial_em === null
              ? `Abertura de ${formatarBRL(conta.saldo_inicial)}`
              : `Abertura de ${formatarBRL(conta.saldo_inicial)} em ${dataLegivel(conta.saldo_inicial_em)}`}
          </p>
        )}
        {podeDefinirAbertura ? (
          <Botao
            variante={nuncaAberta ? 'secundario' : 'fantasma'}
            tamanho="sm"
            // um botão igual por cartão: o nome acessível diz DE QUAL conta, começando pelo texto
            // visível (2.5.3 — quem fala o rótulo em voz alta ainda acerta)
            aria-label={`${rotuloDaAcao} de ${conta.nome}`}
            onClick={(evento) => {
              aoDefinirAbertura(evento.currentTarget)
            }}
          >
            {rotuloDaAcao}
          </Botao>
        ) : null}
      </div>
    </li>
  )
}

export interface SaldosDasContasProps {
  /** A conta do extrato (`null` = todas) — o cartão dela aparece escolhido. */
  contaEscolhida: number | null
  aoEscolherConta: (contaId: number | null) => void
}

/**
 * "Quanto tem em cada conta" (change `saldo-das-contas`): o saldo de HOJE de cada conta e o
 * total, como o servidor os somou — a tela nunca soma dinheiro (somar no navegador já inventou
 * R$ 17,00 nesta casa).
 *
 * Cada cartão é também o FILTRO do extrato logo abaixo; o do total volta a "todas as contas".
 * A conta sem abertura diz que o número pode não bater com o banco, e oferece — a quem pode — o
 * caminho para acertar.
 */
export function SaldosDasContas({ contaEscolhida, aoEscolherConta }: SaldosDasContasProps) {
  const idDoTitulo = useId()
  const consulta = useQuery({ queryKey: chaves.saldosDasContas(), queryFn: buscarSaldosDasContas })
  const podeDefinirAbertura = useAuthStore((estado) => possuiTodasAsPermissoes(estado.temPermissao, PERMISSOES_DA_ABERTURA))
  const podeCadastrarConta = useAuthStore((estado) => estado.temPermissao('contas.criar'))
  const [emAbertura, setEmAbertura] = useState<SaldoDaConta | null>(null)
  const refDisparador = useRef<HTMLElement | null>(null)

  function conteudo() {
    if (consulta.isError) {
      return <EstadoErro mensagem="Não foi possível carregar o saldo das contas." aoTentarNovamente={() => void consulta.refetch()} />
    }
    if (consulta.isPending) {
      return (
        <div aria-busy="true" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, indice) => (
            <Skeleton key={indice} className="h-36 rounded-janela" />
          ))}
        </div>
      )
    }
    const { contas, total, em } = consulta.data
    if (contas.length === 0) {
      return (
        <EstadoVazio
          titulo="Nenhuma conta para mostrar."
          descricao="Cadastre as contas da clínica — o caixa da recepção, os bancos — para acompanhar quanto tem em cada uma."
          acao={
            podeCadastrarConta ? (
              <Botao asChild>
                <Link to="/contas">Cadastrar conta</Link>
              </Botao>
            ) : undefined
          }
        />
      )
    }

    return (
      <ul aria-label="Contas da clínica — escolha uma para filtrar o extrato" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <li className={cn(classesDoCartao(contaEscolhida === null), 'bg-acento-suave')}>
          <button
            type="button"
            aria-pressed={contaEscolhida === null}
            onClick={() => {
              aoEscolherConta(null)
            }}
            className={cn(CLASSES_DO_ALVO, 'h-full hover:bg-selecao')}
          >
            <span className="text-rotulo text-texto-suave">Todas as contas</span>
            <span className={cn('text-titulo font-semibold tabular-nums', ehNegativo(total) ? 'text-perigo-texto' : 'text-texto')}>
              {formatarBRL(total)}
            </span>
            <span className="mt-auto text-meta text-texto-suave">Total em {dataLegivel(em)}</span>
          </button>
        </li>
        {contas.map((conta) => (
          <CartaoDaConta
            key={conta.id}
            conta={conta}
            escolhida={contaEscolhida === conta.id}
            aoEscolher={() => {
              // o cartão escolhido, de novo, devolve o extrato a todas as contas
              aoEscolherConta(contaEscolhida === conta.id ? null : conta.id)
            }}
            podeDefinirAbertura={podeDefinirAbertura}
            aoDefinirAbertura={(disparador) => {
              refDisparador.current = disparador
              setEmAbertura(conta)
            }}
          />
        ))}
      </ul>
    )
  }

  return (
    <section aria-labelledby={idDoTitulo} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id={idDoTitulo} className="text-subtitulo font-semibold text-texto">
          Quanto tem em cada conta
        </h2>
        <p className="max-w-3xl text-corpo text-texto-suave">{ORIGEM_DO_VALOR_DAS_CONTAS}</p>
      </div>

      {conteudo()}

      {emAbertura !== null && consulta.data !== undefined ? (
        <DialogoSaldoDeAbertura
          conta={emAbertura}
          hoje={consulta.data.em}
          aoFechar={() => {
            setEmAbertura(null)
          }}
          focoAoFechar={() => refDisparador.current}
        />
      ) : null}
    </section>
  )
}
