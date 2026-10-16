import { useQuery } from '@tanstack/react-query'
import { AlertDialog } from 'radix-ui'
import { useEffect, useRef, useState } from 'react'

import { SeloDeCicloFechado } from '@/componentes/ciclos/selo-de-ciclo-fechado'
import { Botao } from '@/componentes/ui/botao'
import { CampoSelect } from '@/componentes/ui/campo-select'
import { CampoTexto } from '@/componentes/ui/campo-texto'
import { CampoTextoLongo } from '@/componentes/ui/campo-texto-longo'
import { DialogConfirmacao } from '@/componentes/ui/dialog-confirmacao'
import { EstadoErro } from '@/componentes/ui/estado-erro'
import { AvisoErro } from '@/componentes/ui/aviso-erro'
import { Skeleton } from '@/componentes/ui/skeleton'
import { usarMutacaoDeEvolucao } from '@/hooks/usar-mutacao-de-atendimento'
import { chaves } from '@/lib/chaves-query'
import { dataHoraLegivel } from '@/lib/datas'
import { primeiroControleFocavel } from '@/lib/primeiro-controle-focavel'
import { opcoesDeProfissional } from '@/lib/profissionais'
import { buscarEvolucao } from '@/servicos/atendimentos'
import { buscarConfiguracaoAgenda, listarProfissionais } from '@/servicos/catalogos'
import { useAuthStore } from '@/stores/auth-store'
import type { DestinoDaEvolucao, EvolucaoDetalhe, SessaoAoSalvarEvolucao } from '@/tipos'

const LIMITE_CONTEUDO = 20000

interface FormularioEvolucaoProps {
  /** O atendimento registrado, ou a sessão ainda sem registro — que a evolução registra junto (D1) */
  destino: DestinoDaEvolucao
  /** Ausente = evolução nova; presente = ler/editar a existente */
  evolucaoId?: number
  /** Sugestão de autoria: o profissional do agendamento */
  profissionalSugerido?: number | null
  /** O que salvar a evolução NOVA fez com a sessão (evolucao-finaliza-a-sessao) */
  aoRegistrar?: (sessao: SessaoAoSalvarEvolucao | undefined) => void
  aoFechar: () => void
}

export function FormularioEvolucao({
  destino,
  evolucaoId,
  profissionalSugerido,
  aoRegistrar,
  aoFechar,
}: FormularioEvolucaoProps) {
  const detalhe = useQuery({
    queryKey: chaves.evolucao(evolucaoId ?? 0),
    queryFn: () => buscarEvolucao(evolucaoId as number),
    enabled: evolucaoId !== undefined,
    // DUAS razões, e cada uma bastaria sozinha:
    //
    // 1. CHAVE-DETALHE — o formulário hidrata `useState` a partir desta query, e o
    //    `useState` inicializa UMA vez. Com cache quente, reabrir montaria sobre o dado
    //    VELHO e a segunda edição REVERTERIA a primeira. Nos tratamentos isso apagou a
    //    matrícula de um menor; aqui apagaria a OBSERVAÇÃO CLÍNICA DE UMA CRIANÇA.
    //
    // 2. A leitura é AUDITADA (art. 11): cada GET do prontuário grava `consultou`. Servido
    //    pelo cache, o segundo profissional que abrisse não apareceria na trilha — e a
    //    auditoria estaria MENTINDO sobre quem leu o prontuário de um menor.
    //
    // `staleTime: 0` NÃO substitui o `gcTime: 0`: ele dispara o refetch, mas o PRIMEIRO
    // render ainda enxerga o dado do cache — e é nele que o `useState` hidrata. Quem
    // garante que o formulário só nasce com dado FRESCO é o `gcTime: 0` (sem entrada no
    // cache, a query nasce `isPending` e o Skeleton segura o formulário).
    gcTime: 0,
    staleTime: 0,
  })

  if (evolucaoId !== undefined && detalhe.isPending) {
    return <Skeleton className="h-64 w-full" />
  }

  if (evolucaoId !== undefined && detalhe.isError) {
    return (
      <EstadoErro
        mensagem="Não foi possível abrir a evolução desta sessão."
        aoTentarNovamente={() => void detalhe.refetch()}
      />
    )
  }

  // remonta do zero quando o detalhe troca: o `useState` de dentro nunca reinicializa
  return (
    <FormularioCarregado
      key={detalhe.data?.id ?? 'nova'}
      destino={destino}
      evolucao={detalhe.data}
      profissionalSugerido={profissionalSugerido}
      aoRegistrar={aoRegistrar}
      aoFechar={aoFechar}
    />
  )
}

