import { useMutation, useQuery, type UseQueryResult } from '@tanstack/react-query'
import { ExternalLink, MessageCircle, TriangleAlert } from 'lucide-react'
import { useId, useState } from 'react'
import { Link } from 'react-router-dom'

import { AvisoErro } from '@/componentes/ui/aviso-erro'
import { Botao } from '@/componentes/ui/botao'
import { Dialog } from '@/componentes/ui/dialog'
import { EstadoErro } from '@/componentes/ui/estado-erro'
import { Realce } from '@/componentes/ui/realce'
import { Skeleton } from '@/componentes/ui/skeleton'
import { usarPodeCobrar } from '@/hooks/usar-pode-cobrar'
import { chaves } from '@/lib/chaves-query'
import { cn } from '@/lib/cn'
import {
  ehCobravel,
  fraseDaUltimaCobranca,
  linkDoWhatsapp,
  telefoneLegivel,
  type LancamentoCobravel,
} from '@/lib/cobranca-pelo-whatsapp'
import { dataLegivel } from '@/lib/datas'
import { formatarBRL } from '@/lib/dinheiro'
import { distribuirErrosDoServidor } from '@/lib/erros'
import { ErroDeApi } from '@/lib/http'
import { buscarCobranca, registrarCobranca } from '@/servicos/cobranca-do-lancamento'
import type { CobrancaDoLancamento, LancamentoCaixaDetalhe, ResponsavelCobravel, UltimaCobranca } from '@/tipos'

/** O que a tela promete antes do clique — e o limite do que o sistema faz. */
export const EXPLICACAO_DA_COBRANCA =
  'A conversa abre no WhatsApp deste computador, com a mensagem da clínica já escrita. Revise e envie por lá: o sistema não envia nada sozinho.'

export interface DialogoDeCobrancaProps {
  lancamento: LancamentoCobravel
  aoFechar: () => void
  /** Avisado com a última cobrança que o SERVIDOR registrou, depois que a conversa foi aberta. */
  aoRegistrar?: (ultima: UltimaCobranca) => void
}

/**
 * "Cobrar pelo WhatsApp" (change `cobranca-pelo-whatsapp`).
 *
 * O servidor devolve os responsáveis com telefone e a mensagem da clínica já preenchida (D1); a
 * tela mostra A QUEM a conversa vai abrir, e o link de conversa é uma ÂNCORA de verdade
 * (`target="_blank"`, `rel="noopener noreferrer"`). Abrir a aba DEPOIS da consulta, por código,
 * esbarraria no bloqueador de janelas — o clique da pessoa na âncora é o gesto que o navegador
 * respeita. Ao abrir, a tela registra a cobrança: o sistema sabe que a conversa ABRIU, nunca
 * que a mensagem foi enviada.
 *
 * O telefone e a mensagem vivem só enquanto o diálogo existe: a consulta declara `gcTime: 0`, e
 * nada disso vai para log nem para o armazenamento do navegador.
 */
export function DialogoDeCobranca({ lancamento, aoFechar, aoRegistrar }: DialogoDeCobrancaProps) {
  const [abertaCom, setAbertaCom] = useState<string | null>(null)
  const [errosDoRegistro, setErrosDoRegistro] = useState<readonly string[]>([])

  const consulta = useQuery({
    queryKey: chaves.cobrancaDoLancamento(lancamento.id),
    queryFn: () => buscarCobranca(lancamento.id),
    gcTime: 0,
    staleTime: 0,
    retry: false,
  })

  const registro = useMutation({
    retry: 0,
    mutationFn: () => registrarCobranca(lancamento.id),
    onMutate: () => {
      setErrosDoRegistro([])
    },
    onSuccess: async () => {
      // "quem e quando" é o que o SERVIDOR gravou — relido dele, nunca inventado com o relógio daqui
      const { data } = await consulta.refetch()
      if (data?.ultima_cobranca !== undefined && data.ultima_cobranca !== null) {
        aoRegistrar?.(data.ultima_cobranca)
      }
    },
    onError: (erro) => {
      setErrosDoRegistro(distribuirErrosDoServidor(erro, new Set()).gerais)
    },
  })

  const crianca = lancamento.interessado.nome
  const descricao = [
    `Receita de ${formatarBRL(lancamento.liquido)}`,
    crianca,
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
      titulo="Cobrar pelo WhatsApp"
      descricao={descricao}
    >
      <div className="flex flex-col gap-4">
        <ConteudoDaCobranca
          consulta={consulta}
          criancaId={lancamento.interessado.id}
          crianca={crianca}
          aoFechar={aoFechar}
          aoAbrirConversa={(responsavel) => {
            setAbertaCom(responsavel.nome)
            registro.mutate()
          }}
        />
        <AvisoErro mensagens={errosDoRegistro} />
      </div>
      {/* SEMPRE montada e na árvore de acessibilidade (nada de `hidden` enquanto vazia): região
          viva que nasce junto com o texto não é anunciada. Fora da pilha com `gap` para, vazia,
          não abrir espaço */}
      <p role="status" className={cn('text-corpo text-sucesso-texto', abertaCom === null ? null : 'mt-4')}>
        {abertaCom === null
          ? ''
          : `Conversa com ${abertaCom} aberta numa nova aba. Revise a mensagem e envie pelo WhatsApp.`}
      </p>
    </Dialog>
  )
}

interface ConteudoDaCobrancaProps {
  consulta: UseQueryResult<CobrancaDoLancamento>
  criancaId: number
  /** `null` quando o nome não veio — a frase muda, nunca "a ficha de null" */
  crianca: string | null
  aoFechar: () => void
  aoAbrirConversa: (responsavel: ResponsavelCobravel) => void
}

