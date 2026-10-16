import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, TriangleAlert } from 'lucide-react'
import { useState } from 'react'

import { Botao } from '@/componentes/ui/botao'
import { EstadoErro } from '@/componentes/ui/estado-erro'
import { DialogConfirmacao } from '@/componentes/ui/dialog-confirmacao'
import { Realce } from '@/componentes/ui/realce'
import { Skeleton } from '@/componentes/ui/skeleton'
import { usarToast } from '@/componentes/ui/toast'
import { buscarLinkDeCadastro, rotacionarLinkDeCadastro } from '@/servicos/fila-de-cadastro'

/**
 * O ENDEREÇO do cadastro pelo link, na tela de Configurações
 * (change `cadastro-online-do-paciente`).
 *
 * Ele não é uma configuração como as outras, e por isso tem seção própria em vez de um campo na
 * lista: toda escrita em `configuracoes` é auditada **com o valor em claro**, e a trilha é legível
 * por quem tem `auditoria.ver` — gravar o endereço ali o entregaria pela porta que existe para
 * vigiar o sistema. Ele mora em coluna própria, e a trilha registra que houve rotação, nunca para
 * qual valor.
 *
 * **Rotacionar derruba o endereço divulgado**, e é por isso que ele pede confirmação nomeando a
 * consequência: é a mitigação do link vazado — se ele foi parar onde não devia, troca-se o
 * endereço, em vez de pedir para apagarem a mensagem.
 */
export function SecaoLinkDeCadastro({ podeEditar }: { podeEditar: boolean }) {
  const queryClient = useQueryClient()
  const { notificar } = usarToast()
  const [confirmandoRotacao, setConfirmandoRotacao] = useState(false)

  const consulta = useQuery({ queryKey: ['link-de-cadastro'], queryFn: buscarLinkDeCadastro })

  const rotacao = useMutation({
    mutationFn: rotacionarLinkDeCadastro,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['link-de-cadastro'] })
      setConfirmandoRotacao(false)
      notificar({ tom: 'sucesso', titulo: 'Endereço gerado.' })
    },
    onError: () => {
      notificar({ tom: 'erro', titulo: 'Não foi possível gerar o endereço.' })
    },
  })

  if (consulta.isPending) return <Skeleton className="h-24 w-full" />

  // a seção NÃO desaparece na falha: quem abre Configurações numa falha de rede concluiria que o
  // cadastro pelo link não existe neste produto (design-QA, achado 8)
  if (consulta.isError) {
    return (
      <section className="flex flex-col gap-3">
        <h4 className="text-corpo font-semibold text-texto">Endereço do cadastro pelo link</h4>
        <EstadoErro
          mensagem="Não foi possível carregar o endereço do cadastro."
          aoTentarNovamente={() => { void consulta.refetch() }}
        />
      </section>
    )
  }

  const { slug, url, ativo } = consulta.data
  const jaTemEndereco = slug !== null

  async function copiar(endereco: string) {
    try {
      await navigator.clipboard.writeText(endereco)
      notificar({ tom: 'sucesso', titulo: 'Endereço copiado.' })
    } catch {
      // navegador sem permissão de área de transferência: o endereço está na tela, e é
      // selecionável — avisar é melhor que fingir que copiou
      notificar({ tom: 'aviso', titulo: 'Copie o endereço manualmente.' })
    }
  }

  return (
    <section className="flex flex-col gap-3">
      {/* `h4` sob o `h3` do bloco (`pagina-configuracoes.tsx`), como o cartão irmão do WhatsApp */}
      <h4 className="text-corpo font-semibold text-texto">Endereço do cadastro pelo link</h4>

      <p className="text-corpo leading-relaxed text-texto-suave">
        É o endereço que a família abre no celular para preencher o próprio cadastro. Gere,
        confira num aparelho e só então divulgue — e lembre de ligar a chave acima, sem ela o
        endereço não responde a ninguém.
      </p>

      {jaTemEndereco ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2 rounded-campo border border-linha bg-fundo p-3">
            <code className="min-w-0 flex-1 break-all text-corpo text-texto">{url}</code>
            <Botao
              variante="secundario"
              tamanho="sm"
              aria-label="Copiar o endereço do cadastro"
              onClick={() => { void copiar(url ?? '') }}
            >
              <Copy aria-hidden="true" className="size-4" />
              Copiar
            </Botao>
          </div>

          {!ativo ? (
            <Realce
              tom="atencao"
              rotulo="Atenção"
              icone={<TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-alerta-texto" />}
              texto="O endereço existe, mas o cadastro pelo link está DESLIGADO: quem o abrir vê que ele não está disponível. Ligue a chave acima quando quiser começar a receber."
            />
          ) : null}
        </div>
      ) : (
        <p className="text-corpo text-texto-suave">Nenhum endereço gerado ainda.</p>
      )}

      {podeEditar ? (
        <div className="flex flex-wrap gap-3">
          <Botao
            variante={jaTemEndereco ? 'secundario' : 'primario'}
            carregando={rotacao.isPending}
            onClick={() => {
              // gerar o PRIMEIRO não derruba nada e não pede confirmação; trocar derruba o que
              // já foi divulgado, e aí a pergunta é obrigatória
              if (jaTemEndereco) {
                setConfirmandoRotacao(true)
                return
              }
              rotacao.mutate()
            }}
          >
            {jaTemEndereco ? 'Trocar o endereço' : 'Gerar endereço'}
          </Botao>
        </div>
      ) : null}

      <DialogConfirmacao
        aberto={confirmandoRotacao}
        aoMudarAberto={setConfirmandoRotacao}
        titulo="Trocar o endereço do cadastro?"
        consequencia="O endereço atual para de funcionar na hora. Quem já recebeu o link antigo — por WhatsApp, cartaz ou mensagem — não vai mais conseguir abrir o formulário, e precisará do endereço novo."
        rotuloConfirmar="Trocar endereço"
        tom="atencao"
        carregando={rotacao.isPending}
        aoConfirmar={() => { rotacao.mutate() }}
      />
    </section>
  )
}
