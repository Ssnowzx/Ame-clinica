import { useMutation, useQueryClient } from '@tanstack/react-query'
import { TriangleAlert } from 'lucide-react'
import { useId, useRef, useState, type RefObject } from 'react'

import { AvisoErro } from '@/componentes/ui/aviso-erro'
import { Botao } from '@/componentes/ui/botao'
import { CampoCheckbox } from '@/componentes/ui/campo-checkbox'
import { CampoSelect } from '@/componentes/ui/campo-select'
import { DialogConfirmacao } from '@/componentes/ui/dialog-confirmacao'
import { Etiqueta } from '@/componentes/ui/etiqueta'
import { usarToast } from '@/componentes/ui/toast'
import { usarNomesDoTratamento } from '@/hooks/usar-nomes-do-tratamento'
import { dataLegivel } from '@/lib/datas'
import { formatarBRL } from '@/lib/dinheiro'
import { distribuirErrosDoServidor, erroDaLista, erroDoItem, semErros, type ErrosDoServidor } from '@/lib/erros'
import { ErroDeApi } from '@/lib/http'
import { formatarContagem } from '@/lib/numeros'
import { rotuloDoTratamentoDoPagamento, type NomesDoTratamento } from '@/lib/rotulo-de-tratamento'
import { vincularTratamentos } from '@/servicos/financeiro'
import type { PagamentoSemTratamento, PagamentosSemTratamento, VinculoDoLote } from '@/tipos'

/** O teto do `POST /lancamentos/vincular-tratamentos` (1..200 pares). */
const TETO_DO_LOTE = 200

/** O que a recusa de UMA linha diz no topo, antes das linhas: o lote é tudo ou nada (design D3). */
export const NADA_FOI_VINCULADO = 'Nada foi vinculado. Corrija a linha apontada e envie de novo.'

const ESCOLHA_O_TRATAMENTO = { valor: '', rotulo: 'Escolha o tratamento' }

/** A decisão de uma linha: marcada ou não, e para qual tratamento. */
interface Escolha {
  marcado: boolean
  /** `''` = nenhum tratamento escolhido — a linha não entra no lote */
  tratamentoId: string
}

/** A linha COM sugestão nasce marcada nela; a SEM sugestão nasce fora do lote (design D5). */
function escolhaInicial(pagamento: PagamentoSemTratamento): Escolha {
  return pagamento.sugestao === null
    ? { marcado: false, tratamentoId: '' }
    : { marcado: true, tratamentoId: String(pagamento.sugestao.tratamento_id) }
}

function plural(quantidade: number, singular: string, varios: string): string {
  return `${formatarContagem(quantidade)} ${quantidade === 1 ? singular : varios}`
}

/** "Vincular 3 pagamentos" — o botão e a confirmação dizem o MESMO número. */
function rotuloDoEnvio(quantidade: number): string {
  return quantidade === 0 ? 'Vincular pagamentos' : `Vincular ${plural(quantidade, 'pagamento', 'pagamentos')}`
}

const CHAVE_DE_ITEM = /^vinculos\.(\d+)(\.|$)/

/**
 * A recusa do servidor, por linha. O índice `vinculos.{i}` é do LOTE ENVIADO, não da lista: as
 * linhas desmarcadas não foram, então o `i` só se traduz em pagamento pelo que foi de fato. A
 * recusa que não cai em linha nenhuma volta como ÓRFÃ — ela vai para o resumo, nunca some.
 */
function errosPorLinha(
  erros: ErrosDoServidor,
  enviados: readonly VinculoDoLote[],
): { porLinha: Map<number, string>; orfas: string[] } {
  const porLinha = new Map<number, string>()
  enviados.forEach((vinculo, indice) => {
    const mensagem =
      erroDoItem(erros, 'vinculos', indice, 'tratamento_id') ??
      erroDoItem(erros, 'vinculos', indice, 'lancamento_id') ??
      erroDoItem(erros, 'vinculos', indice)
    if (mensagem !== undefined) {
      porLinha.set(vinculo.lancamento_id, mensagem)
    }
  })
  const orfas = [...erros.campos.entries()].flatMap(([chave, mensagem]) => {
    const indice = CHAVE_DE_ITEM.exec(chave)?.[1]
    return indice !== undefined && Number(indice) < enviados.length ? [] : chave === 'vinculos' ? [] : [mensagem]
  })
  return { porLinha, orfas }
}