function FormularioCarregado({
  destino,
  evolucao,
  profissionalSugerido,
  aoRegistrar,
  aoFechar,
}: {
  destino: DestinoDaEvolucao
  evolucao?: EvolucaoDetalhe
  profissionalSugerido?: number | null
  aoRegistrar?: (sessao: SessaoAoSalvarEvolucao | undefined) => void
  aoFechar: () => void
}) {
  const { erros, registrar, atualizar, salvando } = usarMutacaoDeEvolucao()
  const vinculo = useAuthStore((estado) => estado.usuario?.profissional_id ?? null)
  const podeEditar = useAuthStore((estado) => estado.temPermissao('evolucoes.editar'))
  const podeAssinarPorOutro = useAuthStore((estado) => estado.temPermissao('evolucoes.assinar_por_outro'))

  // a lista é catálogo pequeno e cacheado — e agora ela é necessária SEMPRE, para dizer
  // QUEM assinou o prontuário (ver abaixo), não só para escolher o autor
  const profissionais = useQuery({
    queryKey: chaves.profissionais(),
    queryFn: listarProfissionais,
  })

  // REGRA É DADO (§13): a obrigatoriedade do responsável técnico vem da configuração da
  // clínica, nunca de um `if` na tela.
  const configuracao = useQuery({
    queryKey: chaves.configuracaoAgenda(),
    queryFn: buscarConfiguracaoAgenda,
  })
  const responsavelObrigatorio = configuracao.data?.responsavelTecnicoObrigatorio === true

  const editando = evolucao !== undefined

  const [conteudo, setConteudo] = useState(evolucao?.conteudo ?? '')
  // Só faz sentido ESCOLHER o autor ao CRIAR. Ao editar, o autor é quem escreveu — e nem o
  // vinculado nem ninguém o reescreve por acidente (ver `salvar`).
  const [autor, setAutor] = useState<string>(() => {
    const inicial = vinculo ?? profissionalSugerido ?? null

    return inicial !== null ? String(inicial) : ''
  })
  const [responsavel, setResponsavel] = useState<string>(
    evolucao?.responsavel_tecnico_id != null ? String(evolucao.responsavel_tecnico_id) : '',
  )
  // Exceção de autoria (FA-04): sem vínculo, criar é assinar EM NOME DE OUTRO —
  // motivo obrigatório + confirmação DIGITADA (o padrão do CORRIGIR).
  const assinandoPorOutro = !editando && vinculo === null
  const [motivo, setMotivo] = useState('')
  const [confirmandoAssinatura, setConfirmandoAssinatura] = useState(false)

  const nomeDoAutor =
    (profissionais.data ?? []).find((p) => p.id === evolucao?.profissional_id)?.nome ?? null
  const nomeDoAutorEscolhido =
    (profissionais.data ?? []).find((p) => p.id === Number(autor))?.nome ?? 'outro profissional'

  // Autoria alheia é LEITURA para quem tem vínculo: o servidor recusa a edição de registro
  // que não é seu (T-ate-06, "só registra evolução em nome próprio") — um "Salvar" aqui
  // prometeria o que o servidor SEMPRE nega (re-review I-3).
  const autoriaAlheia = editando && vinculo !== null && evolucao.profissional_id !== vinculo

  const somenteLeitura = editando && (!podeEditar || autoriaAlheia)

  // Ciclo fechado (D7): a produção deste período já foi enviada à operadora e o servidor
  // recusa o PUT com 422. O booleano vem DO REGISTRO (SEC-FC-09) — a tela não conhece o
  // calendário do convênio nem a lista de fechamentos, e não pode conhecer.
  //
  // Ele NÃO entra no `somenteLeitura`: aquele desabilita o campo, e o padrão da casa é
  // **esconder a AÇÃO, nunca desabilitar campo por regra de servidor** (D7, precedente do
  // "Excluir" que some do lançamento pago). O texto clínico continua legível e copiável;
  // some o botão que gravaria, e o selo diz por quê — botão que some sem explicação vira
  // suspeita de bug, e a pessoa vai tentar pelo caminho torto.
  const emCicloFechado = evolucao?.em_ciclo_fechado === true
  const gravacaoBloqueada = somenteLeitura || emCicloFechado

  // O campo do responsável aparece para CRIAR (sempre que a clínica o exige) e, na EDIÇÃO,
  // só para preencher a LACUNA de uma evolução anterior à configuração — sem ele, editar o
  // conteúdo de uma evolução sem responsável era beco sem saída: 422 num campo que o modo
  // edição não renderizava (re-review I-2). Trocar um responsável já assinado continua fora.
  const responsavelEmFalta = !editando || evolucao.responsavel_tecnico_id == null
  // `gravacaoBloqueada`, não `somenteLeitura`: em ciclo fechado não há gravação nenhuma —
  // oferecer o campo que só existe para PREENCHER a lacuna seria oferecer um beco sem saída.
  const mostrarResponsavel = responsavelObrigatorio && !gravacaoBloqueada && responsavelEmFalta

  function salvar(evento: React.FormEvent) {
    evento.preventDefault()

    if (editando) {
      // `profissional_id` NÃO VAI no PUT.
      //
      // Ele é a AUTORIA do prontuário de uma criança. O formulário o mandava sempre, com o
      // vínculo de QUEM ABRIU — então quem editasse a evolução escrita por outra
      // profissional a assinava com o próprio nome, em silêncio, e a produção e a pendência
      // migravam junto (gate CR, BLOQUEANTE 2).
      //
      // No servidor ele agora é `prohibited` na edição (SEC-R2-01): a autoria é imutável
      // no boundary, não só escondida da tela.
      atualizar.mutate(
        {
          id: evolucao.id,
          // token da leitura fresca que hidratou o formulário (gcTime: 0)
          versao: evolucao.updated_at,
          payload: {
            conteudo,
            // só para PREENCHER a lacuna (re-review I-2) — nunca para trocar
            ...(responsavel !== '' && evolucao.responsavel_tecnico_id == null
              ? { responsavel_tecnico_id: Number(responsavel) }
              : {}),
          },
        },
        { onSuccess: aoFechar },
      )

      return
    }

    // Exceção de autoria (FA-04): quem não assina em nome próprio só grava DEPOIS
    // da confirmação digitada — a mutação vive no diálogo, não aqui.
    if (assinandoPorOutro) {
      setConfirmandoAssinatura(true)

      return
    }

    registrar.mutate(
      {
        destino,
        payload: {
          profissional_id: Number(autor),
          conteudo,
          // chave ausente é chave preservada: só mandamos o responsável quando ele existe
          ...(responsavel !== '' ? { responsavel_tecnico_id: Number(responsavel) } : {}),
        },
      },
      {
        onSuccess: (resposta) => {
          aoRegistrar?.(resposta.sessao)
          aoFechar()
        },
      },
    )
  }

  /** A mutação da exceção — o motivo vai junto; erro mantém o diálogo aberto. */
  async function assinarPorOutro(): Promise<void> {
    const resposta = await registrar.mutateAsync({
      destino,
      payload: {
        profissional_id: Number(autor),
        conteudo,
        motivo_assinatura: motivo,
        ...(responsavel !== '' ? { responsavel_tecnico_id: Number(responsavel) } : {}),
      },
    })
    aoRegistrar?.(resposta.sessao)
    aoFechar()
  }

  // Fail-closed na tela (o controle real é o authorize() do servidor): sem a
  // permissão de exceção, o sem-vínculo não recebe um formulário que o 403 negaria.
  if (assinandoPorOutro && !podeAssinarPorOutro) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-corpo text-texto-suave">
          Registrar evolução em nome de outro profissional exige a liberação do administrador
          (permissão de assinatura por outro).
        </p>
        <div className="flex justify-end">
          <Botao type="button" variante="secundario" tamanho="lg" onClick={aoFechar}>
            Fechar
          </Botao>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={salvar} className="flex flex-col gap-4">
      {/* Quem escreveu e quando — ANTES de editar. Sem isto, quem abre o prontuário de
          outra pessoa não sabe que está mexendo em registro alheio, e o texto perdido
          numa edição concorrente NÃO é recuperável pela trilha (o conteúdo é mascarado). */}
      {/* QUEM assinou, e quando — antes de qualquer edição.
          Sem o NOME, quem abre o prontuário de outra profissional não sabe que é alheio: era
          essa a compensação que o gatilho EVO-LOSTUPDATE exigia desta change (o texto perdido
          numa edição concorrente NÃO é recuperável nem pela trilha — `conteudo` é mascarado
          por exigência do art. 11). */}
      {editando ? (
        <p className="text-meta text-texto-suave">
          {nomeDoAutor !== null ? `Registrada por ${nomeDoAutor}` : 'Registrada'} em{' '}
          {dataHoraLegivel(evolucao.preenchida_em)}.
        </p>
      ) : null}

      {/* Antes de tudo: por que "Salvar evolução" não está aqui. O selo NÃO nomeia o
          convênio nem o período — a tela só tem o booleano do registro (SEC-FC-09). */}
      {emCicloFechado ? <SeloDeCicloFechado className="self-start" /> : null}

      {/* A recusa que chega pelo servidor (tela velha, aba antiga, ciclo fechado entre o
          GET e o PUT) pousa em `gerais` — `ciclo_fechado` não é campo do formulário. */}
      <AvisoErro mensagens={erros.gerais} />

      {/* A autoria só se escolhe ao CRIAR. Ao editar, ela não muda — nem por acidente. */}
      {!editando && vinculo === null ? (
        <CampoSelect
          rotulo="Responsável pela evolução"
          obrigatorio
          value={autor}
          onChange={(evento) => {
            setAutor(evento.target.value)
          }}
          erro={erros.campos.get('profissional_id')}
          // profissional DESLIGADO não assina prontuário de menor (re-review r10)
          opcoes={opcoesDeProfissional(profissionais.data ?? [], autor !== '' ? Number(autor) : null)}
        />
      ) : null}
      {assinandoPorOutro ? (
        <CampoTexto
          rotulo="Motivo de registrar em nome de outro"
          obrigatorio
          value={motivo}
          onChange={(evento) => {
            setMotivo(evento.target.value)
          }}
          maxLength={500}
          erro={erros.campos.get('motivo_assinatura')}
          ajuda="Fica registrado na trilha de auditoria — não inclua dado clínico."
          // mesmo motivo do campo de conteúdo: o corretor "enhanced" do navegador
          // envia o texto ao fornecedor — nada daqui sai da clínica por default
          spellCheck={false}
          autoComplete="off"
        />
      ) : null}
      {!editando && vinculo !== null ? (
        <p className="text-meta text-texto-suave">
          A evolução será registrada em seu nome — é o seu vínculo profissional.
        </p>
      ) : null}

      {/* O servidor RECUSA a evolução sem responsável técnico quando a clínica liga a
          configuração. Sem este campo, ligá-la tornava IMPOSSÍVEL registrar qualquer
          evolução — 422 numa chave que a tela não tinha, com o texto clínico preso no
          formulário (gate CR, IMPORTANTE 1). */}
      {mostrarResponsavel ? (
        <CampoSelect
          rotulo="Responsável técnico"
          obrigatorio
          value={responsavel}
          onChange={(evento) => {
            setResponsavel(evento.target.value)
          }}
          // sem o placeholder, o select nativo EXIBIA a primeira profissional enquanto o
          // formulário mandava vazio: campo que parece preenchido e o servidor recusa como
          // ausente (achado dirigindo a app real, re-review rodada 2)
          placeholder="Selecione o responsável técnico"
          erro={erros.campos.get('responsavel_tecnico_id')}
          opcoes={opcoesDeProfissional(
            profissionais.data ?? [],
            responsavel !== '' ? Number(responsavel) : null,
          )}
        />
      ) : null}

      <CampoTextoLongo
        rotulo="Evolução da sessão"
        obrigatorio
        value={conteudo}
        onChange={(evento) => {
          setConteudo(evento.target.value)
        }}
        // sem `evolucoes.editar`, o prontuário se LÊ, não se altera: um campo editável com
        // botão de salvar prometeria o que o servidor nega com 403 (gate CR, IMPORTANTE 3)
        disabled={somenteLeitura}
        maxLength={LIMITE_CONTEUDO}
        erro={erros.campos.get('conteudo')}
        // O corretor "enhanced" do Chrome e o Editor do Edge ENVIAM o texto do campo para
        // os servidores do fornecedor. Dado de saúde de um MENOR não sai da clínica por um
        // default de navegador.
        spellCheck={false}
        autoComplete="off"
      />

      <div className="flex justify-end gap-3">
        <Botao type="button" variante="secundario" tamanho="lg" onClick={aoFechar} disabled={salvando}>
          {gravacaoBloqueada ? 'Fechar' : 'Cancelar'}
        </Botao>
        {gravacaoBloqueada ? null : (
          <Botao type="submit" tamanho="lg" carregando={salvando}>
            {editando ? 'Salvar evolução' : 'Registrar evolução'}
          </Botao>
        )}
      </div>

      {/* A confirmação DIGITADA da exceção (FA-04, padrão do CORRIGIR): a palavra é
          fricção de UI — o controle é o servidor (permissão + motivo). Título e
          consequência levam SÓ o nome do profissional, nunca conteúdo clínico. */}
      {assinandoPorOutro ? (
        <DialogConfirmacao
          aberto={confirmandoAssinatura}
          aoMudarAberto={setConfirmandoAssinatura}
          titulo={`Registrar em nome de ${nomeDoAutorEscolhido}?`}
          consequencia={
            'Você está assinando a evolução em nome de outra pessoa. A exceção fica '
            + 'registrada na trilha de auditoria: quem digitou, em nome de quem e o motivo.'
          }
          rotuloConfirmar="Assinar em nome de outro"
          tom="atencao"
          palavraDeConfirmacao="ASSINAR"
          carregando={salvando}
          erros={[
            ...erros.gerais,
            // TODO campo do formulário está atrás deste modal no fluxo da exceção —
            // toda recusa por campo aparece DENTRO dele (CR-CA-05: a mensagem fica
            // onde a pessoa está olhando; gate I-2)
            ...erros.campos.values(),
          ]}
          aoConfirmar={assinarPorOutro}
        />
      ) : null}
    </form>
  )
}

