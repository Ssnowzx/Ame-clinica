import { useQuery } from '@tanstack/react-query'
import { Printer } from 'lucide-react'

import { Botao } from '@/componentes/ui/botao'
import { Dialog } from '@/componentes/ui/dialog'
import { chaves } from '@/lib/chaves-query'
import { formatarBRL } from '@/lib/dinheiro'
import { buscarDocumentoDoInteressado, buscarNomeDaClinica } from '@/servicos/financeiro'
import { useAuthStore } from '@/stores/auth-store'
import type { InteressadoTipo, LancamentoCaixa } from '@/tipos'

/** A permissão de leitura do documento de cada tipo de interessado. */
const PERMISSAO_POR_TIPO: Record<InteressadoTipo, string> = {
  paciente: 'pacientes.ver',
  fornecedor: 'fornecedores.ver',
  funcionario: 'funcionarios.ver',
}

/** `Y-m-d` (ou `Y-m-d H:i`) → `dd/mm/aaaa`. */
function formatarData(valor: string): string {
  const [data] = valor.split(' ')
  return data.split('-').reverse().join('/')
}

export interface ReciboProps {
  /** O lançamento (detalhe, com `obs`) — deve estar PAGO para emitir recibo */
  lancamento: LancamentoCaixa
  aoFechar: () => void
}

/**
 * Recibo imprimível de um lançamento (fecha o gatilho REC).
 *
 * **Todo texto livre — `obs`, `documento`, razão social do interessado — é
 * renderizado por JSX comum, que o React ESCAPA.** Injeção de HTML bruto é
 * proibida aqui (guarda mecânica em `recibo.test.tsx` + a fiscalização global do
 * design system): é o primeiro lugar do produto a imprimir esses campos, então o
 * piso de escaping nasce com ele (fecha o gatilho REC).
 *
 * A identidade da clínica (`clinica.nome`) e o CPF/CNPJ do interessado vêm de
 * leituras JÁ gated; sem a permissão, o recibo OMITE o dado — nunca o fabrica.
 */
export function Recibo({ lancamento, aoFechar }: ReciboProps) {
  const temPermissao = useAuthStore((estado) => estado.temPermissao)
  const interessado = lancamento.interessado ?? null

  const clinica = useQuery({
    queryKey: chaves.nomeDaClinica(),
    queryFn: buscarNomeDaClinica,
    enabled: temPermissao('configuracoes.ver'),
  })

  const documento = useQuery({
    queryKey:
      interessado === null
        ? chaves.documentoDoInteressado('paciente', 0)
        : chaves.documentoDoInteressado(interessado.tipo, interessado.id),
    queryFn: () => buscarDocumentoDoInteressado(interessado!.tipo, interessado!.id),
    enabled: interessado !== null && temPermissao(PERMISSAO_POR_TIPO[interessado.tipo]),
  })

  const nomeDoInteressado = documento.data?.nome ?? interessado?.nome ?? null
  const documentoDoInteressado = documento.data?.documento ?? null
  const verbo = lancamento.tipo === 'receita' ? 'Recebemos de' : 'Pagamos a'

  const rodape = (
    <div data-nao-imprimir className="flex justify-end gap-3">
      <Botao variante="secundario" tamanho="lg" onClick={aoFechar}>
        Fechar
      </Botao>
      <Botao
        tamanho="lg"
        onClick={() => {
          window.print()
        }}
      >
        <Printer aria-hidden="true" className="size-4" />
        Imprimir
      </Botao>
    </div>
  )

  return (
    <Dialog
      aberto
      aoMudarAberto={(aberto) => {
        if (!aberto) aoFechar()
      }}
      titulo="Recibo"
      rodape={rodape}
    >
      <article data-impresso className="flex flex-col gap-5 text-texto">
        <header className="border-b border-linha pb-4">
          {clinica.data !== null && clinica.data !== undefined ? (
            <p className="text-titulo font-semibold">{clinica.data}</p>
          ) : null}
          <p className="text-rotulo uppercase tracking-wide text-texto-suave">Recibo</p>
        </header>

        <p className="text-corpo-lg">
          {verbo}{' '}
          <span className="font-semibold">{nomeDoInteressado ?? 'interessado não informado'}</span>
          {documentoDoInteressado !== null ? (
            <>
              {' '}
              (CPF/CNPJ: <span className="font-medium">{documentoDoInteressado}</span>)
            </>
          ) : null}{' '}
          a quantia de{' '}
          <span className="font-semibold">{formatarBRL(lancamento.liquido)}</span>.
        </p>

        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-corpo">
          <dt className="text-texto-suave">Competência</dt>
          <dd>{formatarData(lancamento.competencia)}</dd>
          <dt className="text-texto-suave">Vencimento</dt>
          <dd>{formatarData(lancamento.vencimento)}</dd>
          {lancamento.pago_em !== null ? (
            <>
              <dt className="text-texto-suave">Pago em</dt>
              <dd>{formatarData(lancamento.pago_em)}</dd>
            </>
          ) : null}
          {lancamento.documento !== null && lancamento.documento !== '' ? (
            <>
              <dt className="text-texto-suave">Documento</dt>
              {/* texto livre — JSX escapa por padrão (REC) */}
              <dd>{lancamento.documento}</dd>
            </>
          ) : null}
        </dl>

        {lancamento.obs !== null && lancamento.obs !== undefined && lancamento.obs !== '' ? (
          <div className="border-t border-linha pt-4">
            <p className="text-rotulo text-texto-suave">Observações</p>
            {/* texto livre potencialmente hostil — renderizado como TEXTO, nunca HTML (REC) */}
            <p className="mt-1 whitespace-pre-wrap text-corpo">{lancamento.obs}</p>
          </div>
        ) : null}
      </article>
    </Dialog>
  )
}
