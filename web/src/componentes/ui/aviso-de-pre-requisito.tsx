import { Link } from 'react-router-dom'

import type { CaminhoDoCadastro } from '@/lib/caminhos-dos-cadastros'

import { Botao } from '@/componentes/ui/botao'
import { usePodeResolver } from '@/lib/caminhos-dos-cadastros'

// SEMPRE sublinhado: dentro do texto, a cor sozinha não distingue o link (1,04:1 contra o texto-suave
// no tema Padrão) — WCAG 1.4.1, gate A11Y-AVI-01
const CLASSES_DO_LINK =
  'text-acento underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco'

interface AvisoDePreRequisitoProps {
  para: CaminhoDoCadastro
  /**
   * A frase que diz o que falta — porque "vazio" tem mais de uma cara: pode não haver categoria
   * NENHUMA, ou nenhuma da NATUREZA escolhida. As duas mandam ao mesmo cadastro, mas não são a
   * mesma frase.
   */
  oQueFalta: string
  /** Fecha o diálogo que contém o formulário, quando há um. */
  aoNavegar?: () => void
  /**
   * O caminho em texto, sem link (design D7): o aviso está num formulário longo que não guarda o que
   * foi digitado, e seguir o link apagaria tudo. Quem pode resolver lê ONDE; quem não pode, a quem pedir.
   */
  semLink?: boolean
}

/**
 * O próximo passo quando falta um cadastro ou uma configuração para a ação (design system).
 *
 * Nasceu no financeiro como `CatalogoVazio`: a clínica abriu o primeiro recebimento em 2026-09-02 e
 * encontrou um seletor mudo em "Selecione…" — o financeiro parecia quebrado. Em 2026-10-02 o usuário
 * achou o mesmo na transferência só com o Caixa, e a regra virou do sistema: o que falta, por quê e
 * o caminho. Quem PODE resolver recebe o link; quem não pode recebe a quem pedir — mandar alguém a uma
 * tela onde vai levar 403 é pior que não mandar.
 *
 * Sem `<p>` próprio: quem chama passa isto como `ajuda` do campo, e o `EnvelopeCampo` o embrulha com o
 * `id` que entra no `aria-describedby` do controle. Parágrafo irmão ao lado do campo é relação só
 * visual — quem usa leitor de tela nunca a ouve.
 */
export function AvisoDePreRequisito({ para, oQueFalta, aoNavegar, semLink = false }: AvisoDePreRequisitoProps) {
  const podeResolver = usePodeResolver(para)

  if (semLink) {
    return <>{`${oQueFalta} ${podeResolver ? para.instrucao : para.pedido}`}</>
  }

  return (
    <>
      {oQueFalta}{' '}
      {podeResolver ? (
        <Link to={para.rota} onClick={aoNavegar} className={CLASSES_DO_LINK}>
          {para.rotulo}
        </Link>
      ) : (
        para.pedido
      )}
    </>
  )
}

interface AcaoDoPreRequisitoProps {
  para: CaminhoDoCadastro
  aoNavegar?: () => void
  /**
   * Id da frase de a quem pedir (só existe sem a permissão): o diálogo a inclui na descrição acessível
   * junto do texto do vazio — o BOTÃO não entra, senão a descrição repete o nome da ação (A11Y-AVI-R2-02).
   */
  idDoPedido?: string
}

/**
 * A saída de um `EstadoVazio` ou de um `Realce` quando NADA pode ser feito sem o pré-requisito (D2):
 * o botão para o cadastro, ou — sem a permissão — a frase de a quem pedir, no lugar do botão.
 */
export function AcaoDoPreRequisito({ para, aoNavegar, idDoPedido }: AcaoDoPreRequisitoProps) {
  const podeResolver = usePodeResolver(para)

  if (!podeResolver) {
    return (
      <p id={idDoPedido} className="text-corpo text-texto-suave">
        {para.pedido}
      </p>
    )
  }

  return (
    <Botao asChild>
      <Link to={para.rota} onClick={aoNavegar}>
        {para.rotuloCurto}
      </Link>
    </Botao>
  )
}
