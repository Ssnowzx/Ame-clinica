import { useState } from 'react'

import { Botao } from '@/componentes/ui/botao'
import { CampoTexto } from '@/componentes/ui/campo-texto'
import { Dialog } from '@/componentes/ui/dialog'
import { EstadoVazio } from '@/componentes/ui/estado-vazio'
import { Skeleton } from '@/componentes/ui/skeleton'
import { usarEscolhaDePacienteDoCadastro } from '@/hooks/usar-escolha-de-paciente-do-cadastro'

/**
 * Vincular a conversa a um paciente (change mensageria-whatsapp).
 *
 * É o caminho manual para quando o sistema se RECUSOU a adivinhar — dois irmãos no mesmo
 * telefone, o caso comum de clínica infantil. Antes isto era um link para
 * `/pacientes?vincular=<id>`, e ninguém lia esse parâmetro: a recepção caía na lista de
 * pacientes sem contexto, sem ação e sem volta (achado do gate de design).
 *
 * O termo da busca NÃO vai para a URL: nome de menor não entra em histórico nem em Referer.
 */
export function VincularPaciente({
  aberto,
  aoFechar,
  aoVincular,
  vinculando,
  focoAoFechar,
}: {
  aberto: boolean
  aoFechar: () => void
  aoVincular: (pacienteId: number) => void
  vinculando: boolean
  /**
   * Destino do foco ao fechar, quando quem abriu já não existe — o item do "Mais ações" do
   * celular sai da árvore junto com o menu. `null` devolve ao elemento que abriu (o padrão).
   */
  focoAoFechar?: () => HTMLElement | null
}) {
  const [busca, setBusca] = useState('')
  const termo = busca.trim()

  // abre com a lista dos ativos e filtra ao digitar — o mesmo comportamento das outras
  // caixas de paciente do produto (change busca-de-paciente-com-lista)
  const pacientes = usarEscolhaDePacienteDoCadastro({ aberto, termo })

  return (
    <Dialog
      aberto={aberto}
      aoMudarAberto={(estado) => {
        if (!estado) {
          setBusca('')
          aoFechar()
        }
      }}
      titulo="Vincular a um paciente"
      descricao="Busque pelo nome da criança para ligar esta conversa ao cadastro dela."
      focoAoFechar={focoAoFechar}
    >
      <div className="space-y-3">
        <CampoTexto
          rotulo="Nome do paciente"
          type="search"
          // SEM `autoFocus`: ele movia o foco antes de o Dialog registrar o gatilho, e ao
          // fechar o foco caía no `<body>` em vez de voltar para "Vincular paciente".
          // O Dialog do design system já cuida do foco inicial.
          value={busca}
          placeholder="Buscar ou escolher…"
          onChange={(evento) => setBusca(evento.target.value)}
        />

        {pacientes.carregando ? (
          <div aria-busy="true" className="space-y-2">
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-full" />
          </div>
        ) : pacientes.falhou ? (
          // FALHA não é ausência de dado. Sem este ramo, um 500 virava a afirmação "não há
          // criança ativa no cadastro" — e a saída natural de quem lê isso é pré-cadastrar,
          // criando DUPLICATA de menor por causa de uma requisição que caiu (achado CR-BPL-04)
          <EstadoVazio
            titulo="Não foi possível carregar a lista"
            descricao="A busca falhou — tente de novo em instantes. O cadastro não foi consultado."
            className="p-6"
          />
        ) : pacientes.opcoes.length === 0 ? (
          // a mensagem segue o MODO: com a lista aberta e nada digitado, mandar "confira a
          // grafia" é orientar sobre um nome que ninguém escreveu (achado CR-BPL-10)
          <EstadoVazio
            titulo={termo.length >= 2 ? 'Nenhum paciente encontrado' : 'Nenhum paciente ativo para vincular'}
            descricao={
              termo.length >= 2
                ? 'Confira a grafia do nome ou busque por outra parte dele.'
                : 'Quando houver criança ativa no cadastro, ela aparece aqui.'
            }
            className="p-6"
          />
        ) : (
          <ul
            className="max-h-72 space-y-1 overflow-y-auto"
            onScroll={(evento) => {
              const alvo = evento.currentTarget
              if (alvo.scrollTop + alvo.clientHeight >= alvo.scrollHeight * 0.8) {
                pacientes.aoAproximarDoFim()
              }
            }}
          >
            {pacientes.opcoes.map((opcao) => (
              <li key={opcao.valor}>
                <Botao
                  variante="fantasma"
                  className="w-full justify-start"
                  carregando={vinculando}
                  onClick={() => aoVincular(opcao.valor)}
                >
                  {opcao.rotulo}
                </Botao>
              </li>
            ))}
            {pacientes.carregandoMais ? <Skeleton className="h-11 w-full" /> : null}
          </ul>
        )}
      </div>
    </Dialog>
  )
}
