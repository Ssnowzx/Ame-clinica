import { TelaDeCatalogo } from '@/componentes/cadastro/tela-de-catalogo'
import { CampoCheckbox } from '@/componentes/ui/campo-checkbox'
import { CampoTexto } from '@/componentes/ui/campo-texto'
import { chaves } from '@/lib/chaves-query'
import { salas, type PayloadSala } from '@/servicos/catalogos-de-apoio'
import type { Sala } from '@/tipos'

const CAMPOS = new Set(['nome', 'capacidade', 'ativo'])

interface Valores {
  nome: string
  /** string porque o campo é um `<input type="number">`: o vazio tem de sobreviver à digitação */
  capacidade: string
  ativo: boolean
}

/**
 * A capacidade que o payload leva. Campo vazio (ou zero, ou lixo) ⇒ **1**, o default do cadastro
 * e a posição segura: mandar `NaN` faria o servidor recusar com uma mensagem sobre tipo, e quem
 * apagou o número queria "uma por vez", não um erro. Acima do teto segue cru para o servidor —
 * a faixa mora lá, e a tela não mantém uma verdade paralela (§13).
 */
function capacidadeDoFormulario(valor: string): number {
  const numero = Number.parseInt(valor, 10)
  return Number.isFinite(numero) && numero >= 1 ? numero : 1
}

export function PaginaSalas() {
  return (
    <TelaDeCatalogo<Sala, PayloadSala, Valores>
      titulo="Salas"
      modulo="salas"
      rotuloSingular="sala"
      genero="f"
      chave={chaves.salas()}
      listar={salas.listar}
      recurso={salas}
      campos={CAMPOS}
      colunas={[
        { cabecalho: 'Sala', celula: (sala) => sala.nome },
        {
          // capacidade 1 é o padrão de todas: dizê-lo em toda linha é ruído que esconde a
          // única informação que a linha tem a dar — qual sala é a do grupo
          cabecalho: 'Ao mesmo tempo',
          celula: (sala) => (sala.capacidade > 1 ? `${sala.capacidade} atendimentos` : '—'),
        },
        { cabecalho: 'Situação', celula: (sala) => (sala.ativo ? 'Ativa' : 'Inativa') },
      ]}
      valoresIniciais={(sala) => ({
        nome: sala?.nome ?? '',
        capacidade: String(sala?.capacidade ?? 1),
        ativo: sala?.ativo ?? true,
      })}
      paraPayload={(valores) => ({
        nome: valores.nome,
        capacidade: capacidadeDoFormulario(valores.capacidade),
        ativo: valores.ativo,
      })}
      nomeDoRegistro={(sala) => sala.nome}
      // A capacidade é REGRA, não preferência: ela decide o que a agenda ACEITA. E a
      // confirmação não pode prometer o que não faz — baixar o número NÃO desmarca ninguém,
      // só recusa as marcações novas.
      consequenciasDaRegra={(valores, original) => {
        const nova = capacidadeDoFormulario(valores.capacidade)
        if (original === undefined || nova === original.capacidade) {
          return []
        }
        return [
          nova > 1
            ? `A sala "${original.nome}" passa a aceitar ${nova} atendimentos no mesmo horário. Os agendamentos já marcados não mudam.`
            : `A sala "${original.nome}" volta a aceitar um atendimento por horário. Os agendamentos já marcados continuam de pé; só as marcações novas passam a ser recusadas.`,
        ]
      }}
      // a saída honesta para uma sala que já foi usada é DESATIVAR: excluir o
      // histórico não é possível, e o servidor recusa
      consequenciaDaExclusao="Se a sala já tiver agendamentos, o sistema recusa a exclusão — nesse caso, desative-a."
      vazioTitulo="Nenhuma sala cadastrada"
      vazioDescricao="A agenda controla quantos atendimentos cabem na mesma sala e horário."
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
          {/* REGRA de agenda (change atendimento-em-grupo): o atendimento em grupo da clínica
              acontece na MESMA sala, e sem este número o eixo da sala recusaria o grupo que o
              profissional já aceita. */}
          <CampoTexto
            rotulo="Quantos cabem ao mesmo tempo"
            type="number"
            min={1}
            max={20}
            value={valores.capacidade}
            onChange={(evento) => {
              definir({ capacidade: evento.target.value })
            }}
            ajuda="Quantos atendimentos a agenda aceita nesta sala no mesmo horário. Deixe 1 — ou em branco — para uma criança por vez."
            erro={erros.campos.get('capacidade')}
          />
          <CampoCheckbox
            rotulo="Ativa"
            marcado={valores.ativo}
            aoMudar={(marcado) => {
              definir({ ativo: marcado })
            }}
            ajuda="Sala inativa não pode ser escolhida em novos agendamentos."
          />
        </>
      )}
    />
  )
}
