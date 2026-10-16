import { digitosDoCep } from '@/lib/cep'
import { UFS } from '@/lib/ufs'

/**
 * A CONSULTA DE CEP (capability `consulta-de-cep`, ADR-0005).
 *
 * Este arquivo é a fronteira com o único serviço de terceiro que o cadastro toca, e ele tem
 * duas regras que não são estilo:
 *
 * 1. **`fetch` cru, sem credencial.** NUNCA o `@/lib/http`: aquele cliente é criado com
 *    `withCredentials: true`, `withXSRFToken: true` e **sem `baseURL`** — ele existe para falar
 *    com o nosso Laravel por caminho relativo, e apontá-lo para um host externo acrescentaria o
 *    token anti-CSRF da clínica à requisição. Para o serviço de CEP vai um CEP, e nada além
 *    disso.
 * 2. **`erro` vem com HTTP 200.** O ViaCEP responde `200` com `{"erro":"true"}` para CEP que não
 *    existe (medido em 2026-09-04). Conferir só `response.ok` daria por bom um endereço que não
 *    existe — e o cadastro da criança ficaria com a rua de ninguém.
 *
 * Trocar de provedor é reescrever `URL_DO_SERVICO` e `traduzir`. Nada mais neste arquivo, e nada
 * fora dele.
 */

/** O endereço na forma do PRODUTO — os nomes do provedor param na tradução. */
export interface EnderecoDoCep {
  logradouro: string
  bairro: string
  cidade: string
  uf: string
}

/**
 * Os três desfechos, explícitos.
 *
 * `nao_encontrado` e `indisponivel` são coisas diferentes para quem preenche: um é "confira o
 * número que você digitou", o outro é "não é você, é o serviço". Um `null` para os dois
 * obrigaria a tela a escolher uma frase errada para metade dos casos.
 */
export type ResultadoDoCep =
  | { tipo: 'encontrado'; endereco: EnderecoDoCep }
  | { tipo: 'nao_encontrado' }
  | { tipo: 'indisponivel' }

const URL_DO_SERVICO = (cep: string) => `https://viacep.com.br/ws/${cep}/json/`

/** Quanto esperamos o provedor antes de desistir e liberar a digitação à mão. */
const TETO_DE_ESPERA = 8000

/**
 * O sinal da requisição: o cancelamento de fora MAIS o nosso teto de espera.
 *
 * Composto À MÃO de propósito. A primeira versão usava `AbortSignal.any`, que só existe a
 * partir de Chrome 116 / Safari 17.4 / Firefox 124 — e este projeto não declara
 * `browserslist`, então o alvo do Vite ainda inclui Safari 16.4–17.3. O Vite transpila
 * sintaxe, nunca faz polyfill de API de runtime: naqueles aparelhos a expressão lançava
 * `TypeError` **dentro do `try`**, caía no `catch` e virava "serviço indisponível".
 *
 * O efeito era o pior possível: a consulta **nunca funcionava** no celular antigo da família
 * — exatamente o público que a política de referenciador existe para proteger —, e a tela
 * dizia "não foi possível buscar o endereço agora", mandando todo mundo procurar problema de
 * rede na clínica (parecer SEC-CEP-09).
 *
 * `abort()` sem argumento e `setTimeout` funcionam em tudo. Quem distingue "expirou" de
 * "outra consulta cancelou esta" é a flag, não o motivo do sinal.
 */
function sinalComTeto(externo: AbortSignal | undefined): {
  sinal: AbortSignal
  expirou: () => boolean
  limpar: () => void
} {
  const controlador = new AbortController()
  let expirou = false

  const cronometro = setTimeout(() => {
    expirou = true
    controlador.abort()
  }, TETO_DE_ESPERA)

  const propagar = () => {
    controlador.abort()
  }

  if (externo !== undefined) {
    if (externo.aborted) propagar()
    else externo.addEventListener('abort', propagar, { once: true })
  }

  return {
    sinal: controlador.signal,
    expirou: () => expirou,
    limpar: () => {
      clearTimeout(cronometro)
      externo?.removeEventListener('abort', propagar)
    },
  }
}

