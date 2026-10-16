import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FileText, Pencil, Plus, Trash2 } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'

import { CabecalhoDeCadastro } from '@/componentes/cadastro/cabecalho-de-cadastro'
import { EstadosDaLista } from '@/componentes/cadastro/estados-da-lista'
import { ProtegidoPorPermissao } from '@/componentes/protegido-por-permissao'
import { AvisoErro } from '@/componentes/ui/aviso-erro'
import { Botao } from '@/componentes/ui/botao'
import { CampoTexto } from '@/componentes/ui/campo-texto'
import { CampoTextoLongo } from '@/componentes/ui/campo-texto-longo'
import { Dialog } from '@/componentes/ui/dialog'
import { DialogConfirmacao } from '@/componentes/ui/dialog-confirmacao'
import { Tabela } from '@/componentes/ui/tabela'
import { EstadoErro } from '@/componentes/ui/estado-erro'
import { Skeleton } from '@/componentes/ui/skeleton'
import { usarErrosDoServidor } from '@/hooks/usar-erros-do-servidor'
import { chaves } from '@/lib/chaves-query'
import { ehConflitoDeEdicao } from '@/lib/conflito'
import { dataHoraLegivel } from '@/lib/pacientes'
import { termos } from '@/servicos/termos'
import type { PayloadDoTermo, VersaoDoTermo } from '@/tipos'

/** Os campos do FORMULÁRIO — a chave `termo` (recusa de exclusão) fica fora, para cair em `gerais`. */
const CAMPOS = new Set(['titulo', 'texto'])

/** Teto do servidor (`TermoConsentimentoRequest`) — o contador evita a viagem inútil ao 422. */
const LIMITE_TEXTO = 50000

interface Valores {
  titulo: string
  texto: string
}

const VALORES_VAZIOS: Valores = { titulo: '', texto: '' }

/**
 * O TERMO de consentimento da clínica (change aceite-do-regulamento, FA-08).
 *
 * A clínica decidiu um contrato terapêutico ÚNICO, assinado por toda família antes de
 * iniciar. Aqui o texto vira DADO versionado (§13): publicar uma versão nova passa a
 * cobrar o aceite dela e **não reescreve** as anteriores — elas são a prova do que cada
 * família aceitou. Por isso versão com aceite não se corrige nem se exclui (o servidor
 * recusa; a tela nem oferece), e o texto é renderizado como TEXTO, nunca como HTML.
 */
