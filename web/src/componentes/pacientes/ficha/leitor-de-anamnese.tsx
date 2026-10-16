import { useQuery } from '@tanstack/react-query'
import { Info, Pencil, TriangleAlert } from 'lucide-react'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

import { FormularioAnamnese } from '@/componentes/pacientes/ficha/formulario-anamnese'
import { AvisoErro } from '@/componentes/ui/aviso-erro'
import { Botao } from '@/componentes/ui/botao'
import { Dialog } from '@/componentes/ui/dialog'
import { EstadoErro } from '@/componentes/ui/estado-erro'
import { EstadoVazio } from '@/componentes/ui/estado-vazio'
import { ListaDescricao, type ItemDescricao } from '@/componentes/ui/lista-descricao'
import { Skeleton } from '@/componentes/ui/skeleton'
import { usarMutacaoDeAnamnese } from '@/hooks/usar-mutacao-de-anamnese'
import { valorCruLegivel } from '@/lib/anamnese'
import { chaves } from '@/lib/chaves-query'
import { dataHoraLegivel, dataLegivel } from '@/lib/datas'
import { buscarAnamnese, listarModelosDeAnamnese } from '@/servicos/anamneses'
import { useAuthStore } from '@/stores/auth-store'
import type { AnamneseDaLista, AnamneseModelo, CampoDeModelo, RespostasAnamnese } from '@/tipos'

interface LeitorDeAnamneseProps {
  /** Metadados da linha (id · modelo · data) — a fonte do título e da leitura auditada. */
  anamnese: AnamneseDaLista
  aberto: boolean
  aoFechar: () => void
}

/** O valor de uma resposta CONHECIDA, formatado por tipo e ESCAPADO (JSX children). */
function valorPorTipo(campo: CampoDeModelo, valor: unknown): ReactNode {
  switch (campo.tipo) {
    case 'texto':
    case 'opcoes':
      return <span className="whitespace-pre-wrap break-words">{valorCruLegivel(valor)}</span>
    case 'data':
      return dataLegivel(typeof valor === 'string' ? valor : null)
    case 'booleano':
      return valor === true ? 'Sim' : 'Não'
    case 'numero':
      return valorCruLegivel(valor)
    default:
      return <span className="whitespace-pre-wrap break-words">{valorCruLegivel(valor)}</span>
  }
}

/** O rótulo de uma resposta ÓRFÃ — id cru + aviso; ícone E texto (1.4.1), nunca oculta. */
function RotuloOrfa({ id }: { id: string }) {
  return (
    <span className="flex flex-col gap-0.5">
      <span>{id}</span>
      <span className="flex items-center gap-1 text-alerta-texto">
        <TriangleAlert aria-hidden="true" className="size-3.5 shrink-0" />
        campo removido do modelo
      </span>
    </span>
  )
}

/**
 * Monta as linhas de leitura a partir do detalhe + modelo.
 *
 * Ordem do modelo primeiro (respostas conhecidas, por rótulo), depois as ÓRFÃS
 * (chave em `respostas_json` que o `campos_json` atual não conhece — renderizadas
 * sob id cru, NUNCA ocultadas; SEC-ANM-05). Sem modelo (degradação), todo rótulo
 * é o id cru.
 */
function montarLinhas(respostas: RespostasAnamnese, modelo: AnamneseModelo | undefined): ItemDescricao[] {
  const linhas: ItemDescricao[] = []

  if (modelo !== undefined) {
    const idsConhecidos = new Set<string>()
    for (const campo of modelo.campos_json) {
      idsConhecidos.add(campo.id)
      if (Object.prototype.hasOwnProperty.call(respostas, campo.id)) {
        linhas.push({
          chave: campo.id,
          rotulo: campo.rotulo,
          valor: valorPorTipo(campo, respostas[campo.id]),
          larguraTotal: campo.tipo === 'texto',
        })
      }
    }
    for (const [id, valor] of Object.entries(respostas)) {
      if (!idsConhecidos.has(id)) {
        linhas.push({
          chave: id,
          rotulo: <RotuloOrfa id={id} />,
          valor: <span className="whitespace-pre-wrap break-words">{valorCruLegivel(valor)}</span>,
          larguraTotal: true,
        })
      }
    }
    return linhas
  }

  // degradação: modelo indisponível — todo rótulo vira o id cru, respostas seguem visíveis
  for (const [id, valor] of Object.entries(respostas)) {
    linhas.push({
      chave: id,
      rotulo: id,
      valor: <span className="whitespace-pre-wrap break-words">{valorCruLegivel(valor)}</span>,
      larguraTotal: true,
    })
  }
  return linhas
}

