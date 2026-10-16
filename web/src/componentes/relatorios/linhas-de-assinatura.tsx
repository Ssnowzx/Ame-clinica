/**
 * As linhas de assinatura do papel (change `fechamento-de-caixa`, design D4): a clínica imprime o
 * fechamento para arquivar, e ele é ENTREGUE por quem deu as baixas e CONFERIDO por quem recebe a
 * gaveta. Só no papel — na tela, uma linha em branco para assinar não tem o que fazer.
 */
export function LinhasDeAssinatura({ rotulos }: { rotulos: readonly string[] }) {
  return (
    <div className="hidden print:mt-10 print:grid print:grid-cols-2 print:gap-12">
      {rotulos.map((rotulo) => (
        <div key={rotulo} className="flex flex-col gap-1">
          <div aria-hidden="true" className="h-10 border-b border-texto" />
          <p className="text-meta text-texto">{rotulo}</p>
          <p className="text-meta text-texto-suave">Nome e data</p>
        </div>
      ))}
    </div>
  )
}