export function PaginaTermos() {
  const queryClient = useQueryClient()
  const consulta = useQuery({
    queryKey: chaves.termos(),
    queryFn: termos.listar,
  })
  const versoes = consulta.data ?? []
  const vigente = versoes.find((versao) => versao.vigente) ?? null

  const { erros, limparErros, aoFalhar, notificar } = usarErrosDoServidor(CAMPOS)

  const [emEdicao, setEmEdicao] = useState<VersaoDoTermo | null>(null)
  const [aLer, setALer] = useState<VersaoDoTermo | null>(null)
  const [publicando, setPublicando] = useState(false)
  const [valores, setValores] = useState<Valores>(VALORES_VAZIOS)
  const [aConfirmarPublicacao, setAConfirmarPublicacao] = useState<Valores | null>(null)
  const [aExcluir, setAExcluir] = useState<VersaoDoTermo | null>(null)

  // O texto NÃO vem na lista (até 50 KB por versão): abre sob demanda, para ler ou
  // corrigir. `gcTime: 0` porque é chave de DETALHE que hidrata formulário — contrato
  // CHAVE-DETALHE: texto de cache velho reverteria uma correção em silêncio.
  const alvoDoTexto = emEdicao ?? aLer
  const consultaDoTexto = useQuery({
    queryKey: chaves.termo(alvoDoTexto?.id ?? 0),
    queryFn: () => termos.obter(alvoDoTexto?.id ?? 0),
    enabled: alvoDoTexto !== null,
    gcTime: 0,
  })

  // hidrata o formulário de correção quando o texto da versão chega
  const textoCarregado = consultaDoTexto.data
  useEffect(() => {
    if (emEdicao !== null && textoCarregado?.id === emEdicao.id) {
      setValores({
        titulo: textoCarregado.titulo,
        texto: textoCarregado.texto,
      })
    }
  }, [emEdicao, textoCarregado])

  async function aoConcluir(titulo: string): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: chaves.termos() })
    // ...e a RÉGUA que o cadastro do paciente lê: sem esta linha, a recepção seguiria
    // registrando aceite da versão antiga até o cache expirar
    await queryClient.invalidateQueries({ queryKey: chaves.termoVigente() })
    notificar({ tom: 'sucesso', titulo })
  }

  const publicar = useMutation({
    retry: 0, // repetir um POST recusado publicaria versão duplicada
    mutationFn: (payload: PayloadDoTermo) => termos.publicar(payload),
    onSuccess: async () => {
      setAConfirmarPublicacao(null)
      setPublicando(false)
      await aoConcluir('Versão publicada')
    },
    onError: aoFalhar,
  })

  const corrigir = useMutation({
    retry: 0,
    mutationFn: ({ id, payload, versao }: { id: number; payload: PayloadDoTermo; versao: string }) =>
      termos.atualizar(id, payload, versao),
    onSuccess: async () => {
      setEmEdicao(null)
      await aoConcluir('Versão corrigida')
    },
    // conflito: a LINHA que hidratou a edição está velha — sem invalidar, fechar e
    // reabrir "Corrigir" re-hidrata do MESMO registro e o PUT leva 409 até um F5
    // (modo de falha B1, documentado em `lib/conflito.ts`). O formulário aberto não
    // é tocado: o que se garante é que REABRIR venha fresco.
    onError: (erro) => {
      aoFalhar(erro)
      if (ehConflitoDeEdicao(erro)) {
        void queryClient.invalidateQueries({ queryKey: chaves.termos() })
      }
    },
  })

  const excluir = useMutation({
    retry: 0,
    mutationFn: (id: number) => termos.excluir(id),
    onSuccess: async () => {
      setAExcluir(null)
      await aoConcluir('Versão excluída')
    },
    onError: aoFalhar,
  })

  const salvando = publicar.isPending || corrigir.isPending
  const formularioAberto = publicando || emEdicao !== null

  function abrirPublicacao(): void {
    limparErros()
    setEmEdicao(null)
    setValores(VALORES_VAZIOS)
    setPublicando(true)
  }

  function abrirCorrecao(versao: VersaoDoTermo): void {
    limparErros()
    setALer(null)
    setPublicando(false)
    setValores(VALORES_VAZIOS) // o efeito acima hidrata quando o texto chega
    setEmEdicao(versao)
  }

  function fecharFormulario(): void {
    setPublicando(false)
    setEmEdicao(null)
  }

  function submeter(evento: FormEvent): void {
    evento.preventDefault()
    const payload: Valores = {
      titulo: valores.titulo.trim(),
      texto: valores.texto.trim(),
    }

    if (emEdicao !== null) {
      corrigir.mutate({
        id: emEdicao.id,
        payload,
        versao: emEdicao.updated_at,
      })
      return
    }
    // publicar TROCA a régua cobrada da clínica inteira: confirma enunciando a consequência
    setAConfirmarPublicacao(payload)
  }

  // `Math.max`, e não `versoes[0]`: o número entra na frase que enuncia a consequência
  // da publicação — depender da ordenação do servidor faria a tela prometer a versão
  // errada no dia em que a ordem mudar
  const proximaVersao = versoes.reduce((maior, versao) => Math.max(maior, versao.versao), 0) + 1

  return (
    <section className="flex flex-col gap-6">
      <CabecalhoDeCadastro
        titulo="Termo de consentimento"
        voltar={{ rota: '/cadastros', rotulo: 'Cadastros' }}
        contador={
          consulta.isSuccess
            ? vigente !== null
              ? `Em vigor: v${vigente.versao}`
              : 'Nenhuma versão em vigor'
            : undefined
        }
        acao={
          <ProtegidoPorPermissao permissao="termos_consentimento.criar">
            <Botao onClick={abrirPublicacao}>
              <Plus aria-hidden="true" className="size-4" />
              Publicar nova versão
            </Botao>
          </ProtegidoPorPermissao>
        }
      />

      <EstadosDaLista
        carregando={consulta.isPending}
        erro={consulta.isError}
        aoTentarNovamente={() => {
          void consulta.refetch()
        }}
        vazio={consulta.isSuccess && versoes.length === 0}
        vazioTitulo="Nenhum termo publicado"
        vazioDescricao="Publique o contrato terapêutico para que a recepção possa registrar o aceite das famílias. Enquanto não houver versão em vigor, o aceite não pode ser registrado."
        vazioAcao={
          <ProtegidoPorPermissao permissao="termos_consentimento.criar">
            <Botao onClick={abrirPublicacao}>
              <Plus aria-hidden="true" className="size-4" />
              Publicar primeira versão
            </Botao>
          </ProtegidoPorPermissao>
        }
      >
        <Tabela legenda={`${versoes.length} versões do termo de consentimento`}>
          <Tabela.Cabecalho>
            <Tabela.Linha>
              <Tabela.CelulaCabecalho scope="col">Versão</Tabela.CelulaCabecalho>
              <Tabela.CelulaCabecalho scope="col">Título</Tabela.CelulaCabecalho>
              <Tabela.CelulaCabecalho scope="col">Situação</Tabela.CelulaCabecalho>
              <Tabela.CelulaCabecalho scope="col">Aceites</Tabela.CelulaCabecalho>
              <Tabela.CelulaCabecalho scope="col">Atualizada em</Tabela.CelulaCabecalho>
              <Tabela.CelulaCabecalho scope="col">Ações</Tabela.CelulaCabecalho>
            </Tabela.Linha>
          </Tabela.Cabecalho>
          <Tabela.Corpo>
            {versoes.map((versao) => (
              <Tabela.Linha key={versao.id}>
                <Tabela.Celula className="text-texto tabular-nums">v{versao.versao}</Tabela.Celula>
                <Tabela.Celula className="text-texto">{versao.titulo}</Tabela.Celula>
                <Tabela.Celula className="text-texto-suave">
                  {versao.vigente ? 'Em vigor' : 'Aposentada'}
                </Tabela.Celula>
                <Tabela.Celula className="text-texto-suave tabular-nums">
                  {versao.aceites_total}
                </Tabela.Celula>
                <Tabela.Celula className="text-texto-suave">
                  {dataHoraLegivel(versao.updated_at)}
                </Tabela.Celula>
                <Tabela.Celula>
                  <div className="flex gap-2">
                    <Botao
                      variante="secundario"
                      tamanho="sm"
                      onClick={() => {
                        setALer(versao)
                      }}
                    >
                      <FileText aria-hidden="true" className="size-3.5" />
                      Ler
                    </Botao>
                    {/*
                      Versão com aceite não se corrige nem se exclui — é prova. A tela nem
                      oferece a ação: a recusa do servidor existe (é a autoridade), mas
                      oferecer um botão que sempre falha é fazer o usuário descobrir a regra
                      pelo erro.
                    */}
                    {versao.aceites_total === 0 ? (
                      <>
                        <ProtegidoPorPermissao permissao="termos_consentimento.editar">
                          <Botao
                            variante="fantasma"
                            tamanho="sm"
                            onClick={() => {
                              abrirCorrecao(versao)
                            }}
                          >
                            <Pencil aria-hidden="true" className="size-3.5" />
                            Corrigir
                          </Botao>
                        </ProtegidoPorPermissao>
                        <ProtegidoPorPermissao permissao="termos_consentimento.excluir">
                          <Botao
                            variante="perigo-suave"
                            tamanho="sm"
                            onClick={() => {
                              limparErros()
                              setAExcluir(versao)
                            }}
                          >
                            <Trash2 aria-hidden="true" className="size-3.5" />
                            Excluir
                          </Botao>
                        </ProtegidoPorPermissao>
                      </>
                    ) : null}
                  </div>
                </Tabela.Celula>
              </Tabela.Linha>
            ))}
          </Tabela.Corpo>
        </Tabela>
      </EstadosDaLista>

      {/* LEITURA: dispensável (Esc/overlay fecham) — Dialog, não AlertDialog */}
      <Dialog
        aberto={aLer !== null && emEdicao === null}
        aoMudarAberto={(aberto) => {
          if (!aberto) setALer(null)
        }}
        titulo={aLer === null ? 'Termo de consentimento' : `${aLer.titulo} — v${aLer.versao}`}
        descricao="O texto que as famílias aceitam nesta versão."
      >
        {consultaDoTexto.isPending ? (
          <p className="text-corpo text-texto-suave">Carregando o texto…</p>
        ) : consultaDoTexto.isError ? (
          <p className="text-corpo text-perigo-texto" role="alert">
            Não foi possível carregar o texto desta versão.
          </p>
        ) : (
          // TEXTO, jamais HTML: o conteúdo é entrada de admin e é exibido como o que é
          <p className="whitespace-pre-wrap text-corpo text-texto">{consultaDoTexto.data?.texto}</p>
        )}
      </Dialog>

      {/* PUBLICAR troca a régua cobrada de toda a clínica — a confirmação diz isso */}
      {aConfirmarPublicacao !== null ? (
        <DialogConfirmacao
          aberto
          aoMudarAberto={(aberto) => {
            if (!aberto && !publicar.isPending) setAConfirmarPublicacao(null)
          }}
          titulo={`Publicar a v${proximaVersao} do termo?`}
          consequencia={`A partir de agora, o aceite cobrado das famílias passa a ser o da v${proximaVersao} — quem só aceitou versões anteriores volta a aparecer em "Termos pendentes". Os aceites já registrados continuam válidos como prova do que foi aceito.`}
          rotuloConfirmar="Publicar versão"
          tom="atencao"
          carregando={publicar.isPending}
          erros={erros.gerais}
          aoConfirmar={() => {
            publicar.mutate(aConfirmarPublicacao)
          }}
        />
      ) : null}

      {aExcluir !== null ? (
        <DialogConfirmacao
          aberto
          aoMudarAberto={(aberto) => {
            if (!aberto && !excluir.isPending) setAExcluir(null)
          }}
          titulo={`Excluir a v${aExcluir.versao} do termo?`}
          consequencia="A versão some do histórico. Só é possível porque nenhuma família aceitou esta versão — versão aceita é prova e não se exclui."
          rotuloConfirmar="Excluir versão"
          tom="perigo"
          carregando={excluir.isPending}
          erros={erros.gerais}
          aoConfirmar={() => {
            excluir.mutate(aExcluir.id)
          }}
        />
      ) : null}

      <Dialog
        aberto={formularioAberto}
        aoMudarAberto={(aberto) => {
          if (!aberto && !salvando) fecharFormulario()
        }}
        titulo={
          emEdicao === null ? `Publicar a v${proximaVersao} do termo` : `Corrigir a v${emEdicao.versao}`
        }
        descricao={
          emEdicao === null
            ? 'O texto publicado é o que as famílias aceitam. Publicar não altera as versões anteriores.'
            : 'Só é possível corrigir uma versão que ninguém aceitou — depois do primeiro aceite, o caminho é publicar uma nova.'
        }
      >
        {emEdicao !== null && consultaDoTexto.isPending ? (
          <div aria-busy className="flex flex-col gap-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
        ) : emEdicao !== null && consultaDoTexto.isError ? (
          <EstadoErro
            mensagem="Não foi possível carregar o texto desta versão."
            aoTentarNovamente={() => {
              void consultaDoTexto.refetch()
            }}
          />
        ) : (
          <form onSubmit={submeter} className="flex flex-col gap-4">
            <AvisoErro mensagens={erros.gerais} />

            <CampoTexto
              rotulo="Título"
              obrigatorio
              value={valores.titulo}
              onChange={(evento) => {
                setValores((anteriores) => ({
                  ...anteriores,
                  titulo: evento.target.value,
                }))
              }}
              erro={erros.campos.get('titulo')}
            />

            <CampoTextoLongo
              rotulo="Texto do termo"
              obrigatorio
              linhas={14}
              limite={LIMITE_TEXTO}
              value={valores.texto}
              onChange={(evento) => {
                setValores((anteriores) => ({
                  ...anteriores,
                  texto: evento.target.value,
                }))
              }}
              erro={erros.campos.get('texto')}
              ajuda="Cole aqui o texto do contrato terapêutico. Ele é exibido como texto simples."
            />

            <div className="flex justify-end gap-3">
              <Botao type="button" variante="secundario" onClick={fecharFormulario} disabled={salvando}>
                Cancelar
              </Botao>
              <Botao type="submit" disabled={salvando}>
                {emEdicao === null ? 'Continuar' : 'Salvar correção'}
              </Botao>
            </div>
          </form>
        )}
      </Dialog>
    </section>
  )
}
