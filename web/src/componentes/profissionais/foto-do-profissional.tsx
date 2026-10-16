import { Trash2, Upload } from 'lucide-react'
import { useId, useRef, useState, type ChangeEvent } from 'react'

import { AvatarDoProfissional } from '@/componentes/agenda/avatar-do-profissional'
import { Botao } from '@/componentes/ui/botao'
import { distribuirErrosDoServidor } from '@/lib/erros'
import { enviarFotoDoProfissional, removerFotoDoProfissional } from '@/servicos/profissionais'

export interface FotoDoProfissionalProps {
  id: number
  nome: string
  fotoVersao: string | null
  /** `profissionais.editar` — sem ela, só o avatar, sem controle nenhum. */
  podeEditar: boolean
  aoMudar: (fotoVersao: string | null) => void
}

function mensagemDoErro(erro: unknown): string {
  const { campos, gerais } = distribuirErrosDoServidor(erro, new Set(['arquivo']))

  return campos.get('arquivo') ?? gerais[0] ?? 'Não foi possível concluir. Tente de novo.'
}

/**
 * A foto no cadastro do profissional (change foto-do-profissional): quem edita o cadastro envia
 * ou remove; o resto da casa (lista da agenda, cabeçalho da grade) só mostra. O mesmo contrato
 * da foto de perfil do usuário: PNG/JPG/WebP até 1 MB, caminho server-set, versão de cache.
 */
export function FotoDoProfissional({ id, nome, fotoVersao, podeEditar, aoMudar }: FotoDoProfissionalProps) {
  const idDoArquivo = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function aoEscolherArquivo(evento: ChangeEvent<HTMLInputElement>): Promise<void> {
    const arquivo = evento.target.files?.[0]
    evento.target.value = ''
    if (arquivo === undefined) {
      return
    }
    setErro(null)
    setEnviando(true)
    try {
      const { foto_versao } = await enviarFotoDoProfissional(id, arquivo)
      aoMudar(foto_versao)
    } catch (falha) {
      setErro(mensagemDoErro(falha))
    } finally {
      setEnviando(false)
    }
  }

  async function aoRemover(): Promise<void> {
    setErro(null)
    setEnviando(true)
    try {
      await removerFotoDoProfissional(id)
      aoMudar(null)
    } catch (falha) {
      setErro(mensagemDoErro(falha))
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="flex items-center gap-4">
      <AvatarDoProfissional id={id} nome={nome} cor={null} fotoVersao={fotoVersao} tamanho="lg" />
      {podeEditar ? (
        <div className="flex flex-col gap-1.5">
          <label className="sr-only" htmlFor={idDoArquivo}>
            Arquivo da foto
          </label>
          <input
            ref={inputRef}
            id={idDoArquivo}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            // fora da sequência de Tab: `sr-only` não é `display:none`, e o teclado parava num
            // controle invisível antes de chegar a "Enviar foto", que é quem o aciona (CR-FP-12)
            tabIndex={-1}
            onChange={(evento) => {
              void aoEscolherArquivo(evento)
            }}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Botao
              variante="secundario"
              tamanho="sm"
              carregando={enviando}
              onClick={() => {
                inputRef.current?.click()
              }}
            >
              <Upload aria-hidden="true" className="size-4" />
              {fotoVersao === null ? 'Enviar foto' : 'Trocar foto'}
            </Botao>
            {fotoVersao === null ? null : (
              <Botao
                variante="fantasma"
                tamanho="sm"
                disabled={enviando}
                onClick={() => {
                  void aoRemover()
                }}
              >
                <Trash2 aria-hidden="true" className="size-4" />
                Remover foto
              </Botao>
            )}
          </div>
          <p className="text-meta text-texto-suave">PNG, JPG ou WebP, até 1 MB.</p>
          {erro === null ? null : (
            <p role="alert" className="text-meta text-perigo-texto">
              {erro}
            </p>
          )}
        </div>
      ) : null}
    </div>
  )
}
