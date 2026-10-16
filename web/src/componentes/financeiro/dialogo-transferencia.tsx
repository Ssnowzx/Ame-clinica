import { useQuery } from '@tanstack/react-query'
import { useId, useState } from 'react'

import type { ContaFinanceira, PayloadTransferencia, Transferencia } from '@/tipos'

import { AvisoConflito } from '@/componentes/aviso-conflito'
import { JanelaDeFormulario } from '@/componentes/financeiro/janela-de-formulario'
import { AcaoDoPreRequisito } from '@/componentes/ui/aviso-de-pre-requisito'
import { AvisoErro } from '@/componentes/ui/aviso-erro'
import { CampoSelect } from '@/componentes/ui/campo-select'
import { CampoTexto } from '@/componentes/ui/campo-texto'
import { CampoTextoLongo } from '@/componentes/ui/campo-texto-longo'
import { EstadoVazio } from '@/componentes/ui/estado-vazio'
import { Skeleton } from '@/componentes/ui/skeleton'
import { usarMutacaoDeTransferencia } from '@/hooks/usar-mutacao-de-transferencia'
import { CAMINHOS, usePodeResolver } from '@/lib/caminhos-dos-cadastros'
import { chaves } from '@/lib/chaves-query'
import { hojeNaClinica, TIMEZONE_PADRAO } from '@/lib/datas'
import { paraDecimalDaApi } from '@/lib/dinheiro'
import { TEMPO_CATALOGO_MS } from '@/lib/query-client'
import { buscarConfiguracaoAgenda } from '@/servicos/catalogos'
import { buscarTransferencia, listarContas } from '@/servicos/financeiro'
import { useAuthStore } from '@/stores/auth-store'

/** O que é uma transferência (design D8) — a frase que o ClinicaÁgil nunca disse. */
export const EXPLICACAO_DA_TRANSFERENCIA =
  'O dinheiro muda de lugar entre duas contas da clínica — do caixa para o banco, por exemplo. Não é receita nem despesa: as entradas e as saídas do período continuam as mesmas.'

/** Por que "Transferir" fica indisponível com a mesma conta nos dois lados. */
export const RAZAO_DAS_CONTAS_IGUAIS = 'Escolha uma conta de destino diferente da de origem.'

interface ValoresTransferencia {
  conta_origem_id: string
  conta_destino_id: string
  valor: string
  /** `null` = ninguém mexeu: vale HOJE no fuso da clínica, que pode chegar depois da abertura */
  data: string | null
  obs: string
}

function valoresIniciais(transferencia: Transferencia | null): ValoresTransferencia {
  if (transferencia === null) {
    return { conta_origem_id: '', conta_destino_id: '', valor: '', data: null, obs: '' }
  }
  return {
    conta_origem_id: String(transferencia.conta_origem_id),
    conta_destino_id: String(transferencia.conta_destino_id),
    // o decimal da API na forma que o brasileiro lê e digita (`2000.00` → `2000,00`)
    valor: transferencia.valor.replace('.', ','),
    data: transferencia.data,
    obs: transferencia.obs ?? '',
  }
}

/**
 * Por que não dá para transferir, com o nome da conta que existe (change `o-sistema-avisa-o-que-falta`,
 * D2). Em 2026-10-02 a clínica só tinha o "Caixa", e o diálogo mostrava o formulário inteiro com os
 * seletores vazios — a explicação era uma linha miúda sob o primeiro campo.
 */
function motivoDaFaltaDeConta(
  ativas: readonly ContaFinanceira[],
  inativas: number,
  podeReativar: boolean,
  podeCadastrar: boolean,
): string {
  const precisa = 'Transferir pede duas contas ativas: a de onde o dinheiro sai e a para onde ele vai — um banco, por exemplo.'
  const existentes = ativas.length === 1 ? `A clínica só tem a conta “${ativas[0].nome}” ativa. ` : 'Nenhuma conta ativa cadastrada. '
  if (inativas === 0) {
    return `${existentes}${precisa}`
  }
  // o caminho de reativar conforme a permissão (gate CR-AVI-07). Sem poder reativar NEM cadastrar, o
  // pedido vem uma vez só, no lugar do botão — dois "Peça a quem administra" seguidos (DQA-AVI-R2-02)
  const comoReativar = podeReativar
    ? ': se ela ainda é usada, reative-a em Cadastros › Contas.'
    : podeCadastrar
      ? ': se ela ainda é usada, peça a quem administra o sistema para reativá-la.'
      : '.'

  return `${existentes}${precisa} Conta inativa não recebe transferência${comoReativar}`
}

/**
 * Um campo em espera, nas medidas do `EnvelopeCampo` (medidas no navegador): rótulo de 18 px, controle e
 * a linha de ajuda de 16 px — o Valor não tem ajuda.
 */
function EsqueletoDeCampo({ controle = 'h-10', comAjuda = true }: { controle?: string; comAjuda?: boolean }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Skeleton className="h-[1.125rem] w-32 rounded-campo" />
      <Skeleton className={`${controle} rounded-campo`} />
      {comAjuda ? <Skeleton className="h-4 w-48 rounded-campo" /> : null}
    </div>
  )
}

