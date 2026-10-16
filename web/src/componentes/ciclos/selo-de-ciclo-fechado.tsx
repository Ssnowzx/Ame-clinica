import { Lock } from 'lucide-react'

import { cn } from '@/lib/cn'

/** O texto do selo, exportado para os testes assertarem a copy, não um `data-testid`. */
export const TEXTO_DO_SELO = 'Produção do período já fechada — só o administrador reabre'

export interface SeloDeCicloFechadoProps {
  className?: string
}

/**
 * O selo que explica por que "Editar"/"Excluir" não estão ali (D7 + SEC-FC-09).
 *
 * O padrão da casa é **esconder a ação, nunca desabilitar campo por regra de servidor**
 * (precedente: "Excluir" some do lançamento pago, em `painel-lancamentos`). Só que ação
 * que some sem explicação vira suspeita de bug — e a pessoa tenta pelo caminho torto, ou
 * liga para a coordenação. O selo é a metade que faltava: diz o ESTADO e a SAÍDA (quem
 * reabre), na mesma linha.
 *
 * **O que ele NÃO diz, e não pode dizer:** o nome do convênio e as datas do período. A
 * tela só recebe um booleano por registro — nem a lista de fechamentos nem o calendário
 * (SEC-FC-09). Quem tem `lancamentos.editar` não tem, por construção, `convenios.ver`:
 * nomear a operadora aqui revelaria o vínculo paciente↔convênio, dado pessoal de menor.
 * Quando a pessoa chega ao servidor, é a 422 que decide o que ela pode ler (D7b).
 *
 * **Cor não é canal único** (WCAG 1.4.1): o cadeado e o texto carregam o estado sozinhos;
 * o par `alerta-texto`/`alerta-suave` tem contraste AA provado no contrato do DS.
 *
 * **`role="status"`** (4.1.3) porque em duas das três telas ele NASCE de uma resposta
 * assíncrona — no atendimento ele aparece no mesmo instante em que "Desfazer registro"
 * some. Para quem usa leitor de tela, uma ação que desaparece em silêncio é uma ação que
 * nunca existiu; o selo é justamente a explicação, e explicação precisa ser anunciada.
 */
export function SeloDeCicloFechado({ className }: SeloDeCicloFechadoProps) {
  return (
    <p
      role="status"
      className={cn(
        'inline-flex items-center gap-1.5 rounded-controle bg-alerta-suave px-2 py-0.5',
        'text-meta font-medium text-alerta-texto',
        className,
      )}
    >
      <Lock aria-hidden="true" className="size-3.5 shrink-0" />
      {TEXTO_DO_SELO}
    </p>
  )
}
