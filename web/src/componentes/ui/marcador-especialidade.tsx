import { normalizarCorMarcador } from '@/lib/cor-status'

export interface MarcadorEspecialidadeProps {
  /** Hex do cadastro (especialidades.cor); normalizado por normalizarCorMarcador (§2.4) */
  cor: string
}

/**
 * Fio de 3px — a assinatura visual do sistema (design-system.md §5.5). Barra
 * vertical, nunca preenchimento. É `aria-hidden`: o consumidor DEVE exibir o
 * nome da especialidade em texto no mesmo card/linha (cor nunca é o único
 * canal, 1.4.1). A classe `w-[3px]` é a ÚNICA exceção de valor arbitrário
 * permitida, encapsulada aqui (allowlist do teste de contrato §8.2).
 */
export function MarcadorEspecialidade({ cor }: MarcadorEspecialidadeProps) {
  return (
    <span
      aria-hidden="true"
      className="w-[3px] shrink-0 self-stretch rounded-pilula"
      style={{ backgroundColor: normalizarCorMarcador(cor) }}
    />
  )
}