/** O diálogo — o conteúdo clínico NUNCA vai para o título (só o que a sessão é). */
export function DialogoDeEvolucao({
  aberto,
  aoMudarAberto,
  destino,
  evolucaoId,
  profissionalSugerido,
  nomeDaCrianca,
  aoRegistrar,
  focoAoFechar,
  avisoAoRegistrar,
}: {
  aberto: boolean
  aoMudarAberto: (aberto: boolean) => void
  destino: DestinoDaEvolucao
  evolucaoId?: number
  profissionalSugerido?: number | null
  nomeDaCrianca: string
  aoRegistrar?: (sessao: SessaoAoSalvarEvolucao | undefined) => void
  /**
   * Para onde o foco vai ao fechar, quando o botão que abriu o diálogo SUMIU (2.4.3): registrar a
   * evolução troca o ramo da seção, e o Radix devolveria o foco ao `body`. `null` = o padrão do Radix.
   */
  focoAoFechar?: () => HTMLElement | null
  /** O efeito de registrar além do prontuário — "a sessão é finalizada e desconta do pacote" (A11Y-EVO-03). */
  avisoAoRegistrar?: string
}) {
  /**
   * O diálogo NÃO MUDA DE IDENTIDADE debaixo de quem o abriu.
   *
   * `evolucaoId` vem do atendimento, e registrar a evolução faz o atendimento ser
   * reinvalidado — ou seja, o id APARECE enquanto o diálogo ainda está aberto. Sem congelar,
   * o "Registrar evolução" virava "Evolução da sessão" no meio do salvamento: a query do
   * detalhe ligava, o formulário desmontava para dar lugar ao Skeleton, e o React Query
   * **descarta os callbacks de um componente que desmontou** — o `aoFechar` nunca rodava e o
   * diálogo ficava aberto, como se nada tivesse acontecido. (Achado dirigindo a app real: a
   * suíte não via, porque ela assertava o payload, não o fechamento.)
   *
   * Congelado na abertura, o diálogo termina o que começou — e a próxima abertura já lê o id
   * fresco e abre em modo de leitura/edição.
   */
  const [idCongelado, setIdCongelado] = useState(evolucaoId)

  useEffect(() => {
    if (aberto) {
      setIdCongelado(evolucaoId)
    }
    // de propósito: só re-sincroniza na ABERTURA, nunca durante
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto])

  const editando = idCongelado !== undefined

  // Aberto pelo estado, sem `AlertDialog.Trigger`: o Radix não conhece o gatilho e devolvia o foco ao
  // `body` (medido no navegador). Mesmo molde do `Dialog` e do `DialogConfirmacao`
  const refDisparador = useRef<HTMLElement | null>(null)
  const refConteudo = useRef<HTMLDivElement>(null)

  return (
    <AlertDialog.Root open={aberto} onOpenChange={aoMudarAberto}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-(--z-scrim) bg-texto/40" />
        <AlertDialog.Content
          className="fixed left-1/2 top-1/2 z-(--z-dialogo) max-h-[90vh] w-full max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-janela bg-superficie-elevada p-6 shadow-e3"
          ref={refConteudo}
          onOpenAutoFocus={(evento) => {
            // O padrão do AlertDialog foca o `AlertDialog.Cancel` — que este diálogo não tem: o foco
            // ficava no botão de trás, sob o diálogo e numa árvore `aria-hidden` (A11Y-EVO-01). Vai ao
            // primeiro campo; enquanto o formulário carrega, ao próprio diálogo
            evento.preventDefault()
            // o `body` não é quem abriu (o molde do Editar da agenda)
            const ativo = document.activeElement
            refDisparador.current = ativo instanceof HTMLElement && ativo !== document.body ? ativo : null
            const alvo = primeiroControleFocavel(refConteudo.current) ?? refConteudo.current
            alvo?.focus()
            // se o foco não entrou (um controle que o estilo esconde de um jeito não previsto), o diálogo o recebe
            if (refConteudo.current !== null && !refConteudo.current.contains(document.activeElement)) {
              refConteudo.current.focus()
            }
          }}
          onCloseAutoFocus={(evento) => {
            evento.preventDefault()
            // o destino explícito VENCE: salvar a evolução pode apagar o próprio gatilho
            const alvo = focoAoFechar?.() ?? null
            if (alvo !== null) {
              alvo.focus()
            } else {
              refDisparador.current?.focus()
            }
            refDisparador.current = null
          }}
        >
          {/* O NOME identifica a sessão; o CONTEÚDO nunca sobe para cá. Título, aba do
              navegador, toast e URL são superfícies de vazamento de dado clínico. */}
          <AlertDialog.Title className="text-titulo font-semibold text-texto">
            {editando ? 'Evolução da sessão' : 'Registrar evolução'} — {nomeDaCrianca}
          </AlertDialog.Title>
          <AlertDialog.Description className="mt-1 text-meta text-texto-suave">
            Registro clínico da sessão. Fica na ficha da criança e não pode ser excluído.
            {!editando && avisoAoRegistrar !== undefined ? ` ${avisoAoRegistrar}` : ''}
          </AlertDialog.Description>

          <div className="mt-5">
            {aberto ? (
              <FormularioEvolucao
                destino={destino}
                evolucaoId={idCongelado}
                profissionalSugerido={profissionalSugerido}
                aoRegistrar={aoRegistrar}
                aoFechar={() => {
                  aoMudarAberto(false)
                }}
              />
            ) : null}
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
