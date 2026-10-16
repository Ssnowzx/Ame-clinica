import { PERMISSOES_DA_COBRANCA } from '@/lib/cobranca-pelo-whatsapp'
import { possuiTodasAsPermissoes } from '@/lib/permissoes'
import { useAuthStore } from '@/stores/auth-store'

/**
 * As duas permissões da cobrança pelo WhatsApp, em E (change `cobranca-pelo-whatsapp`): o
 * telefone é contato do cadastro da criança. A afordância não aparece para quem levaria 403.
 */
function usePodeCobrar(): boolean {
  return useAuthStore((estado) => possuiTodasAsPermissoes(estado.temPermissao, PERMISSOES_DA_COBRANCA))
}

// nome do repo é pt-BR; o lint exige o prefixo `use` na declaração
export { usePodeCobrar as usarPodeCobrar }
