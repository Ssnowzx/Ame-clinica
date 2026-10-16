import { TelaDeCatalogo } from '@/componentes/cadastro/tela-de-catalogo'
import { CampoCheckbox } from '@/componentes/ui/campo-checkbox'
import { CampoTexto } from '@/componentes/ui/campo-texto'
import { chaves } from '@/lib/chaves-query'
import { feriados, type PayloadFeriado } from '@/servicos/catalogos-de-apoio'
import type { Feriado } from '@/tipos'

const CAMPOS = new Set(['nome', 'data', 'recorrente', 'ativo'])

interface Valores {
  nome: string
  /** `Y-m-d` — é o que o `<input type="date">` já produz, e o que a API exige */
  data: string
  recorrente: boolean
  ativo: boolean
}

/** Exibe `Y-m-d` como `dd/mm/aaaa` sem construir Date (que introduziria fuso). */
function dataLegivel(data: string): string {
  const [ano, mes, dia] = data.split('-')
  return dia !== undefined ? `${dia}/${mes}/${ano}` : data
}

export function PaginaFeriados() {
  return (
    <TelaDeCatalogo<Feriado, PayloadFeriado, Valores>
      titulo="Feriados"
      modulo="feriados"
      rotuloSingular="feriado"
      genero="m"
      chave={chaves.feriados()}
      listar={feriados.listar}
      recurso={feriados}
      campos={CAMPOS}
      colunas={[
        { cabecalho: 'Feriado', celula: (feriado) => feriado.nome },
        { cabecalho: 'Data', celula: (feriado) => dataLegivel(feriado.data) },
        {
          cabecalho: 'Repete',
          celula: (feriado) => (feriado.recorrente ? 'Todo ano' : 'Só nesta data'),
        },
        { cabecalho: 'Situação', celula: (feriado) => (feriado.ativo ? 'Ativo' : 'Inativo') },
      ]}
      valoresIniciais={(feriado) => ({
        nome: feriado?.nome ?? '',
        data: feriado?.data ?? '',
        recorrente: feriado?.recorrente ?? false,
        ativo: feriado?.ativo ?? true,
      })}
      // o valor do <input type="date"> JÁ é `Y-m-d`: ele vai cru para a API.
      // Passar por `new Date()`/`toISOString()` introduziria fuso e sufixo — e é
      // exatamente esse o erro que fez todo consentimento levar 422 na change passada
      paraPayload={(valores) => ({
        nome: valores.nome,
        data: valores.data,
        recorrente: valores.recorrente,
        ativo: valores.ativo,
      })}
      nomeDoRegistro={(feriado) => `${feriado.nome} (${dataLegivel(feriado.data)})`}
      consequenciaDaExclusao="O dia volta a ser dia útil na grade da agenda."
      vazioTitulo="Nenhum feriado cadastrado"
      vazioDescricao="Dia não cadastrado é dia útil: a recepção conseguiria marcar num dia em que a clínica não abre."
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
            rotulo="Data"
            obrigatorio
            type="date"
            value={valores.data}
            onChange={(evento) => {
              definir({ data: evento.target.value })
            }}
            erro={erros.campos.get('data')}
          />
          <CampoCheckbox
            rotulo="Repete todo ano"
            marcado={valores.recorrente}
            aoMudar={(marcado) => {
              definir({ recorrente: marcado })
            }}
            ajuda="Para feriados de data fixa (Natal, Tiradentes). Deixe desmarcado para feriados móveis."
          />
          <CampoCheckbox
            rotulo="Ativo"
            marcado={valores.ativo}
            aoMudar={(marcado) => {
              definir({ ativo: marcado })
            }}
          />
        </>
      )}
    />
  )
}
