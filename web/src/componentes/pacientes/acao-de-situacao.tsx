import { useRef, useState } from 'react'

import { Botao } from '@/componentes/ui/botao'
import { DialogConfirmacao } from '@/componentes/ui/dialog-confirmacao'
import { usarMutacaoDePaciente } from '@/hooks/usar-mutacao-de-paciente'
import { nomeDeExibicao } from '@/lib/pacientes'
import { useAuthStore } from '@/stores/auth-store'
import type { Paciente } from '@/tipos'

export interface AcaoDeSituacaoProps {
  paciente: Paciente
  /** Tamanho do gatilho — a faixa da ficha é mais discreta que o cabeçalho do formulário */
  tamanho?: 'sm' | 'md' | 'lg'
  /**
   * O cadastro que o servidor devolveu depois da troca.
   *
   * O formulário de edição PRECISA dele para re-hidratar: a troca de situação grava o cadastro do
   * SERVIDOR, e sem re-hidratar a tela seguiria exibindo edição não salva (parecer code-review §9).
   * A ficha, que é leitura, não precisa de nada — a invalidação do hook já a atualiza.
   */
  aoConcluir?: (salvo: Paciente) => void
  /**
   * Onde o foco pousa quando a troca APAGA o gatilho (2.4.3).
   *
   * A faixa da ficha some junto com o botão que tinha o foco; sem uma âncora que sobrevive à
   * mutação, o foco cai no `body` e o leitor de tela recomeça a página. Só é usado quando a
   * troca aconteceu: cancelar devolve o foco ao próprio botão, que continua lá.
   */
  focoAposTroca?: () => HTMLElement | null
}

/**
 * Desativar / reativar um paciente — o gatilho, a confirmação e a escrita num lugar só.
 *
 * NÃO existe excluir paciente (design D3): a API não a tem, e desativar preserva a trilha (§12).
 * A troca vai pelo endpoint de SITUAÇÃO (`PATCH /api/pacientes/{id}/situacao`), que não exige
 * campo nenhum do cadastro — é o que permite reativar um PRÉ-CADASTRADO sem inventar data de
 * nascimento ou necessidade de um MENOR.
 *
 * Existe como componente porque são DOIS lugares (o formulário de edição e a faixa da ficha do
 * paciente inativo) e os textos da confirmação são **regra dita ao usuário**: duplicá-los é
 * garantir que um dos dois envelheça (change `paciente-inativo-com-saida`, decisão D4).
 *
 * Autoguardado por `pacientes.editar`: sem a permissão não renderiza nada — e o servidor
 * continua sendo quem decide de verdade (403).
 */
export function AcaoDeSituacao({ paciente, tamanho = 'md', aoConcluir, focoAposTroca }: AcaoDeSituacaoProps) {
  const podeEditar = useAuthStore((estado) => estado.temPermissao('pacientes.editar'))
  const [confirmando, setConfirmando] = useState(false)
  // a troca aconteceu nesta abertura do diálogo? só então o gatilho some, e só então o foco
  // precisa de outro destino
  const trocou = useRef(false)
  const { definirSituacao, gravando } = usarMutacaoDePaciente()

  if (!podeEditar) {
    return null
  }

  const nome = nomeDeExibicao(paciente)

  return (
    <>
      <Botao
        variante={paciente.ativo ? 'secundario' : 'primario'}
        tamanho={tamanho}
        onClick={() => {
          trocou.current = false
          setConfirmando(true)
        }}
      >
        {paciente.ativo ? 'Desativar' : 'Reativar'}
      </Botao>

      <DialogConfirmacao
        aberto={confirmando}
        aoMudarAberto={setConfirmando}
        titulo={paciente.ativo ? `Desativar ${nome}?` : `Reativar ${nome}?`}
        consequencia={
          paciente.ativo
            ? 'O cadastro e todo o histórico permanecem — o paciente deixa de aparecer na lista de ativos. Não existe exclusão de paciente.'
            : 'O paciente volta a aparecer na lista de ativos e pode ser escolhido de novo para agendar.'
        }
        rotuloConfirmar={paciente.ativo ? 'Desativar' : 'Reativar'}
        tom={paciente.ativo ? 'perigo' : 'atencao'}
        carregando={gravando}
        focoAoFechar={() => (trocou.current ? (focoAposTroca?.() ?? null) : null)}
        aoConfirmar={() =>
          new Promise<void>((resolver, rejeitar) => {
            definirSituacao.mutate(
              {
                id: paciente.id,
                // estado ABSOLUTO pretendido, derivado do que esta tela mostra — e a VERSÃO
                // que hidratou essa mesma tela. Enquanto o serviço relia o cadastro só para
                // montar o `If-Match`, a concorrência otimista era teatro: a versão validada
                // era sempre a de meio segundo atrás, nunca a que o usuário viu, e o 409 não
                // disparava nunca (parecer SEC-PIS-05)
                ativo: !paciente.ativo,
                versao: paciente.updated_at,
              },
              {
                onSuccess: (salvo) => {
                  trocou.current = true
                  setConfirmando(false)
                  aoConcluir?.(salvo)
                  resolver()
                },
                // a recusa mantém o diálogo aberto; o toast do hook diz o motivo
                onError: () => {
                  rejeitar(new Error('recusado'))
                },
              },
            )
          })
        }
      />
    </>
  )
}
