import { useState } from 'react'

import type {
  Definir,
  DetalheDeInteressado,
  LinhaDeInteressado,
  ModuloDeInteressado,
} from '@/componentes/financeiro/modulo-de-interessado'

import { AvisoConflito } from '@/componentes/aviso-conflito'
import { JanelaDeFormulario } from '@/componentes/financeiro/janela-de-formulario'
import { AvisoErro } from '@/componentes/ui/aviso-erro'
import { usarMutacaoDeInteressado } from '@/hooks/usar-mutacao-de-interessado'

export interface DialogoDeInteressadoProps<
  L extends LinhaDeInteressado,
  D extends DetalheDeInteressado,
  P,
  V extends { ativo: boolean },
> {
  modulo: ModuloDeInteressado<L, D, P, V>
  /** O DETALHE lido agora do servidor (edição), ou `null` (cadastro novo). Nunca a linha da lista. */
  registro: D | null
  /** O formulário curto do cadastro rápido pelo lançamento (design D5). */
  curto?: boolean
  /** O nome que a pessoa já digitou na busca — ela não precisa digitar de novo. */
  nomeSugerido?: string
  aoFechar: () => void
  /** O que o servidor gravou. O cadastro rápido o devolve ESCOLHIDO ao lançamento. */
  aoSalvar?: (salvo: D) => void
  focoAoFechar: () => HTMLElement | null
  /** Aberta por cima de outra janela (o lançamento). */
  empilhada?: boolean
}

/**
 * O formulário de fornecedor ou funcionário numa janela — o MESMO na tela do módulo e no cadastro
 * rápido do lançamento (design D5). Muda só a versão (cheia × curta) e o que acontece depois de
 * salvar; a validação, o corpo e o lugar onde a recusa pousa são um só.
 *
 * A edição recebe o DETALHE lido na hora (com o `updated_at` da concorrência otimista). O conflito
 * (409) não recarrega sozinho: quem decide jogar fora o que digitou é a pessoa, pelo "Recarregar".
 */
export function DialogoDeInteressado<
  L extends LinhaDeInteressado,
  D extends DetalheDeInteressado,
  P,
  V extends { ativo: boolean },
>({
  modulo,
  registro,
  curto = false,
  nomeSugerido,
  aoFechar,
  aoSalvar,
  focoAoFechar,
  empilhada = false,
}: DialogoDeInteressadoProps<L, D, P, V>) {
  const [emEdicao, setEmEdicao] = useState<D | null>(registro)
  const [valores, setValores] = useState<V>(() => modulo.valoresIniciais(registro ?? undefined, nomeSugerido))
  const [recarregando, setRecarregando] = useState(false)
  const { erros, limparErros, notificar, criar, atualizar, salvando } = usarMutacaoDeInteressado(modulo)

  const definir: Definir<V> = (parciais) => {
    setValores((anteriores) => ({
      ...anteriores,
      ...(typeof parciais === 'function' ? parciais(anteriores) : parciais),
    }))
  }

  function salvar(): void {
    const payload = modulo.paraPayload(valores, curto)
    const concluir = {
      onSuccess: (salvo: D) => {
        aoSalvar?.(salvo)
        aoFechar()
      },
    }

    if (emEdicao === null) {
      criar.mutate(payload, concluir)
      return
    }
    atualizar.mutate({ id: emEdicao.id, payload, versao: emEdicao.updated_at }, concluir)
  }

  /** A saída do conflito: relê o cadastro e re-hidrata o formulário com a versão de agora. */
  async function recarregar(): Promise<void> {
    if (emEdicao === null) return
    setRecarregando(true)
    try {
      const fresco = await modulo.servico.buscar(emEdicao.id)
      limparErros()
      setEmEdicao(fresco)
      setValores(modulo.valoresIniciais(fresco))
    } catch {
      notificar({ tom: 'erro', titulo: 'Não foi possível recarregar o cadastro. Tente de novo em instantes.' })
    } finally {
      setRecarregando(false)
    }
  }

  const { Campos } = modulo
  const conflito = erros.motivo === 'conflito' && emEdicao !== null

  return (
    <JanelaDeFormulario
      titulo={emEdicao === null ? `Cadastrar ${modulo.rotuloSingular}` : `Editar ${modulo.nomeDoDetalhe(emEdicao)}`}
      descricao={modulo.explicacao}
      aoFechar={aoFechar}
      aoSubmeter={salvar}
      salvando={salvando}
      rotuloSalvar={emEdicao === null ? 'Cadastrar' : 'Salvar'}
      focoAoFechar={focoAoFechar}
      empilhada={empilhada}
    >
      <AvisoErro mensagens={conflito ? [] : erros.gerais} />
      <AvisoConflito
        visivel={conflito}
        aoRecarregar={() => {
          void recarregar()
        }}
        recarregando={recarregando}
      />
      <Campos valores={valores} definir={definir} erros={erros} curto={curto} />
    </JanelaDeFormulario>
  )
}
