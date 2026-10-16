import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'

import {
  CampoMensagemDeCobranca,
  MENSAGEM_DE_COBRANCA_VAZIA,
} from '@/componentes/administracao/campo-mensagem-de-cobranca'
import { Botao } from '@/componentes/ui/botao'
import { CampoCheckbox } from '@/componentes/ui/campo-checkbox'
import { CampoSelect } from '@/componentes/ui/campo-select'
import { CampoTexto } from '@/componentes/ui/campo-texto'
import { usarToast } from '@/componentes/ui/toast'
import { chaves } from '@/lib/chaves-query'
import { CHAVE_ENCADEAMENTO_ALVO, rotuloDaOpcao } from '@/lib/configuracoes-rotulos'
import { ErroDeApi } from '@/lib/http'
import { salvarConfiguracao } from '@/servicos/configuracoes'
import type { AlvoEncadeamento, Configuracao, StatusQueFinaliza } from '@/tipos'

interface CampoDeConfiguracaoProps {
  config: Configuracao
  /**
   * Status que não descontam sessão — a lista dos ponteiros de status (o alvo do encadeamento e
   * os formatos `status`/`status_que_libera`). Os outros campos não a usam.
   */
  alvos: AlvoEncadeamento[]
  /** Status que FINALIZAM a sessão — a lista do formato `status_que_finaliza` (evolucao-finaliza-a-sessao). */
  finalizam: StatusQueFinaliza[]
  /** Se a leitura de alvos concluiu com sucesso — sem isso, não se julga "órfão". */
  alvosCarregou: boolean
  podeEditar: boolean
  /** Por que o campo está travado, quando a razão não é óbvia (a segurança, para quem não administra o acesso). */
  motivoSemEdicao?: string
  /**
   * Reporta edição digitada e NÃO salva (a página usa para a guarda da troca de aba).
   * Só os campos com botão "Salvar" reportam — o toggle de bool salva na hora, e o
   * sujo transitório dele (até o refetch assentar) dispararia a guarda à toa.
   */
  aoMudarSujo?: (chave: string, sujo: boolean) => void
}

/** O que muda entre os ponteiros de status: quem entra na lista, o nome do 0 e o aviso de órfão. */
interface PonteiroDeStatus {
  opcoes: AlvoEncadeamento[]
  rotuloDoZero: string
  /**
   * A frase de quando o valor gravado saiu da lista. Começa pelo NOME do campo: ela vira o erro do
   * próprio select (`aria-invalid` + `aria-describedby`), e numa aba com três ponteiros a frase
   * solta não dizia de qual deles falava (achado A11Y-BT-02 do gate).
   */
  avisoDeOrfao: string
}

/**
 * O campo é um PONTEIRO de status? O alvo do encadeamento é reconhecido pela chave (é anterior aos
 * formatos); os demais, pelo `formato` que o catálogo publica (change lembrete-com-botoes-de-resposta)
 * — nunca pela chave. O valor gravado é o id; na tela, a pessoa escolhe pelo NOME.
 */
function ponteiroDeStatus(
  config: Configuracao,
  alvos: AlvoEncadeamento[],
  finalizam: StatusQueFinaliza[],
): PonteiroDeStatus | null {
  if (config.chave === CHAVE_ENCADEAMENTO_ALVO) {
    return {
      opcoes: alvos,
      rotuloDoZero: 'Desligado',
      avisoDeOrfao: `${config.rotulo}: o status-alvo atual foi excluído ou passou a descontar sessão — o encadeamento não vai disparar. Escolha um status válido ou deixe desligado.`,
    }
  }
  if (config.formato === 'status') {
    return {
      opcoes: alvos,
      rotuloDoZero: 'Não configurado',
      avisoDeOrfao: `${config.rotulo}: o status gravado foi excluído ou passou a descontar sessão. Escolha um status da lista ou deixe não configurado.`,
    }
  }
  if (config.formato === 'status_que_libera') {
    return {
      // só quem DEVOLVE o horário: é o que libera a vaga para outra criança (o servidor recusa o resto)
      opcoes: alvos.filter((alvo) => alvo.ocupa_horario === false),
      rotuloDoZero: 'Não configurado',
      avisoDeOrfao: `${config.rotulo}: o status gravado foi excluído, passou a descontar sessão ou deixou de liberar o horário. Escolha um status da lista ou deixe não configurado.`,
    }
  }
  if (config.formato === 'status_que_finaliza') {
    return {
      // só quem FINALIZA: desconta a sessão, segura o horário e não é falta (o servidor recusa o resto)
      opcoes: finalizam,
      rotuloDoZero: 'Desligado',
      avisoDeOrfao: `${config.rotulo}: o status gravado foi excluído, deixou de descontar a sessão, passou a liberar o horário ou a marcar falta — salvar a evolução não vai finalizar a sessão. Escolha um status da lista ou deixe desligado.`,
    }
  }

  return null
}

