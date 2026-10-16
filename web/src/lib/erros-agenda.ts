import { distribuirErrosDoServidor } from '@/lib/erros'

/**
 * Traduz a recusa do servidor em correção possível (parecer T-aes-10).
 *
 * A API recusa com precisão — `errors` chaveado por campo, em português, escrito
 * para humano. O trabalho da tela é levar cada mensagem ao campo que a causou, e
 * dar um lugar ao que não pertence a campo nenhum. Uma recusa que não aparece é
 * uma recusa que a recepcionista não consegue resolver.
 *
 * A separação em si vive em `lib/erros.ts` (genérica, usada também pelos
 * cadastros); aqui fica o CONTRATO TIPADO da agenda: só os campos que os
 * formulários da agenda têm de fato.
 */

/** Campos que o formulário conhece — chave da API → campo da tela. */
const CAMPOS_DO_FORMULARIO = [
  'inicio',
  'fim',
  'duracao_minutos',
  'profissional_id',
  'paciente_id',
  'especialidade_id',
  'tratamento_id',
  'sala_id',
  'equipamento_id',
  'medico_id',
  'status_id',
  'obs',
  'reposicao_de_id',
  // campo do formulário da FILA (a agenda não o tem) — sem ele, a recusa de
  // prioridade cairia no aviso geral, longe do campo que a causou
  'prioridade',
  // o modo bloqueio não é um campo da tela: a recusa de `tipo` vai para o aviso
] as const

export type CampoDoFormulario = (typeof CAMPOS_DO_FORMULARIO)[number]

export interface ErrosDoFormulario {
  /** Mensagem por campo (a primeira, que é a que orienta) */
  porCampo: Partial<Record<CampoDoFormulario, string>>
  /** O que não pertence a campo nenhum — vai para o `AvisoErro` */
  gerais: string[]
}

const CAMPOS_CONHECIDOS = new Set<string>(CAMPOS_DO_FORMULARIO)

/**
 * Distribui as recusas do servidor entre os campos da agenda e o aviso geral.
 *
 * Chave desconhecida (inclusive pontuada, como `recorrencia.ate`) vai para o
 * aviso — fail-safe: o usuário vê o motivo mesmo que a tela não conheça o campo.
 *
 * @param erro - Exceção de qualquer origem (só `ErroDeApi` carrega recusa de domínio)
 * @returns Mensagens por campo e mensagens gerais (nunca vazio quando há recusa)
 */
export function distribuirErros(erro: unknown): ErrosDoFormulario {
  const { campos, gerais } = distribuirErrosDoServidor(erro, CAMPOS_CONHECIDOS)

  const porCampo: Partial<Record<CampoDoFormulario, string>> = {}
  for (const [chave, mensagem] of campos) {
    // a agenda não tem lista indexada: chave pontuada aqui é chave desconhecida
    if (CAMPOS_CONHECIDOS.has(chave)) {
      porCampo[chave as CampoDoFormulario] = mensagem
    } else {
      gerais.push(mensagem)
    }
  }

  return { porCampo, gerais }
}
