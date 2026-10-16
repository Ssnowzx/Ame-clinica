import { useMutation, useQuery, useQueryClient, type Query } from '@tanstack/react-query'
import { CircleAlert, Download, FileText, Paperclip, Trash2 } from 'lucide-react'
import { useId, useRef, useState } from 'react'

import { AvisoErro } from '@/componentes/ui/aviso-erro'
import { Botao } from '@/componentes/ui/botao'
import { Dialog } from '@/componentes/ui/dialog'
import { DialogConfirmacao } from '@/componentes/ui/dialog-confirmacao'
import { EstadoErro } from '@/componentes/ui/estado-erro'
import { Etiqueta } from '@/componentes/ui/etiqueta'
import { Skeleton } from '@/componentes/ui/skeleton'
import { baixarBlob } from '@/lib/baixar-blob'
import { chaves } from '@/lib/chaves-query'
import { dataHoraLegivel, dataLegivel } from '@/lib/datas'
import { formatarBRL } from '@/lib/dinheiro'
import { distribuirErrosDoServidor } from '@/lib/erros'
import {
  baixarAnexoDoLancamento,
  enviarAnexoDoLancamento,
  excluirAnexoDoLancamento,
  listarAnexosDoLancamento,
} from '@/servicos/anexos-do-lancamento'
import { useAuthStore } from '@/stores/auth-store'
import type { AnexoDoLancamento, LancamentoCaixa } from '@/tipos'

/** O teto do servidor (`LancamentoAnexoController::TETO_BYTES`), dito ANTES de o arquivo subir. */
const TETO_EM_MB = 10

/** O que o seletor de arquivo oferece — o servidor decide pelo CONTEÚDO, nunca por esta lista. */
const TIPOS_OFERECIDOS = '.pdf,.jpg,.jpeg,.png,.webp,.xml,application/pdf,image/jpeg,image/png,image/webp,text/xml,application/xml'

export const AJUDA_DO_ANEXO = `PDF, imagem (JPEG, PNG ou WEBP) ou o XML da nota fiscal, até ${TETO_EM_MB} MB. O arquivo fica guardado assim que é enviado.`

export const RECUSA_DO_TAMANHO = `O arquivo excede o tamanho máximo de ${TETO_EM_MB} MB.`