/** Fusos IANA que o navegador conhece — a mesma família que o servidor valida. */
function fusosDisponiveis(): string[] {
  const comApi = Intl as unknown as { supportedValuesOf?: (chave: string) => string[] }
  return comApi.supportedValuesOf?.('timeZone') ?? ['America/Sao_Paulo']
}

/**
 * Um campo de configuração — widget derivado do TIPO e dos metadados do catálogo, nunca
 * hardcoded por chave (a exceção é o status-alvo do encadeamento, anterior aos formatos de
 * status). Escrita CHAVE A CHAVE: salva individualmente, com erro 422 no próprio campo.
 */
export function CampoDeConfiguracao({
  config,
  alvos,
  finalizam,
  alvosCarregou,
  podeEditar,
  motivoSemEdicao,
  aoMudarSujo,
}: CampoDeConfiguracaoProps) {
  const queryClient = useQueryClient()
  const { notificar } = usarToast()
  const [valor, setValor] = useState<string | number | boolean>(config.valor)
  const [erro, setErro] = useState<string | undefined>(undefined)
  const ponteiro = useMemo(() => ponteiroDeStatus(config, alvos, finalizam), [config, alvos, finalizam])

  // o rótulo vem do catálogo do servidor: a tela não tem dicionário próprio para
  // ficar desatualizado, e por isso não existe caminho em que ela mostre a chave crua
  const rotulo = config.rotulo
  const sujo = valor !== config.valor

  // pendência = sujo num campo que exige "Salvar"; int compara normalizado (o input
  // devolve string, e "40" !== 40 marcaria sujo um valor idêntico ao efetivo). O ponteiro de
  // status reporta a PRÓPRIA pendência (o widget dele guarda a escolha)
  const pendente =
    config.tipo !== 'bool'
    && ponteiro === null
    && (config.tipo === 'int' ? Number(valor) !== Number(config.valor) : sujo)

  useEffect(() => {
    aoMudarSujo?.(config.chave, pendente)
  }, [aoMudarSujo, config.chave, pendente])

  // ao desmontar (troca de aba confirmada), a pendência morre com o campo
  useEffect(
    () => () => {
      aoMudarSujo?.(config.chave, false)
    },
    [aoMudarSujo, config.chave],
  )

  const mutacao = useMutation({
    retry: 0,
    mutationFn: (novo: string | number | boolean) => salvarConfiguracao(config.chave, novo),
    onMutate: () => {
      setErro(undefined)
    },
    onSuccess: async (resultado) => {
      // maker-checker (AP-13): desligar flag `seguranca.*` com a dupla ligada → 202,
      // o valor VIGENTE não mudou — o toggle volta ao que está valendo
      if (!resultado.aplicado) {
        setValor(config.valor)
        await queryClient.invalidateQueries({ queryKey: chaves.aprovacoesDeAcesso() })
        notificar({
          tom: 'aviso',
          titulo: 'Mudança enviada para aprovação.',
          descricao: 'Outro administrador precisa aprovar antes de ela valer.',
        })
        return
      }
      await queryClient.invalidateQueries({ queryKey: chaves.configuracoes() })
      // a seleção da agenda carrega flags DERIVADAS das configurações (o status do desmarque, da família…)
      // e os avisos de pré-requisito leem dela: sem isto, quem configura pelo menu volta à agenda e o aviso
      // continua dizendo que falta, por até 10 minutos de cache (gate CR-AVI-02)
      await queryClient.invalidateQueries({ queryKey: chaves.selecaoDaAgenda() })
      notificar({ tom: 'sucesso', titulo: `${rotulo} atualizado.` })
    },
    onError: (falha: unknown) => {
      const mensagem =
        falha instanceof ErroDeApi
          ? (falha.camposInvalidos.valor?.[0] ?? falha.message)
          : 'Não foi possível salvar.'
      setErro(mensagem)
    },
  })

  function salvar(novo: string | number | boolean): void {
    mutacao.mutate(novo)
  }

  /** "Salvar" dos campos que não salvam na hora — `bloqueado` soma a trava própria do widget. */
  function botaoSalvar(bloqueado: boolean) {
    return podeEditar ? (
      <Botao
        type="button"
        variante="secundario"
        disabled={!sujo || bloqueado || mutacao.isPending}
        carregando={mutacao.isPending}
        onClick={() => {
          salvar(config.tipo === 'int' ? Number(valor) : valor)
        }}
      >
        Salvar
      </Botao>
    ) : null
  }

  // ── bool → toggle que salva na hora (sem botão) ───────────────────────────────────
  if (config.tipo === 'bool') {
    return (
      <CampoCheckbox
        rotulo={rotulo}
        erro={erro}
        ajuda={podeEditar ? undefined : motivoSemEdicao}
        marcado={valor === true}
        desabilitado={!podeEditar || mutacao.isPending}
        aoMudar={(marcado) => {
          setValor(marcado)
          salvar(marcado)
        }}
      />
    )
  }

  // ── ponteiro de status: lista com os NOMES, grava o id (widget dedicado, valida na leitura) ──
  if (ponteiro !== null) {
    return (
      <CampoDeStatus
        rotulo={rotulo}
        valorAtual={typeof config.valor === 'number' ? config.valor : Number(config.valor)}
        opcoesDeStatus={ponteiro.opcoes}
        rotuloDoZero={ponteiro.rotuloDoZero}
        avisoDeOrfao={ponteiro.avisoDeOrfao}
        alvosCarregou={alvosCarregou}
        podeEditar={podeEditar}
        salvando={mutacao.isPending}
        erro={erro}
        aoSalvar={(id) => {
          salvar(id)
        }}
        aoMudarSujo={(sujoAgora) => aoMudarSujo?.(config.chave, sujoAgora)}
      />
    )
  }

  // ── a mensagem de cobrança: texto longo com a PRÉVIA (pelo formato do catálogo, nunca pela chave) ──
  if (config.formato === 'mensagem_cobranca') {
    const texto = String(valor)
    // o vazio o servidor recusa com uma frase de tipo ("valor incompatível"): a tela diz antes, em
    // palavras da clínica, e segura o Salvar
    const vazia = texto.trim() === ''

    return (
      <div className="flex flex-col gap-3">
        <CampoMensagemDeCobranca
          rotulo={rotulo}
          valor={texto}
          erro={erro ?? (vazia ? MENSAGEM_DE_COBRANCA_VAZIA : undefined)}
          desabilitado={!podeEditar}
          aoMudar={setValor}
        />
        {podeEditar ? <div className="flex justify-end">{botaoSalvar(vazia)}</div> : null}
      </div>
    )
  }

  // o "Salvar" vai NA LINHA do controle (`acaoAoLado`): com o botão por fora do campo, um rótulo de
  // duas linhas no celular ou a ajuda e o erro embaixo o desalinhavam (gate r2 e r3, design-qa)
  const acaoAoLado = botaoSalvar(false) ?? undefined
  const controle =
    config.opcoes !== undefined ? (
      <CampoSelect
        rotulo={rotulo}
        erro={erro}
        ajuda={config.ajuda}
        acaoAoLado={acaoAoLado}
        disabled={!podeEditar}
        value={String(valor)}
        opcoes={config.opcoes.map((opcao) => ({ valor: opcao, rotulo: rotuloDaOpcao(opcao) }))}
        onChange={(evento) => {
          setValor(evento.target.value)
        }}
      />
    ) : config.formato === 'timezone' ? (
      <CampoSelect
        rotulo={rotulo}
        erro={erro}
        ajuda={config.ajuda}
        acaoAoLado={acaoAoLado}
        disabled={!podeEditar}
        value={String(valor)}
        opcoes={fusosDisponiveis().map((fuso) => ({ valor: fuso, rotulo: fuso }))}
        onChange={(evento) => {
          setValor(evento.target.value)
        }}
      />
    ) : (
      <CampoTexto
        rotulo={rotulo}
        erro={erro}
        ajuda={config.ajuda}
        acaoAoLado={acaoAoLado}
        disabled={!podeEditar}
        type={config.formato === 'hora' ? 'time' : config.formato === 'date' ? 'date' : config.tipo === 'int' ? 'number' : 'text'}
        min={config.tipo === 'int' ? config.min : undefined}
        max={config.tipo === 'int' ? config.max : undefined}
        value={String(valor)}
        onChange={(evento) => {
          setValor(evento.target.value)
        }}
      />
    )

  return controle
}

