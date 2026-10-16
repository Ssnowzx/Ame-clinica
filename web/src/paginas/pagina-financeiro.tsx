import { ArrowLeftRight, Link2, Plus, SlidersHorizontal, TrendingUp } from 'lucide-react'
import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import { CabecalhoDeCadastro } from '@/componentes/cadastro/cabecalho-de-cadastro'
import { DialogoTransferencia } from '@/componentes/financeiro/dialogo-transferencia'
import { PainelFluxo } from '@/componentes/financeiro/painel-fluxo'
import { PainelLancamentos } from '@/componentes/financeiro/painel-lancamentos'
import { ProtegidoPorPermissao } from '@/componentes/protegido-por-permissao'
import { Botao } from '@/componentes/ui/botao'
import { PERMISSOES_DO_VINCULO_EM_LOTE } from '@/lib/catalogos'
import { possuiTodasAsPermissoes } from '@/lib/permissoes'
import { useAuthStore } from '@/stores/auth-store'

type Aba = 'lancamentos' | 'fluxo'

/** Criar a transferência e ler as contas que ela liga — as duas, em E. */
const PERMISSOES_DE_TRANSFERIR = ['transferencias.criar', 'contas.ver'] as const

const ABAS = [
  { id: 'lancamentos', rotulo: 'Lançamentos' },
  { id: 'fluxo', rotulo: 'Fluxo de caixa' },
] as const satisfies ReadonlyArray<{ id: Aba; rotulo: string }>

/**
 * O dinheiro da clínica (§9). A rota e o item de menu seguem sob `lancamentos.ver`,
 * mas as duas abas têm donos distintos (change totais-do-caixa, D3): Lançamentos
 * (operação um a um) fica com `lancamentos.ver`; Fluxo de Caixa (o extrato com os
 * TOTAIS da clínica) exige `fluxo_caixa.ver` — sem ela a afordância SOME (nunca
 * aba desabilitada) e a tela degrada para Lançamentos apenas, plenamente funcional.
 *
 * "Novo lançamento" vive AQUI, no cabeçalho (não na linha de filtros do painel):
 * o cabeçalho tem folga, e disputar espaço com os filtros transbordava a linha.
 *
 * "Transferir entre contas" (change `caixa-do-dia-a-dia`, D7) mora ao lado e vale nas DUAS abas:
 * a transferência não é lançamento, e é no Fluxo de caixa que ela aparece e se corrige.
 */
export function PaginaFinanceiro() {
  const [aba, setAba] = useState<Aba>('lancamentos')
  const [criando, setCriando] = useState(false)
  const [transferindo, setTransferindo] = useState(false)
  const refDoTransferir = useRef<HTMLButtonElement>(null)
  // o lote de vínculos exige as TRÊS permissões da rota — link para "acesso negado" é promessa vazia
  const podeVincular = useAuthStore((estado) =>
    possuiTodasAsPermissoes(estado.temPermissao, PERMISSOES_DO_VINCULO_EM_LOTE),
  )
  // SEC-CDD-02: o diálogo lista as contas para escolher origem e destino — sem `contas.ver` ele
  // abria e nunca deixava salvar. O botão exige as duas
  const podeTransferir = useAuthStore((estado) =>
    possuiTodasAsPermissoes(estado.temPermissao, PERMISSOES_DE_TRANSFERIR),
  )

  return (
    <section className="flex flex-col gap-6">
      <CabecalhoDeCadastro
        titulo="Financeiro"
        acao={
          <div className="flex flex-wrap items-center gap-3">
            {podeVincular ? (
              <Botao asChild variante="secundario">
                <Link to="/financeiro/vincular">
                  <Link2 aria-hidden="true" className="size-4" />
                  Pagamentos sem tratamento
                </Link>
              </Botao>
            ) : null}
            {podeTransferir ? (
              <Botao
                ref={refDoTransferir}
                variante="secundario"
                onClick={() => {
                  setTransferindo(true)
                }}
              >
                <ArrowLeftRight aria-hidden="true" className="size-4" />
                Transferir entre contas
              </Botao>
            ) : null}
            {/* o DRE é o resultado da clínica (dre-gerencial): mora ao lado do Fluxo de caixa, que já
                exige ver o caixa — o relatório pede também `lancamentos.ver`, que esta rota tem */}
            {aba === 'fluxo' ? (
              <>
                <Botao asChild variante="secundario">
                  <Link to="/relatorios/dre-gerencial">
                    <TrendingUp aria-hidden="true" className="size-4" />
                    Ver o DRE
                  </Link>
                </Botao>
                <Botao asChild variante="fantasma">
                  <Link to="/financeiro/dre/configurar">
                    <SlidersHorizontal aria-hidden="true" className="size-4" />
                    Configurar DRE
                  </Link>
                </Botao>
              </>
            ) : null}
            {aba === 'lancamentos' ? (
              <ProtegidoPorPermissao permissao="lancamentos.criar">
                <Botao
                  onClick={() => {
                    setCriando(true)
                  }}
                >
                  <Plus aria-hidden="true" className="size-4" />
                  Novo lançamento
                </Botao>
              </ProtegidoPorPermissao>
            ) : null}
          </div>
        }
      />

      <div className="flex gap-2 border-b border-linha" role="tablist" aria-label="Visões do financeiro">
        {ABAS.map(({ id, rotulo }) => {
          const botao = (
            <Botao
              key={id}
              id={`aba-${id}`}
              variante="fantasma"
              role="tab"
              aria-selected={aba === id}
              aria-controls={`painel-${id}`}
              tabIndex={aba === id ? 0 : -1}
              className={
                aba === id
                  ? 'rounded-t-controle rounded-b-none border-b-2 border-destaque text-acento'
                  : 'rounded-t-controle rounded-b-none border-b-2 border-transparent text-texto-suave'
              }
              onClick={() => {
                setAba(id)
              }}
            >
              {rotulo}
            </Botao>
          )

          // os totais da clínica têm permissão própria: sem ela a aba não existe
          return id === 'fluxo' ? (
            <ProtegidoPorPermissao key={id} permissao="fluxo_caixa.ver">
              {botao}
            </ProtegidoPorPermissao>
          ) : (
            botao
          )
        })}
      </div>

      <div id={`painel-${aba}`} role="tabpanel" aria-labelledby={`aba-${aba}`}>
        {aba === 'lancamentos' ? (
          <PainelLancamentos
            criando={criando}
            aoFecharCriar={() => {
              setCriando(false)
            }}
          />
        ) : (
          // defesa em profundidade: o painel também some (o 403 do servidor é o contrato)
          <ProtegidoPorPermissao permissao="fluxo_caixa.ver">
            <PainelFluxo />
          </ProtegidoPorPermissao>
        )}
      </div>

      {transferindo ? (
        <DialogoTransferencia
          transferencia={null}
          aoFechar={() => {
            setTransferindo(false)
          }}
          focoAoFechar={() => refDoTransferir.current}
        />
      ) : null}
    </section>
  )
}
