import { Component, type ErrorInfo, type ReactNode } from 'react'

import { Botao } from '@/componentes/ui/botao'
import { EstadoErro } from '@/componentes/ui/estado-erro'
import { ehFalhaDeCargaDeCodigo } from '@/lib/versao-nova'

interface BarreiraDeErroProps {
  children: ReactNode
  /** Como a página recarrega (o jsdom não navega: o teste injeta) */
  recarregar?: () => void
}

interface BarreiraDeErroState {
  quebrou: boolean
  /**
   * A falha foi o código de uma tela que não veio — uma versão nova publicada com a página aberta, e
   * a recarga automática já foi gasta. Aqui "tentar de novo" é recarregar: remontar a árvore só
   * repetiria o import rejeitado, que o `React.lazy` guarda (PERF-12).
   */
  versaoNova: boolean
}

/**
 * Rede de segurança da raiz: sem ela, QUALQUER exceção em render deixa o balcão
 * com a tela em branco (parecer SEC-R1/R2). Aqui o erro vira uma tela tratada
 * com saída — a mensagem é sempre a nossa, nunca o texto da exceção (que pode
 * carregar dado de paciente).
 *
 * É a única classe do código: React só oferece error boundary como classe.
 */
export class BarreiraDeErro extends Component<BarreiraDeErroProps, BarreiraDeErroState> {
  state: BarreiraDeErroState = { quebrou: false, versaoNova: false }

  static getDerivedStateFromError(erro: unknown): BarreiraDeErroState {
    return { quebrou: true, versaoNova: ehFalhaDeCargaDeCodigo(erro) }
  }

  componentDidCatch(_erro: Error, _info: ErrorInfo): void {
    // Sem observabilidade ainda: o gatilho de Sentry/logs é da change de deploy.
    // Nada é impresso — log de exceção pode vazar dado do card (LGPD).
  }

  private recomecar = (): void => {
    if (this.state.versaoNova) {
      const recarregar = this.props.recarregar ?? (() => window.location.reload())
      recarregar()

      return
    }
    this.setState({ quebrou: false, versaoNova: false })
  }

  render(): ReactNode {
    if (this.state.quebrou) {
      return (
        <main className="flex min-h-screen items-center justify-center p-8">
          <div className="flex w-full max-w-md flex-col gap-4">
            <EstadoErro
              mensagem={
                this.state.versaoNova
                  ? 'O sistema foi atualizado enquanto esta tela estava aberta. Tente novamente para carregar a versão nova.'
                  : 'Algo deu errado ao montar esta tela.'
              }
              aoTentarNovamente={this.recomecar}
            />
            <Botao asChild variante="fantasma">
              <a href="/agenda">Voltar para a agenda</a>
            </Botao>
          </div>
        </main>
      )
    }

    return this.props.children
  }
}
