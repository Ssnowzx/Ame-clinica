import { useIsMutating, useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef } from 'react'

import type { CategoriaNoDre, ConfiguracaoDoDre, SubcategoriaNoDre } from '@/tipos'

import {
  idDoSeletor,
  linhasDaNatureza,
  opcaoSemEscolha,
  rotuloDaLinha,
} from '@/componentes/financeiro/dre/linha-do-dre'
import { usarRascunhoDaLinha } from '@/componentes/financeiro/dre/rascunhos-da-linha-do-dre'
import { Botao } from '@/componentes/ui/botao'
import { CampoSelect } from '@/componentes/ui/campo-select'
import { usarErrosDoServidor } from '@/hooks/usar-erros-do-servidor'
import { chaves } from '@/lib/chaves-query'
import { definirLinhaDaCategoria, definirLinhaDaSubcategoria } from '@/servicos/dre'

const CAMPOS = new Set(['linha_dre'])

export type AlvoDaLinha =
  | { tipo: 'categoria'; categoria: CategoriaNoDre }
  | { tipo: 'subcategoria'; categoria: CategoriaNoDre; subcategoria: SubcategoriaNoDre }

export interface SeletorDaLinhaDoDreProps {
  configuracao: ConfiguracaoDoDre
  alvo: AlvoDaLinha
  /** O rótulo do campo — o NOME do que se classifica ("Aluguel", "Pessoal › Vale-transporte"). */
  rotulo: string
  /**
   * Avisa ANTES de reconsultar — no sucesso E na recusa: o item pode mudar de lugar na tela (a
   * linha nova, ou a que outra pessoa gravou no 409), e o foco precisa ir junto.
   */
  aoTrocar?: (idDoCampo: string) => void
  /** Uma linha sob o campo — no cadastro, a linha EM VIGOR e de onde ela vem. */
  ajuda?: string
}

/**
 * Em que linha do DRE a categoria (ou a subcategoria) entra (change `dre-gerencial`). As opções são
 * só as da NATUREZA dela — a API recusaria a outra (422) —, e a primeira é "sem escolha": o padrão
 * da natureza, ou a linha da categoria-mãe.
 *
 * Escolher é RASCUNHO (A11Y-FIN-02, 3.2.2): gravar no `onChange` mudava o contexto sem pedido — o
 * item trocava de cartão levando o foco, e no Chrome/Windows cada seta no select fechado gravava de
 * novo, com auditoria e aviso. Com o rascunho diferente do gravado aparecem "Aplicar" e "Desfazer";
 * só "Aplicar" grava, com o `If-Match` da versão lida, um envio por vez. O rascunho é da página
 * quando ela o guarda (`ContextoDosRascunhos`): o item pode mudar de cartão e remontar.
 */