/**
 * Leitura de UMA anamnese — sob demanda e AUDITADA (art. 11).
 *
 * O detalhe (`GET /anamneses/{id}`) é buscado SÓ quando o diálogo abre, por um ÚNICO
 * observer da chave `chaves.anamnese(id)` com `gcTime:0` + `staleTime:0` +
 * `retry:false` + `refetchOnReconnect:false`: a trilha `consultou` reflete leitura
 * HUMANA, não render, e não se re-dispara sozinha (SEC-ANM-01/02/03). Sem prefetch,
 * sem segundo `useQuery`, sem `setQueryData`.
 *
 * A edição reusa o MESMO diálogo e hidrata o formulário do detalhe já carregado (por
 * PROP) — nunca de um `useQuery` de detalhe. Pós-edição invalida a LISTA e fecha.
 */
export function LeitorDeAnamnese({ anamnese, aberto, aoFechar }: LeitorDeAnamneseProps) {
  const podeEditar = useAuthStore((estado) => estado.temPermissao('anamneses.editar'))
  const podeVerModelos = useAuthStore((estado) => estado.temPermissao('anamnese_modelos.ver'))
  const { erros, atualizar, salvando } = usarMutacaoDeAnamnese(anamnese.paciente_id)
  const [editando, setEditando] = useState(false)
  const formId = useId()
  const refEditar = useRef<HTMLButtonElement>(null)
  const editouAntes = useRef(false)

  // sai do modo edição quando o diálogo fecha — reabrir começa na leitura
  useEffect(() => {
    if (!aberto) {
      setEditando(false)
    }
  }, [aberto])

  // Ordem de foco (WCAG 2.4.3): a troca leitura↔edição no MESMO diálogo desmonta o botão
  // focado. Ao ENTRAR em edição, o foco vai ao 1º controle do formulário (também anuncia a
  // troca de modo); ao VOLTAR (cancelar), volta ao "Editar" — nunca fica órfão no <body>.
  useEffect(() => {
    if (editando) {
      editouAntes.current = true
      document
        .getElementById(formId)
        ?.querySelector<HTMLElement>('input, textarea, select')
        ?.focus()
    } else if (editouAntes.current) {
      editouAntes.current = false
      refEditar.current?.focus()
    }
  }, [editando, formId])

  const detalhe = useQuery({
    queryKey: chaves.anamnese(anamnese.id),
    queryFn: () => buscarAnamnese(anamnese.id),
    enabled: aberto,
    // higiene de cache E integridade da auditoria: sem isto, reabrir renderizaria as
    // respostas sem novo `show` — releitura NÃO auditada (SEC-ANM-01/02/03)
    gcTime: 0,
    staleTime: 0,
    retry: false,
    refetchOnReconnect: false,
  })

  // os modelos mapeiam id→rótulo; a leitura por rótulo acopla a `anamnese_modelos.ver`
  const modelos = useQuery({
    queryKey: chaves.modelosDeAnamnese(),
    queryFn: listarModelosDeAnamnese,
    enabled: aberto && podeVerModelos,
  })

  const modelo =
    detalhe.data !== undefined
      ? modelos.data?.find((item) => item.id === detalhe.data.modelo_id)
      : undefined
  // degradação: sem permissão de modelo, ou o catálogo falhou → id cru
  const degradado = !podeVerModelos || modelos.isError
  // só esperamos os modelos DEPOIS que o detalhe chegou (mapeiam id→rótulo); um erro
  // do detalhe não pode ficar escondido atrás do skeleton dos modelos
  const esperandoModelos =
    detalhe.isSuccess && podeVerModelos && !modelos.isError && modelos.isPending

  const tituloDoModelo = anamnese.modelo?.titulo ?? 'Anamnese'
  const avisosGerais = [...erros.gerais, erros.campos.get('respostas_json')].filter(
    (mensagem): mensagem is string => mensagem !== undefined,
  )

  function salvarEdicao(respostas: RespostasAnamnese) {
    atualizar.mutate(
      { id: anamnese.id, respostas, versao: anamnese.updated_at },
      {
        onSuccess: () => {
          setEditando(false)
          aoFechar()
        },
      },
    )
  }

  const rodape =
    editando && modelo !== undefined ? (
      <div className="flex justify-end gap-3">
        <Botao variante="secundario" onClick={() => setEditando(false)}>
          Cancelar
        </Botao>
        <Botao type="submit" form={formId} variante="primario" carregando={salvando}>
          Salvar alterações
        </Botao>
      </div>
    ) : (
      <div className="flex justify-end gap-3">
        {podeEditar && modelo !== undefined ? (
          <Botao ref={refEditar} variante="secundario" onClick={() => setEditando(true)}>
            <Pencil aria-hidden="true" className="size-4" />
            Editar
          </Botao>
        ) : null}
        <Botao variante="fantasma" onClick={aoFechar}>
          Fechar
        </Botao>
      </div>
    )

  return (
    <Dialog
      aberto={aberto}
      aoMudarAberto={(proximo) => {
        if (!proximo) {
          aoFechar()
        }
      }}
      titulo={tituloDoModelo}
      descricao={`Preenchida em ${dataHoraLegivel(anamnese.preenchida_em)}`}
      rodape={rodape}
    >
      {detalhe.isPending || esperandoModelos ? (
        <div aria-busy="true" className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {[0, 1, 2, 3, 4].map((indice) => (
            <div key={indice}>
              <Skeleton className="h-3 w-24" />
              <Skeleton className="mt-2 h-4 w-40" />
            </div>
          ))}
        </div>
      ) : detalhe.isError ? (
        <EstadoErro
          mensagem="Não foi possível abrir esta anamnese."
          aoTentarNovamente={() => void detalhe.refetch()}
        />
      ) : editando && modelo !== undefined ? (
        <div className="flex flex-col gap-4">
          <AvisoErro mensagens={avisosGerais} />
          <FormularioAnamnese
            modelo={modelo}
            formId={formId}
            valoresIniciais={detalhe.data.respostas_json}
            erros={erros}
            aoSalvar={salvarEdicao}
          />
        </div>
      ) : (
        <LeituraDasRespostas
          respostas={detalhe.data.respostas_json}
          modelo={degradado ? undefined : modelo}
          degradado={degradado}
        />
      )}
    </Dialog>
  )
}

/** O corpo de leitura — respostas por rótulo no primitivo `ListaDescricao`, órfã inclusa. */
function LeituraDasRespostas({
  respostas,
  modelo,
  degradado,
}: {
  respostas: RespostasAnamnese
  modelo: AnamneseModelo | undefined
  degradado: boolean
}) {
  const itens = montarLinhas(respostas, modelo)

  if (itens.length === 0) {
    return <EstadoVazio titulo="Nenhuma resposta registrada" descricao="Esta anamnese não tem respostas preenchidas." />
  }

  return (
    <div className="flex flex-col gap-4">
      {degradado ? (
        <p className="flex items-center gap-1.5 text-meta text-texto-suave">
          <Info aria-hidden="true" className="size-3.5 shrink-0" />
          Modelos indisponíveis — exibindo identificadores dos campos.
        </p>
      ) : null}
      <ListaDescricao itens={itens} />
    </div>
  )
}