export interface LoteDeVinculosProps {
  pagamentos: PagamentosSemTratamento
  /** O título da página: é para onde o foco volta quando o lote some da tela (2.4.3). */
  ancoraDoFoco: RefObject<HTMLHeadingElement | null>
}

/**
 * O lote "Vincular pagamentos ao tratamento" (change `vincular-pagamentos-ao-tratamento`): as
 * linhas COM sugestão vêm marcadas, as SEM sugestão oferecem os tratamentos da criança e só entram
 * quando escolhidas. "Vincular N pagamentos" confirma e envia; o servidor aplica tudo ou nada, e a
 * recusa de uma linha volta NELA, com nada gravado.
 */
export function LoteDeVinculos({ pagamentos, ancoraDoFoco }: LoteDeVinculosProps) {
  const queryClient = useQueryClient()
  const { notificar } = usarToast()
  const idDoMotivo = useId()
  const nomes = usarNomesDoTratamento(true)
  const [escolhas, setEscolhas] = useState<ReadonlyMap<number, Escolha>>(new Map())
  const [confirmando, setConfirmando] = useState(false)
  const [erros, setErros] = useState<ErrosDoServidor>(semErros)
  const [enviados, setEnviados] = useState<readonly VinculoDoLote[]>([])
  const [errosDoDialogo, setErrosDoDialogo] = useState<string[]>([])
  const vinculouAgora = useRef(false)
  const vincular = useMutation({ retry: 0, mutationFn: vincularTratamentos })

  const escolhaDe = (pagamento: PagamentoSemTratamento): Escolha =>
    escolhas.get(pagamento.id) ?? escolhaInicial(pagamento)

  const lote: VinculoDoLote[] = pagamentos.data.flatMap((pagamento) => {
    const escolha = escolhaDe(pagamento)
    return escolha.marcado && escolha.tratamentoId !== ''
      ? [{ lancamento_id: pagamento.id, tratamento_id: Number(escolha.tratamentoId) }]
      : []
  })
  const { porLinha: recusas, orfas } = errosPorLinha(erros, enviados)
  const acimaDoTeto = lote.length > TETO_DO_LOTE
  const motivoDoBloqueio =
    lote.length === 0
      ? 'Marque ao menos um pagamento com tratamento.'
      : acimaDoTeto
        ? `O lote vai até ${formatarContagem(TETO_DO_LOTE)} pagamentos por vez — desmarque ${formatarContagem(lote.length - TETO_DO_LOTE)}.`
        : null

  function mudarEscolha(pagamento: PagamentoSemTratamento, escolha: Escolha): void {
    setEscolhas((anteriores) => new Map(anteriores).set(pagamento.id, escolha))
  }

  /** O resumo da recusa: o que é da lista inteira, e cada linha recusada pelo nome e pela data. */
  function mensagensDoResumo(): string[] {
    const daLista = [erroDaLista(erros, 'vinculos'), ...erros.gerais, ...orfas].filter(
      (mensagem): mensagem is string => mensagem !== undefined,
    )
    const dasLinhas = pagamentos.data.flatMap((pagamento) => {
      const mensagem = recusas.get(pagamento.id)
      return mensagem === undefined
        ? []
        : [`${pagamento.paciente.nome}, pago em ${dataLegivel(pagamento.pago_em)}: ${mensagem}`]
    })
    const todas = [...daLista, ...dasLinhas]
    return todas.length === 0 ? [] : [...new Set([NADA_FOI_VINCULADO, ...todas])]
  }

  async function confirmar(): Promise<void> {
    const pares = lote
    setErrosDoDialogo([])
    try {
      const { vinculados } = await vincular.mutateAsync(pares)
      setErros(semErros())
      setEnviados([])
      vinculouAgora.current = true
      notificar({ tom: 'sucesso', titulo: `${plural(vinculados, 'pagamento vinculado', 'pagamentos vinculados')} ao tratamento.` })
      // a lista do lote e o formulário moram em `lancamentos`; o "Recebido" é um relatório. SEM
      // `await`: o diálogo fecha (e devolve o foco) antes de a lista recarregada tirar o lote da tela
      void queryClient.invalidateQueries({ queryKey: ['lancamentos'] })
      void queryClient.invalidateQueries({ queryKey: ['relatorios'] })
    } catch (erro) {
      if (erro instanceof ErroDeApi && erro.motivo === 'invalido') {
        // a recusa é de LINHA: o diálogo fecha para a pessoa ver a linha apontada atrás dele
        setEnviados(pares)
        setErros(distribuirErrosDoServidor(erro, new Set(['vinculos'])))
        return
      }
      // sem linha onde pousar (403, rede, servidor): a mensagem fica no diálogo, que continua aberto
      setErrosDoDialogo([erro instanceof Error ? erro.message : 'Não foi possível vincular. Tente novamente.'])
      throw erro
    }
  }

  const resumo = mensagensDoResumo()

  return (
    <div className="flex flex-col gap-4">
      {pagamentos.truncado ? (
        <p role="status" className="flex items-start gap-2 rounded-superficie bg-alerta-suave px-4 py-3 text-corpo text-alerta-texto">
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          A lista mostra os primeiros {formatarContagem(pagamentos.contagem)} pagamentos do mês. Vincule estes e os
          próximos aparecem aqui.
        </p>
      ) : null}

      <AvisoErro mensagens={resumo} />

      <ul
        aria-label={`Pagamentos sem tratamento: ${plural(pagamentos.contagem, 'pagamento', 'pagamentos')}`}
        className="rounded-superficie border border-linha-forte bg-superficie"
      >
        {pagamentos.data.map((pagamento) => (
          <LinhaDoVinculo
            key={pagamento.id}
            pagamento={pagamento}
            escolha={escolhaDe(pagamento)}
            nomes={nomes}
            erro={recusas.get(pagamento.id)}
            aoMudar={(escolha) => {
              mudarEscolha(pagamento, escolha)
            }}
          />
        ))}
      </ul>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-corpo text-texto-suave">
          {plural(lote.length, 'pagamento marcado', 'pagamentos marcados')} de {formatarContagem(pagamentos.contagem)}
        </p>
        <div className="flex flex-col items-end gap-1">
          <Botao
            tamanho="lg"
            aria-disabled={motivoDoBloqueio === null ? undefined : true}
            aria-describedby={motivoDoBloqueio === null ? undefined : idDoMotivo}
            onClick={() => {
              if (motivoDoBloqueio === null) {
                setConfirmando(true)
              }
            }}
          >
            {rotuloDoEnvio(lote.length)}
          </Botao>
          {motivoDoBloqueio === null ? null : (
            <p id={idDoMotivo} className="text-meta text-texto-suave">
              {motivoDoBloqueio}
            </p>
          )}
        </div>
      </div>

      <DialogConfirmacao
        aberto={confirmando}
        aoMudarAberto={(aberto) => {
          setConfirmando(aberto)
          if (!aberto) {
            setErrosDoDialogo([])
          }
        }}
        titulo={`${rotuloDoEnvio(lote.length)} ao tratamento?`}
        consequencia="Cada pagamento passa a contar para o profissional do tratamento no Recebido por profissional. A data do pagamento não muda. Se algum for recusado, nenhum é vinculado."
        rotuloConfirmar={rotuloDoEnvio(lote.length)}
        tom="atencao"
        carregando={vincular.isPending}
        erros={errosDoDialogo}
        aoConfirmar={confirmar}
        focoAoFechar={() => {
          // o lote que deu certo pode esvaziar a lista e levar o botão junto
          const alvo = vinculouAgora.current ? ancoraDoFoco.current : null
          vinculouAgora.current = false
          return alvo
        }}
      />
    </div>
  )
}

