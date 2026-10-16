import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import type { CamposDoInteressadoProps } from '@/componentes/financeiro/modulo-de-interessado'
import type { ContatoDoPaciente, EnderecoDoPaciente } from '@/tipos'

import { ContatosEEndereco } from '@/componentes/financeiro/contatos-e-endereco'
import { CampoCheckbox } from '@/componentes/ui/campo-checkbox'
import { CampoSelect } from '@/componentes/ui/campo-select'
import { CampoTexto } from '@/componentes/ui/campo-texto'
import { chaves } from '@/lib/chaves-query'
import { digitosDoDocumento, formatarCpfOuCnpj } from '@/lib/documento-fiscal'
import { TEMPO_CATALOGO_MS } from '@/lib/query-client'
import { listarCategorias } from '@/servicos/financeiro'
import { useAuthStore } from '@/stores/auth-store'

/** O formulário do fornecedor em strings de formulário (select vazio = `''`; documento em dígitos). */
export interface ValoresDoFornecedor {
  razao_social: string
  nome_fantasia: string
  cpf_cnpj: string
  categoria_id: string
  subcategoria_id: string
  centro_custo: string
  ativo: boolean
  contatos: ContatoDoPaciente[]
  endereco: EnderecoDoPaciente
}

/**
 * Os campos do fornecedor — na tela de Fornecedores (cheio) e no cadastro rápido do lançamento
 * (curto: razão social, documento e categoria padrão). O MESMO componente nos dois (design D5).
 *
 * A categoria padrão só oferece categorias de DESPESA: é para a despesa que ela preenche a
 * categoria (design D6), e uma receita padrão nunca seria usada. A que já estiver gravada continua
 * na lista, mesmo que não seja de despesa — o formulário não a apaga por não reconhecê-la.
 */
export function CamposDoFornecedor({ valores, definir, erros, curto }: CamposDoInteressadoProps<ValoresDoFornecedor>) {
  const podeVerCategorias = useAuthStore((estado) => estado.temPermissao('categorias.ver'))
  const categorias = useQuery({
    queryKey: chaves.categorias(),
    queryFn: listarCategorias,
    staleTime: TEMPO_CATALOGO_MS,
    enabled: podeVerCategorias,
  })
  const deDespesa = useMemo(
    () =>
      (categorias.data ?? []).filter(
        (categoria) => categoria.tipo === 'despesa' || String(categoria.id) === valores.categoria_id,
      ),
    [categorias.data, valores.categoria_id],
  )
  const escolhida = deDespesa.find((categoria) => String(categoria.id) === valores.categoria_id)
  const erroDe = (campo: string): string | undefined => erros.campos.get(campo)

  const campoDocumento = (
    <CampoTexto
      rotulo="CPF ou CNPJ"
      inputMode="numeric"
      autoComplete="off"
      value={formatarCpfOuCnpj(valores.cpf_cnpj)}
      onChange={(evento) => {
        definir({ cpf_cnpj: digitosDoDocumento(evento.target.value) })
      }}
      ajuda="Opcional. Vai no recibo; não aparece na lista."
      erro={erroDe('cpf_cnpj')}
    />
  )

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <CampoTexto
          rotulo="Razão social"
          obrigatorio
          limite={255}
          value={valores.razao_social}
          onChange={(evento) => {
            definir({ razao_social: evento.target.value })
          }}
          ajuda="Como está na nota ou no contrato."
          erro={erroDe('razao_social')}
        />
        {curto ? (
          campoDocumento
        ) : (
          <CampoTexto
            rotulo="Nome fantasia"
            limite={255}
            value={valores.nome_fantasia}
            onChange={(evento) => {
              definir({ nome_fantasia: evento.target.value })
            }}
            ajuda="Opcional. O nome pelo qual a equipe conhece."
            erro={erroDe('nome_fantasia')}
          />
        )}
      </div>

      {curto ? null : (
        <div className="grid gap-4 sm:grid-cols-2">
          {campoDocumento}
          <CampoTexto
            rotulo="Centro de custo"
            limite={100}
            value={valores.centro_custo}
            onChange={(evento) => {
              definir({ centro_custo: evento.target.value })
            }}
            ajuda="Opcional. Se o contador separa as despesas por setor."
            erro={erroDe('centro_custo')}
          />
        </div>
      )}

      {/* sem `categorias.ver` o par some: um seletor vazio e mudo não explica nada. O que já está
          gravado continua no estado do formulário e volta igual no corpo — nada se perde */}
      {podeVerCategorias ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <CampoSelect
            rotulo="Categoria padrão"
            value={valores.categoria_id}
            onChange={(evento) => {
              definir({ categoria_id: evento.target.value, subcategoria_id: '' })
            }}
            opcoes={[
              { valor: '', rotulo: 'Nenhuma' },
              ...deDespesa.map((categoria) => ({ valor: String(categoria.id), rotulo: categoria.nome })),
            ]}
            ajuda="Opcional. Preenche a categoria da despesa quando este fornecedor é escolhido; no lançamento, dá para trocar."
            erro={erroDe('categoria_id')}
          />
          <CampoSelect
            rotulo="Subcategoria padrão"
            value={valores.subcategoria_id}
            onChange={(evento) => {
              definir({ subcategoria_id: evento.target.value })
            }}
            opcoes={[
              { valor: '', rotulo: 'Nenhuma' },
              ...(escolhida?.subcategorias ?? []).map((subcategoria) => ({
                valor: String(subcategoria.id),
                rotulo: subcategoria.nome,
              })),
            ]}
            erro={erroDe('subcategoria_id')}
          />
        </div>
      ) : null}

      {curto ? null : (
        <>
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