interface CampoDeStatusProps {
  rotulo: string
  valorAtual: number
  /** Os status que este ponteiro aceita — a lista que a pessoa vê, pelo nome. */
  opcoesDeStatus: AlvoEncadeamento[]
  /** O que o 0 quer dizer neste ponteiro ("Desligado", "Não configurado"). */
  rotuloDoZero: string
  /** A frase de quando o valor gravado não está mais na lista. */
  avisoDeOrfao: string
  alvosCarregou: boolean
  podeEditar: boolean
  salvando: boolean
  erro: string | undefined
  aoSalvar: (id: number) => void
  /** Escolha feita e não salva (o widget também exige "Salvar") — ver CampoDeConfiguracaoProps. */
  aoMudarSujo?: (sujo: boolean) => void
}

/**
 * Widget dos ponteiros de status — nasceu para o alvo do encadeamento e passou a servir os
 * formatos `status`/`status_que_libera` (change lembrete-com-botoes-de-resposta: a clínica
 * tropeçou no "número interno" em 28/09). Valida NA LEITURA (SEC-ADM / CONFIG-SEM-FK): se o
 * valor efetivo não é 0 nem está entre os status aceitos, ele foi excluído ou deixou de valer
 * para o ponteiro — a tela avisa e oferece corrigir ou zerar.
 *
 * `selecionado` é DERIVADO (não `useState` semeado uma vez): enquanto o usuário não toca,
 * ele reflete o estado atual dos `alvos`. Assim, se os alvos chegarem/erros mudarem depois
 * do mount, o campo não fica preso a um "órfão" fantasma que ofereceria gravar `0` sobre um
 * encadeamento válido (achado do code-review). Só se julga órfão com `alvosCarregou`.
 */
