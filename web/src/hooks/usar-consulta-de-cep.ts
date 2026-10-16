import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

import type { EnderecoDoCep } from '@/servicos/cep'

import { cepCompleto, digitosDoCep } from '@/lib/cep'
import { consultarCep } from '@/servicos/cep'

/**
 * A consulta de CEP do formulário (capability `consulta-de-cep`), numa peça só, consumida
 * pelas DUAS bordas do cadastro — a recepção e o link público.
 *
 * A peça é uma só pela mesma razão que `FormaDoCampo` é uma só no servidor: a segunda cópia não
 * diverge com erro, diverge com a família tendo uma experiência diferente da recepção, meses
 * depois, sem ninguém ligar uma coisa à outra.
 *
 * **Não existe efeito de montagem, e isso é a guarda central.** A consulta é IMPERATIVA: só
 * acontece quando `aoDigitarCep` é chamado, isto é, quando uma pessoa mexe no campo. Um
 * `useEffect` observando o valor pareceria idêntico e teria um comportamento inaceitável —
 * abrir a ficha de uma criança para ver um telefone dispararia consulta com o CEP gravado, e o
 * endereço que a família corrigiu à mão viraria o que o serviço responde hoje.
 */

export type EstadoDaConsultaDeCep =
  | 'ocioso'
  | 'consultando'
  | 'preenchido'
  | 'nao_encontrado'
  | 'indisponivel'

/**
 * Os `id` dos campos que a consulta escreve — as duas bordas os aplicam.
 *
 * Existem para que o hook saiba QUAL campo está com o foco no instante da resposta, e não
 * sobrescreva o que a pessoa está digitando (achado A11Y-CEP-10). O `useId()` do design system
 * gera identificador opaco e diferente a cada montagem; comparar com ele seria impossível.
 */
export const ID_DO_CAMPO: Record<keyof EnderecoDoCep, string> = {
  logradouro: 'endereco-logradouro',
  bairro: 'endereco-bairro',
  cidade: 'endereco-cidade',
  uf: 'endereco-uf',
}

/** Os campos do catálogo que o CEP responde — e a chave de cada um no endereço. */
const CAMPOS_DO_CEP = [
  ['endereco_logradouro', 'logradouro'],
  ['endereco_bairro', 'bairro'],
  ['endereco_cidade', 'cidade'],
  ['endereco_uf', 'uf'],
] as const satisfies ReadonlyArray<readonly [string, keyof EnderecoDoCep]>

export interface OpcoesDaConsultaDeCep {
  /**
   * Escreve no formulário o que a consulta trouxe. Recebe SÓ os campos visíveis na régua, e
   * nunca `numero` nem `complemento` — a capability proíbe, e o tipo não os oferece.
   */
  aoPreencher: (endereco: Partial<EnderecoDoCep>) => void
  /** A régua da clínica. Sem ela, todos os campos são considerados visíveis. */
  campoVisivel?: (campo: string) => boolean
  /** O Número é o único campo que o CEP não responde — o foco vai para ele. */
  refDoNumero?: RefObject<HTMLInputElement | null>
  atrasoMs?: number
}

export interface ConsultaDeCep {
  estado: EstadoDaConsultaDeCep
  /** Para o `onChange` do campo de CEP. É o ÚNICO gatilho da consulta. */
  aoDigitarCep: (valor: string) => void
  /** A frase do `role="status"` — vazia quando não há nada a anunciar. */
  mensagem: string
  /**
   * A ajuda PERSISTENTE do campo de CEP.
   *
   * Ela não é enfeite: é o que torna o movimento de foco conforme ao WCAG 3.2.2 (achado
   * bloqueante A11Y-CEP-01). Mudança de contexto automática só é permitida quando a pessoa
   * **foi avisada antes de usar o componente** — e "o cursor vai para o Número" é o aviso.
   * Ela vem do hook, e não de cada borda, para as duas prometerem exatamente o mesmo.
   */
  ajuda: string
}