/** Os quatro estados: carregando, recusa (ou falha com nova tentativa), sem telefone e a escolha. */
function ConteudoDaCobranca({ consulta, criancaId, crianca, aoFechar, aoAbrirConversa }: ConteudoDaCobrancaProps) {
  const idDaPergunta = useId()

  if (consulta.isError) {
    const erro = consulta.error
    // a recusa de DOMÍNIO (já paga, não é de criança) não melhora tentando de novo: diz a razão
    if (erro instanceof ErroDeApi && erro.motivo === 'invalido') {
      return <AvisoErro mensagens={distribuirErrosDoServidor(erro, new Set()).gerais} />
    }
    return (
      <EstadoErro
        mensagem={erro instanceof ErroDeApi ? erro.message : 'Não foi possível carregar os telefones.'}
        aoTentarNovamente={() => void consulta.refetch()}
      />
    )
  }

  if (consulta.isPending) {
    return (
      <div aria-busy="true" className="flex flex-col gap-3">
        <Skeleton className="h-5 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    )
  }

  const { responsaveis, ultima_cobranca: ultima } = consulta.data

  if (responsaveis.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3 rounded-superficie border border-dashed border-linha-forte p-4">
        <p className="text-corpo text-texto">
          {crianca === null || crianca === '' ? 'A ficha da criança' : `A ficha de ${crianca}`} não tem telefone de
          responsável. Cadastre o telefone na ficha e volte para cobrar.
        </p>
        <Botao asChild variante="secundario">
          <Link to={`/pacientes/${criancaId}`} onClick={aoFechar}>
            Abrir a ficha da criança
          </Link>
        </Botao>
      </div>
    )
  }

  const varios = responsaveis.length > 1

  return (
    <>
      {ultima === null ? null : (
        <Realce
          tom="atencao"
          rotulo="Família já lembrada"
          icone={<TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-alerta-texto" />}
          texto={`${fraseDaUltimaCobranca(ultima)}.`}
        />
      )}
      <p className="text-corpo text-texto-suave">{EXPLICACAO_DA_COBRANCA}</p>
      {varios ? (
        <p id={idDaPergunta} className="text-corpo font-medium text-texto">
          A quem enviar?
        </p>
      ) : null}
      <ul aria-labelledby={varios ? idDaPergunta : undefined} className="flex flex-col gap-2">
        {responsaveis.map((responsavel) => (
          <li
            key={`${responsavel.telefone}-${responsavel.nome}`}
            className="flex flex-wrap items-center justify-between gap-3 rounded-campo border border-linha bg-superficie px-3 py-2"
          >
            <div className="min-w-0 flex-1 basis-48">
              <p className="text-corpo font-medium text-texto">
                {responsavel.nome}
                {responsavel.parentesco === '' ? null : (
                  <span className="font-normal text-texto-suave"> ({responsavel.parentesco})</span>
                )}
              </p>
              <p className="text-meta tabular-nums text-texto-suave">{telefoneLegivel(responsavel.telefone)}</p>
            </div>
            <Botao asChild variante={varios ? 'secundario' : 'primario'} tamanho="sm">
              <a
                href={linkDoWhatsapp(responsavel.telefone, responsavel.mensagem)}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Abrir conversa com ${responsavel.nome} no WhatsApp (abre em nova aba)`}
                onClick={() => {
                  aoAbrirConversa(responsavel)
                }}
                // o clique do MEIO também abre a conversa (nova aba) e não dispara `click`: sem
                // isto a cobrança aberta assim não ficava registrada (CR-WEB-09)
                onAuxClick={(evento) => {
                  if (evento.button === 1) {
                    aoAbrirConversa(responsavel)
                  }
                }}
              >
                <MessageCircle aria-hidden="true" className="size-3.5" />
                Abrir conversa
                <ExternalLink aria-hidden="true" className="size-3.5" />
              </a>
            </Botao>
          </li>
        ))}
      </ul>
    </>
  )
}

export interface CobrancaNoDetalheProps {
  lancamento: LancamentoCaixaDetalhe
}

/**
 * A cobrança no DETALHE do lançamento: "Cobrança aberta em dd/mm por <nome>" (quem já lembrou a
 * família, para ninguém lembrar duas vezes no mesmo dia sem saber) e a ação, quando cabe. A linha
 * aparece para quem vê o detalhe; o botão, só na receita em aberto de criança e com as duas
 * permissões.
 */
export function CobrancaNoDetalhe({ lancamento }: CobrancaNoDetalheProps) {
  const podeCobrar = usarPodeCobrar()
  const [ultima, setUltima] = useState<UltimaCobranca | null>(lancamento.ultima_cobranca)
  const [cobrando, setCobrando] = useState(false)
  const cobravel = ehCobravel(lancamento) ? lancamento : null
  const ofereceCobrar = podeCobrar && cobravel !== null

  if (ultima === null && !ofereceCobrar) {
    return null
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-campo border border-linha bg-fundo px-3 py-2">
      <p className="flex items-center gap-2 text-corpo text-texto-suave">
        <MessageCircle aria-hidden="true" className="size-4 shrink-0" />
        {ultima === null ? 'Nenhuma cobrança pelo WhatsApp aberta ainda.' : `${fraseDaUltimaCobranca(ultima)}.`}
      </p>
      {ofereceCobrar ? (
        <Botao
          variante="secundario"
          tamanho="sm"
          onClick={() => {
            setCobrando(true)
          }}
        >
          <MessageCircle aria-hidden="true" className="size-3.5" />
          Cobrar pelo WhatsApp
        </Botao>
      ) : null}
      {cobrando && cobravel !== null ? (
        <DialogoDeCobranca
          lancamento={cobravel}
          aoFechar={() => {
            setCobrando(false)
          }}
          aoRegistrar={setUltima}
        />
      ) : null}
    </div>
  )
}
