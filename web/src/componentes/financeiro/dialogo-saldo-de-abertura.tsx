import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import type { PayloadSaldoDeAbertura, SaldoDaConta } from '@/tipos'

import { AvisoConflito } from '@/componentes/aviso-conflito'
import { JanelaDeFormulario } from '@/componentes/financeiro/janela-de-formulario'
import { AvisoErro } from '@/componentes/ui/aviso-erro'
import { CampoTexto } from '@/componentes/ui/campo-texto'
import { usarErrosDoServidor } from '@/hooks/usar-erros-do-servidor'
import { chaves } from '@/lib/chaves-query'
import { paraDecimalDaApi } from '@/lib/dinheiro'
import { buscarSaldosDasContas, definirSaldoDeAbertura } from '@/servicos/financeiro'

/** O que é o saldo de abertura, numa frase (spec `financeiro-tela`) — visível sob o título. */
export const EXPLICACAO_DA_ABERTURA =
  'É quanto havia na conta no início do dia escolhido: o saldo parte deste valor, e o que foi pago ou transferido antes desse dia não entra, porque já está dentro dele.'

/** As recusas que têm campo onde pousar; o resto (403, conflito) vai para o aviso geral. */
const CAMPOS = new Set(['saldo_inicial', 'saldo_inicial_em'])

/** Zero em qualquer grafia decimal (`0`, `0.00`, `-0.00`) — comparação de TEXTO, nunca soma. */
const ZERO_DECIMAL = /^[+-]?0+(\.0+)?$/

interface ValoresDaAbertura {
  valor: string
  data: string
}

/**
 * O formulário nasce da conta LIDA nos saldos. Sem abertura, o valor nasce VAZIO: um "0,00"
 * pré-preenchido seria uma resposta que ninguém deu — e a data nasce com o "hoje" do servidor.
 */
function valoresDe(conta: SaldoDaConta, hoje: string): ValoresDaAbertura {
  const nuncaDefinida = conta.saldo_inicial_em === null && ZERO_DECIMAL.test(conta.saldo_inicial)

  return {
    // o decimal da API na forma que o brasileiro lê e digita (`-350.00` → `-350,00`)
    valor: nuncaDefinida ? '' : conta.saldo_inicial.replace('.', ','),
    data: conta.saldo_inicial_em ?? hoje,
  }
}

export interface DialogoSaldoDeAberturaProps {
  /** A conta como veio de `GET /contas/saldos` — com o `updated_at` que vai no `If-Match`. */
  conta: SaldoDaConta
  /** `Y-m-d` de HOJE no fuso da clínica, dito pelo servidor (o `em` dos saldos). */
  hoje: string
  aoFechar: () => void
  focoAoFechar: () => HTMLElement | null
}

/**
 * Definir (ou ajustar) o saldo de abertura de uma conta (change `saldo-das-contas`, D1): o valor
 * que havia nela no início de um dia. É o que faz o cartão bater com o banco.
 *
 * - **Negativo** é aceito (conta no cheque especial): por isso o campo NÃO usa o teclado decimal
 *   do celular — o do iPhone não tem o sinal de menos.
 * - **Depois de salvar**, os saldos e o extrato se refazem (a chave dos saldos mora sob a do
 *   extrato), e a ação fica na auditoria (servidor).
 * - **Conflito:** o `PUT` leva o `updated_at` da leitura; se outra pessoa mudou a conta, nada é
 *   gravado por cima, e quem decide recarregar é a pessoa.
 */