/**
 * A espera das contas no FORMATO do formulário (De/Para, Valor/Data, Observação): no caso comum — duas
 * contas ou mais — o formulário chega sem salto; com o aviso, o diálogo só encolhe (gate DQA-AVI-R2-01:
 * um bloco genérico fazia o diálogo crescer 225 px quando a lista chegava).
 */
function EsqueletoDoFormulario() {
  return (
    <div aria-busy="true" className="flex flex-col gap-4">
      <span className="sr-only">Carregando as contas…</span>
      <div className="grid gap-4 sm:grid-cols-2">
        <EsqueletoDeCampo />
        <EsqueletoDeCampo />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <EsqueletoDeCampo comAjuda={false} />
        <EsqueletoDeCampo />
      </div>
      <EsqueletoDeCampo controle="h-[7.125rem]" />
    </div>
  )
}

export interface DialogoTransferenciaProps {
  /** A transferência lida AGORA do servidor (edição, com o `updated_at`), ou `null` (nova). */
  transferencia: Transferencia | null
  aoFechar: () => void
  focoAoFechar: () => HTMLElement | null
}

/**
 * Transferir entre contas (change `caixa-do-dia-a-dia`, design D7) — o depósito da gaveta no banco,
 * que antes não tinha onde ser lançado e virava despesa mais receita, inflando os dois lados.
 *
 * - **Data:** hoje no fuso da CLÍNICA (§13), não o do aparelho; quem registra uma de ontem troca.
 * - **Contas iguais:** a tela recusa antes do envio e diz por quê; o servidor continua sendo a
 *   autoridade (`different`), e a recusa dele pousa no mesmo campo.
 * - **Edição:** o `PUT` leva o `updated_at` da leitura (If-Match). O conflito não recarrega
 *   sozinho: quem decide descartar o que digitou é a pessoa.
 */
