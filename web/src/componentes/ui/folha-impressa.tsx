import type { ReactNode } from 'react'

import { MarcaDaClinica } from '@/componentes/marca-da-clinica'

/**
 * A região que vai ao PAPEL, com o cabeçalho que um documento assinável precisa: de quem
 * ele é e de quando.
 *
 * Existe porque a clínica pediu, não porque é bonito: na pergunta 5 do 3º formulário a
 * Mariana confirmou que o número que o painel calcula **já é o que ela queria**, e que a
 * saída de que precisa é **imprimir para assinar, arquivar e mandar ao convênio**. Hoje
 * ela vê o número na tela e não consegue tirá-lo de lá.
 *
 * O cabeçalho é componente e não markup repetido porque três abas vão imprimir: montado em
 * cada uma, elas divergem no primeiro conserto.
 *
 * `data-impresso` é o gancho do `@media print` (`index.css`): tudo o que estiver fora some
 * do papel, e o que levar `data-nao-imprimir` some explicitamente.
 */
export function FolhaImpressa({
  titulo,
  periodo,
  rodape,
  children,
}: {
  titulo: string
  /** Por extenso — "setembro de 2026", não "2026-09". Quem assina lê em português. */
  periodo: string
  /**
   * O fecho do papel, quando o documento pede — as linhas de assinatura do fechamento de caixa. É
   * o ponto de extensão por documento: quem não passa nada imprime exatamente como antes.
   */
  rodape?: ReactNode
  children: ReactNode
}) {
  return (
    <div data-impresso className="flex flex-col gap-4">
      {/* só no papel: na tela o cabeçalho da área já diz tudo isto, e repetir seria ruído.
          `div`, não `header`: um segundo `<header>` de topo cria um segundo landmark de
          banner, e o `axe` da casa reprova (achado do próprio teste ao montar no shell). */}
      <div className="hidden print:flex print:flex-col print:gap-1 print:border-b print:border-linha print:pb-3">
        <MarcaDaClinica />
        <p className="text-corpo font-semibold text-texto">
          {titulo} — {periodo}
        </p>
      </div>
      {children}
      {rodape}
    </div>
  )
}
