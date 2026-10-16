import { useQuery } from '@tanstack/react-query'
import { Printer } from 'lucide-react'
import { Suspense } from 'react'
import { Outlet } from 'react-router-dom'

import type { ContextoDosIndicadores } from '@/componentes/indicadores/periodo-dos-indicadores'

import { BarraDeAbas } from '@/componentes/indicadores/barra-de-abas'
import { useMesDaUrl } from '@/componentes/indicadores/mes-da-url'
import { EsqueletoDaArea } from '@/componentes/indicadores/moldura-dos-indicadores'
import { SeletorDeMes } from '@/componentes/indicadores/seletor-de-mes'
import { Botao } from '@/componentes/ui/botao'
import { chaves } from '@/lib/chaves-query'
import { hojeNaClinica, TIMEZONE_PADRAO } from '@/lib/datas'
import { rotuloDoMes } from '@/lib/meses'
import { TEMPO_CATALOGO_MS } from '@/lib/query-client'
import { buscarConfiguracaoAgenda } from '@/servicos/catalogos'
import { useAuthStore } from '@/stores/auth-store'

/**
 * A casca da área de Indicadores: título, **seletor de período** e **barra de abas** —
 * nessa ordem, o período ACIMA das abas.
 *
 * **Um período para a área inteira, e ele mora na URL (`?mes=`).** Guardar em store
 * sobreviveria à troca de aba, mas não ao link copiado, nem ao Voltar, nem ao F5 — e a
 * clínica manda link de tela por mensagem. Com a URL, "compartilhado" é propriedade do
 * endereço. Como só existe UM parâmetro, duas abas exibindo meses diferentes é estado
 * inexpressável — o defeito que o ClinicaÁgil tem (seletor de mês nas pizzas, de ano na
 * série) morre aqui no nível da ÁREA, não de uma tela.
 *
 * O fuso vem da configuração da CLÍNICA (§13), como as telas já faziam.
 */
export function ShellDeIndicadores() {
  const podeAgenda = useAuthStore((estado) => estado.temPermissao('agenda.ver'))

  const configuracao = useQuery({
    queryKey: chaves.configuracaoAgenda(),
    queryFn: buscarConfiguracaoAgenda,
    staleTime: TEMPO_CATALOGO_MS,
    enabled: podeAgenda,
  })

  const mesCorrente = hojeNaClinica(configuracao.data?.timezone ?? TIMEZONE_PADRAO).slice(0, 7)
  // o fuso da clínica CONHECIDO antes de corrigir a URL (ver `useMesDaUrl`)
  const fusoConhecido = !podeAgenda || configuracao.isSuccess || configuracao.isError
  const { mes, trocarMes } = useMesDaUrl(mesCorrente, fusoConhecido)

  return (
    <div className="flex flex-col gap-5">
      <CabecalhoDaArea mes={mes} trocarMes={trocarMes} mesCorrente={mesCorrente} />

      {/* as abas chegam SOB DEMANDA (PERF-08): enquanto o código delas desce, o esqueleto segura a
          caixa do conteúdo — e, como ele é a última coisa da página, nada se move quando a aba monta */}
      <Suspense fallback={<EsqueletoDaArea />}>
        <Outlet context={{ mes, trocarMes, mesCorrente } satisfies ContextoDosIndicadores} />
      </Suspense>
    </div>
  )
}

/** O título, o seletor de período (acima das abas, porque vale para todas), o Imprimir e as abas. */
function CabecalhoDaArea({ mes, trocarMes, mesCorrente }: ContextoDosIndicadores) {
  return (
    <header data-nao-imprimir className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-titulo font-semibold text-texto">Indicadores</h1>
          {/* o subtítulo é da ÁREA, não da Visão geral: "cada bloco aparece conforme a sua
              permissão" só descrevia uma das quatro rotas e vazava para as outras (DQ-07) */}
          <p className="mt-1 text-corpo text-texto-suave">
            Os números de {rotuloDoMes(mes)}. Cada aba abre conforme a sua permissão.
          </p>
        </div>

        {/* `flex-wrap`: em 320 CSS px o grupo do período (com o rótulo de largura mínima) mais o
            Imprimir mede 354px e empurrava a PÁGINA para o lado — 1.4.10 pede que nada role
            horizontalmente até 320 (medido: scrollWidth 378, achado A11Y-01). */}
        <div className="flex flex-wrap items-center gap-3">
          <SeletorDeMes mes={mes} mesCorrente={mesCorrente} trocarMes={trocarMes} rotulo="Período de todos os indicadores" />

          <Botao variante="secundario" tamanho="sm" aria-label="Imprimir esta seção" onClick={() => window.print()}>
            <Printer aria-hidden="true" className="size-4" />
            Imprimir
          </Botao>
        </div>
      </div>

      <BarraDeAbas mes={mes} />
    </header>
  )
}