/** O que o ViaCEP devolve, na língua dele. */
interface RespostaDoServico {
  // `unknown`, não `string`: o que vem de fora não tem tipo garantido, e declarar `string`
  // aqui seria a mesma promessa vazia que o `as` faz na desserialização
  logradouro?: unknown
  bairro?: unknown
  localidade?: unknown
  uf?: unknown
  erro?: unknown
}

/**
 * Teto de sanidade para um campo de endereço vindo de fora. **Não é o limite do servidor** —
 * é a fronteira do absurdo: nenhum logradouro real tem 200 caracteres, e um provedor que
 * responde 100 mil não está respondendo à nossa pergunta.
 */
const ABSURDO = 200

/** Marca de resposta que não dá para usar — o provedor respondeu, mas não o que perguntamos. */
const INVALIDO = Symbol('resposta inutilizável')

/**
 * Um campo de texto vindo do TERCEIRO, tratado como o que é: entrada não confiável.
 *
 * `as RespostaDoServico` é promessa de tipo, não checagem — e o que entra aqui vai direto para
 * o formulário e daí para o nosso servidor. Sem esta função, um provedor com defeito produzia
 * 422 **culpando quem não digitou**: a família lia "use apenas letras, números e pontuação"
 * sobre um texto que o preenchimento automático escreveu (parecer SEC-CEP-02).
 *
 * Caracteres de controle e de formatação saem — nunca fazem parte de um endereço, e são
 * exatamente o que a guarda de texto hostil do servidor recusa.
 */
function texto(valor: unknown): string | typeof INVALIDO {
  if (valor === undefined || valor === null) return ''
  if (typeof valor !== 'string') return INVALIDO

  /*
   * A ORDEM importa (parecer SEC-CEP-10). `\n` e `\t` são categoria Cc: removê-los ANTES de
   * colapsar espaço grudava palavras — "Rua das Flores\nfundos" virava "Rua das Floresfundos",
   * e o dado corrompido ia para a ficha da criança. A função existe para tornar utilizável uma
   * entrada não confiável, não para estragá-la.
   */
  const limpo = valor
    .replace(/\s+/gu, ' ')
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .trim()

  return limpo.length > ABSURDO ? INVALIDO : limpo
}

/**
 * Do formato do provedor para o nosso.
 *
 * `localidade` é a cidade — o nome dele não é o nosso. E o `complemento` que ele devolve
 * ("de 100 a 200", "lado ímpar") é **descartado de propósito**: a capability proíbe a consulta
 * de tocar em complemento, que é o campo que só quem mora ali sabe preencher. Descartar aqui
 * fecha a porta por dentro — nenhum consumidor consegue usar o que não existe no tipo.
 */
function traduzir(resposta: RespostaDoServico): EnderecoDoCep | typeof INVALIDO {
  const logradouro = texto(resposta.logradouro)
  const bairro = texto(resposta.bairro)
  const cidade = texto(resposta.localidade)
  const uf = texto(resposta.uf)

  if (logradouro === INVALIDO || bairro === INVALIDO || cidade === INVALIDO || uf === INVALIDO) {
    return INVALIDO
  }

  const siglaLimpa = uf.toUpperCase()
  // UF fora da lista não é endereço brasileiro: o `CampoSelect` ficaria sem seleção visível e
  // o servidor recusaria o cadastro sem que a tela dissesse por quê
  if (siglaLimpa !== '' && !(UFS as readonly string[]).includes(siglaLimpa)) {
    return INVALIDO
  }

  return { logradouro, bairro, cidade, uf: siglaLimpa }
}

/**
 * Consulta o endereço de um CEP.
 *
 * @param cep - CEP com ou sem máscara; só os dígitos viajam
 * @param sinal - Cancelamento de uma consulta superada por outra mais nova
 */