/** Bytes → "1,2 MB" / "340 KB" — só exibição (o número real vive no servidor). */
function tamanhoLegivel(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

/**
 * A LISTA de lançamentos, e só ela (o selo "Com anexo"). O detalhe `['lancamentos', id]` fica de
 * FORA de propósito: ele alimenta o formulário de edição aberto em volta desta seção, e refazê-lo
 * trocaria a versão (`updated_at`) que o "Salvar" manda no `If-Match` — uma edição de outra pessoa
 * no meio seria sobrescrita em silêncio. A lista tem um OBJETO de filtro no segundo segmento; o
 * detalhe, um número; o lote de vínculos, uma palavra.
 */
function ehListaDeLancamentos(consulta: Query): boolean {
  const segundo = consulta.queryKey[1]

  return typeof segundo === 'object' && segundo !== null
}

export interface SecaoAnexosDoLancamentoProps {
  lancamentoId: number
  /** Sem título quando o diálogo em volta já se chama "Anexos do lançamento". */
  comTitulo?: boolean
}

/**
 * Os arquivos do lançamento (change `anexo-no-lancamento`): o comprovante do PIX, a nota do
 * fornecedor, o recibo assinado. Ver e baixar com `lancamentos.ver`; anexar e excluir com
 * `lancamentos.editar` — sem ela as duas ações nem aparecem. Vale no lançamento pago e no de
 * período fechado: o anexo não é dinheiro e não entra em total (D3).
 *
 * A lista traz só METADADOS; o conteúdo desce pelo download autenticado, que o servidor registra.
 * Nada aqui usa toast: a seção mora dentro de um diálogo, e o toast roubaria o Esc dele
 * (gatilho TOAST-ROUBA-O-ESC) — a confirmação é a lista que muda e o anúncio da região viva.
 */
export function SecaoAnexosDoLancamento({ lancamentoId, comTitulo = true }: SecaoAnexosDoLancamentoProps) {
  const podeEditar = useAuthStore((estado) => estado.temPermissao('lancamentos.editar'))
  const queryClient = useQueryClient()
  const id = useId()
  const idTitulo = `${id}-titulo`
  const idAjuda = `${id}-ajuda`
  const idErro = `${id}-erro`
  const refArquivo = useRef<HTMLInputElement>(null)
  const refAnexar = useRef<HTMLButtonElement>(null)
  const refGatilhoDaExclusao = useRef<HTMLElement | null>(null)
  const [erroDoArquivo, setErroDoArquivo] = useState<string | undefined>(undefined)
  const [errosGerais, setErrosGerais] = useState<readonly string[]>([])
  const [errosDaExclusao, setErrosDaExclusao] = useState<readonly string[]>([])
  const [aExcluir, setAExcluir] = useState<AnexoDoLancamento | null>(null)
  const [anuncio, setAnuncio] = useState('')

  const lista = useQuery({
    queryKey: chaves.anexosDoLancamento(lancamentoId),
    queryFn: () => listarAnexosDoLancamento(lancamentoId),
  })

  async function recarregar(): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: chaves.anexosDoLancamento(lancamentoId) })
    await queryClient.invalidateQueries({ queryKey: ['lancamentos'], predicate: ehListaDeLancamentos })
  }

  function limparAvisos(): void {
    setErroDoArquivo(undefined)
    setErrosGerais([])
    setAnuncio('')
  }

  const envio = useMutation({
    retry: 0,
    mutationFn: (arquivo: File) => enviarAnexoDoLancamento(lancamentoId, arquivo),
    onMutate: limparAvisos,
    onSuccess: async (anexo) => {
      setAnuncio(`"${anexo.nome}" anexado.`)
      await recarregar()
    },
    onError: (erro) => {
      // a recusa do tipo e do tamanho chega em `arquivo` e pousa SOB o botão, ligada a ele
      const distribuidos = distribuirErrosDoServidor(erro, new Set(['arquivo']))
      setErroDoArquivo(distribuidos.campos.get('arquivo'))
      setErrosGerais(distribuidos.gerais)
    },
  })

  const exclusao = useMutation({
    retry: 0,
    mutationFn: (anexo: AnexoDoLancamento) => excluirAnexoDoLancamento(anexo.id),
    onMutate: () => {
      setErrosDaExclusao([])
    },
    onSuccess: async (_resposta, anexo) => {
      setAExcluir(null)
      setAnuncio(`"${anexo.nome}" excluído.`)
      await recarregar()
    },
    // a recusa fica DENTRO do diálogo de confirmação, que continua aberto (CR-CA-05). E a lista se
    // refaz: o anexo que outra pessoa já excluiu (404) não pode continuar oferecido (CR-WEB-07)
    onError: async (erro) => {
      setErrosDaExclusao(distribuirErrosDoServidor(erro, new Set()).gerais)
      await queryClient.invalidateQueries({ queryKey: chaves.anexosDoLancamento(lancamentoId) })
    },
  })

  function escolherArquivo(arquivo: File): void {
    // o teto dito antes da viagem: subir 40 MB para ouvir "máximo de 10" é espera à toa. Quem
    // recusa de verdade continua sendo o servidor (tipo pelo conteúdo, tamanho, contagem)
    if (arquivo.size > TETO_EM_MB * 1024 * 1024) {
      limparAvisos()
      setErroDoArquivo(RECUSA_DO_TAMANHO)
      return
    }
    envio.mutate(arquivo)
  }

  async function baixar(anexo: AnexoDoLancamento): Promise<void> {
    limparAvisos()
    try {
      baixarBlob(await baixarAnexoDoLancamento(anexo.id), anexo.nome)
    } catch {
      // arquivo que falha em silêncio não existe; e se ele foi excluído por outra pessoa, a
      // lista recarregada é o que explica
      setErrosGerais([`Não foi possível baixar "${anexo.nome}". Atualize a lista e tente de novo.`])
      await queryClient.invalidateQueries({ queryKey: chaves.anexosDoLancamento(lancamentoId) })
    }
  }

  const anexos = lista.data ?? []
  const descricaoDoAnexar = erroDoArquivo === undefined ? idAjuda : `${idAjuda} ${idErro}`

  return (
    <section aria-labelledby={comTitulo ? idTitulo : undefined} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        {comTitulo ? (
          <div className="min-w-0">
            <h3 id={idTitulo} className="text-subtitulo font-semibold text-texto">
              Anexos
            </h3>
            <p className="text-meta text-texto-suave">Comprovante, nota fiscal ou recibo deste lançamento.</p>
          </div>
        ) : (
          <p className="text-corpo text-texto-suave">Comprovante, nota fiscal ou recibo deste lançamento.</p>
        )}
        {podeEditar ? (
          <>
            {/* `hidden`, sem nome nem descrição: com `sr-only` o leitor de tela ouvia um SEGUNDO
                "Anexar arquivo" (A11Y-FIN-04). O controle é o botão; o `.click()` dele continua
                abrindo o seletor do sistema */}
            <input
              ref={refArquivo}
              type="file"
              accept={TIPOS_OFERECIDOS}
              hidden
              onChange={(evento) => {
                const arquivo = evento.target.files?.[0]
                if (arquivo !== undefined) {
                  escolherArquivo(arquivo)
                }
                evento.target.value = ''
              }}
            />
            <Botao
              ref={refAnexar}
              variante="secundario"
              tamanho="sm"
              carregando={envio.isPending}
              aria-describedby={descricaoDoAnexar}
              onClick={() => refArquivo.current?.click()}
            >
              <Paperclip aria-hidden="true" className="size-3.5" />
              Anexar arquivo
            </Botao>
          </>
        ) : null}
      </div>

      {podeEditar ? (
        <p id={idAjuda} className="text-meta text-texto-suave">
          {AJUDA_DO_ANEXO}
        </p>
      ) : null}
      {erroDoArquivo !== undefined ? (
        <p id={idErro} role="alert" className="flex items-center gap-1 text-meta text-perigo-texto">
          <CircleAlert aria-hidden="true" className="size-3.5 shrink-0" />
          {erroDoArquivo}
        </p>
      ) : null}
      <AvisoErro mensagens={errosGerais} />
      {/* SEMPRE montada: região viva que nasce junto com o texto não é anunciada */}
      <p role="status" className="sr-only">
        {anuncio}
      </p>

      <ListaDeAnexos
        carregando={lista.isPending}
        erro={lista.isError}
        aoTentarNovamente={() => void lista.refetch()}
        anexos={anexos}
        podeEditar={podeEditar}
        aoBaixar={(anexo) => void baixar(anexo)}
        aoExcluir={(anexo, gatilho) => {
          // a recusa de OUTRA ação não contamina o diálogo que abre agora
          setErrosDaExclusao([])
          refGatilhoDaExclusao.current = gatilho
          setAExcluir(anexo)
        }}
      />

      <DialogConfirmacao
        aberto={aExcluir !== null}
        aoMudarAberto={(aberto) => {
          if (!aberto) {
            setAExcluir(null)
          }
        }}
        titulo={aExcluir !== null ? `Excluir o anexo "${aExcluir.nome}"?` : ''}
        consequencia="O arquivo some deste lançamento na hora. Ele continua guardado pelo prazo de retenção, e a exclusão fica registrada na auditoria."
        rotuloConfirmar="Excluir anexo"
        tom="perigo"
        erros={errosDaExclusao}
        carregando={exclusao.isPending}
        // cancelou: o foco volta ao Excluir do item (o padrão). Excluiu: o botão sumiu com o item,
        // e o foco vai para "Anexar arquivo", que fica — nunca para o `body`
        focoAoFechar={() => (refGatilhoDaExclusao.current?.isConnected === true ? null : refAnexar.current)}
        aoConfirmar={async () => {
          if (aExcluir !== null) {
            await exclusao.mutateAsync(aExcluir)
          }
        }}
      />
    </section>
  )
}