function CampoDeStatus({
  rotulo,
  valorAtual,
  opcoesDeStatus,
  rotuloDoZero,
  avisoDeOrfao,
  alvosCarregou,
  podeEditar,
  salvando,
  erro,
  aoSalvar,
  aoMudarSujo,
}: CampoDeStatusProps) {
  const [tocado, setTocado] = useState(false)
  const [escolha, setEscolha] = useState<number>(0)

  const orfao = alvosCarregou && valorAtual !== 0 && !opcoesDeStatus.some((alvo) => alvo.id === valorAtual)
  const selecionado = tocado ? escolha : orfao ? 0 : valorAtual
  const sujo = selecionado !== valorAtual

  useEffect(() => {
    aoMudarSujo?.(sujo)
  }, [aoMudarSujo, sujo])

  const opcoes = useMemo(
    () => [
      { valor: '0', rotulo: rotuloDoZero },
      ...opcoesDeStatus.map((alvo) => ({ valor: String(alvo.id), rotulo: alvo.nome })),
    ],
    [opcoesDeStatus, rotuloDoZero],
  )

  // sem os alvos, não se edita o alvo (nem se julga órfão) — não há como validar a escolha
  const editavel = podeEditar && alvosCarregou

  return (
    <div className="flex items-end gap-3">
      <div className="flex-1">
        {/* o órfão é ERRO do próprio campo — `aria-invalid` + descrição ligada ao select —, e não um
            parágrafo solto ao lado; a recusa do servidor, quando houver, fala primeiro */}
        <CampoSelect
          rotulo={rotulo}
          erro={erro ?? (orfao ? avisoDeOrfao : undefined)}
          disabled={!editavel}
          value={String(selecionado)}
          opcoes={opcoes}
          onChange={(evento) => {
            setTocado(true)
            setEscolha(Number(evento.target.value))
          }}
        />
      </div>
      {editavel ? (
        <Botao
          type="button"
          variante="secundario"
          disabled={!sujo || salvando}
          carregando={salvando}
          onClick={() => {
            aoSalvar(selecionado)
          }}
        >
          Salvar
        </Botao>
      ) : null}
    </div>
  )
}
