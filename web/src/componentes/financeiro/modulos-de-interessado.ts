import type { ValoresDoFornecedor } from '@/componentes/financeiro/campos-do-fornecedor'
import type { ValoresDoFuncionario } from '@/componentes/financeiro/campos-do-funcionario'
import type { ModuloDeInteressado } from '@/componentes/financeiro/modulo-de-interessado'
import type {
  ContatoDoPaciente,
  EnderecoDoPaciente,
  Fornecedor,
  FornecedorDaLista,
  Funcionario,
  FuncionarioDaLista,
  PayloadFornecedor,
  PayloadFuncionario,
} from '@/tipos'

import { CamposDoFornecedor } from '@/componentes/financeiro/campos-do-fornecedor'
import { CamposDoFuncionario } from '@/componentes/financeiro/campos-do-funcionario'
import { chaves } from '@/lib/chaves-query'
import { fornecedores, funcionarios } from '@/servicos/financeiro'

/** Campo vazio viaja `null`, nunca `""` (o servidor aceita nulo, não string vazia). */
function textoOuNulo(valor: string): string | null {
  const limpo = valor.trim()
  return limpo === '' ? null : limpo
}

function idOuNulo(valor: string): number | null {
  return valor === '' ? null : Number(valor)
}

function idDoFormulario(valor: number | null | undefined): string {
  return valor === null || valor === undefined ? '' : String(valor)
}

const CHAVES_DO_ENDERECO = ['cep', 'logradouro', 'numero', 'complemento', 'bairro', 'cidade', 'uf'] as const

/** O endereço do corpo: campo vazio viaja `null`; endereço todo vazio é `null` inteiro. */
function enderecoDoPayload(endereco: EnderecoDoPaciente): EnderecoDoPaciente | null {
  const limpo: EnderecoDoPaciente = {}
  for (const chave of CHAVES_DO_ENDERECO) {
    limpo[chave] = textoOuNulo(endereco[chave] ?? '')
  }
  return CHAVES_DO_ENDERECO.every((chave) => limpo[chave] === null) ? null : limpo
}

/** Os contatos do corpo — só as três chaves da whitelist do servidor (chave extra é 422). */
function contatosDoPayload(contatos: readonly ContatoDoPaciente[]): ContatoDoPaciente[] {
  return contatos.map((contato) => ({
    tipo: contato.tipo,
    valor: contato.valor.trim(),
    obs: textoOuNulo(contato.obs ?? ''),
  }))
}

/**
 * Fornecedores (§9): a quem a clínica paga por material, aluguel e serviço. A frase de "o que é"
 * mora aqui, uma vez, e aparece na tela, no formulário e no cadastro rápido (design D8).
 */
export const FORNECEDORES: ModuloDeInteressado<FornecedorDaLista, Fornecedor, PayloadFornecedor, ValoresDoFornecedor> = {
  modulo: 'fornecedores',
  titulo: 'Fornecedores',
  rotuloSingular: 'fornecedor',
  genero: 'm',
  explicacao:
    'As empresas e pessoas a quem a clínica paga: aluguel, material, serviços. Cada uma pode ser escolhida como interessado de uma despesa no financeiro.',
  servico: fornecedores,
  chave: chaves.fornecedores,
  // `fornecedor` (a recusa da exclusão) fica FORA: não é campo, cai no aviso geral
  campos: new Set([
    'razao_social',
    'nome_fantasia',
    'cpf_cnpj',
    'categoria_id',
    'subcategoria_id',
    'centro_custo',
    'ativo',
    'contatos_json',
    'endereco_json',
  ]),
  valoresIniciais: (fornecedor, nomeSugerido = '') => ({
    razao_social: fornecedor?.razao_social ?? nomeSugerido,
    nome_fantasia: fornecedor?.nome_fantasia ?? '',
    cpf_cnpj: fornecedor?.cpf_cnpj ?? '',
    categoria_id: idDoFormulario(fornecedor?.categoria_id),
    subcategoria_id: idDoFormulario(fornecedor?.subcategoria_id),
    centro_custo: fornecedor?.centro_custo ?? '',
    ativo: fornecedor?.ativo ?? true,
    contatos: fornecedor?.contatos_json ?? [],
    endereco: fornecedor?.endereco_json ?? {},
  }),
  paraPayload: (valores, curto) => ({
    razao_social: valores.razao_social.trim(),
    nome_fantasia: textoOuNulo(valores.nome_fantasia),
    cpf_cnpj: valores.cpf_cnpj === '' ? null : valores.cpf_cnpj,
    categoria_id: idOuNulo(valores.categoria_id),
    subcategoria_id: idOuNulo(valores.subcategoria_id),
    centro_custo: textoOuNulo(valores.centro_custo),
    ativo: valores.ativo,
    ...(curto
      ? {}
      : { contatos_json: contatosDoPayload(valores.contatos), endereco_json: enderecoDoPayload(valores.endereco) }),
  }),
  nomeDaLinha: (fornecedor) => fornecedor.razao_social,
  nomeDoDetalhe: (fornecedor) => fornecedor.razao_social,
  comoInteressado: (fornecedor) => ({
    tipo: 'fornecedor',
    id: fornecedor.id,
    nome: fornecedor.razao_social,
    categoria_id: fornecedor.categoria_id,
    subcategoria_id: fornecedor.subcategoria_id,
  }),
  Campos: CamposDoFornecedor,
}

/**
 * Funcionários (§9): quem trabalha na clínica e recebe dela. NÃO é login — é o registro de a quem
 * o salário vai; quem opera o sistema é cadastrado em Usuários.
 */
export const FUNCIONARIOS: ModuloDeInteressado<FuncionarioDaLista, Funcionario, PayloadFuncionario, ValoresDoFuncionario> = {
  modulo: 'funcionarios',
  titulo: 'Funcionários',
  rotuloSingular: 'funcionário',
  genero: 'm',
  explicacao:
    'Quem trabalha na clínica e recebe dela: salário, vale, comissão. Cada um pode ser escolhido como interessado de uma despesa no financeiro. Não é acesso ao sistema — esse se cadastra em Usuários.',
  servico: funcionarios,
  chave: chaves.funcionarios,
  // `funcionario` (a recusa da exclusão) fica FORA: não é campo, cai no aviso geral
  campos: new Set(['nome', 'funcao', 'cpf', 'nascimento', 'ativo', 'contatos_json', 'endereco_json']),
  valoresIniciais: (funcionario, nomeSugerido = '') => ({
    nome: funcionario?.nome ?? nomeSugerido,
    funcao: funcionario?.funcao ?? '',
    cpf: funcionario?.cpf ?? '',
    nascimento: funcionario?.nascimento ?? '',
    ativo: funcionario?.ativo ?? true,
    contatos: funcionario?.contatos_json ?? [],
    endereco: funcionario?.endereco_json ?? {},
  }),
  paraPayload: (valores, curto) => ({
    nome: valores.nome.trim(),
    funcao: valores.funcao.trim(),
    cpf: valores.cpf === '' ? null : valores.cpf,
    nascimento: valores.nascimento === '' ? null : valores.nascimento,
    ativo: valores.ativo,
    ...(curto
      ? {}
      : { contatos_json: contatosDoPayload(valores.contatos), endereco_json: enderecoDoPayload(valores.endereco) }),
  }),
  nomeDaLinha: (funcionario) => funcionario.nome,
  nomeDoDetalhe: (funcionario) => funcionario.nome,
  comoInteressado: (funcionario) => ({ tipo: 'funcionario', id: funcionario.id, nome: funcionario.nome }),
  Campos: CamposDoFuncionario,
}
