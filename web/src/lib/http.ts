import axios, { AxiosError } from 'axios'

// Sanctum SPA: cookies de sessão + header X-XSRF-TOKEN (design D2).
// Sem baseURL: o proxy do Vite encaminha /api e /sanctum para o Laravel em dev.
export const http = axios.create({
  withCredentials: true,
  withXSRFToken: true,
  headers: { Accept: 'application/json' },
})

let csrfCarregado = false

/** Busca o cookie XSRF uma única vez, antes da primeira mutação (erro 419 = faltou isto). */
export async function garantirCsrf(): Promise<void> {
  if (!csrfCarregado) {
    await http.get('/sanctum/csrf-cookie')
    csrfCarregado = true
  }
}

/**
 * Esquece o token CSRF. OBRIGATÓRIO ao encerrar a sessão: o cookie XSRF morre
 * junto com ela, mas a SPA não recarrega — sem isto, `garantirCsrf()` viraria
 * no-op e o próximo login levaria 419 para sempre (só F5 destravaria).
 */
export function esquecerCsrf(): void {
  csrfCarregado = false
}

/**
 * `PUT` com a concorrência otimista do produto (EX-05 · SEC-OCC): envia no
 * `If-Match` o `updated_at` da leitura que hidratou o formulário — a string
 * VERBATIM, nunca reformatada (`new Date()` perderia precisão e fabricaria
 * conflito eterno). 409 vira o motivo `conflito`; a tela avisa e oferece
 * recarregar. Helper ÚNICO: nenhuma tela monta o header à mão.
 */
export async function putComVersao<T>(url: string, dados: unknown, versao: string): Promise<T> {
  return (await putComVersaoDetalhado<T>(url, dados, versao)).data
}

/**
 * Como `putComVersao`, mas devolve TAMBÉM o status — o maker-checker (AP-13)
 * responde **202** quando a mutação virou pendência de aprovação, e o chamador
 * precisa distinguir "aplicou" de "aguarda outro administrador".
 */
export async function putComVersaoDetalhado<T>(
  url: string,
  dados: unknown,
  versao: string,
): Promise<{ status: number; data: T }> {
  await garantirCsrf()
  const resposta = await http.put<T>(url, dados, cabecalhoDaVersao(versao))

  return { status: resposta.status, data: resposta.data }
}

/**
 * O header, num lugar só. A CHAMADA fica literal em cada helper de propósito: a guarda de idioma
 * (`concorrencia-otimista.contrato.test.ts`) conta, por arquivo, as chamadas CRUAS do cliente HTTP
 * por verbo, e um despacho dinâmico (`http[metodo]`) a cegaria — trocaria três linhas de repetição
 * por um buraco na rede que detecta a tela nova nascendo sem versão.
 */
function cabecalhoDaVersao(versao: string) {
  return { headers: { 'If-Match': versao } }
}

/**
 * `PATCH` com versão — mesma disciplina do `putComVersao`: CSRF garantido e o `If-Match` da leitura
 * que hidratou a tela (o piso de concorrência otimista vale para PUT **e** PATCH de edição).
 */
export async function patchComVersao<T>(url: string, dados: unknown, versao: string): Promise<T> {
  await garantirCsrf()
  const { data } = await http.patch<T>(url, dados, cabecalhoDaVersao(versao))

  return data
}

/** Motivos que a TELA entende — nenhuma resposta bruta do servidor vaza (T-ds-05). */
export type MotivoErro = 'sessao_expirada' | 'sem_acesso' | 'invalido' | 'conflito' | 'rede' | 'servidor'

/** Erro normalizado: a mensagem é humana e segura de exibir. */
export class ErroDeApi extends Error {
  readonly motivo: MotivoErro
  /** Erros de validação por campo (422) — chaves da API, valores já tratados */
  readonly camposInvalidos: Record<string, string[]>
  /**
   * O código HTTP, quando houve resposta. O `motivo` agrupa (todo 4xx sem nome próprio é `invalido`);
   * o código separa o que pede uma frase própria — o 429 do limite de consultas não é "revise os dados".
   */
  readonly status: number | undefined