export function DialogoTransferencia({ transferencia, aoFechar, focoAoFechar }: DialogoTransferenciaProps) {
  const [emEdicao, setEmEdicao] = useState<Transferencia | null>(transferencia)
  const [valores, setValores] = useState<ValoresTransferencia>(() => valoresIniciais(transferencia))
  const [recarregando, setRecarregando] = useState(false)
  const { erros, limparErros, notificar, criar, atualizar, salvando } = usarMutacaoDeTransferencia()

  // o fuso da CLÍNICA (§13) decide o "hoje" — lido de onde a casa já lê, sob `agenda.ver`
  const podeAgenda = useAuthStore((estado) => estado.temPermissao('agenda.ver'))
  const podeReativarConta = useAuthStore((estado) => estado.temPermissao('contas.ver') && estado.temPermissao('contas.editar'))
  const podeCadastrarConta = usePodeResolver(CAMINHOS.conta)
  const idDoAviso = useId()
  const idDoPedido = useId()
  const configuracao = useQuery({
    queryKey: chaves.configuracaoAgenda(),
    queryFn: buscarConfiguracaoAgenda,
    staleTime: TEMPO_CATALOGO_MS,
    enabled: podeAgenda,
  })
  const contas = useQuery({ queryKey: chaves.contas(), queryFn: listarContas })

  const data = valores.data ?? hojeNaClinica(configuracao.data?.timezone ?? TIMEZONE_PADRAO)
  const contasIguais = valores.conta_origem_id !== '' && valores.conta_origem_id === valores.conta_destino_id
  const todasAsContas = contas.data ?? []
  const contasAtivas = todasAsContas.filter((conta) => conta.ativo)
  // D3: numa transferência nova, só as ativas; ao editar, as contas gravadas continuam no seletor
  // mesmo inativas — senão a edição abriria com o campo vazio e perderia o valor
  const gravadas = emEdicao === null ? [] : [emEdicao.conta_origem_id, emEdicao.conta_destino_id]
  const opcoesDeConta = todasAsContas
    .filter((conta) => conta.ativo || gravadas.includes(conta.id))
    .map((conta) => ({ valor: String(conta.id), rotulo: conta.nome }))
  // transferir exige DUAS contas ATIVAS: com uma só, não há para onde o dinheiro ir
  const faltaConta = emEdicao === null && contas.isSuccess && contasAtivas.length < 2
  // numa transferência NOVA, o corpo espera as contas: abrir o formulário e trocá-lo pelo aviso quando
  // a lista chega era um salto de 160 px com o foco perdido (DQA-AVI-02)
  const carregandoContas = emEdicao === null && contas.isPending
  const inativas = todasAsContas.length - contasAtivas.length
  const caminhoDaConta =
    inativas > 0 && !podeReativarConta
      ? { ...CAMINHOS.conta, pedido: 'Peça a quem administra o sistema para reativá-la ou cadastrar outra conta.' }
      : CAMINHOS.conta
  const conflito = erros.motivo === 'conflito' && emEdicao !== null

  function definir(parciais: Partial<ValoresTransferencia>): void {
    setValores((anteriores) => ({ ...anteriores, ...parciais }))
  }

  function paraPayload(): PayloadTransferencia {
    const obs = valores.obs.trim()
    return {
      conta_origem_id: Number(valores.conta_origem_id),
      conta_destino_id: Number(valores.conta_destino_id),
      valor: paraDecimalDaApi(valores.valor),
      data,
      obs: obs === '' ? null : obs,
    }
  }

  function salvar(): void {
    const fechar = { onSuccess: aoFechar }
    if (emEdicao === null) {
      criar.mutate(paraPayload(), fechar)
      return
    }
    atualizar.mutate({ id: emEdicao.id, payload: paraPayload(), versao: emEdicao.updated_at }, fechar)
  }

  async function recarregar(): Promise<void> {
    if (emEdicao === null) return
    setRecarregando(true)
    try {
      const fresca = await buscarTransferencia(emEdicao.id)
      limparErros()
      setEmEdicao(fresca)
      setValores(valoresIniciais(fresca))
    } catch {
      notificar({ tom: 'erro', titulo: 'Não foi possível recarregar a transferência. Tente de novo em instantes.' })
    } finally {
      setRecarregando(false)
    }
  }

  const erroDe = (campo: string): string | undefined => erros.campos.get(campo)

  return (
    <JanelaDeFormulario
      titulo={emEdicao === null ? 'Transferir entre contas' : 'Editar transferência'}
      descricao={EXPLICACAO_DA_TRANSFERENCIA}
      aoFechar={aoFechar}
      aoSubmeter={salvar}
      salvando={salvando}
      rotuloSalvar={emEdicao === null ? 'Transferir' : 'Salvar'}
      podeSalvar={!contasIguais && !faltaConta && !contas.isError && !carregandoContas}
      semSalvar={faltaConta}
      carregando={carregandoContas}
      idsDoAviso={faltaConta ? [idDoAviso, idDoPedido] : undefined}
      focoAoFechar={focoAoFechar}
    >
      {carregandoContas ? (
        <EsqueletoDoFormulario />
      ) : faltaConta ? (
        // o aviso entra na DESCRIÇÃO do diálogo: quem usa leitor de tela ouve o motivo ao abrir, e não só
        // a frase genérica do que é transferência (A11Y-AVI-03)
        <EstadoVazio
          idDoTexto={idDoAviso}
          titulo="Falta uma conta para transferir"
          descricao={motivoDaFaltaDeConta(contasAtivas, inativas, podeReativarConta, podeCadastrarConta)}
          acao={<AcaoDoPreRequisito para={caminhoDaConta} aoNavegar={aoFechar} idDoPedido={idDoPedido} />}
        />
      ) : (
        <>
          <AvisoErro mensagens={conflito ? [] : erros.gerais} />
          <AvisoConflito
            visivel={conflito}
            aoRecarregar={() => {
              void recarregar()
            }}
            recarregando={recarregando}
          />
          {contas.isError ? (
            <AvisoErro
              mensagens={[
                'Não foi possível carregar as contas. Você pode não ter permissão para vê-las — fale com o administrador.',
              ]}
            />
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            {/* a mensagem mora DENTRO da célula do campo: sob a grade ela apontaria para o vizinho */}
            <div className="flex flex-col gap-1">
              <CampoSelect
                rotulo="De (conta de origem)"
                obrigatorio
                placeholder="Selecione a conta"
                value={valores.conta_origem_id}
                onChange={(evento) => {
                  definir({ conta_origem_id: evento.target.value })
                }}
                opcoes={opcoesDeConta}
                ajuda="De onde o dinheiro sai."
                erro={erroDe('conta_origem_id')}
              />
            </div>
            <div className="flex flex-col gap-1">
              <CampoSelect
                rotulo="Para (conta de destino)"
                obrigatorio
                placeholder="Selecione a conta"
                value={valores.conta_destino_id}
                onChange={(evento) => {
                  definir({ conta_destino_id: evento.target.value })
                }}
                opcoes={opcoesDeConta}
                ajuda="Para onde o dinheiro vai."
                erro={contasIguais ? RAZAO_DAS_CONTAS_IGUAIS : erroDe('conta_destino_id')}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <CampoTexto
              rotulo="Valor (R$)"
              inputMode="decimal"
              obrigatorio
              placeholder="0,00"
              value={valores.valor}
              onChange={(evento) => {
                definir({ valor: evento.target.value })
              }}
              erro={erroDe('valor')}
            />
            <CampoTexto
              rotulo="Data"
              type="date"
              obrigatorio
              value={data}
              onChange={(evento) => {
                definir({ data: evento.target.value })
              }}
              ajuda="O dia em que o dinheiro mudou de conta."
              erro={erroDe('data')}
            />
          </div>

          <CampoTextoLongo
            rotulo="Observação"
            limite={255}
            value={valores.obs}
            onChange={(evento) => {
              definir({ obs: evento.target.value })
            }}
            erro={erroDe('obs')}
          />
        </>
      )}
    </JanelaDeFormulario>
  )
}
