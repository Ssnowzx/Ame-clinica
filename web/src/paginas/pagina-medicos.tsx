import { useQuery } from '@tanstack/react-query'

import { TelaDeCatalogo } from '@/componentes/cadastro/tela-de-catalogo'
import { registroNoConselho } from '@/lib/conselho'
import { CampoSelect } from '@/componentes/ui/campo-select'
import { CampoTexto } from '@/componentes/ui/campo-texto'
import { chaves } from '@/lib/chaves-query'
import { medicos, type PayloadMedico } from '@/servicos/catalogos-de-apoio'
import { listarCbos } from '@/servicos/profissionais'
import type { Medico } from '@/tipos'

const CAMPOS = new Set(['nome', 'conselho', 'uf_conselho', 'num_conselho', 'cbos_id'])

/** As mesmas 27 do servidor (`MedicoRequest::UFS`) — o servidor recusa qualquer outra. */
const UFS = [
  'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT',
  'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO',
]

interface Valores {
  nome: string
  conselho: string
  uf_conselho: string
  num_conselho: string
  cbos_id: string
}

export function PaginaMedicos() {
  const catalogoCbos = useQuery({ queryKey: chaves.cbos(), queryFn: listarCbos })
  const porId = new Map((catalogoCbos.data ?? []).map((cbos) => [cbos.id, cbos]))

  return (
    <TelaDeCatalogo<Medico, PayloadMedico, Valores>
      titulo="Médicos solicitantes"
      modulo="medicos"
      rotuloSingular="médico"
      genero="m"
      chave={chaves.medicos()}
      listar={medicos.listar}
      recurso={medicos}
      campos={CAMPOS}
      colunas={[
        { cabecalho: 'Médico', celula: (medico) => medico.nome },
        {
          cabecalho: 'Conselho',
          celula: (medico) => registroNoConselho(medico) ?? '—',
        },
        {
          cabecalho: 'CBOS',
          celula: (medico) => {
            if (medico.cbos_id === null) return '—'
            const cbos = porId.get(medico.cbos_id)
            return cbos === undefined ? '—' : `${cbos.codigo} · ${cbos.nome}`
          },
        },
      ]}
      valoresIniciais={(medico) => ({
        nome: medico?.nome ?? '',
        conselho: medico?.conselho ?? 'CRM',
        uf_conselho: medico?.uf_conselho ?? 'SP',
        num_conselho: medico?.num_conselho ?? '',
        cbos_id: medico?.cbos_id === null || medico?.cbos_id === undefined ? '' : String(medico.cbos_id),
      })}
      paraPayload={(valores) => ({
        nome: valores.nome,
        conselho: valores.conselho,
        uf_conselho: valores.uf_conselho,
        num_conselho: valores.num_conselho,
        cbos_id: valores.cbos_id === '' ? null : Number(valores.cbos_id),
      })}
      nomeDoRegistro={(medico) => medico.nome}
      consequenciaDaExclusao="Se o médico já tiver sido indicado em agendamentos ou tratamentos, o sistema recusa a exclusão."
      vazioTitulo="Nenhum médico cadastrado"
      vazioDescricao="É quem encaminha o paciente — o agendamento pode registrar o médico solicitante."
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
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <CampoTexto
              rotulo="Conselho"
              obrigatorio
              value={valores.conselho}
              onChange={(evento) => {
                definir({ conselho: evento.target.value })
              }}
              ajuda="CRM, CRO…"
              erro={erros.campos.get('conselho')}
            />
            <CampoSelect
              rotulo="UF"
              obrigatorio
              value={valores.uf_conselho}
              onChange={(evento) => {
                definir({ uf_conselho: evento.target.value })
              }}
              opcoes={UFS.map((uf) => ({ valor: uf, rotulo: uf }))}
              erro={erros.campos.get('uf_conselho')}
            />
            <CampoTexto
              rotulo="Número"
              obrigatorio
              value={valores.num_conselho}
              onChange={(evento) => {
                definir({ num_conselho: evento.target.value })
              }}
              erro={erros.campos.get('num_conselho')}
            />
          </div>
          <CampoSelect
            rotulo="CBOS"
            value={valores.cbos_id}
            onChange={(evento) => {
              definir({ cbos_id: evento.target.value })
            }}
            opcoes={[
              { valor: '', rotulo: 'Sem CBOS' },
              ...(catalogoCbos.data ?? []).map((cbos) => ({
                valor: String(cbos.id),
                rotulo: `${cbos.codigo} · ${cbos.nome}`,
              })),
            ]}
            erro={erros.campos.get('cbos_id')}
          />
        </>
      )}
    />
  )
}