interface ListaDeAnexosProps {
  carregando: boolean
  erro: boolean
  aoTentarNovamente: () => void
  anexos: readonly AnexoDoLancamento[]
  podeEditar: boolean
  aoBaixar: (anexo: AnexoDoLancamento) => void
  aoExcluir: (anexo: AnexoDoLancamento, gatilho: HTMLElement) => void
}

/** Os quatro estados da lista, na caixa compacta que cabe dentro do diálogo. */
function ListaDeAnexos({ carregando, erro, aoTentarNovamente, anexos, podeEditar, aoBaixar, aoExcluir }: ListaDeAnexosProps) {
  if (erro) {
    return <EstadoErro mensagem="Não foi possível carregar os anexos." aoTentarNovamente={aoTentarNovamente} />
  }

  if (carregando) {
    return (
      <div aria-busy="true" className="flex flex-col gap-2">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    )
  }

  if (anexos.length === 0) {
    return (
      <p className="rounded-campo border border-dashed border-linha-forte px-3 py-3 text-corpo text-texto-suave">
        {podeEditar
          ? 'Nenhum arquivo anexado. Use "Anexar arquivo" para guardar o comprovante, a nota ou o recibo.'
          : 'Nenhum arquivo anexado.'}
      </p>
    )
  }

  return (
    <ul className="flex flex-col gap-2">
      {anexos.map((anexo) => (
        <li
          key={anexo.id}
          className="flex flex-wrap items-center justify-between gap-2 rounded-campo border border-linha bg-superficie px-3 py-2"
        >
          <div className="flex min-w-0 flex-1 basis-48 items-start gap-2">
            <FileText aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-texto-suave" />
            <div className="min-w-0">
              <p className="break-all text-corpo font-medium text-texto">{anexo.nome}</p>
              <p className="text-meta text-texto-suave">
                {tamanhoLegivel(anexo.tamanho)} · {dataHoraLegivel(anexo.criado_em)}
                {anexo.criado_por === null ? null : ` · ${anexo.criado_por.nome}`}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 gap-1">
            <Botao variante="fantasma" tamanho="sm" aria-label={`Baixar ${anexo.nome}`} onClick={() => aoBaixar(anexo)}>
              <Download aria-hidden="true" className="size-3.5" />
              Baixar
            </Botao>
            {podeEditar ? (
              <Botao variante="fantasma" tamanho="sm" aria-label={`Excluir ${anexo.nome}`}
                onClick={(evento) => {
                  aoExcluir(anexo, evento.currentTarget)
                }}
              >
                <Trash2 aria-hidden="true" className="size-3.5" />
                Excluir
              </Botao>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  )
}

export interface SeloComAnexoProps {
  aoAbrir: (gatilho: HTMLButtonElement) => void
}

/**
 * O selo "Com anexo" da linha da lista. É um BOTÃO: abre os arquivos sem passar pela edição — é
 * o único caminho de quem vê lançamentos e não os edita até o comprovante que a regra lhe dá.
 */
export function SeloComAnexo({ aoAbrir }: SeloComAnexoProps) {
  return (
    <button
      type="button"
      aria-label="Com anexo: ver os arquivos"
      className="rounded-pilula focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco"
      onClick={(evento) => {
        aoAbrir(evento.currentTarget)
      }}
    >
      <Etiqueta tom="info" icone={Paperclip}>
        Com anexo
      </Etiqueta>
    </button>
  )
}

export interface DialogoAnexosDoLancamentoProps {
  lancamento: Pick<LancamentoCaixa, 'id' | 'tipo' | 'liquido' | 'vencimento' | 'interessado'>
  aoFechar: () => void
  /** Para onde o foco volta quando o selo que abriu o diálogo sumiu (o último anexo foi excluído). */
  focoAoFechar?: () => HTMLElement | null
}

/** Os anexos a partir da LISTA: o mesmo conteúdo da seção do detalhe, num diálogo de leitura. */
export function DialogoAnexosDoLancamento({ lancamento, aoFechar, focoAoFechar }: DialogoAnexosDoLancamentoProps) {
  const quem = lancamento.interessado?.nome ?? null
  const descricao = [
    `${lancamento.tipo === 'receita' ? 'Receita' : 'Despesa'} de ${formatarBRL(lancamento.liquido)}`,
    quem,
    `vence ${dataLegivel(lancamento.vencimento)}`,
  ]
    .filter((parte): parte is string => parte !== null && parte !== '')
    .join(' · ')

  return (
    <Dialog
      aberto
      aoMudarAberto={(aberto) => {
        if (!aberto) aoFechar()
      }}
      titulo="Anexos do lançamento"
      descricao={descricao}
      focoAoFechar={focoAoFechar}
    >
      <SecaoAnexosDoLancamento lancamentoId={lancamento.id} comTitulo={false} />
    </Dialog>
  )
}
