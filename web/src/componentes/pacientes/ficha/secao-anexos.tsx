import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, Paperclip, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'

import { EstadosDaLista } from '@/componentes/cadastro/estados-da-lista'
import { AvisoErro } from '@/componentes/ui/aviso-erro'
import { Botao } from '@/componentes/ui/botao'
import { DialogConfirmacao } from '@/componentes/ui/dialog-confirmacao'
import { Tabela } from '@/componentes/ui/tabela'
import { baixarBlob } from '@/lib/baixar-blob'
import { chaves } from '@/lib/chaves-query'
import { dataHoraLegivel } from '@/lib/datas'
import { distribuirErrosDoServidor, semErros, type ErrosDoServidor } from '@/lib/erros'
import { baixarAnexo, enviarAnexo, excluirAnexo, listarAnexos } from '@/servicos/anexos'
import { useAuthStore } from '@/stores/auth-store'
import type { AnexoDoPaciente } from '@/tipos'

interface SecaoAnexosProps {
  pacienteId: number
}

/** Bytes → "1,2 MB" / "340 KB" — só exibição (o número real vive no servidor). */
function tamanhoLegivel(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

/**
 * Seção Anexos da ficha — documentos do paciente (potencialmente laudo, art. 11).
 *
 * A lista traz METADADOS; o conteúdo só desce pelo download autenticado (que o
 * servidor AUDITA). Ações por permissão — sem `anexos.criar` o envio nem
 * renderiza (nunca promessa). Excluir é SOFT no servidor (retenção).
 */
export function SecaoAnexos({ pacienteId }: SecaoAnexosProps) {
  const podeCriar = useAuthStore((estado) => estado.temPermissao('anexos.criar'))
  const podeExcluir = useAuthStore((estado) => estado.temPermissao('anexos.excluir'))
  const queryClient = useQueryClient()
  const refArquivo = useRef<HTMLInputElement>(null)
  const [erros, setErros] = useState<ErrosDoServidor>(semErros())
  const [aExcluir, setAExcluir] = useState<AnexoDoPaciente | null>(null)

  const lista = useQuery({
    queryKey: chaves.anexosDoPaciente(pacienteId),
    queryFn: () => listarAnexos(pacienteId),
  })

  const envio = useMutation({
    mutationFn: (arquivo: File) => enviarAnexo(pacienteId, arquivo),
    onSuccess: () => {
      setErros(semErros())
      void queryClient.invalidateQueries({ queryKey: chaves.anexosDoPaciente(pacienteId) })
    },
    onError: (erro) => setErros(distribuirErrosDoServidor(erro, new Set(['arquivo']))),
  })

  const exclusao = useMutation({
    mutationFn: (id: number) => excluirAnexo(id),
    onSuccess: () => {
      setErros(semErros())
      setAExcluir(null)
      void queryClient.invalidateQueries({ queryKey: chaves.anexosDoPaciente(pacienteId) })
    },
    // recusa mantém o dialog aberto COM mensagem — "não aconteceu nada" é o
    // anti-padrão que o DialogConfirmacao documenta (CR-CA-05)
    onError: (erro) => setErros(distribuirErrosDoServidor(erro, new Set())),
  })

  async function baixar(anexo: AnexoDoPaciente) {
    setErros(semErros())
    try {
      // caminho AUTENTICADO (blob) — o servidor audita a leitura; nunca URL de storage
      baixarBlob(await baixarAnexo(anexo.id), anexo.nome)
    } catch (erro) {
      // laudo que falha em silêncio não existe: a recusa vira mensagem (CR I-2)
      setErros(distribuirErrosDoServidor(erro, new Set()))
    }
  }

  const anexos = lista.data ?? []
  const avisos = [...erros.gerais, erros.campos.get('arquivo')].filter(
    (mensagem): mensagem is string => mensagem !== undefined,
  )

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {lista.isSuccess ? (
          <p className="text-corpo text-texto-suave">
            {anexos.length} {anexos.length === 1 ? 'anexo' : 'anexos'}
          </p>
        ) : (
          <span />
        )}
        {podeCriar ? (
          <div className="flex flex-col items-end gap-1">
            <input
              ref={refArquivo}
              type="file"
              accept=".pdf,.jpg,.jpeg,.png"
              // fora da árvore de acessibilidade: o botão "Anexar documento" é o controle — com
              // `sr-only` e nome, o leitor de tela anunciava dois (A11Y-FIN-04)
              hidden
              onChange={(evento) => {
                const arquivo = evento.target.files?.[0]
                if (arquivo !== undefined) {
                  envio.mutate(arquivo)
                }
                evento.target.value = ''
              }}
            />
            <Botao
              variante="primario"
              carregando={envio.isPending}
              onClick={() => refArquivo.current?.click()}
            >
              <Paperclip aria-hidden="true" className="size-4" />
              Anexar documento
            </Botao>
            {/* limites DECLARADOS antes do erro */}
            <p className="text-meta text-texto-suave">PDF, JPEG ou PNG · até 10 MB</p>
          </div>
        ) : null}
      </div>

      <AvisoErro mensagens={avisos} />

      <EstadosDaLista
        carregando={lista.isPending}
        erro={lista.isError}
        aoTentarNovamente={() => void lista.refetch()}
        vazio={anexos.length === 0}
        vazioTitulo="Nenhum documento anexado"
        vazioDescricao="Encaminhamentos, carteirinhas e laudos do paciente aparecem aqui."
      >
        <Tabela densidade="confortavel" legenda="Anexos do paciente">
          <Tabela.Cabecalho>
            <Tabela.Linha>
              <Tabela.CelulaCabecalho>Documento</Tabela.CelulaCabecalho>
              <Tabela.CelulaCabecalho>Tamanho</Tabela.CelulaCabecalho>
              <Tabela.CelulaCabecalho>Anexado em</Tabela.CelulaCabecalho>
              <Tabela.CelulaCabecalho>Por</Tabela.CelulaCabecalho>
              <Tabela.CelulaCabecalho>
                <span className="sr-only">Ações</span>
              </Tabela.CelulaCabecalho>
            </Tabela.Linha>
          </Tabela.Cabecalho>
          <Tabela.Corpo>
            {anexos.map((anexo) => (
              <Tabela.Linha key={anexo.id}>
                <Tabela.Celula className="break-all text-texto">{anexo.nome}</Tabela.Celula>
                <Tabela.Celula className="text-texto-suave tabular-nums">
                  {tamanhoLegivel(anexo.tamanho)}
                </Tabela.Celula>
                <Tabela.Celula className="text-texto-suave">
                  {dataHoraLegivel(anexo.criado_em)}
                </Tabela.Celula>
                <Tabela.Celula className="text-texto-suave">
                  {anexo.criado_por?.nome ?? '—'}
                </Tabela.Celula>
                <Tabela.Celula className="text-right">
                  <div className="flex justify-end gap-1">
                    <Botao
                      variante="fantasma"
                      tamanho="sm"
                      onClick={() => void baixar(anexo)}
                      aria-label={`Baixar ${anexo.nome}`}
                    >
                      <Download aria-hidden="true" className="size-4" />
                      Baixar
                    </Botao>
                    {podeExcluir ? (
                      <Botao
                        variante="fantasma"
                        tamanho="sm"
                        onClick={() => {
                          // erro de OUTRA ação não contamina o dialog que abre agora
                          setErros(semErros())
                          setAExcluir(anexo)
                        }}
                        aria-label={`Excluir ${anexo.nome}`}
                      >
                        <Trash2 aria-hidden="true" className="size-4" />
                        Excluir
                      </Botao>
                    ) : null}
                  </div>
                </Tabela.Celula>
              </Tabela.Linha>
            ))}
          </Tabela.Corpo>
        </Tabela>
      </EstadosDaLista>

      <DialogConfirmacao
        aberto={aExcluir !== null}
        aoMudarAberto={(aberto) => {
          if (!aberto) {
            setAExcluir(null)
          }
        }}
        titulo={aExcluir !== null ? `Excluir o anexo "${aExcluir.nome}"?` : ''}
        consequencia="O documento some da ficha imediatamente. Ele permanece guardado pelo prazo de retenção do prontuário e a exclusão fica registrada na auditoria."
        rotuloConfirmar="Excluir anexo"
        tom="perigo"
        erros={erros.gerais}
        carregando={exclusao.isPending}
        aoConfirmar={async () => {
          if (aExcluir !== null) {
            await exclusao.mutateAsync(aExcluir.id)
          }
        }}
      />
    </div>
  )
}