export function SeletorDaLinhaDoDre({ configuracao, alvo, rotulo, aoTrocar, ajuda }: SeletorDaLinhaDoDreProps) {
  const queryClient = useQueryClient()
  // sem o toast automático (A11Y-FIN-R2-04): a recusa do campo (422) já é dita pelo alerta dele e
  // pela descrição do select — o toast era a terceira vez. Só a que não tem campo onde pousar vai
  // ao toast, à mão, no `onError`
  const { erros, limparErros, aoFalhar, notificar } = usarErrosDoServidor(CAMPOS, { toast: false })
  const refSeletor = useRef<HTMLSelectElement>(null)
  const registro = alvo.tipo === 'categoria' ? alvo.categoria : alvo.subcategoria
  const id = idDoSeletor(alvo.tipo, registro.id)
  const semEscolha = opcaoSemEscolha(
    configuracao,
    alvo.tipo === 'categoria' ? { tipo: 'categoria', natureza: alvo.categoria.tipo } : { tipo: 'subcategoria', categoria: alvo.categoria },
  )

  const gravada = registro.linha_dre ?? ''
  // a base mudou por fora (a troca aplicada, o 409 reconsultado, a natureza trocada): o rascunho
  // volta ao gravado
  const [rascunho, setRascunho] = usarRascunhoDaLinha(id, gravada, alvo.categoria.tipo)
  // o envio no ar mora no cache de mutações, não no seletor (CR-WEB-R3-01): o rascunho sobrevive ao
  // item mudar de cartão, e o "enviando" tem de sobreviver junto — senão o seletor remontado
  // oferecia "Aplicar" de novo, com a mesma versão, e o 2º envio voltava num 409 falso
  const chaveDoEnvio = ['linha-dre', id]
  const enviando = useIsMutating({ mutationKey: chaveDoEnvio, exact: true }) > 0

  /** O botão que tinha o foco some junto com o rascunho: o foco fica no campo, nunca no `body`. */
  function focarOSeletor(): void {
    refSeletor.current?.focus()
  }

  const trocar = useMutation({
    mutationKey: chaveDoEnvio,
    retry: 0,
    mutationFn: (linha: string | null) =>
      alvo.tipo === 'categoria'
        ? definirLinhaDaCategoria(registro.id, linha, registro.updated_at)
        : definirLinhaDaSubcategoria(registro.id, linha, registro.updated_at),
    onMutate: limparErros,
    onSuccess: async (_definida, linha) => {
      focarOSeletor()
      aoTrocar?.(id)
      // `categorias` alcança a configuração do DRE E a lista do cadastro: a versão mudou nas duas
      await queryClient.invalidateQueries({ queryKey: chaves.categorias() })
      notificar({
        tom: 'sucesso',
        titulo:
          linha === null
            ? `${registro.nome} voltou a: ${semEscolha.rotulo}.`
            : `${registro.nome} agora entra em ${rotuloDaLinha(configuracao, linha)}.`,
      })
    },
    onError: async (falha) => {
      // a razão do campo (422) fica nele; a que não tem campo onde pousar — o conflito (409), o
      // acesso, a rede — vai ao toast: depois do 409 o campo pode desmontar (o item mudou de lugar)
      const { gerais, campos } = aoFalhar(falha)
      // o campo que recebia a razão DESMONTOU (o item mudou de cartão durante o envio, CR-WEB-R4-01):
      // a do campo também vai ao aviso, senão a escolha voltava atrás sem dizer por quê
      const semPouso = refSeletor.current === null ? campos.get('linha_dre') : undefined
      const razao = gerais[0] ?? semPouso
      if (razao !== undefined) {
        notificar({ tom: 'erro', titulo: razao })
      }
      // e o campo volta a dizer o que está gravado
      setRascunho(gravada)
      focarOSeletor()
      // outra pessoa mudou antes (409): a reconsulta pode levar o item a outro cartão
      aoTrocar?.(id)
      await queryClient.invalidateQueries({ queryKey: chaves.configuracaoDoDre() })
    },
  })

  function aplicar(): void {
    // um envio por vez: o segundo sairia com a versão já vencida e voltaria em conflito
    if (enviando) return
    trocar.mutate(rascunho === '' ? null : rascunho)
  }

  function desfazer(): void {
    focarOSeletor()
    setRascunho(gravada)
  }

  const opcoes = [
    semEscolha,
    ...linhasDaNatureza(configuracao, alvo.categoria.tipo).map((linha) => ({ valor: linha.codigo, rotulo: linha.rotulo })),
  ]
  const pendente = rascunho !== gravada

  return (
    <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
      <CampoSelect
        ref={refSeletor}
        id={id}
        rotulo={rotulo}
        complementoDoRotulo=": linha do DRE"
        // `grow` e não `flex-1`: com base zero o campo nunca cederia a linha aos botões — no
        // celular ele encolheria até sumir em vez de os botões descerem
        className="min-w-0 grow"
        value={rascunho}
        opcoes={opcoes}
        aria-busy={enviando || undefined}
        ajuda={ajuda}
        erro={erros.campos.get('linha_dre')}
        onChange={(evento) => {
          // um envio por vez também na escolha (CR-WEB-R2-03): a feita DURANTE o envio sumiria no
          // sucesso (o gravado muda e o rascunho volta a ele) — recusada agora, o select controlado
          // a desfaz à vista
          if (enviando) return
          // a recusa era do valor tentado: com outra escolha, ela não diz mais nada
          limparErros()
          setRascunho(evento.target.value)
        }}
      />
      {pendente ? (
        <div className="flex flex-col gap-1.5">
          {/* a altura de uma linha de rótulo, invisível: os botões alinham com o CAMPO, e não com
              a ajuda que o cadastro põe embaixo dele */}
          <span aria-hidden="true" className="invisible text-rotulo">
            &nbsp;
          </span>
          {/* o nome acessível COMEÇA pelo texto visível (2.5.3); o espaço fica fora do trecho
              oculto porque o cálculo do nome apara o texto de cada filho */}
          <div className="flex h-10 items-center gap-2">
            <Botao tamanho="sm" carregando={enviando} onClick={aplicar}>
              Aplicar <span className="sr-only">a linha de {rotulo}</span>
            </Botao>
            <Botao variante="fantasma" tamanho="sm" disabled={enviando} onClick={desfazer}>
              Desfazer <span className="sr-only">a escolha de {rotulo}</span>
            </Botao>
          </div>
        </div>
      ) : null}
    </div>
  )
}
