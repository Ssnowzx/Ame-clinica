import type { CamposDoInteressadoProps } from '@/componentes/financeiro/modulo-de-interessado'
import type { ContatoDoPaciente, EnderecoDoPaciente } from '@/tipos'

import { ContatosEEndereco } from '@/componentes/financeiro/contatos-e-endereco'
import { CampoCheckbox } from '@/componentes/ui/campo-checkbox'
import { CampoTexto } from '@/componentes/ui/campo-texto'
import { formatarCpf } from '@/lib/pacientes'

/** O formulário do funcionário em strings de formulário (CPF em dígitos; nascimento `Y-m-d`). */
export interface ValoresDoFuncionario {
  nome: string
  funcao: string
  cpf: string
  nascimento: string
  ativo: boolean
  contatos: ContatoDoPaciente[]
  endereco: EnderecoDoPaciente
}

/**
 * Os campos do funcionário — na tela de Funcionários (cheio) e no cadastro rápido do lançamento
 * (curto: nome e função). O MESMO componente nos dois (design D5).
 */
export function CamposDoFuncionario({ valores, definir, erros, curto }: CamposDoInteressadoProps<ValoresDoFuncionario>) {
  const erroDe = (campo: string): string | undefined => erros.campos.get(campo)

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <CampoTexto
          rotulo="Nome"
          obrigatorio
          limite={255}
          value={valores.nome}
          onChange={(evento) => {
            definir({ nome: evento.target.value })
          }}
          erro={erroDe('nome')}
        />
        <CampoTexto
          rotulo="Função"
          obrigatorio
          limite={100}
          value={valores.funcao}
          onChange={(evento) => {
            definir({ funcao: evento.target.value })
          }}
          ajuda="Recepcionista, auxiliar administrativo, limpeza."
          erro={erroDe('funcao')}
        />
      </div>

      {curto ? null : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <CampoTexto
              rotulo="CPF"
              inputMode="numeric"
              autoComplete="off"
              value={formatarCpf(valores.cpf)}
              onChange={(evento) => {
                definir({ cpf: evento.target.value.replace(/\D/g, '').slice(0, 11) })
              }}
              ajuda="Opcional. Vai no recibo; não aparece na lista."
              erro={erroDe('cpf')}
            />
            <CampoTexto
              rotulo="Nascimento"
              type="date"
              value={valores.nascimento}
              onChange={(evento) => {
                definir({ nascimento: evento.target.value })
              }}
              ajuda="Opcional."
              erro={erroDe('nascimento')}
            />
          </div>
          <CampoCheckbox
            rotulo="Ativo"
            marcado={valores.ativo}
            aoMudar={(marcado) => {
              definir({ ativo: marcado })
            }}
            ajuda="Inativo continua no histórico dos lançamentos que já tem."
            erro={erroDe('ativo')}
          />
          <ContatosEEndereco
            contatos={valores.contatos}
            endereco={valores.endereco}
            aoMudarContatos={(contatos) => {
              definir({ contatos })
            }}
            aoMudarEndereco={(mudanca) => {
              // o CEP responde DEPOIS: o endereço é somado ao estado de agora, não ao da tecla
              definir((anteriores) => ({ endereco: { ...anteriores.endereco, ...mudanca } }))
            }}
            erros={erros}
          />
        </>
      )}
    </>
  )
}
