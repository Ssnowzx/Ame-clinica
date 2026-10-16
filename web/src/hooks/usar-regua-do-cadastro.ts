import { useQuery } from '@tanstack/react-query'
import { useCallback, useMemo } from 'react'

import type { CampoDaRegua, EstadoDoCampo, ReguaDoCadastro } from '@/tipos'

import { chaves } from '@/lib/chaves-query'
import { buscarReguaDoCadastro } from '@/servicos/campos-cadastro'

/**
 * A régua do cadastro, na forma que o formulário consome.
 *
 * Enquanto ela carrega, `visivel()` devolve `true` e `obrigatorio()` devolve `false`: o
 * formulário aparece inteiro e sem asterisco nenhum, e se corrige quando a régua chega.
 * A alternativa — esconder tudo até saber — piscaria um formulário vazio; e a autoridade
 * sobre o que é exigido é do servidor de qualquer modo, que recusa o que faltar.
 */
export interface ReguaDoFormulario {
  dados: ReguaDoCadastro | undefined
  carregando: boolean
  /**
   * A régua NÃO chegou. Quem consome precisa bloquear a tela: sem ela, o mapa fica vazio,
   * `visivel()` devolve `true` para tudo e `obrigatorio()` devolve `false` para tudo — o
   * formulário abriria com TODOS os campos e NENHUMA marca de obrigatório, inclusive nos
   * que o catálogo trava como obrigatórios. O operador preencheria às cegas e só descobriria
   * na recusa do servidor, que continua aplicando a régua da clínica.
   */
  erro: boolean
  /** Nova tentativa, para o "Tentar novamente" do `EstadoErro`. */
  recarregar: () => void
  /** O campo aparece no formulário? */
  visivel: (campo: string) => boolean
  /** O campo leva marca de obrigatório? */
  obrigatorio: (campo: string) => boolean
  /**
   * O teto de caracteres do campo, do SERVIDOR — `undefined` quando não há.
   *
   * É o mesmo número que o boundary usa para recusar. A tela nunca o mantém por conta
   * própria: foi a divergência entre o que o formulário aceita e o que o servidor recusa que
   * fez a recepção perder uma ficha inteira no salvar (change `tetos-do-cadastro-na-tela`).
   */
  limite: (campo: string) => number | undefined
  /** O teto de um SUBCAMPO de lista (`responsaveis_json`, `nome`). */
  limiteDoItem: (campo: string, subcampo: string) => number | undefined
  /** Algum campo desta seção aparece? Seção vazia não vira cabeçalho solto. */
  secaoVisivel: (secao: string) => boolean
  /** Os campos escondidos — o payload precisa OMITIR a chave deles (o servidor usa `missing`). */
  ocultos: string[]
}

// nome do repo é pt-BR; o lint exige o prefixo `use` na declaração (o mesmo idioma de
// `usar-erros-do-servidor.ts` e dos outros três hooks da base) — daí o alias na exportação
function useReguaDoCadastro(formulario = 'paciente'): ReguaDoFormulario {
  const consulta = useQuery({
    queryKey: chaves.reguaDoCadastro(formulario),
    queryFn: () => buscarReguaDoCadastro(formulario),
  })

  // `refetch` do React Query é estável; extraí-lo mantém o `useMemo` sem depender do
  // objeto inteiro da consulta, que muda a cada render.
  const { refetch } = consulta
  const recarregar = useCallback(() => {
    void refetch()
  }, [refetch])

  return useMemo(() => {
    const porCampo = new Map<string, CampoDaRegua>(
      (consulta.data?.campos ?? []).map((campo) => [campo.campo, campo]),
    )

    const visivel = (campo: string) => !(porCampo.get(campo)?.desabilitado ?? false)

    return {
      dados: consulta.data,
      carregando: consulta.isPending,
      erro: consulta.isError,
      recarregar,
      visivel,
      obrigatorio: (campo: string) => porCampo.get(campo)?.obrigatorio ?? false,
      limite: (campo: string) => porCampo.get(campo)?.tamanho ?? undefined,
      limiteDoItem: (campo: string, subcampo: string) =>
        porCampo.get(campo)?.tamanhos_dos_itens?.[subcampo] ?? undefined,
      secaoVisivel: (secao: string) =>
        porCampo.size === 0 ||
        [...porCampo.values()].some((campo) => campo.secao === secao && !campo.desabilitado),
      ocultos: [...porCampo.values()].filter((campo) => campo.desabilitado).map((campo) => campo.campo),
    }
  }, [consulta.data, consulta.isPending, consulta.isError, recarregar])
}

/** Os dois booleanos da API viram o estado único que a tela de configuração manipula. */
export function estadoDoCampo(campo: CampoDaRegua): EstadoDoCampo {
  if (campo.desabilitado) return 'oculto'
  return campo.obrigatorio ? 'obrigatorio' : 'opcional'
}

/** …e de volta: o estado único vira o par que a API grava. */
export function chavesDoEstado(estado: EstadoDoCampo): {
  obrigatorio: boolean
  desabilitado: boolean
} {
  return {
    obrigatorio: estado === 'obrigatorio',
    desabilitado: estado === 'oculto',
  }
}

export { useReguaDoCadastro as usarReguaDoCadastro }