export async function consultarCep(cep: string, sinal?: AbortSignal): Promise<ResultadoDoCep> {
  const digitos = digitosDoCep(cep)
  const espera = sinalComTeto(sinal)

  try {
    const resposta = await fetch(URL_DO_SERVICO(digitos), {
      /*
       * O QUE CADA UMA FAZ (parecer SEC-CEP-01/04 — a redação anterior era imprecisa):
       *
       * - `referrerPolicy`: a linha que de fato protege. Sem ela, quem manda o `Referer` é o
       *   navegador — e na borda pública a URL é `/cadastro/{slug}`, onde o slug é o ÚNICO
       *   segredo da porta. Navegador moderno manda só a origem; WebView antiga de Android
       *   (que é onde a família abre um link de WhatsApp) manda a URL inteira.
       * - `cache: 'no-store'`: o provedor responde `Cache-Control: public, max-age=3600`. Sem
       *   isto, a lista de CEPs consultados na ordem dos atendimentos fica no disco do
       *   computador COMPARTILHADO da recepção. É a mesma decisão que barrou o rascunho do
       *   cadastro no armazenamento local do navegador.
       * - `credentials: 'omit'`: cinto e suspensório. Cookie da clínica não iria a outro
       *   domínio de nenhum jeito — o vetor real com o cliente errado é o `X-XSRF-TOKEN` que
       *   o axios copia do cookie, e a defesa contra isso é não usar o `@/lib/http` aqui.
       * - `signal`: cancelamento, não privacidade.
       */
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
      credentials: 'omit',
      // um provedor que aceita a conexão e não responde deixaria "Buscando o endereço…" para
      // sempre
      signal: espera.sinal,
    })

    // CEP malformado é 400 no provedor; para quem preenche, é o mesmo que não achar
    if (!resposta.ok) {
      return resposta.status === 400 ? { tipo: 'nao_encontrado' } : { tipo: 'indisponivel' }
    }

    const dados = (await resposta.json()) as RespostaDoServico

    // o `erro` que chega com 200 — a armadilha desta integração
    if (dados.erro !== undefined && dados.erro !== false && dados.erro !== 'false') {
      return { tipo: 'nao_encontrado' }
    }

    const endereco = traduzir(dados)

    // o provedor respondeu algo que não é endereço: é defeito DELE, não do CEP digitado
    if (endereco === INVALIDO) {
      return { tipo: 'indisponivel' }
    }

    /*
     * RESPOSTA VAZIA NÃO É ENDEREÇO (parecer SEC-CEP-03).
     *
     * `{"erro":"true"}` estava tratado; um `200` com `{}` NÃO estava — e virava "encontrado"
     * com os quatro campos em branco, que o preenchimento então ESCREVIA por cima do endereço
     * da criança, com a tela dizendo "preenchido com sucesso".
     *
     * O caminho provável não é ataque, é manutenção: a substituta declarada no ADR-0005
     * (BrasilAPI) usa `street`/`neighborhood`/`city`/`state`. Quem trocar a URL sem trocar a
     * tradução apaga o endereço de TODO cadastro, em silêncio.
     *
     * CEP genérico de cidade grande continua sendo sucesso: ele volta sem logradouro e sem
     * bairro, mas COM cidade e UF — por isso a condição é "os quatro vazios", não "algum".
     */
    if (Object.values(endereco).every((valor) => valor === '')) {
      return { tipo: 'nao_encontrado' }
    }

    return { tipo: 'encontrado', endereco }
  } catch (erro) {
    // expirar É falha do serviço, e o aborto que a acompanha não pode ser lido como
    // cancelamento — senão o estado ficaria preso em "Buscando o endereço…"
    if (espera.expirou()) {
      return { tipo: 'indisponivel' }
    }

    // aborto não é falha do serviço: é a consulta mais nova mandando esta calar a boca.
    // Sem esta distinção, trocar de CEP acenderia "serviço indisponível" na tela.
    if (erro instanceof DOMException && erro.name === 'AbortError') {
      throw erro
    }

    return { tipo: 'indisponivel' }
  } finally {
    espera.limpar()
  }
}
