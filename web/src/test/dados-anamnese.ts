import type {
  Anamnese,
  AnamneseDaLista,
  AnamneseModelo,
  CampoDeModelo,
  PaginaDeApi,
} from '@/tipos'

/** Fixtures da anamnese — 100% FICTÍCIAS (LGPD: nunca dado que possa ser de um menor real). */

export function modeloFicticio(sobrescritas: Partial<AnamneseModelo> = {}): AnamneseModelo {
  return {
    id: 1,
    updated_at: '2026-07-15T10:00:00.000000Z',
    titulo: 'Triagem Fictícia',
    especialidade_id: null,
    ativo: true,
    campos_json: [
      { id: 'queixa', tipo: 'texto', rotulo: 'Queixa principal', obrigatorio: true },
      { id: 'idade_meses', tipo: 'numero', rotulo: 'Idade em meses', obrigatorio: false },
      { id: 'turno', tipo: 'opcoes', rotulo: 'Turno', obrigatorio: false, opcoes: ['Manhã', 'Tarde'] },
      { id: 'inicio', tipo: 'data', rotulo: 'Início dos sintomas', obrigatorio: false },
      { id: 'acompanhado', tipo: 'booleano', rotulo: 'Veio acompanhado', obrigatorio: false },
    ] satisfies CampoDeModelo[],
    ...sobrescritas,
  }
}

export function anamneseDaListaFicticia(sobrescritas: Partial<AnamneseDaLista> = {}): AnamneseDaLista {
  return {
    id: 10,
    updated_at: '2026-07-15T10:00:00.000000Z',
    paciente_id: 1,
    modelo: { id: 1, titulo: 'Triagem Fictícia' },
    preenchida_em: '2026-07-10 09:30',
    ...sobrescritas,
  }
}

export function anamneseFicticia(sobrescritas: Partial<Anamnese> = {}): Anamnese {
  return {
    id: 10,
    updated_at: '2026-07-15T10:00:00.000000Z',
    paciente_id: 1,
    modelo_id: 1,
    respostas_json: { queixa: 'Fala fictícia da triagem', turno: 'Manhã', acompanhado: true },
    preenchida_em: '2026-07-10 09:30',
    ...sobrescritas,
  }
}

export function paginaDeAnamneses(itens: AnamneseDaLista[]): PaginaDeApi<AnamneseDaLista> {
  return { data: itens, current_page: 1, last_page: 1, per_page: 50, total: itens.length }
}
