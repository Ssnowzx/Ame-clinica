import { useQuery } from '@tanstack/react-query'

import { useMesDaUrl } from '@/componentes/indicadores/mes-da-url'
import { chaves } from '@/lib/chaves-query'
import { hojeNaClinica, TIMEZONE_PADRAO } from '@/lib/datas'
import { TEMPO_AGENDA_MS, TEMPO_CATALOGO_MS } from '@/lib/query-client'
import { buscarConfiguracaoAgenda } from '@/servicos/catalogos'
import { buscarPainelDoProfissional, buscarProfissionalDoCadastro } from '@/servicos/profissionais'
import { useAuthStore } from '@/stores/auth-store'

/**
 * O que a ficha do profissional pode mostrar a quem olha, e as leituras que ela faz — num módulo de
 * HOOKS, sem componente (o fast refresh do Vite só funciona quando um módulo exporta só componentes).
 *
 * Esconder é experiência: o servidor continua decidindo (own-show, permissões e o escopo D11). Aqui só
 * não se pede o que viria 403 e não se mostra número que o recorte de quem olha fabricaria.
 */
export interface AcessoDaFicha {
  ehProprio: boolean
  /** `profissionais.ver` OU o próprio profissional */
  podeVerCadastro: boolean
  /** A volta para a LISTA só se promete a quem abre a lista */
  voltarParaALista: boolean
  podeEditar: boolean
  podeAgenda: boolean
  podeAtendimentos: boolean
  podeEvolucoes: boolean
  podeTratamentos: boolean
  /**
   * A lista de tratamentos é escopada pelo eixo AGENDA (D11): ela só diz a verdade sobre ESTE
   * profissional na própria ficha ou para quem opera a agenda de toda a clínica.
   */
  alcancaTratamentos: boolean
  /** Algum bloco do painel pode vir: a agenda, os pacientes ou uma das duas portas do financeiro (D4) */
  podePainel: boolean
}

export function useAcessoDaFicha(profissionalId: number, idValido: boolean): AcessoDaFicha {
  const usuario = useAuthStore((estado) => estado.usuario)
  const temPermissao = useAuthStore((estado) => estado.temPermissao)
  const ehProprio = usuario?.profissional_id === profissionalId
  const podeVerCadastro = temPermissao('profissionais.ver') || ehProprio
  const podeAgenda = temPermissao('agenda.ver')
  const podeTratamentos = temPermissao('tratamentos.ver')
  const podeFinanceiro =
    (ehProprio && temPermissao('repasse.ver_proprio')) ||
    (temPermissao('repasse.ver') && temPermissao('lancamentos.ver') && podeTratamentos)

  return {
    ehProprio,
    podeVerCadastro,
    voltarParaALista: temPermissao('profissionais.ver'),
    podeEditar: temPermissao('profissionais.editar'),
    podeAgenda,
    podeAtendimentos: temPermissao('atendimentos.ver'),
    podeEvolucoes: temPermissao('evolucoes.ver'),
    podeTratamentos,
    alcancaTratamentos: podeTratamentos && (ehProprio || temPermissao('agenda.ver_todos')),
    // o bloco dos pacientes exige `pacientes.ver` E `tratamentos.ver` no servidor: só `pacientes.ver`
    // é 403 garantido, e a ficha não pede o que vem 403 (code-reviewer r2)
    podePainel:
      idValido && podeVerCadastro && (podeAgenda || (temPermissao('pacientes.ver') && podeTratamentos) || podeFinanceiro),
  }
}

/** O "hoje" e o mês do painel, na parede da CLÍNICA (§13) — a configuração vem sob `agenda.ver`, com São Paulo de reserva. */
export interface RelogioDaFicha {
  fuso: string
  /** `Y-m-d` */
  hoje: string
  mesCorrente: string
  /** O mês do painel, da URL (`?mes=`) */
  mes: string
  trocarMes: (mes: string) => void
}

export function useRelogioDaFicha(podeAgenda: boolean): RelogioDaFicha {
  const configuracao = useQuery({
    queryKey: chaves.configuracaoAgenda(),
    queryFn: buscarConfiguracaoAgenda,
    staleTime: TEMPO_CATALOGO_MS,
    enabled: podeAgenda,
  })
  const fuso = configuracao.data?.timezone ?? TIMEZONE_PADRAO
  const hoje = hojeNaClinica(fuso)
  const fusoConhecido = !podeAgenda || configuracao.isSuccess || configuracao.isError
  const { mes, trocarMes } = useMesDaUrl(hoje.slice(0, 7), fusoConhecido)

  return { fuso, hoje, mesCorrente: hoje.slice(0, 7), mes, trocarMes }
}

/**
 * O cadastro: chave de DETALHE (alimenta o form de edição por prop) — `gcTime: 0`, para remontar a
 * página re-hidratar FRESCO, nunca de um cache que reverteria a edição anterior.
 */
export function useFichaDoProfissional(profissionalId: number, habilitada: boolean) {
  return useQuery({
    queryKey: chaves.fichaProfissional(profissionalId),
    queryFn: () => buscarProfissionalDoCadastro(profissionalId),
    enabled: habilitada,
    gcTime: 0,
  })
}

/** O painel do mês (D7) — em paralelo com o cadastro, nunca depois dele (sem cascata). */
export function usePainelDoProfissional(profissionalId: number, mes: string, habilitado: boolean) {
  return useQuery({
    queryKey: chaves.painelDoProfissional(profissionalId, mes),
    queryFn: () => buscarPainelDoProfissional(profissionalId, mes),
    staleTime: TEMPO_AGENDA_MS,
    enabled: habilitado,
  })
}