export function DialogoSaldoDeAbertura({ conta, hoje, aoFechar, focoAoFechar }: DialogoSaldoDeAberturaProps) {
  const queryClient = useQueryClient()
  const [emEdicao, setEmEdicao] = useState<SaldoDaConta>(conta)
  const [valores, setValores] = useState<ValoresDaAbertura>(() => valoresDe(conta, hoje))
  const [recarregando, setRecarregando] = useState(false)
  const [falhaAoRecarregar, setFalhaAoRecarregar] = useState<string | null>(null)
  // toda recusa tem onde pousar — os dois campos, o aviso geral e o do conflito: o toast seria a
  // mesma frase uma terceira vez, e roubaria o Esc do diálogo (A11Y-FIN-03, TOAST-ROUBA-O-ESC)
  const { erros, limparErros, aoFalhar, notificar } = usarErrosDoServidor(CAMPOS, { toast: false })
  const conflito = erros.motivo === 'conflito'

  const salvar = useMutation({
    retry: 0,
    mutationFn: (payload: PayloadSaldoDeAbertura) => definirSaldoDeAbertura(emEdicao.id, payload, emEdicao.updated_at),
    onMutate: () => {
      limparErros()
      setFalhaAoRecarregar(null)
    },
    onSuccess: async () => {
      // o saldo dos cartões e o saldo corrido do extrato partem da abertura: refazem-se os dois
      await queryClient.invalidateQueries({ queryKey: ['fluxo-caixa'] })
      notificar({ tom: 'sucesso', titulo: `Saldo de abertura de ${emEdicao.nome} salvo.` })
      aoFechar()
    },
    onError: aoFalhar,
  })

  function definir(parciais: Partial<ValoresDaAbertura>): void {
    setValores((anteriores) => ({ ...anteriores, ...parciais }))
  }

  async function recarregar(): Promise<void> {
    setFalhaAoRecarregar(null)
    setRecarregando(true)
    try {
      const frescos = await queryClient.fetchQuery({
        queryKey: chaves.saldosDasContas(),
        queryFn: buscarSaldosDasContas,
        staleTime: 0,
      })
      const fresca = frescos.contas.find((candidata) => candidata.id === emEdicao.id)
      if (fresca === undefined) {
        notificar({ tom: 'erro', titulo: `${emEdicao.nome} não aparece mais entre as contas com saldo.` })
        aoFechar()
        return
      }
      limparErros()
      setEmEdicao(fresca)
      setValores(valoresDe(fresca, frescos.em))
    } catch {
      // dentro do diálogo, ao lado do "Recarregar" que falhou — nunca só num toast que some
      setFalhaAoRecarregar('Não foi possível recarregar a conta. Tente de novo em instantes.')
    } finally {
      setRecarregando(false)
    }
  }

  const erroDe = (campo: string): string | undefined => erros.campos.get(campo)
  const definida = !(emEdicao.saldo_inicial_em === null && ZERO_DECIMAL.test(emEdicao.saldo_inicial))

  return (
    <JanelaDeFormulario
      titulo={`${definida ? 'Ajustar' : 'Definir'} saldo de abertura — ${emEdicao.nome}`}
      descricao={EXPLICACAO_DA_ABERTURA}
      aoFechar={aoFechar}
      aoSubmeter={() => {
        salvar.mutate({ saldo_inicial: paraDecimalDaApi(valores.valor), saldo_inicial_em: valores.data })
      }}
      salvando={salvar.isPending}
      rotuloSalvar="Salvar abertura"
      // sem o dia, a abertura viraria "desde sempre" — outro número, que ninguém pediu
      podeSalvar={valores.data !== ''}
      focoAoFechar={focoAoFechar}
    >
      <AvisoErro mensagens={conflito ? [] : erros.gerais} />
      <AvisoConflito
        visivel={conflito}
        aoRecarregar={() => {
          void recarregar()
        }}
        recarregando={recarregando}
      />
      <AvisoErro mensagens={falhaAoRecarregar === null ? [] : [falhaAoRecarregar]} />

      <div className="grid gap-4 sm:grid-cols-2">
        <CampoTexto
          rotulo="Dia da abertura"
          type="date"
          obrigatorio
          value={valores.data}
          onChange={(evento) => {
            definir({ data: evento.target.value })
          }}
          ajuda="Em geral, o dia do último extrato do banco que você tem em mãos."
          erro={erroDe('saldo_inicial_em')}
        />
        <CampoTexto
          rotulo="Valor no início desse dia (R$)"
          obrigatorio
          placeholder="0,00"
          value={valores.valor}
          onChange={(evento) => {
            definir({ valor: evento.target.value })
          }}
          ajuda="No cheque especial, use o sinal de menos: -350,00."
          erro={erroDe('saldo_inicial')}
        />
      </div>
    </JanelaDeFormulario>
  )
}
