import { TelaDeCatalogo } from '@/componentes/cadastro/tela-de-catalogo'
import { CampoCheckbox } from '@/componentes/ui/campo-checkbox'
import { CampoCor } from '@/componentes/ui/campo-cor'
import { CampoTexto } from '@/componentes/ui/campo-texto'
import { MarcadorEspecialidade } from '@/componentes/ui/marcador-especialidade'
import { chaves } from '@/lib/chaves-query'
import { COR_DE_RESERVA } from '@/lib/cor-status'
import { especialidades, type PayloadEspecialidade } from '@/servicos/catalogos-de-apoio'
import type { Especialidade } from '@/tipos'

/** Só os campos do FORMULÁRIO — a chave da entidade (`especialidade`) fica fora. */
const CAMPOS = new Set(['nome', 'tempo_sessao', 'cor', 'exige_termo', 'oculta_agendamento_online'])

interface Valores {
  nome: string
  tempo_sessao: string
  cor: string
  exige_termo: boolean
  oculta_agendamento_online: boolean
}

export function PaginaEspecialidades() {
  return (
    <TelaDeCatalogo<Especialidade, PayloadEspecialidade, Valores>
      titulo="Especialidades"
      modulo="especialidades"
      rotuloSingular="especialidade"
      genero="f"
      chave={chaves.especialidades()}
      listar={especialidades.listar}
      recurso={especialidades}
      campos={CAMPOS}
      colunas={[
        {
          cabecalho: 'Especialidade',
          // a cor é MARCADOR, nunca preenchimento — e o nome vem sempre em texto
          // ao lado dela (§2: cor jamais é o único canal)
          celula: (especialidade) => (
            <span className="flex items-stretch gap-2">
              <MarcadorEspecialidade cor={especialidade.cor} />
              <span className="text-corpo text-texto">{especialidade.nome}</span>
            </span>
          ),
        },
        {
          cabecalho: 'Sessão',
          celula: (especialidade) => `${especialidade.tempo_sessao} min`,
        },
        {
          cabecalho: 'Termo',
          celula: (especialidade) => (especialidade.exige_termo ? 'Exige termo' : '—'),
        },
      ]}
      valoresIniciais={(especialidade) => ({
        nome: especialidade?.nome ?? '',
        tempo_sessao: String(especialidade?.tempo_sessao ?? 40),
        cor: especialidade?.cor ?? COR_DE_RESERVA,
        exige_termo: especialidade?.exige_termo ?? false,
        oculta_agendamento_online: especialidade?.oculta_agendamento_online ?? false,
      })}
      paraPayload={(valores) => ({
        nome: valores.nome,
        tempo_sessao: Number(valores.tempo_sessao),
        cor: valores.cor,
        exige_termo: valores.exige_termo,
        oculta_agendamento_online: valores.oculta_agendamento_online,
      })}
      nomeDoRegistro={(especialidade) => especialidade.nome}
      consequenciaDaExclusao="Se a especialidade estiver vinculada a profissionais, tratamentos ou agendamentos, o sistema recusa a exclusão."
      vazioTitulo="Nenhuma especialidade cadastrada"
      vazioDescricao="A especialidade define a duração padrão da sessão e a cor do marcador na grade."
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
            rotulo="Tempo de sessão (min)"
            obrigatorio
            type="number"
            min={5}
            max={480}
            value={valores.tempo_sessao}
            onChange={(evento) => {
              definir({ tempo_sessao: evento.target.value })
            }}
            ajuda="É a duração que o agendamento desta especialidade recebe por padrão."
            erro={erros.campos.get('tempo_sessao')}
          />

          <CampoCor
            rotulo="Cor do marcador"
            obrigatorio
            valor={valores.cor}
            aoMudar={(cor) => {
              definir({ cor })
            }}
            ajuda="Aparece como um fio fino no card da agenda — o nome vem sempre em texto ao lado."
            erro={erros.campos.get('cor')}
          />

          <CampoCheckbox
            rotulo="Exige termo de consentimento"
            marcado={valores.exige_termo}
            aoMudar={(marcado) => {
              definir({ exige_termo: marcado })
            }}
          />

          <CampoCheckbox
            rotulo="Ocultar do agendamento online"
            marcado={valores.oculta_agendamento_online}
            aoMudar={(marcado) => {
              definir({ oculta_agendamento_online: marcado })
            }}
          />
        </>
      )}
    />
  )
}
