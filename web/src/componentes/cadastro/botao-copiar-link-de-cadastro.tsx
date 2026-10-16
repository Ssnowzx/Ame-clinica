import { useQuery } from '@tanstack/react-query'
import { Link2 } from 'lucide-react'

import { Botao } from '@/componentes/ui/botao'
import { usarToast } from '@/componentes/ui/toast'
import { buscarLinkDeCadastro } from '@/servicos/fila-de-cadastro'
import { useAuthStore } from '@/stores/auth-store'

/** Quem pode PEGAR o link: quem cadastra criança, quem confere os envios, quem administra. */
const PERMISSOES_QUE_LEEM_O_LINK = ['pacientes.criar', 'cadastro_online.conferir', 'configuracoes.editar'] as const

/**
 * "Copiar link do cadastro" onde a atendente está — Pacientes e Cadastros recebidos — em vez de
 * só nas Configurações (pedido do usuário, 2026-09-02: "fica mais intuitivo pegar o link lá").
 *
 * Só COPIA: gerar, trocar e ligar o endereço continuam nas Configurações, com quem administra.
 * Sem endereço gerado ou com o link desligado, o botão não aparece — não se manda à família um
 * endereço que não responde.
 */
export function BotaoCopiarLinkDeCadastro() {
  const temPermissao = useAuthStore((estado) => estado.temPermissao)
  const { notificar } = usarToast()
  const podeLer = PERMISSOES_QUE_LEEM_O_LINK.some((permissao) => temPermissao(permissao))
  const consulta = useQuery({
    queryKey: ['link-de-cadastro'],
    queryFn: buscarLinkDeCadastro,
    enabled: podeLer,
  })

  const url = consulta.data?.url ?? null
  if (!podeLer || !consulta.isSuccess || !consulta.data.ativo || url === null) {
    return null
  }

  async function copiar(endereco: string) {
    try {
      await navigator.clipboard.writeText(endereco)
      notificar({ tom: 'sucesso', titulo: 'Link do cadastro copiado.' })
    } catch {
      notificar({ tom: 'aviso', titulo: 'Não foi possível copiar. Pegue o endereço em Configurações.' })
    }
  }

  return (
    <Botao
      variante="secundario"
      onClick={() => {
        void copiar(url)
      }}
    >
      <Link2 aria-hidden="true" className="size-4" />
      Copiar link do cadastro
    </Botao>
  )
}
