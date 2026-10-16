import { useQuery } from '@tanstack/react-query'
import { useCallback, useId, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { CampoDeConfiguracao } from '@/componentes/administracao/campo-de-configuracao'
import { SecaoCamposDoCadastro } from '@/componentes/administracao/secao-campos-do-cadastro'
import { SecaoIdentidadeDaClinica } from '@/componentes/administracao/secao-identidade-da-clinica'
import { SecaoLinkDeCadastro } from '@/componentes/administracao/secao-link-de-cadastro'
import { CabecalhoDeCadastro } from '@/componentes/cadastro/cabecalho-de-cadastro'
import { Botao } from '@/componentes/ui/botao'
import { DialogConfirmacao } from '@/componentes/ui/dialog-confirmacao'
import { EstadoErro } from '@/componentes/ui/estado-erro'
import { Skeleton } from '@/componentes/ui/skeleton'
import { chaves } from '@/lib/chaves-query'
import { CHAVES_DE_IDENTIDADE } from '@/lib/configuracoes-rotulos'
import { listarAlvosEncadeamento, listarConfiguracoes } from '@/servicos/configuracoes'
import { useAuthStore } from '@/stores/auth-store'
import type { Configuracao, LeituraDeConfiguracoes } from '@/tipos'

/** Uma aba: as chaves de uma seção, repartidas nos subtítulos que o servidor declarou. */
interface GrupoDeConfiguracao {
  id: string
  rotulo: string
  itens: Configuracao[]
  blocos: Array<{ id: string; rotulo: string; itens: Configuracao[] }>
}

/** A aba de exceção, para chave cuja seção o servidor não declarou. Vai sempre por último. */
const SECAO_SEM_DECLARACAO = '__sem-secao'

/**
 * O rótulo neutro, usado na ABA de exceção e no BLOCO órfão.
 *
 * A spec declara que os dois níveis dividem a mesma palavra **de propósito**. Com dois
 * literais soltos isso era coincidência de digitação, não decisão: trocar o rótulo da aba
 * deixaria o do bloco para trás em silêncio — a tese desta change ("nenhuma lista manual
 * paralela") reaparecendo um andar abaixo, em miniatura (achado design-qa r4).
 *
 * Se um dia os níveis ganharem nomes distintos, viram duas constantes nomeadas — por decisão,
 * e não por descuido.
 */
const ROTULO_NEUTRO = 'Outros ajustes'

/** Uma aba que a tela acrescenta e que NÃO vem do catálogo (Cadastro). */
function abaSemCatalogo(id: string, rotulo: string): GrupoDeConfiguracao {
  return { id, rotulo, itens: [], blocos: [] }
}

/** O motivo, no lugar do interruptor, para quem edita configurações mas não administra o acesso. */
const SEGURANCA_DE_QUEM_ADMINISTRA = 'As configurações de segurança são de quem administra o acesso da clínica.'

/**
 * Configurações da clínica (§13), sob `configuracoes.ver` (escrita sob
 * `configuracoes.editar`). Regra de negócio parametrizável é DADO: a tela lê o catálogo
 * efetivo do servidor e renderiza o widget do tipo — uma ABA por **seção declarada pelo
 * servidor**, na ordem que ele manda.
 *
 * A tela NÃO deriva agrupamento nem rótulo da chave. Ela fazia as duas coisas, e as duas
 * listas que mantinha divergiram do catálogo em produção: a administradora da clínica viu
 * `whatsapp.limite_mensal` cru na tela (2026-08-21). Chave sem rótulo não existe mais — é
 * erro de catálogo, pego pela suíte antes de chegar aqui.
 *
 * Trocar de aba com edição digitada e não salva pede confirmação: descartar é decisão, nunca
 * efeito colateral.
 */
export function PaginaConfiguracoes() {
  const podeEditar = useAuthStore((estado) => estado.temPermissao('configuracoes.editar'))
  // `seguranca.*` é de quem administra o acesso (change `trava-de-usuarios-e-niveis`): o servidor
  // recusa com 403 quem só tem `configuracoes.editar`
  const administraAcesso = useAuthStore((estado) => estado.temPermissao('niveis_permissao.editar'))

  const consulta = useQuery({ queryKey: chaves.configuracoes(), queryFn: listarConfiguracoes })
  const consultaAlvos = useQuery({
    queryKey: chaves.alvosEncadeamento(),
    queryFn: listarAlvosEncadeamento,
  })

  const podeConectarWhatsapp = useAuthStore((estado) => estado.temPermissao('mensagens.conectar'))
  const idDoCartaoDaConexao = useId()

  const gruposDoCatalogo = useMemo(
    () =>
      // cada lista com o seu `??`: o fallback do objeto inteiro cobria só `data === undefined`
      // e dava a impressão de defesa que não existia (achado SEC-SDC-03)
      agruparConfiguracoes({
        configuracoes: consulta.data?.configuracoes ?? [],
        secoes: consulta.data?.secoes ?? [],
        blocos: consulta.data?.blocos ?? [],
      }),
    [consulta.data],
  )

  /*
   * A aba CADASTRO não vem do catálogo de `configuracoes`: a régua dos campos é recurso
   * próprio (`campos_cadastro`), com tabela e API separadas. Ela entra aqui porque é onde
   * quem administra a clínica procura, e vai por último — salvo a aba de exceção, que fica
   * atrás dela (ver logo abaixo).
   */
  const grupos = useMemo(() => {
    // a aba de exceção vai por ÚLTIMO, atrás inclusive da Cadastro: ela é anomalia, e não pode
    // ficar na frente de uma aba de uso diário — e `grupos[0]` é a ativa por padrão, então
    // invertê-la abriria a tela DENTRO da anomalia.
    //
    // Veio junto do fecho do A10 na rodada 2, mas não É o A10 (aquele é o rótulo neutro do
    // bloco órfão, logo abaixo). Citar o mesmo id nas duas atrapalhou o gate a fechar a
    // rodada; a guarda de posição só nasceu na rodada 3 (CR-BLOQUEANTE-2 = design-qa IMP-1).
    const excecao = gruposDoCatalogo.filter((grupo) => grupo.id === SECAO_SEM_DECLARACAO)
    const normais = gruposDoCatalogo.filter((grupo) => grupo.id !== SECAO_SEM_DECLARACAO)

    return [...normais, abaSemCatalogo('cadastro', 'Cadastro'), ...excecao]
  }, [gruposDoCatalogo])

  const alvos = consultaAlvos.data?.alvos ?? []
  const finalizam = consultaAlvos.data?.finalizam ?? []

  const [ativa, setAtiva] = useState<string | undefined>(undefined)
  // aba clicada com edição pendente — fica em espera até o usuário decidir no diálogo
  const [destinoPendente, setDestinoPendente] = useState<string | null>(null)

  /**
   * Chaves com edição digitada e NÃO salva na aba ativa (a escrita é chave a chave).
   * Só os campos montados reportam — trocar de aba desmonta e limpa por construção.
   */
  const [sujas, setSujas] = useState<ReadonlySet<string>>(new Set())
  const marcarSuja = useCallback((chave: string, suja: boolean) => {
    setSujas((atual) => {
      if (atual.has(chave) === suja) {
        return atual
      }
      const proximo = new Set(atual)
      if (suja) {
        proximo.add(chave)
      } else {
        proximo.delete(chave)
      }
      return proximo
    })
  }, [])

  // o widget do encadeamento valida o alvo CONTRA `alvos` — montá-lo antes de a leitura de
  // alvos assentar marcaria um alvo válido como órfão e ofereceria gravar "desligado" em
  // silêncio (corrida na carga fria). Esperamos as DUAS leituras antes de renderizar.
  const carregando = consulta.isPending || consultaAlvos.isPending

  const abaAtual = ativa !== undefined && grupos.some((grupo) => grupo.id === ativa) ? ativa : grupos[0]?.id
  const grupoAtual = grupos.find((grupo) => grupo.id === abaAtual)
  const grupoDestino = grupos.find((grupo) => grupo.id === destinoPendente)

  function trocarAba(destino: string): void {
    if (destino === abaAtual) {
      return
    }
    // com edição não salva, a troca espera a decisão — o painel desmonta ao trocar,
    // e o que foi digitado morreria em silêncio
    if (sujas.size > 0) {
      setDestinoPendente(destino)
      return
    }
    setAtiva(destino)
  }

  /** Setas/Home/End movem E ativam (o roving tabIndex sem teclado deixaria as abas inalcançáveis). */
  function aoTeclarNaAba(evento: React.KeyboardEvent<HTMLButtonElement>): void {
    const indice = grupos.findIndex((grupo) => grupo.id === abaAtual)
    const destino =
      evento.key === 'ArrowRight'
        ? grupos[(indice + 1) % grupos.length]
        : evento.key === 'ArrowLeft'
          ? grupos[(indice - 1 + grupos.length) % grupos.length]
          : evento.key === 'Home'
            ? grupos[0]
            : evento.key === 'End'
              ? grupos[grupos.length - 1]
              : undefined
    if (destino === undefined) {
      return
    }
    evento.preventDefault()
    trocarAba(destino.id)
    // sem edição pendente a ativação é imediata — o foco acompanha a aba
    if (sujas.size === 0) {
      document.getElementById(`aba-${destino.id}`)?.focus()
    }
  }

  return (
    <section className="flex flex-col gap-6">
      <CabecalhoDeCadastro
        titulo="Configurações"
        contador={podeEditar ? undefined : 'Somente leitura'}
      />

      {carregando ? (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : consulta.isError ? (
        <EstadoErro
          mensagem="Não foi possível carregar as configurações."
          aoTentarNovamente={() => {
            void consulta.refetch()
          }}
        />
      ) : (
        <>
          {grupos.length > 1 ? (
            <div className="flex flex-wrap gap-2 border-b border-linha" role="tablist" aria-label="Grupos de configurações">
              {grupos.map(({ id, rotulo }) => (
                <Botao
                  key={id}
                  id={`aba-${id}`}
                  variante="fantasma"
                  role="tab"
                  aria-selected={abaAtual === id}
                  aria-controls={`painel-${id}`}
                  tabIndex={abaAtual === id ? 0 : -1}
                  className={
                    abaAtual === id
                      ? 'rounded-t-controle rounded-b-none border-b-2 border-destaque text-acento'
                      : 'rounded-t-controle rounded-b-none border-b-2 border-transparent text-texto-suave'
                  }
                  onClick={() => {
                    trocarAba(id)
                  }}
                  onKeyDown={aoTeclarNaAba}
                >
                  {rotulo}
                </Botao>
              ))}
            </div>
          ) : null}

          {grupoAtual !== undefined ? (
            <section
              key={grupoAtual.id}
              id={`painel-${grupoAtual.id}`}
              role={grupos.length > 1 ? 'tabpanel' : undefined}
              aria-labelledby={grupos.length > 1 ? `aba-${grupoAtual.id}` : undefined}
              // max-w-2xl: a medida de formulário do design system (§ Sheet/Form) — campo
              // esticado até a borda da viewport quebra a leitura e desloca o "Salvar"
              // para longe do campo que ele salva
              className="flex w-full max-w-2xl flex-col gap-4"
            >
              {/*
                O `h2` do painel é emitido SEMPRE, e some visualmente quando há tablist (a aba
                ativa já dá a pista). Antes ele era condicionado a `grupos.length === 1` — e
                como a tela sempre acrescenta a aba Cadastro, esse ramo era CÓDIGO MORTO: o
                painel nunca tinha `h2`, e todo `h3` da tela pendurava direto no `h1`.

                É o que fecha o gatilho `A11Y-HEADING-CONFIG` nas SETE abas de uma vez, sem
                tocar em `secao-identidade-da-clinica` nem em `secao-campos-do-cadastro`: os
                `h3` deles passam a estar certos por terem finalmente um `h2` acima.

                Cabeçalho `sr-only` é semântica de verdade, não ARIA por via das dúvidas — e o
                `aria-labelledby` do `tabpanel` continua apontando para a ABA, que é o padrão APG.
              */}
              <h2
                className={
                  grupos.length > 1 ? 'sr-only' : 'text-subtitulo font-semibold text-texto'
                }
              >
                {grupoAtual.rotulo}
              </h2>
              {/*
                Uma SEÇÃO por bloco. O subtítulo aparece salvo quando repetiria o rótulo da
                aba na primeira posição — a aba Comunicação junta quatro assuntos e sem eles
                vira lista indistinta, enquanto a Agenda, de assunto único, não ganha
                cabeçalho redundante. A regra exata está no comentário do `h3` abaixo.
              */}
              {grupoAtual.blocos.map((bloco, indice) => (
                <section key={bloco.id} className="flex flex-col gap-4">
                  {/*
                    `h3` sob o `h2` do painel, em `text-subtitulo` — o mesmo papel que a régua
                    do cadastro já usa para cabeçalho de bloco nesta mesma tela. Antes era `h2`
                    a 14px, o MENOR cabeçalho da tela e menor que dois `h3` a uma aba de
                    distância: posto semântico invertido contra o posto visual.

                    O subtítulo é suprimido quando repetiria o rótulo da aba — comparação por
                    RÓTULO, não por `blocos.length`: as duas coincidem hoje por nomenclatura e
                    descoincidiriam no primeiro prefixo novo numa seção de assunto único, que
                    passaria a exibir um subtítulo com o próprio nome da aba.

                    E só na PRIMEIRA posição: fora dela, suprimir ancoraria os campos no `h3`
                    do bloco anterior. Numa seção "Segurança" que ganhasse `auditoria.*` antes
                    do bloco homônimo, a flag de aprovação dupla ficaria sob o subtítulo
                    "Auditoria" (achado a11y IMP-03). Subtítulo redundante é menos pior que
                    âncora errada.
                  */}
                  {bloco.rotulo !== '' && !(indice === 0 && bloco.rotulo === grupoAtual.rotulo) ? (
                    <h3 className="text-subtitulo font-semibold text-texto">{bloco.rotulo}</h3>
                  ) : null}
                  {/*
                    O CARTÃO da conexão vem ANTES dos campos e é destaque, não um link de
                    texto no meio da lista: ele leva a outra página, e é a única coisa desta
                    tela que faz isso. Como link sublinhado no rodapé do bloco, ninguém
                    achava — foi o que a clínica reportou.

                    `border-acento bg-acento-suave` é a receita de DESTAQUE desta base
                    (`painel-lista-espera`, `card-pre-cadastro`); `border-linha-forte
                    bg-superficie` é a de CONTÊINER, e foi o que eu usei na primeira versão:
                    branco sobre o papel dá 1,05:1 de preenchimento e 1,48:1 de borda — o
                    cartão praticamente não existia para quem tem baixa visão.
                  */}
                  {/*
                    O ENDEREÇO do cadastro pelo link não é campo do catálogo (design D5): a trilha
                    de `configuracoes` guarda o valor em claro, e ela é legível por quem audita.
                    Por isso ele tem seção própria, logo abaixo da chave que o liga.
                  */}
                  {bloco.id === 'cadastro_online' ? (
                    <SecaoLinkDeCadastro podeEditar={podeEditar} />
                  ) : null}
                  {bloco.id === 'whatsapp' && podeConectarWhatsapp ? (
                    <div
                      role="group"
                      aria-labelledby={idDoCartaoDaConexao}
                      className="flex flex-col items-start gap-3 rounded-superficie border border-acento bg-acento-suave p-4"
                    >
                      <div className="flex flex-col gap-1">
                        {/*
                          `h4` sob o `h3` do bloco, e `role="group"` com nome: era o único
                          bloco visual da tela fora da lista de cabeçalhos, e o cartão não
                          tinha âncora nomeada. `group`, não `region` — um landmark aqui
                          poluiria o rotor para uma caixa de três linhas.
                        */}
                        <h4 id={idDoCartaoDaConexao} className="text-corpo font-semibold text-texto">
                          Conexão do WhatsApp
                        </h4>
                        <p className="text-meta text-texto-suave">
                          Número conectado, credencial da Meta e sincronia dos templates.
                        </p>
                      </div>
                      <Botao asChild variante="secundario">
                        <Link to="/configuracoes/whatsapp">Abrir configuração do WhatsApp</Link>
                      </Botao>
                    </div>
                  ) : null}
                  {bloco.itens
                    // as chaves de identidade têm widget dedicado (a seção abaixo)
                    .filter((config) => !(CHAVES_DE_IDENTIDADE as readonly string[]).includes(config.chave))
                    .map((config) => (
                      <CampoDeConfiguracao
                        key={config.chave}
                        config={config}
                        alvos={alvos}
                        finalizam={finalizam}
                        alvosCarregou={consultaAlvos.isSuccess}
                        podeEditar={podeEditar && (administraAcesso || !config.chave.startsWith('seguranca.'))}
                        motivoSemEdicao={podeEditar && !administraAcesso ? SEGURANCA_DE_QUEM_ADMINISTRA : undefined}
                        aoMudarSujo={marcarSuja}
                      />
                    ))}
                </section>
              ))}
              {grupoAtual.id === 'clinica' ? identidadeDaClinica(grupoAtual.itens, podeEditar, marcarSuja) : null}
              {grupoAtual.id === 'cadastro' ? (
                <SecaoCamposDoCadastro podeEditar={podeEditar} aoMudarSujo={marcarSuja} />
              ) : null}
            </section>
          ) : null}

          <DialogConfirmacao
            aberto={destinoPendente !== null}
            aoMudarAberto={(aberto) => {
              if (!aberto) {
                setDestinoPendente(null)
              }
            }}
            titulo={`Trocar para ${grupoDestino?.rotulo ?? 'outra aba'} sem salvar?`}
            consequencia={`Há edição não salva em ${grupoAtual?.rotulo ?? 'nesta aba'}. Trocar de aba descarta o que foi digitado e não salvo.`}
            rotuloConfirmar="Descartar e trocar"
            tom="atencao"
            aoConfirmar={() => {
              if (destinoPendente !== null) {
                setAtiva(destinoPendente)
              }
            }}
          />
        </>
      )}
    </section>
  )
}

/**
 * A seção de identidade da aba Clínica — só monta com as DUAS chaves presentes no
 * catálogo efetivo (API antiga sem elas → a aba segue só com os campos genéricos).
 */
function identidadeDaClinica(
  itens: Configuracao[],
  podeEditar: boolean,
  aoMudarSujo: (chave: string, sujo: boolean) => void,
) {
  const identidade = itens.find((config) => config.chave === 'clinica.identidade')
  const fonte = itens.find((config) => config.chave === 'clinica.fonte_do_nome')
  if (identidade === undefined || fonte === undefined) {
    return null
  }

  const nome = itens.find((config) => config.chave === 'clinica.nome')
  // o tema é opcional: uma API anterior à change tema-da-clinica não o traz, e a seção segue sem ele
  const tema = itens.find((config) => config.chave === 'clinica.tema')

  return (
    <SecaoIdentidadeDaClinica
      identidade={identidade}
      fonte={fonte}
      tema={tema}
      nomeDaClinica={String(nome?.valor ?? '')}
      podeEditar={podeEditar}
      aoMudarSujo={aoMudarSujo}
    />
  )
}

/**
 * Agrupa a leitura em ABAS pela `secao` que o servidor declarou, e reparte cada aba nos
 * SUBTÍTULOS que ele declarou como `bloco`. A tela não deriva nada da chave: antes desta
 * change a aba era o prefixo, e por isso `mensagens.retencao_dias` ganhava uma aba inteira.
 *
 * A ordem das abas é a ordem de `secoes`; a dos subtítulos, a de `blocos`. Seção sem nenhuma
 * chave visível não vira aba.
 *
 * **Nada se perde por divergência.** Chave cuja `secao` não está em `secoes`, ou cujo `bloco`
 * não está em `blocos`, vai para o fim da tela em que ela cabe, em vez de sumir. A primeira
 * versão desta função filtrava as duas coisas e a chave desaparecia sem erro, sem aviso e sem
 * estado vazio — o que é PIOR que o defeito de 2026-08-21, que originou a change: lá a
 * administradora via a chave crua e reclamou; aqui não veria nada, e ninguém configura o que
 * não sabe que existe. Numa flag `seguranca.*` isso é a governança de acesso virando
 * inadministrável em silêncio (achados SEC-SDC-02 e CR-I1).
 */
function agruparConfiguracoes(leitura: LeituraDeConfiguracoes): GrupoDeConfiguracao[] {
  const porSecao = new Map<string, Configuracao[]>()
  for (const config of leitura.configuracoes) {
    const daSecao = porSecao.get(config.secao)
    if (daSecao === undefined) {
      porSecao.set(config.secao, [config])
    } else {
      daSecao.push(config)
    }
  }

  const secoesConhecidas = new Set(leitura.secoes.map(({ secao }) => secao))
  const grupos = leitura.secoes.flatMap(({ secao, rotulo }) => {
    const itens = porSecao.get(secao) ?? []
    if (itens.length === 0) {
      return []
    }

    return [{ id: secao, rotulo, itens, blocos: repartirEmBlocos(itens, leitura.blocos) }]
  })

  // seção que o servidor não declarou: a chave existe e precisa continuar configurável
  const orfas = [...porSecao.entries()]
    .filter(([secao]) => !secoesConhecidas.has(secao))
    .flatMap(([, itens]) => itens)

  if (orfas.length > 0) {
    grupos.push({
      id: SECAO_SEM_DECLARACAO,
      rotulo: ROTULO_NEUTRO,
      itens: orfas,
      blocos: repartirEmBlocos(orfas, leitura.blocos),
    })
  }

  return grupos
}

/**
 * Reparte os itens de uma aba nos blocos declarados, na ordem deles. O que não casar com
 * bloco nenhum entra num bloco final SEM subtítulo — visível, configurável, e sem expor o
 * slug do bloco, que é identificador de máquina.
 */
function repartirEmBlocos(
  itens: Configuracao[],
  declarados: LeituraDeConfiguracoes['blocos'],
): GrupoDeConfiguracao['blocos'] {
  const conhecidos = new Set(declarados.map(({ bloco }) => bloco))
  const blocos = declarados
    .map(({ bloco, rotulo }) => ({
      id: bloco,
      rotulo,
      itens: itens.filter((config) => config.bloco === bloco),
    }))
    .filter((bloco) => bloco.itens.length > 0)

  const orfaos = itens.filter((config) => !conhecidos.has(config.bloco))
  if (orfaos.length > 0) {
    /*
     * Rótulo NEUTRO quando a aba já tem bloco rotulado, e vazio quando não tem.
     *
     * Sem cabeçalho próprio, o campo órfão cai logo depois do último bloco nomeado e se lê
     * como parte DELE — uma flag `seguranca.*` apareceria sob o subtítulo "Notificações", e
     * quem administra acharia que está mexendo em notificação. Os três pareceres da rodada 2
     * chegaram nisso por caminhos diferentes (design-qa A10, SEC-SDC-08, a11y IMP-03).
     *
     * "Sem subtítulo" não é o oposto de "expor o slug" — o oposto é um rótulo neutro.
     */
    blocos.push({
      id: '__sem-bloco',
      rotulo: blocos.length > 0 ? ROTULO_NEUTRO : '',
      itens: orfaos,
    })
  }

  return blocos
}