const MENSAGENS: Record<EstadoDaConsultaDeCep, string> = {
  ocioso: '',
  consultando: 'Buscando o endereço…',
  preenchido: 'Endereço preenchido pelo CEP. Confira os campos.',
  nao_encontrado: 'CEP não encontrado. Confira o número ou preencha o endereço à mão.',
  indisponivel: 'Não foi possível buscar o endereço agora. Preencha à mão; o cadastro salva igual.',
}

/** O nome de cada campo na frase — é o que quem não vê a tela ouve. */
const NOME_DO_CAMPO: Record<keyof EnderecoDoCep, string> = {
  logradouro: 'logradouro',
  bairro: 'bairro',
  cidade: 'cidade',
  uf: 'UF',
}

/** `['a','b','c']` → `'a, b e c'`. */
function listar(nomes: string[]): string {
  if (nomes.length <= 1) return nomes[0] ?? ''

  return `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}`
}

/**
 * A frase diz O QUE MUDOU, e só promete o que existe na tela.
 *
 * Duas correções do gate estão aqui. A primeira, do passe de navegador: o formulário público
 * desta clínica publica CEP e Logradouro e **não** publica o Número — a frase mandava a
 * família preencher um campo que não existe ali. A segunda, do parecer de acessibilidade:
 * "Endereço preenchido" não nomeia nem conta os campos, e quem usa leitor de tela precisava
 * TABULAR por eles para descobrir o que mudou — exatamente o trabalho que a change queria
 * poupar. Pior: com resposta parcial, "campos" no plural para um campo só.
 */
function mensagemDoPreenchimento(
  preenchidos: (keyof EnderecoDoCep)[],
  campoVisivel?: (campo: string) => boolean,
): string {
  const nomes = preenchidos.map((chave) => NOME_DO_CAMPO[chave])
  const quais = nomes.length === 0 ? 'Nada a preencher' : listar(nomes)
  const verbo = nomes.length === 1 ? 'preenchido' : 'preenchidos'
  const inicio = nomes.length === 0 ? 'O CEP não trouxe nada novo.' : `${quais} ${verbo} pelo CEP.`
  const temNumero = campoVisivel === undefined || campoVisivel('endereco_numero')

  return temNumero ? `${inicio[0].toUpperCase()}${inicio.slice(1)} Informe o número.` : `${inicio[0].toUpperCase()}${inicio.slice(1)} Confira.`
}