interface LinhaDoVinculoProps {
  pagamento: PagamentoSemTratamento
  escolha: Escolha
  nomes: NomesDoTratamento
  erro: string | undefined
  aoMudar: (escolha: Escolha) => void
}

/** Uma receita: a criança (a caixa de marcar), quando e quanto, e para qual tratamento vai. */
function LinhaDoVinculo({ pagamento, escolha, nomes, erro, aoMudar }: LinhaDoVinculoProps) {
  const semTratamento = escolha.tratamentoId === ''

  return (
    <li className="flex flex-col gap-3 border-b border-linha px-4 py-3 last:border-b-0 sm:flex-row sm:items-start sm:justify-between">
      <CampoCheckbox
        className="min-w-0"
        rotulo={pagamento.paciente.nome}
        ajuda={`Pago em ${dataLegivel(pagamento.pago_em)} · ${formatarBRL(pagamento.liquido)}`}
        marcado={escolha.marcado && !semTratamento}
        desabilitado={semTratamento}
        erro={erro}
        aoMudar={(marcado) => {
          aoMudar({ ...escolha, marcado })
        }}
      />
      <div className="min-w-0 sm:w-1/2">
        {pagamento.sugestao !== null ? (
          <SugestaoDaLinha sugestao={pagamento.sugestao} />
        ) : pagamento.tratamentos_da_crianca.length === 0 ? (
          <p className="text-meta text-texto-suave">Esta criança não tem tratamento cadastrado.</p>
        ) : (
          <EscolhaDoTratamento
            pagamento={pagamento}
            valor={escolha.tratamentoId}
            nomes={nomes}
            aoMudar={(tratamentoId) => {
              // escolher põe a linha no lote; voltar para "Escolha o tratamento" a tira
              aoMudar({ marcado: tratamentoId !== '', tratamentoId })
            }}
          />
        )}
      </div>
    </li>
  )
}

