import { useMutation, useQueryClient } from '@tanstack/react-query'
import { TriangleAlert } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'

import { AmostraDoTema } from '@/componentes/administracao/amostra-do-tema'
import { VisualDaMarca } from '@/componentes/marca-da-clinica'
import { Botao } from '@/componentes/ui/botao'
import { DialogConfirmacao } from '@/componentes/ui/dialog-confirmacao'
import { usarToast } from '@/componentes/ui/toast'
import { chaves } from '@/lib/chaves-query'
import { cn } from '@/lib/cn'
import { fonteDaMarca, rotuloDaOpcao } from '@/lib/configuracoes-rotulos'
import { ErroDeApi } from '@/lib/http'
import { descricaoDoTema } from '@/lib/tema-da-clinica'
import { enviarLogoDaClinica, removerLogoDaClinica, salvarConfiguracao } from '@/servicos/configuracoes'
import { useAuthStore } from '@/stores/auth-store'
import type { Configuracao } from '@/tipos'

/** Espelho das validações do servidor (ClinicaLogoController) — recusa ANTES da rede. */
const FORMATOS_ACEITOS = ['image/png', 'image/jpeg', 'image/webp']
const TETO_BYTES = 1024 * 1024

interface SecaoIdentidadeDaClinicaProps {
  /** `clinica.identidade` (valor efetivo + opções do catálogo) */
  identidade: Configuracao
  /** `clinica.fonte_do_nome` */
  fonte: Configuracao
  /** `clinica.tema` — ausente numa API anterior à change tema-da-clinica: a escolha some */
  tema?: Configuracao
  /** `clinica.nome` efetivo — alimenta o preview e o monograma */
  nomeDaClinica: string
  podeEditar: boolean
  /** A guarda de troca de aba da página — escolha feita e não salva conta como pendência. */
  aoMudarSujo?: (chave: string, sujo: boolean) => void
}

/**
 * Identidade visual da clínica (spec administracao-tela): logo OU nome com fonte
 * curada, com preview dos DOIS estados da barra (expandida e trilho/monograma)
 * refletindo a escolha AINDA NÃO salva — o shell só muda com o SALVO (`/me`).
 * Cada opção de fonte renderiza NA própria fonte: a escolha é visual, não um nome.
 */
