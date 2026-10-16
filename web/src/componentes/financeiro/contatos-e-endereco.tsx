import { ListaDeContatos } from '@/componentes/pacientes/listas-do-paciente'
import { SecaoEndereco } from '@/componentes/pacientes/secoes-do-paciente'
import type { ReguaDoFormulario } from '@/hooks/usar-regua-do-cadastro'
import type { ErrosDoServidor } from '@/lib/erros'
import type { ContatoDoPaciente, EnderecoDoPaciente } from '@/tipos'

/**
 * Os tetos do servidor para contato e endereço (trait `ValidaContatosEEndereco`) — os MESMOS do
 * paciente. A tela os mostra antes do salvar, como no cadastro da criança: o formulário que aceita
 * o que o servidor recusa é o que faz a recepção perder um cadastro inteiro no último clique.
 */
const TETOS_DO_ENDERECO: Readonly<Record<string, number>> = {
  endereco_logradouro: 255,
  endereco_numero: 20,
  endereco_complemento: 100,
  endereco_bairro: 100,
  endereco_cidade: 100,
}

const TETO_DO_CONTATO = 255

/**
 * A régua dos cadastros de quem recebe da clínica: tudo visível, nada obrigatório. A régua
 * CONFIGURÁVEL é da ficha da criança (`campos-do-cadastro`); fornecedor e funcionário não têm uma,
 * e os campos de contato e endereço aqui são todos opcionais no servidor.
 */
const REGUA_ABERTA: ReguaDoFormulario = {
  dados: undefined,
  carregando: false,
  erro: false,
  recarregar: () => undefined,
  visivel: () => true,
  obrigatorio: () => false,
  limite: (campo) => TETOS_DO_ENDERECO[campo],
  limiteDoItem: () => TETO_DO_CONTATO,
  secaoVisivel: () => true,
  ocultos: [],
}

export interface ContatosEEnderecoProps {
  contatos: ContatoDoPaciente[]
  endereco: EnderecoDoPaciente
  aoMudarContatos: (contatos: ContatoDoPaciente[]) => void
  aoMudarEndereco: (mudanca: Partial<EnderecoDoPaciente>) => void
  erros: ErrosDoServidor
}

/**
 * Contatos e endereço de fornecedor e funcionário — as MESMAS peças da ficha da criança, CEP que
 * preenche o endereço inclusive. Uma segunda lista de contatos divergiria da primeira no detalhe
 * que importa: a recusa por índice (`contatos_json.2.valor`) pousando no item certo.
 */
export function ContatosEEndereco({
  contatos,
  endereco,
  aoMudarContatos,
  aoMudarEndereco,
  erros,
}: ContatosEEnderecoProps) {
  return (
    <>
      <ListaDeContatos
        contatos={contatos}
        aoMudar={aoMudarContatos}
        erros={erros}
        limiteDoItem={() => TETO_DO_CONTATO}
      />
      <SecaoEndereco
        dados={endereco}
        aoMudar={aoMudarEndereco}
        erros={erros}
        somenteLeitura={false}
        regua={REGUA_ABERTA}
      />
    </>
  )
}

