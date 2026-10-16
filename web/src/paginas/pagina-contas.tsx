import { TelaDeCatalogo } from '@/componentes/cadastro/tela-de-catalogo'
import { CampoCheckbox } from '@/componentes/ui/campo-checkbox'
import { CampoTexto } from '@/componentes/ui/campo-texto'
import { chaves } from '@/lib/chaves-query'
import { contas } from '@/servicos/financeiro'
import type { ContaFinanceira, PayloadConta } from '@/tipos'

const CAMPOS = new Set(['nome', 'codigo_contabil', 'ativo'])

interface Valores {
  nome: string
  codigo_contabil: string
  ativo: boolean
}

/**
 * Onde o dinheiro da clínica entra e sai (§9). Sem ao menos uma conta não existe
 * lançamento possível: tanto o formulário de caixa quanto o "Faturar sessão" da
 * agenda a exigem.
 */
export function PaginaContas() {
  return (
    <TelaDeCatalogo<ContaFinanceira, PayloadConta, Valores>
      titulo="Contas"
      modulo="contas"
      rotuloSingular="conta"
      genero="f"
      chave={chaves.contas()}
      listar={contas.listar}
      recurso={contas}
      campos={CAMPOS}
      colunas={[
        { cabecalho: 'Conta', celula: (conta) => conta.nome },
        {
          cabecalho: 'Código contábil',
          celula: (conta) => conta.codigo_contabil ?? '—',
        },
        { cabecalho: 'Situação', celula: (conta) => (conta.ativo ? 'Ativa' : 'Inativa') },
      ]}
      valoresIniciais={(conta) => ({
        nome: conta?.nome ?? '',
        codigo_contabil: conta?.codigo_contabil ?? '',
        ativo: conta?.ativo ?? true,
      })}
      paraPayload={(valores) => ({
        nome: valores.nome,
        // '' não é código contábil nenhum — o servidor aceita nulo, não string vazia
        codigo_contabil: valores.codigo_contabil.trim() === '' ? null : valores.codigo_contabil,
        ativo: valores.ativo,
      })}
      nomeDoRegistro={(conta) => conta.nome}
      // conta que já recebeu dinheiro não sai do histórico: a saída honesta é desativar
      consequenciaDaExclusao="Se a conta já tiver lançamentos, cartões ou transferências, o sistema recusa a exclusão — nesse caso, desative-a."
      vazioTitulo="Nenhuma conta cadastrada"
      vazioDescricao="Sem conta não é possível lançar nada no financeiro: cadastre pelo menos o caixa da recepção."
      formulario={({ valores, definir, erros }) => (
        <>
          <CampoTexto
            rotulo="Nome"
            obrigatorio
            value={valores.nome}
            onChange={(evento) => {
              definir({ nome: evento.target.value })
            }}
            erro={erros.campos.get('nome')}
            ajuda="Como a equipe chama esse dinheiro: Caixa, Banco do Brasil, Cofre."
          />
          <CampoTexto
            rotulo="Código contábil"
            value={valores.codigo_contabil}
            onChange={(evento) => {
              definir({ codigo_contabil: evento.target.value })
            }}
            erro={erros.campos.get('codigo_contabil')}
            ajuda="Opcional. O código que o contador usa para esta conta."
          />
          <CampoCheckbox
            rotulo="Ativa"
            marcado={valores.ativo}
            aoMudar={(marcado) => {
              definir({ ativo: marcado })
            }}
            ajuda="Conta inativa continua no histórico dos lançamentos antigos."
          />
        </>
      )}
    />
  )
}
