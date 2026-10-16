import { useState } from 'react'

import type { ParametrosDeRelatorio } from '@/tipos'

import { baixarBlob } from '@/lib/baixar-blob'
import { ErroDeApi } from '@/lib/http'
import { baixarPlanilhaDoRelatorio } from '@/servicos/relatorios'

/** A recusa em uma frase — o download que falha nunca falha em silêncio. */
function mensagemDaFalha(erro: unknown): string {
  if (erro instanceof ErroDeApi) {
    switch (erro.motivo) {
      case 'sem_acesso':
        return 'Você não tem acesso à planilha deste relatório.'
      case 'invalido':
        return 'O servidor recusou o recorte desta planilha. Gere o relatório de novo e tente outra vez.'
      case 'rede':
        return 'Sem conexão com o servidor: a planilha não foi baixada.'
      default:
        break
    }
  }

  return 'Não foi possível baixar a planilha. Tente de novo em instantes.'
}

/**
 * Baixar o relatório em planilha (change `relatorio-em-planilha`): o MESMO recorte da consulta
 * que está na tela, pelo caminho autenticado. O nome do arquivo é o que o servidor deu.
 */
function usePlanilhaDoRelatorio(slug: string, parametros: ParametrosDeRelatorio) {
  const [baixando, setBaixando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function baixar(): Promise<void> {
    setErro(null)
    setBaixando(true)
    try {
      const { arquivo, nome } = await baixarPlanilhaDoRelatorio(slug, parametros)
      baixarBlob(arquivo, nome)
    } catch (falha) {
      setErro(mensagemDaFalha(falha))
    } finally {
      setBaixando(false)
    }
  }

  return { baixar, baixando, erro }
}

// nome do repo é pt-BR; o lint exige o prefixo `use` na declaração
export { usePlanilhaDoRelatorio as usarPlanilhaDoRelatorio }