// nome do repo é pt-BR; o lint exige o prefixo `use` na declaração
function useConsultaDeCep({
  aoPreencher,
  campoVisivel,
  refDoNumero,
  atrasoMs = 400,
}: OpcoesDaConsultaDeCep): ConsultaDeCep {
  const [estado, setEstado] = useState<EstadoDaConsultaDeCep>('ocioso')
  const [preenchidos, setPreenchidos] = useState<(keyof EnderecoDoCep)[]>([])
  /**
   * O que a consulta ANTERIOR escreveu — e só ela. O que a pessoa digitou à mão nunca entra
   * aqui, e é isso que faz a limpeza abaixo ser segura. Em ref, não em estado: quem lê é o
   * callback assíncrono, e estado chegaria velho.
   */
  const escritoPelaConsulta = useRef<(keyof EnderecoDoCep)[]>([])

  const cronometro = useRef<ReturnType<typeof setTimeout> | null>(null)
  const emVoo = useRef<AbortController | null>(null)
  /**
   * O CEP do pedido mais novo. É a guarda de corrida, e ela NÃO é redundante com o
   * `AbortController`: `abort()` não impede um `then` já agendado de rodar. Digitar um CEP,
   * ver o erro e digitar outro é o caso normal — e a rede não promete ordem de chegada. Sem
   * este confronto, o endereço da criança fica sendo o do CEP errado, em silêncio.
   */
  const pedidoMaisNovo = useRef<string | null>(null)

  // as props mudam a cada render do formulário; guardá-las em ref mantém `aoDigitarCep`
  // estável, para o campo não perder o cronômetro a cada tecla.
  //
  // A atualização é em efeito, não no corpo: escrever em ref durante a renderização é o
  // anti-padrão que a própria doc do React nomeia (achado do code review). Aqui não produzia
  // defeito — os dois consumidores usam `setState` funcional —, mas é linha que ensina errado.
  const props = useRef({ aoPreencher, campoVisivel, refDoNumero })
  useEffect(() => {
    props.current = { aoPreencher, campoVisivel, refDoNumero }
  })

  const cancelar = useCallback(() => {
    if (cronometro.current !== null) clearTimeout(cronometro.current)
    emVoo.current?.abort()
    cronometro.current = null
    emVoo.current = null
  }, [])

  // desmontar no meio da consulta não pode deixar `fetch` órfão nem `setState` em componente morto
  useEffect(() => cancelar, [cancelar])

  const aoDigitarCep = useCallback(
    (valor: string) => {
      cancelar()

      if (!cepCompleto(valor)) {
        pedidoMaisNovo.current = null
        setEstado('ocioso')
        return
      }

      /*
       * MINIMIZAÇÃO (parecer SEC-CEP-05, LGPD art. 6º III).
       *
       * A clínica que esconde os quatro campos de destino não tem onde receber a resposta —
       * e mandar o CEP da criança para um terceiro sem finalidade possível é coleta sem
       * propósito. A régua já está aqui; faltava perguntar a ela antes de sair.
       */
      const { campoVisivel: visivelAgora } = props.current
      if (visivelAgora !== undefined && !CAMPOS_DO_CEP.some(([campo]) => visivelAgora(campo))) {
        pedidoMaisNovo.current = null
        setEstado('ocioso')
        return
      }

      const cep = digitosDoCep(valor)
      pedidoMaisNovo.current = cep
      setEstado('consultando')

      /*
       * ONDE O FOCO ESTAVA QUANDO A CONSULTA SAIU (achado bloqueante do code review).
       *
       * Entre o disparo e a resposta há o debounce mais a ida à rede — tempo de sobra para a
       * pessoa ter saído do CEP e já estar digitando o logradouro à mão. Mover o foco assim
       * mesmo ARRANCA o cursor do meio da digitação, e é MUST NOT em duas specs.
       *
       * A regra fica sendo: o foco só avança para o Número se, na volta, a pessoa ainda
       * estiver onde estava quando a consulta saiu.
       */
      const focoNoDisparo = document.activeElement

      /*
       * QUEM DISPAROU precisa ser um campo, não o `body` (achado A11Y-CEP-11).
       *
       * A guarda comparava "o foco não mudou", e não "o foco está no campo". Preenchimento
       * automático do navegador (gerenciador de endereços, extensão) escreve no campo SEM
       * focá-lo: `document.activeElement` era `body` antes e depois, a igualdade passava, e o
       * foco pulava para o Número **sem ninguém ter tocado no formulário** — num caminho em
       * que a pessoa nunca focou o CEP e portanto nunca recebeu o aviso que torna o
       * movimento conforme.
       */
      const disparouDeUmCampo = focoNoDisparo instanceof HTMLInputElement

      cronometro.current = setTimeout(() => {
        const controlador = new AbortController()
        emVoo.current = controlador

        void consultarCep(cep, controlador.signal)
          .then((resultado) => {
            // a resposta de um CEP que já não é o do campo não escreve nada
            if (pedidoMaisNovo.current !== cep) return

            if (resultado.tipo !== 'encontrado') {
              setEstado(resultado.tipo)
              return
            }

            const { campoVisivel: visivel, aoPreencher: preencher, refDoNumero: ref } = props.current

            /*
             * VAZIO NÃO SOBRESCREVE (achado A11Y-CEP-01, agravante C — perda de dado).
             *
             * CEP geral de cidade (comum em cidade pequena) volta com `logradouro` e `bairro`
             * em branco. A regra "o CEP é a autoridade, substitui os quatro" apagava, nesse
             * caso, a rua e o bairro que a recepção tinha acabado de digitar — e o anúncio
             * ainda dizia "endereço preenchido". A ficha salvava com endereço em branco e
             * ninguém era avisado.
             *
             * "O CEP é a autoridade" continua valendo sobre o que ele RESPONDE. Sobre o que
             * ele não respondeu, quem sabe é quem mora lá.
             */
            /*
             * O CAMPO EM QUE A PESSOA ESTÁ DIGITANDO AGORA não é sobrescrito
             * (achado A11Y-CEP-10).
             *
             * A guarda do foco protegia o CURSOR e deixava o CONTEÚDO desprotegido: quem
             * saía do CEP e ia escrever a rua à mão via, no meio da frase, o que digitou ser
             * trocado pela resposta do serviço — e quem usa leitor de tela não recebia sinal
             * nenhum. A assimetria era o defeito; a simetria é a correção.
             */
            const focoAgora = document.activeElement
            const digitandoAgora = (chave: keyof EnderecoDoCep) =>
              focoAgora instanceof HTMLInputElement &&
              focoAgora !== focoNoDisparo &&
              focoAgora.id === ID_DO_CAMPO[chave]

            const preenchimento: Partial<EnderecoDoCep> = {}
            const novos: (keyof EnderecoDoCep)[] = []
            for (const [campo, chave] of CAMPOS_DO_CEP) {
              const valor = resultado.endereco[chave]
              if (valor !== '' && (visivel === undefined || visivel(campo)) && !digitandoAgora(chave)) {
                preenchimento[chave] = valor
                novos.push(chave)
              }
            }

            /*
             * O ESPELHO DA PERDA DE DADO, fechado (achado IMPORTANTE 3 da rodada 2).
             *
             * "Vazio não sobrescreve" salvou o que a pessoa digitou — e abriu o contrário:
             * trocar um CEP de rua por um CEP GERAL de outra cidade deixava o logradouro e o
             * bairro do CEP anterior colados na cidade nova. Uma rua de Lages em Porto Seguro,
             * com a tela mostrando endereço completo e o anúncio calado sobre os dois campos
             * velhos.
             *
             * A saída distingue as duas origens: campo que a CONSULTA ANTERIOR escreveu e que
             * a nova não responde é limpo; campo que a PESSOA digitou nunca esteve nesta
             * lista, e sobrevive. As duas frases da spec passam a valer juntas.
             */
            for (const chave of escritoPelaConsulta.current) {
              if (!novos.includes(chave)) preenchimento[chave] = ''
            }
            escritoPelaConsulta.current = novos

            preencher(preenchimento)
            setPreenchidos(novos)
            setEstado('preenchido')

            if (disparouDeUmCampo && document.activeElement === focoNoDisparo) {
              ref?.current?.focus()
            }
          })
          .catch(() => {
            // só sobra o aborto: `consultarCep` já traduz falha de rede em `indisponivel`
          })
          .finally(() => {
            // sem isto a ref segue apontando para uma consulta que já acabou, dizendo
            // "há requisição em voo" quando não há
            if (emVoo.current === controlador) emVoo.current = null
          })
      }, atrasoMs)
    },
    [atrasoMs, cancelar],
  )

  const temNumero = campoVisivel === undefined || campoVisivel('endereco_numero')

  return {
    estado,
    aoDigitarCep,
    mensagem: estado === 'preenchido' ? mensagemDoPreenchimento(preenchidos, campoVisivel) : MENSAGENS[estado],
    ajuda: temNumero
      ? 'Digite o CEP e o endereço aparece sozinho; o cursor vai para o Número.'
      : 'Digite o CEP e o endereço aparece sozinho.',
  }
}

export { useConsultaDeCep as usarConsultaDeCep }