export function SecaoIdentidadeDaClinica({
  identidade,
  fonte,
  tema,
  nomeDaClinica,
  podeEditar,
  aoMudarSujo,
}: SecaoIdentidadeDaClinicaProps) {
  const queryClient = useQueryClient()
  const { notificar } = usarToast()
  const carregarSessao = useAuthStore((estado) => estado.carregarSessao)
  const marca = useAuthStore((estado) => estado.usuario?.marca)

  const [escolhaIdentidade, setEscolhaIdentidade] = useState(String(identidade.valor))
  const [escolhaFonte, setEscolhaFonte] = useState(String(fonte.valor))
  const [escolhaTema, setEscolhaTema] = useState(String(tema?.valor ?? 'padrao'))
  const [erroLogo, setErroLogo] = useState<string | undefined>(undefined)
  const idDaRegua = useId()
  const idDoErroDaLogo = useId()
  const [confirmandoRemocao, setConfirmandoRemocao] = useState(false)
  const inputDeArquivo = useRef<HTMLInputElement>(null)

  const sujaIdentidade = escolhaIdentidade !== String(identidade.valor)
  const sujaFonte = escolhaFonte !== String(fonte.valor)
  const sujoTema = tema !== undefined && escolhaTema !== String(tema.valor)
  const algoSujo = sujaIdentidade || sujaFonte || sujoTema

  // a escolha não salva entra na guarda de troca de aba da página (descartar é decisão)
  useEffect(() => {
    aoMudarSujo?.(identidade.chave, sujaIdentidade)
  }, [aoMudarSujo, identidade.chave, sujaIdentidade])
  useEffect(() => {
    aoMudarSujo?.(fonte.chave, sujaFonte)
  }, [aoMudarSujo, fonte.chave, sujaFonte])
  const chaveDoTema = tema?.chave
  useEffect(() => {
    if (chaveDoTema !== undefined) {
      aoMudarSujo?.(chaveDoTema, sujoTema)
    }
  }, [aoMudarSujo, chaveDoTema, sujoTema])
  useEffect(
    () => () => {
      aoMudarSujo?.(identidade.chave, false)
      aoMudarSujo?.(fonte.chave, false)
      if (chaveDoTema !== undefined) {
        aoMudarSujo?.(chaveDoTema, false)
      }
    },
    [aoMudarSujo, identidade.chave, fonte.chave, chaveDoTema],
  )

  /** Salva as chaves sujas de uma vez — um clique fecha a escolha. */
  const salvar = useMutation({
    retry: 0,
    mutationFn: async () => {
      if (sujaIdentidade) {
        await salvarConfiguracao(identidade.chave, escolhaIdentidade)
      }
      if (sujaFonte) {
        await salvarConfiguracao(fonte.chave, escolhaFonte)
      }
      if (sujoTema && chaveDoTema !== undefined) {
        await salvarConfiguracao(chaveDoTema, escolhaTema)
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: chaves.configuracoes() })
      await carregarSessao() // a marca do shell vive no /me
      notificar({ tom: 'sucesso', titulo: 'Identidade da clínica atualizada.' })
    },
    onError: () => {
      notificar({ tom: 'erro', titulo: 'Não foi possível salvar a identidade.' })
    },
  })

  const enviarLogo = useMutation({
    retry: 0,
    mutationFn: (arquivo: File) => enviarLogoDaClinica(arquivo),
    onMutate: () => {
      setErroLogo(undefined)
    },
    onSuccess: async (resposta) => {
      // o servidor pode ter APLICADO a logo na barra (change logo-aplicada-ao-enviar): a
      // confirmação diz o que de fato aconteceu, senão a pessoa fica sem saber se ainda falta
      // algum passo — que era o defeito de origem
      if (resposta.identidade_aplicada) {
        setEscolhaIdentidade('logo')
        await queryClient.invalidateQueries({ queryKey: chaves.configuracoes() })
      }
      await carregarSessao()
      notificar({
        tom: 'sucesso',
        titulo: resposta.identidade_aplicada ? 'Logo enviada e aplicada na barra.' : 'Logo enviada.',
      })
    },
    onError: (falha: unknown) => {
      setErroLogo(
        falha instanceof ErroDeApi
          ? (falha.camposInvalidos.arquivo?.[0] ?? falha.message)
          : 'Não foi possível enviar a logo.',
      )
    },
  })

  const removerLogo = useMutation({
    retry: 0,
    mutationFn: () => removerLogoDaClinica(),
    onSuccess: async () => {
      await carregarSessao()
      notificar({ tom: 'sucesso', titulo: 'Logo removida.' })
    },
    onError: () => {
      notificar({ tom: 'erro', titulo: 'Não foi possível remover a logo.' })
    },
  })

  function aoEscolherArquivo(arquivo: File | undefined): void {
    if (arquivo === undefined) {
      return
    }
    // espelho do servidor: recusa local ANTES da rede, com a mesma régua
    if (!FORMATOS_ACEITOS.includes(arquivo.type)) {
      setErroLogo('Formato não aceito. Envie PNG, JPG ou WebP.')
      return
    }
    if (arquivo.size > TETO_BYTES) {
      setErroLogo('O arquivo excede o tamanho máximo de 1 MB.')
      return
    }
    enviarLogo.mutate(arquivo)
  }

  const temLogo = marca?.logo_versao != null
  const avisoLogoSemArquivo = String(identidade.valor) === 'logo' && !temLogo

  return (
    <section className="flex flex-col gap-4 border-t border-linha pt-5">
      <div>
        {/* "barra LATERAL": a marca vive no alto da barra da esquerda, e o catálogo do servidor
            já rotula a chave assim. A tela dizia "topo" e se contradizia quatro linhas abaixo
            ("A barra lateral volta a exibir o nome") — a administradora olhava o topo, não achava
            e concluía que não tinha funcionado (achado design-qa A4). */}
        <h3 className="text-corpo-lg font-semibold text-texto">Identidade da clínica</h3>
        <p className="mt-1 text-corpo text-texto-suave">
          O que aparece no alto da barra da esquerda (a logo da clínica ou o nome, na fonte escolhida) e
          as cores do sistema.
        </p>
      </div>

      {/* ── o que exibir ── */}
      <fieldset disabled={!podeEditar}>
        <legend className="text-rotulo text-texto">Exibir</legend>
        <div className="mt-2 flex gap-4">
          {(identidade.opcoes ?? ['nome', 'logo']).map((opcao) => (
            <label key={opcao} className="flex items-center gap-2 text-corpo text-texto">
              <input
                type="radio"
                name="clinica-identidade"
                value={opcao}
                checked={escolhaIdentidade === opcao}
                onChange={() => {
                  setEscolhaIdentidade(opcao)
                }}
                className="size-4 accent-(--acento)"
              />
              {rotuloDaOpcao(opcao)}
            </label>
          ))}
        </div>
      </fieldset>

      {/* ── fonte do nome: cada opção NA própria fonte ── */}
      <fieldset disabled={!podeEditar}>
        <legend className="text-rotulo text-texto">Fonte do nome</legend>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(fonte.opcoes ?? []).map((opcao) => (
            // o rádio é `sr-only` (clipado em 1×1px), então o `:focus-visible` universal é
            // pintado DENTRO da caixa recortada e some: quem navega por teclado não vê onde
            // está, entre quatro caixas iguais (achado A11Y BLOQ-02, 2.4.7). O `peer` leva o
            // foco do input para o elemento visível — mesmo padrão de `secao-campos-do-cadastro`.
            // `h-full` no span (abaixo) + `h-full` aqui: o label é a célula do grid, e a caixa
            // visual passou a ser filha dele. Sem esticar, um rótulo que quebre linha faz a
            // célula crescer e as OUTRAS caixas param de preencher — sobra área clicável morta
            // embaixo, e o anel de foco deixa de envolver o alvo (ressalva do gate, rodada 2).
            <label key={opcao} className="flex h-full cursor-pointer flex-col items-center gap-1">
              <input
                type="radio"
                name="clinica-fonte"
                value={opcao}
                checked={escolhaFonte === opcao}
                onChange={() => {
                  setEscolhaFonte(opcao)
                }}
                className="peer sr-only"
              />
              <span
                className={cn(
                  'flex h-full w-full flex-col items-center justify-center gap-1 rounded-controle px-3 py-2',
                  'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-foco',
                  escolhaFonte === opcao
                    ? 'border-2 border-acento bg-acento-suave'
                    : 'border border-linha bg-superficie',
                )}
              >
                <span
                  aria-hidden="true"
                  className="text-corpo-lg text-texto"
                  style={{ fontFamily: fonteDaMarca(opcao) }}
                >
                  {(nomeDaClinica.trim() || 'Clínica').split(' ')[0]}
                </span>
                <span className="text-meta text-texto-suave">{rotuloDaOpcao(opcao)}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {/* ── logo ── */}
      <div className="flex flex-col gap-2">
        <p className="text-rotulo text-texto">Logo</p>
        {/* a régua e o erro são ASSOCIADOS ao campo por `aria-describedby` (1.3.1): sem isso,
            quem tabula até o input ouve só o nome, e quem volta depois do anúncio do erro não
            tem como recuperar o motivo (achado A11Y IMP-01) */}
        <p id={idDaRegua} className="text-meta text-texto-suave">
          PNG, JPG ou WebP · até 1 MB · cada lado entre 64 e 4096 pixels. Prefira fundo transparente.
        </p>
        {podeEditar ? (
          <div className="flex items-center gap-3">
            <input
              ref={inputDeArquivo}
              type="file"
              accept={FORMATOS_ACEITOS.join(',')}
              aria-label="Enviar logo da clínica"
              aria-describedby={erroLogo === undefined ? idDaRegua : `${idDaRegua} ${idDoErroDaLogo}`}
              aria-invalid={erroLogo !== undefined}
              disabled={enviarLogo.isPending}
              className="text-corpo text-texto-suave file:mr-3 file:rounded-controle file:border file:border-linha file:bg-superficie file:px-3 file:py-1.5 file:text-corpo file:text-texto"
              onChange={(evento) => {
                aoEscolherArquivo(evento.target.files?.[0])
                evento.target.value = '' // reenviar o MESMO arquivo dispara change de novo
              }}
            />
            {temLogo ? (
              <Botao
                type="button"
                variante="perigo-suave"
                tamanho="sm"
                disabled={removerLogo.isPending}
                onClick={() => {
                  setConfirmandoRemocao(true)
                }}
              >
                Remover logo
              </Botao>
            ) : null}
          </div>
        ) : null}
        {erroLogo !== undefined ? (
          <p id={idDoErroDaLogo} role="alert" className="text-meta text-perigo-texto">
            {erroLogo}
          </p>
        ) : null}
        {/* `status`, não `alert`: isto deriva do valor SALVO e é estado persistente, não um
            acontecimento — assertivo interromperia a leitura sem novidade (achado A11Y N-06) */}
        <div role="status" aria-live="polite">
          {avisoLogoSemArquivo ? (
            <p className="flex items-start gap-1.5 text-meta text-alerta-texto">
              <TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
              A identidade está como logo, mas nenhuma logo foi enviada — a barra exibirá o nome até o envio.
            </p>
          ) : null}
        </div>
      </div>

      {/* ── preview da barra lateral, com a escolha ainda não salva ── */}
      <div>
        <p className="text-rotulo text-texto">Pré-visualização</p>
        <div className="mt-2 flex h-24 w-full max-w-md items-center rounded-superficie border border-linha bg-superficie px-4">
          <VisualDaMarca
            nome={nomeDaClinica}
            fonte={escolhaFonte}
            usaLogo={escolhaIdentidade === 'logo'}
            logoVersao={marca?.logo_versao ?? null}
          />
        </div>
        <p className="mt-1 text-meta text-texto-suave">Como aparece na barra lateral</p>
      </div>

      {/* ── cores do sistema (change tema-da-clinica): cada opção é uma miniatura da tela NO tema,
          com os tokens de verdade — a escolha é visual, como a da fonte. O rádio fica `sr-only` e o
          foco passa ao cartão pelo `peer`, o mesmo padrão das fontes (achado A11Y BLOQ-02). ── */}
      {tema !== undefined ? (
        <fieldset disabled={!podeEditar}>
          <legend className="text-rotulo text-texto">Cores do sistema</legend>
          <p className="mt-1 text-meta text-texto-suave">
            Muda o visual do sistema (cores, fonte e cantos), e só nesta clínica. As cores do texto e dos
            avisos de erro continuam as mesmas.
          </p>
          {/* três opções (change tema-xclinicas): numa linha só a partir de `xl`; entre `sm` e `xl` a
              terceira desce sozinha, e abaixo de `sm` é uma por linha */}
          <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {(tema.opcoes ?? []).map((opcao) => (
              <label key={opcao} className="flex h-full cursor-pointer flex-col">
                <input
                  type="radio"
                  name="clinica-tema"
                  value={opcao}
                  checked={escolhaTema === opcao}
                  onChange={() => {
                    setEscolhaTema(opcao)
                  }}
                  className="peer sr-only"
                />
                <span
                  className={cn(
                    'flex h-full w-full flex-col gap-2 rounded-superficie p-2',
                    'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-foco',
                    escolhaTema === opcao
                      ? 'border-2 border-acento bg-acento-suave'
                      : 'border border-linha bg-superficie',
                  )}
                >
                  <AmostraDoTema tema={opcao} />
                  <span className="flex flex-col px-1 pb-0.5">
                    <span className="text-corpo font-semibold text-texto">{rotuloDaOpcao(opcao)}</span>
                    <span className="text-meta text-texto-suave">{descricaoDoTema(opcao)}</span>
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      {/* ── salvar: o ÚLTIMO passo da seção ──
          O botão morava no meio, entre a fonte e o campo de envio. Quem enviava a logo por
          último não via mais botão nenhum abaixo dela e concluía que não havia onde salvar
          (relato do usuário, 2026-08-28). A ordem agora é a da leitura: escolho, escolho a
          fonte, envio o arquivo, vejo o resultado, salvo. */}
      {podeEditar ? (
        <div className="flex flex-wrap items-center gap-3">
          <Botao
            type="button"
            variante="secundario"
            disabled={!algoSujo || salvar.isPending}
            carregando={salvar.isPending}
            onClick={() => {
              salvar.mutate()
            }}
          >
            Salvar identidade
          </Botao>
          {/* escolha não salva deixa de ser invisível: a tela mostrava a escolha como se já
              valesse — a pessoa marcava "Logo", via a pré-visualização mudar, saía da tela e a
              barra continuava como antes.

              A região viva nasce SEMPRE, vazia — só o texto dentro dela muda. Região `status`
              inserida já com conteúdo é o caso historicamente não confiável: parte das
              combinações leitor/navegador só observa mutações de regiões que JÁ existiam na
              árvore (achado A11Y-04, fechado em `secao-campos-do-cadastro`, e reaberto aqui pela
              primeira versão desta seção). */}
          <div role="status" aria-live="polite">
            {algoSujo ? (
              <p className="flex items-center gap-1.5 text-meta text-alerta-texto">
                <TriangleAlert aria-hidden="true" className="size-3.5 shrink-0" />
                Alteração ainda não salva — a tela só muda depois de salvar.
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      <DialogConfirmacao
        aberto={confirmandoRemocao}
        aoMudarAberto={setConfirmandoRemocao}
        titulo="Remover a logo da clínica?"
        consequencia="A barra lateral volta a exibir o nome da clínica. O arquivo é removido do servidor — para usar a logo de novo, será preciso enviá-la outra vez."
        rotuloConfirmar="Remover logo"
        carregando={removerLogo.isPending}
        aoConfirmar={async () => {
          await removerLogo.mutateAsync()
        }}
      />
    </section>
  )
}
