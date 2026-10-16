import { useQuery } from '@tanstack/react-query'

import { TelaDeCatalogo } from '@/componentes/cadastro/tela-de-catalogo'
import { CampoSelect } from '@/componentes/ui/campo-select'
import { CampoTexto } from '@/componentes/ui/campo-texto'
import { chaves } from '@/lib/chaves-query'
import { equipamentos, especialidades, type PayloadEquipamento } from '@/servicos/catalogos-de-apoio'
import type { Equipamento } from '@/tipos'

const CAMPOS = new Set(['nome', 'quantidade_total', 'especialidade_id'])

interface Valores {
  nome: string
  quantidade_total: string
  especialidade_id: string
}

export function PaginaEquipamentos() {
  const catalogo = useQuery({ queryKey: chaves.especialidades(), queryFn: especialidades.listar })
  const porId = new Map((catalogo.data ?? []).map((uma) => [uma.id, uma.nome]))

  return (
    <TelaDeCatalogo<Equipamento, PayloadEquipamento, Valores>
      titulo="Equipamentos"
      modulo="equipamentos"
      rotuloSingular="equipamento"
      genero="m"
      chave={chaves.equipamentos()}
      listar={equipamentos.listar}
      recurso={equipamentos}
      campos={CAMPOS}
      colunas={[
        { cabecalho: 'Equipamento', celula: (equipamento) => equipamento.nome },
        { cabecalho: 'Quantidade', celula: (equipamento) => equipamento.quantidade_total },
        {
          cabecalho: 'Especialidade',
          celula: (equipamento) =>
            equipamento.especialidade_id === null
              ? 'Qualquer uma'
              : (porId.get(equipamento.especialidade_id) ?? '—'),
        },
      ]}
      valoresIniciais={(equipamento) => ({
        nome: equipamento?.nome ?? '',
        quantidade_total: String(equipamento?.quantidade_total ?? 1),
        especialidade_id:
          equipamento?.especialidade_id === null || equipamento?.especialidade_id === undefined
            ? ''
            : String(equipamento.especialidade_id),
      })}
      paraPayload={(valores) => ({
        nome: valores.nome,
        quantidade_total: Number(valores.quantidade_total),
        especialidade_id: valores.especialidade_id === '' ? null : Number(valores.especialidade_id),
      })}
      nomeDoRegistro={(equipamento) => equipamento.nome}
      consequenciaDaExclusao="Se o equipamento estiver vinculado a agendamentos, o sistema recusa a exclusão."
      vazioTitulo="Nenhum equipamento cadastrado"
      vazioDescricao="A agenda usa a quantidade para não marcar dois atendimentos que disputem o mesmo equipamento."
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
          />
          <CampoTexto
            rotulo="Quantidade disponível"
            obrigatorio
            type="number"
            min={1}
            max={1000}
            value={valores.quantidade_total}
            onChange={(evento) => {
              definir({ quantidade_total: evento.target.value })
            }}
            erro={erros.campos.get('quantidade_total')}
          />
          <CampoSelect
            rotulo="Especialidade"
            value={valores.especialidade_id}
            onChange={(evento) => {
              definir({ especialidade_id: evento.target.value })
            }}
            opcoes={[
              { valor: '', rotulo: 'Qualquer uma' },
              ...(catalogo.data ?? []).map((uma) => ({
                valor: String(uma.id),
                rotulo: uma.nome,
              })),
            ]}
            ajuda="Deixe em branco se o equipamento serve a qualquer especialidade."
            erro={erros.campos.get('especialidade_id')}
          />
        </>
      )}
    />
  )
}
