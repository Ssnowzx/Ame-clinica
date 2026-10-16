import { ErroDeApi, garantirCsrf, http, MENSAGEM_DE_CONFLITO, patchComVersao, putComVersao } from '@/lib/http'
import type { Paciente, PacienteDaLista, PaginaDeApi, PayloadPaciente, ResumoDoPaciente, TelefoneEmUso } from '@/tipos'

/**
 * O pré-cadastro tem DOIS desfechos de sucesso operacional: criou, ou encontrou nome idêntico e
 * está perguntando. Um tipo discriminado obriga o chamador a tratar os dois — um `Paciente | null`
 * deixaria o segundo caso passar como "deu errado".
 */
export type ResultadoDoPreCadastro =
  | { tipo: 'criado'; paciente: Paciente }
  | { tipo: 'homonimo' }

export interface FiltroDePacientes {
  /** Nome ou nome social — vai no corpo da query, NUNCA na URL da tela (design D2) */
  busca?: string
  ativo?: boolean
  pagina?: number
  /** Teto por página — omitido, o servidor usa o dele (50) */
  porPagina?: number
}

/** Lista paginada e MINIMIZADA pelo servidor (sem CPF/responsáveis/contatos). */
export async function listarPacientes({
  busca,
  ativo,
  pagina = 1,
  porPagina,
}: FiltroDePacientes): Promise<PaginaDeApi<PacienteDaLista>> {
  const { data } = await http.get<PaginaDeApi<PacienteDaLista>>('/api/pacientes', {
    params: {
      page: pagina,
      ...(busca !== undefined && busca !== '' ? { busca } : {}),
      ...(ativo !== undefined ? { ativo: ativo ? 1 : 0 } : {}),
      ...(porPagina !== undefined ? { per_page: porPagina } : {}),
    },
  })
  return data
}

/** O cadastro COMPLETO só existe aqui — nunca na lista. */
export async function buscarPaciente(id: number): Promise<Paciente> {
  const { data } = await http.get<Paciente>(`/api/pacientes/${id}`)
  return data
}

/** Resumo agregado read-only para o Painel da ficha (sem coluna do menor). */
export async function buscarResumoDoPaciente(id: number): Promise<ResumoDoPaciente> {
  const { data } = await http.get<ResumoDoPaciente>(`/api/pacientes/${id}/resumo`)
  return data
}

/**
 * Pré-cadastro pelo balcão (pre-cadastro-de-paciente): só nome, sexo e telefone —
 * a criança entra na FILA agora; a ficha se completa depois (a listagem avisa).
 */
export async function preCadastrarPaciente(payload: {
  nome: string
  /** OMITIDO quando a clínica escondeu o campo — o servidor recusa a presença da chave */
  sexo?: string
  telefone: string
  /** Confirmação humana: o nome idêntico É de outra criança (irmãos homônimos existem) */
  confirmarHomonimo?: boolean
}): Promise<ResultadoDoPreCadastro> {
  await garantirCsrf()
  const { status, data } = await http.post<Paciente | { homonimo: true; message: string }>(
    '/api/pacientes/pre-cadastro',
    {
      nome: payload.nome,
      // a chave só viaja se a régua mostrar o campo: com `sexo` escondido, o boundary
      // recusa a PRESENÇA dela — mandar `''` ou `null` daria 422 igual, e o balcão ficaria
      // sem caminho nenhum para pré-cadastrar
      ...(payload.sexo !== undefined ? { sexo: payload.sexo } : {}),
      telefone: payload.telefone,
      ...(payload.confirmarHomonimo === true ? { confirmar_homonimo: true } : {}),
    },
    // o 409 de HOMÔNIMO não é falha: é uma pergunta. Sem tirá-lo do caminho de erro, o
    // interceptador o traduziria como conflito de concorrência otimista ("alterado por outra
    // pessoa enquanto você editava") — mensagem sem sentido numa CRIAÇÃO, e que não oferece a
    // única saída útil, que é confirmar.
    { validateStatus: (status) => status === 201 || status === 409 },
  )

  // Discrimina pela FLAG que o servidor manda, não só pelo status: um 409 futuro nesta rota (outra
  // regra qualquer) não pode virar a pergunta "é outra criança?" em silêncio.
  // A TELA é dona do texto (T-ds-05): daqui sai o FATO, não a mensagem do servidor.
  if (status === 409) {
    if ('homonimo' in data && data.homonimo === true) {
      return { tipo: 'homonimo' }
    }
    throw new ErroDeApi('conflito', MENSAGEM_DE_CONFLITO)
  }

  return { tipo: 'criado', paciente: data as Paciente }
}

export async function criarPaciente(payload: PayloadPaciente): Promise<Paciente> {
  await garantirCsrf()
  const { data } = await http.post<Paciente>('/api/pacientes', payload)
  return data
}

export async function atualizarPaciente(id: number, payload: PayloadPaciente, versao: string): Promise<Paciente> {
  const data = await putComVersao<Paciente>(`/api/pacientes/${id}`, payload, versao)
  return data
}

/**
 * Desativar/reativar — NÃO existe exclusão de paciente (design D3): a API não a
 * tem, e a desativação preserva a trilha (§12).
 *
 * Vai pelo endpoint de SITUAÇÃO (`PATCH .../situacao`), não pelo PUT-inteiro. Enquanto trocar uma
 * flag exigia reenviar o cadastro completo, desativar um PRÉ-CADASTRADO era impossível: o `PUT` pede
 * `nascimento` e `necessidade`, que um pré-cadastrado não tem, e a recepção teria de INVENTAR data de
 * nascimento e dado de saúde de um MENOR para desfazer um erro de digitação (change
 * `faxina-de-gatilhos`).
 *
 * A `versao` vem de QUEM CHAMA — a mesma que hidratou a tela, como no `PUT` de edição. Enquanto
 * esta função relia o cadastro só para montar o `If-Match`, a concorrência otimista era **teatro**:
 * a versão validada era sempre a de meio segundo atrás, nunca a que a pessoa viu, e o 409 não
 * disparava nunca (parecer SEC-PIS-05, change `paciente-inativo-com-saida`). Ler a versão logo
 * antes de escrever é, literalmente, desligar a proteção que o `If-Match` existe para dar.
 */
export async function definirSituacaoDoPaciente(id: number, ativo: boolean, versao: string): Promise<Paciente> {
  // A resposta do PATCH é MÍNIMA de propósito (`{id, ativo, updated_at}`): escrever uma flag não
  // ecoa CPF, responsáveis nem `necessidade` de um menor. A tela re-hidrata o formulário com o
  // cadastro do servidor, então a leitura fresca vem daqui — explícita, sob `pacientes.ver`, e não
  // de um eco de escrita.
  await patchComVersao<{ id: number; ativo: boolean }>(`/api/pacientes/${id}/situacao`, { ativo }, versao)

  return buscarPaciente(id)
}


/**
 * Outros pacientes com o mesmo número (change telefone-que-chega-no-whatsapp, D6). POST de
 * propósito: o número de uma família de criança não vai para o endereço — nem para o log de acesso
 * do proxy, nem para o histórico do navegador.
 */
export async function conferirTelefone(numero: string, ignorarPacienteId?: number): Promise<TelefoneEmUso> {
  await garantirCsrf()
  const { data } = await http.post<TelefoneEmUso>('/api/pacientes/telefone/conferir', {
    numero,
    ...(ignorarPacienteId !== undefined ? { ignorar_paciente_id: ignorarPacienteId } : {}),
  })

  return data
}
