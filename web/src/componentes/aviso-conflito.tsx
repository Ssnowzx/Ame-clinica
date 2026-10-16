import { AvisoErro } from '@/componentes/ui/aviso-erro'
import { Botao } from '@/componentes/ui/botao'

/**
 * O aviso de CONFLITO de edição (EX-05 · concorrência otimista), com a saída:
 * outra pessoa salvou enquanto este formulário estava aberto — o servidor
 * recusou (409) e NADA foi gravado. "Recarregar" refaz a leitura que hidrata o
 * formulário; o que foi digitado aqui não é descartado em silêncio — quem decide
 * recarregar é a pessoa, nunca um refetch automático por baixo do formulário.
 */
export function AvisoConflito({
  visivel,
  aoRecarregar,
  recarregando = false,
}: {
  visivel: boolean
  aoRecarregar: () => void
  recarregando?: boolean
}) {
  if (!visivel) {
    return null
  }

  return (
    <div className="flex flex-col gap-2">
      <AvisoErro
        mensagens={[
          'Este registro foi alterado por outra pessoa enquanto você editava. '
          + 'Nada foi gravado por cima: recarregue para ver a versão atual e reaplique a sua alteração.',
        ]}
      />
      <div className="flex justify-end">
        <Botao type="button" variante="secundario" carregando={recarregando} onClick={aoRecarregar}>
          Recarregar
        </Botao>
      </div>
    </div>
  )
}
