import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { CampoBusca } from '@/componentes/ui/campo-busca'
import { usarEscolhaDePacienteDoCadastro } from '@/hooks/usar-escolha-de-paciente-do-cadastro'

interface BuscaDeOutroPacienteProps {
  /** a seção ativa viaja na navegação — trocar de paciente a mantém (spec) */
  secaoAtiva: string
  /** quem já está na tela — "OUTRO paciente" não oferece o próprio */
  pacienteAberto: number
}

/**
 * "Pesquisar outro paciente" do cabeçalho da ficha — combobox sobre a listagem
 * de pacientes (mesma superfície da tela de pacientes). Abre com a lista, que rola
 * para carregar mais, e filtra ao digitar (o termo é o nome de um menor: mínimo de
 * 2 caracteres, como o resto do produto). Escolher navega para a ficha do paciente
 * MANTENDO a seção ativa.
 */
export function BuscaDeOutroPaciente({ secaoAtiva, pacienteAberto }: BuscaDeOutroPacienteProps) {
  const navigate = useNavigate()
  const [termo, setTermo] = useState('')

  // Só consulta DEPOIS que alguém abre a caixa. Com `aberto: true` fixo, montar a ficha de
  // uma criança puxava o cadastro de outras 50 — com `nascimento` e `necessidade`, que são
  // dado de saúde (art. 11) — sem que ninguém tivesse pedido para escolher (achado CR-BPL-02).
  const [aberto, setAberto] = useState(false)
  // `exceto`: a lista aberta tornou visível o que a busca escondia — o campo se chama
  // "pesquisar OUTRO paciente" e oferecia o próprio, que só navega de volta para esta tela
  const pacientes = usarEscolhaDePacienteDoCadastro({ aberto, termo, exceto: pacienteAberto })

  return (
    <CampoBusca
      rotulo="Pesquisar outro paciente"
      selecionado={null}
      termo={termo}
      aoDigitar={setTermo}
      aoAbrir={() => {
        setAberto(true)
      }}
      // este campo é um "ir para", não um "escolher e guardar": o nome não fica
      limparAoEscolher
      opcoes={pacientes.opcoes}
      carregando={pacientes.carregando}
      falhou={pacientes.falhou}
      carregandoMais={pacientes.carregandoMais}
      aoAproximarDoFim={pacientes.aoAproximarDoFim}
      placeholder="Buscar ou escolher…"
      className="w-full sm:w-72"
      aoSelecionar={(opcao) => {
        if (opcao !== null) {
          navigate(`/pacientes/${opcao.valor}/${secaoAtiva}`)
        }
      }}
    />
  )
}