  constructor(motivo: MotivoErro, mensagem: string, camposInvalidos: Record<string, string[]> = {}, status?: number) {
    super(mensagem)
    this.name = 'ErroDeApi'
    this.motivo = motivo
    this.camposInvalidos = camposInvalidos
    this.status = status
  }
}

/**
 * A mensagem do conflito, exportada porque um caminho de serviço precisa lançá-la à mão: o 409 de
 * HOMÔNIMO do pré-cadastro é tirado do funil do interceptador (é pergunta, não falha), e o que
 * NÃO for homônimo tem de voltar a ser conflito com o mesmo texto de sempre.
 */
export const MENSAGEM_DE_CONFLITO =
  'Este registro foi alterado por outra pessoa enquanto você editava. Recarregue para ver a versão atual.'

const MENSAGEM_POR_MOTIVO: Record<MotivoErro, string> = {
  sessao_expirada: 'Sua sessão expirou. Entre novamente.',
  sem_acesso: 'Você não tem acesso a este recurso.',
  invalido: 'Não foi possível concluir: revise os dados informados.',
  conflito: MENSAGEM_DE_CONFLITO,
  rede: 'Sem conexão com o servidor. Verifique a rede e tente novamente.',
  servidor: 'O servidor não conseguiu responder agora. Tente novamente em instantes.',
}

function motivoDoStatus(status: number | undefined): MotivoErro {
  if (status === undefined) {
    return 'rede'
  }
  if (status === 401 || status === 419) {
    return 'sessao_expirada'
  }
  if (status === 403) {
    return 'sem_acesso'
  }
  // concorrência otimista (EX-05): salvar sobre versão desatualizada; o 428
  // (faltou o If-Match) é bug de integração, não conflito — cai em `invalido`.
  // Exceção declarada: o 409 de HOMÔNIMO do pré-cadastro NÃO passa por aqui — o serviço o tira do
  // caminho de erro (`validateStatus`) porque é pergunta, não falha (change faxina-de-gatilhos).
  if (status === 409) {
    return 'conflito'
  }
  return status >= 400 && status < 500 ? 'invalido' : 'servidor'
}

/** Reação ao 401: registrada pelo app (encerra a sessão e limpa o cache). */
type AoExpirarSessao = () => void
let aoExpirarSessao: AoExpirarSessao = () => undefined

export function registrarAoExpirarSessao(reacao: AoExpirarSessao): void {
  aoExpirarSessao = reacao
}

// Endpoints da própria sessão: um 401 aqui é resposta ESPERADA (visitante sem
// sessão), não expiração — reagir a ele criaria laço de logout/redirect.
// Comparação EXATA: com `startsWith`, `/api/medicos` casaria com `/api/me` e um
// 401 lá deixaria a sessão zumbi (cache de menor vivo, usuário sem saber).
const ROTAS_DE_SESSAO = ['/api/me', '/api/login', '/api/logout']

http.interceptors.response.use(
  (resposta) => resposta,
  (erro: unknown) => {
    if (!(erro instanceof AxiosError)) {
      return Promise.reject(new ErroDeApi('servidor', MENSAGEM_POR_MOTIVO.servidor))
    }

    const status = erro.response?.status
    const motivo = motivoDoStatus(status)
    const url = erro.config?.url ?? ''

    if (motivo === 'sessao_expirada' && !ROTAS_DE_SESSAO.includes(url)) {
      aoExpirarSessao()
    }

    const dados = erro.response?.data as { errors?: Record<string, string[]> } | undefined
    const camposInvalidos = motivo === 'invalido' ? (dados?.errors ?? {}) : {}

    // A mensagem é SEMPRE do nosso dicionário — texto do servidor (stack, SQL)
    // nunca chega à tela (T-ds-05).
    return Promise.reject(new ErroDeApi(motivo, MENSAGEM_POR_MOTIVO[motivo], camposInvalidos, status))
  },
)