/** A sugestão do servidor, com os nomes que ele mandou; o nome que não veio sai, não vira código. */
function SugestaoDaLinha({ sugestao }: { sugestao: NonNullable<PagamentoSemTratamento['sugestao']> }) {
  const pacote = [sugestao.especialidade, sugestao.convenio].filter((parte) => parte !== '').join(' · ')

  return (
    <div className="flex flex-col gap-1">
      <p className="flex flex-wrap items-center gap-2 text-corpo text-texto">
        <Etiqueta tom="info" tamanho="sm">
          Sugerido
        </Etiqueta>
        <span>{pacote === '' ? 'Tratamento particular em andamento' : pacote}</span>
      </p>
      {sugestao.profissional === '' ? null : (
        <p className="text-meta text-texto-suave">{`Vai para: ${sugestao.profissional}`}</p>
      )}
    </div>
  )
}

interface EscolhaDoTratamentoProps {
  pagamento: PagamentoSemTratamento
  valor: string
  nomes: NomesDoTratamento
  aoMudar: (tratamentoId: string) => void
}

/**
 * Sem sugestão, quem confere escolhe entre os tratamentos da criança — o mesmo rótulo do formulário.
 * Os tratamentos vêm NA LINHA (CR-VPT-07): pedir `/tratamentos` por criança era uma consulta por
 * linha, e a lista vai a 500.
 */
function EscolhaDoTratamento({ pagamento, valor, nomes, aoMudar }: EscolhaDoTratamentoProps) {
  const lista = pagamento.tratamentos_da_crianca
  const escolhido = lista.find((tratamento) => String(tratamento.id) === valor)
  const vaiPara = nomes.profissionais.find((profissional) => profissional.id === escolhido?.profissional_id)?.nome

  return (
    <CampoSelect
      rotulo="Tratamento"
      // o nome acessível diz de QUAL criança: são vários "Tratamento" na mesma tela (2.5.3:
      // o rótulo visível abre o nome)
      aria-label={`Tratamento de ${pagamento.paciente.nome}`}
      value={valor}
      opcoes={[
        ESCOLHA_O_TRATAMENTO,
        ...lista.map((tratamento) => ({
          valor: String(tratamento.id),
          rotulo: rotuloDoTratamentoDoPagamento(tratamento, nomes, lista),
        })),
      ]}
      onChange={(evento) => {
        aoMudar(evento.target.value)
      }}
      ajuda={vaiPara === undefined ? 'Sem sugestão: escolha para vincular este pagamento.' : `Vai para: ${vaiPara}`}
    />
  )
}
