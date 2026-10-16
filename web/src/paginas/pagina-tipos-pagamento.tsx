import { TelaDeCatalogo } from '@/componentes/cadastro/tela-de-catalogo'
import { CampoTexto } from '@/componentes/ui/campo-texto'
import { chaves } from '@/lib/chaves-query'
import { tiposPagamento } from '@/servicos/financeiro'
import type { PayloadTipoPagamento, TipoDePagamento } from '@/tipos'

const CAMPOS = new Set(['nome'])

interface Valores {
  nome: string
}

/**
 * Como a família paga (§9). É DADO da clínica, nunca enum de código: uma clínica que
 * aceite permuta ou cortesia cadastra a sua forma sem pedir versão nova do sistema.
 */
export function PaginaTiposPagamento() {
  return (
    <TelaDeCatalogo<TipoDePagamento, PayloadTipoPagamento, Valores>
      titulo="Formas de pagamento"
      modulo="tipos_pagamento"
      rotuloSingular="forma de pagamento"
      genero="f"
      chave={chaves.tiposPagamento()}
      listar={tiposPagamento.listar}
      recurso={tiposPagamento}
      campos={CAMPOS}
      colunas={[{ cabecalho: 'Forma de pagamento', celula: (tipo) => tipo.nome }]}
      valoresIniciais={(tipo) => ({ nome: tipo?.nome ?? '' })}
      paraPayload={(valores) => ({ nome: valores.nome })}
      nomeDoRegistro={(tipo) => tipo.nome}
      consequenciaDaExclusao="Se a forma de pagamento já tiver sido usada em algum lançamento, o sistema recusa a exclusão."
      vazioTitulo="Nenhuma forma de pagamento cadastrada"
      vazioDescricao="Sem forma de pagamento não é possível lançar nada: cadastre Dinheiro, PIX e as demais que a clínica aceita."
      formulario={({ valores, definir, erros }) => (
        <CampoTexto
          rotulo="Nome"
          obrigatorio
          value={valores.nome}
          onChange={(evento) => {
            definir({ nome: evento.target.value })
          }}
          erro={erros.campos.get('nome')}
          ajuda="Dinheiro, PIX, Cartão de crédito, Transferência, Permuta, Cortesia."
        />
      )}
    />
  )
}
