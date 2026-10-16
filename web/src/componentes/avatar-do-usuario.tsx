import { LoaderCircle, Trash2, Upload, UserRound } from 'lucide-react'
import { useEffect, useRef, useState, type ChangeEvent } from 'react'

import { Popover } from '@/componentes/ui/popover'
import { distribuirErrosDoServidor } from '@/lib/erros'
import { enviarAvatar, removerAvatar } from '@/servicos/avatar'
import { useAuthStore } from '@/stores/auth-store'

/** A mensagem legível de uma recusa do servidor — a do campo `arquivo` na frente. */
function mensagemDoErro(erro: unknown): string {
  const { campos, gerais } = distribuirErrosDoServidor(erro, new Set(['arquivo']))
  return campos.get('arquivo') ?? gerais[0] ?? 'Não foi possível concluir. Tente de novo.'
}

const CLASSE_ACAO =
  'flex w-full items-center gap-2 rounded-controle px-2 py-1.5 text-corpo text-texto hover:bg-hover-de-linha focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco disabled:cursor-not-allowed disabled:text-texto-desativado disabled:hover:bg-transparent'

/**
 * A foto de perfil na barra de conta (change foto-de-perfil-do-usuario).
 *
 * Exibe a imagem quando o /me traz `avatar_versao`, caindo para o ícone quando não há
 * versão OU quando a imagem falha (`onError`) — o mesmo fallback determinístico do
 * `VisualDaMarca`, nunca o ícone quebrado do navegador. Clicar abre um menu com "Enviar
 * foto" (seletor de arquivo) e "Remover foto" (só com foto). Após enviar/remover, a versão
 * da sessão é atualizada (auth-store) e a barra reflete na hora, sem recarregar.
 */
export function AvatarDoUsuario() {
  const usuario = useAuthStore((estado) => estado.usuario)
  const atualizarAvatarVersao = useAuthStore((estado) => estado.atualizarAvatarVersao)

  const [aberto, setAberto] = useState(false)
  const [imagemFalhou, setImagemFalhou] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const versao = usuario?.avatar_versao ?? null
  const mostraImagem = versao !== null && !imagemFalhou

  // versão nova (upload próprio OU refetch do /me) = imagem nova para tentar: sem isto,
  // um `onError` de uma versão antiga prenderia o ícone mesmo depois da foto trocar
  useEffect(() => {
    setImagemFalhou(false)
  }, [versao])

  async function aoEscolherArquivo(evento: ChangeEvent<HTMLInputElement>): Promise<void> {
    const arquivo = evento.target.files?.[0]
    // limpa o input para permitir reenviar o MESMO arquivo depois de um erro
    evento.target.value = ''
    if (arquivo === undefined) return

    setErro(null)
    setEnviando(true)
    try {
      const { avatar_versao } = await enviarAvatar(arquivo)
      setImagemFalhou(false)
      atualizarAvatarVersao(avatar_versao)
      setAberto(false)
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
      await removerAvatar()
      atualizarAvatarVersao(null)
      setAberto(false)
    } catch {
      setErro('Não foi possível remover a foto. Tente de novo.')
    } finally {
      setEnviando(false)
    }
  }

  const gatilho = (
    <button
      type="button"
      aria-label="Foto de perfil"
      className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-pilula bg-chip-de-marca text-sobre-chip-de-marca focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco"
    >
      {mostraImagem ? (
        <img
          src={`/api/me/avatar?v=${versao}`}
          alt=""
          className="size-full object-cover"
          onError={() => setImagemFalhou(true)}
        />
      ) : (
        <UserRound aria-hidden="true" className="size-4" />
      )}
    </button>
  )

  return (
    <>
      <Popover
        aberto={aberto}
        aoMudarAberto={(proximo) => {
          setAberto(proximo)
          // erro não sobrevive ao fechar: uma recusa antiga presa no painel confundiria
          // a próxima tentativa (parece que já falhou antes de escolher o arquivo)
          if (!proximo) setErro(null)
        }}
        titulo="Foto de perfil"
        gatilho={gatilho}
        className="w-64"
      >
        <div className="flex flex-col gap-0.5">
          <button type="button" onClick={() => inputRef.current?.click()} disabled={enviando} className={CLASSE_ACAO}>
            {enviando ? (
              <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
            ) : (
              <Upload aria-hidden="true" className="size-4" />
            )}
            Enviar foto
          </button>
          {versao !== null ? (
            <button
              type="button"
              onClick={() => void aoRemover()}
              disabled={enviando}
              className={`${CLASSE_ACAO} text-perigo-texto hover:bg-perigo-suave`}
            >
              <Trash2 aria-hidden="true" className="size-4" />
              Remover foto
            </button>
          ) : null}
          {erro !== null ? (
            <p role="alert" className="mt-1 px-2 text-meta text-perigo-texto">
              {erro}
            </p>
          ) : null}
          <p className="mt-1 px-2 text-meta text-texto-suave">PNG, JPG ou WebP, até 1 MB.</p>
        </div>
      </Popover>
      {/* fora do Popover: persiste mesmo com o menu fechado; o botão "Enviar foto" o
          aciona. aria-label + tabIndex=-1: o controle real é o botão, mas o input
          precisa de nome acessível (não é o botão que rotula um input escondido) */}
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        aria-label="Enviar foto de perfil"
        tabIndex={-1}
        className="hidden"
        onChange={(evento) => void aoEscolherArquivo(evento)}
      />
    </>
  )
}
