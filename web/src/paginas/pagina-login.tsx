import { CircleAlert } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { Botao } from '@/componentes/ui/botao'
import { CampoTexto } from '@/componentes/ui/campo-texto'
import { ErroDeApi } from '@/lib/http'
import { useAuthStore } from '@/stores/auth-store'

export function PaginaLogin() {
  const login = useAuthStore((estado) => estado.login)
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  async function aoEnviar(evento: React.FormEvent) {
    evento.preventDefault()
    setErro(null)
    setEnviando(true)

    try {
      await login(email, senha)
      navigate('/', { replace: true })
    } catch (excecao) {
      // credencial errada volta 422 do servidor; a mensagem é genérica de
      // propósito (não revela se o e-mail existe)
      setErro(
        excecao instanceof ErroDeApi && excecao.motivo === 'invalido'
          ? 'Credenciais inválidas.'
          : 'Não foi possível entrar. Tente novamente.',
      )
    } finally {
      setEnviando(false)
    }
  }

  return (
    // `data-tema="xclinicas"` no PRÓPRIO `<main>`, e não no `<html>` (change tema-xclinicas): o login
    // é a marca do PRODUTO, nas cores e nas fontes do manual, qualquer que seja o tema das clínicas —
    // e não disputa o atributo do `<html>` com o shell, que é quem aplica o tema da CLÍNICA.
    <main data-tema="xclinicas" className="flex min-h-screen items-center justify-center bg-fundo p-4 font-texto [font-weight:var(--peso-texto)]">
      <form
        onSubmit={aoEnviar}
        className="flex w-full max-w-sm flex-col gap-5 rounded-superficie border border-linha-forte bg-superficie p-8 shadow-e1"
      >
        {/*
          A marca aqui é a do PRODUTO, não a da clínica: nesta tela ainda não há sessão, e a
          identidade da clínica só chega depois do login (`VisualDaMarca`, alimentada pelo `/me`).

          O símbolo é `aria-hidden` e o nome fica no `h1`: a imagem repetiria em voz alta o que o
          título já diz, e quem usa leitor de tela ouviria "Xclinicas" duas vezes.
        */}
        <div className="flex flex-col items-center gap-2 text-center">
          {/* o WORDMARK do manual: o símbolo faz as vezes do "X" e "clinicas" vem na serifada da marca.
              O nome acessível é o inteiro ("Xclinicas"), por um texto só para leitor de tela — o
              desenho, sozinho, seria lido "clinicas". */}
          <h1 className="flex items-center gap-1.5 font-display text-display text-texto">
            <img src="/marca/simbolo.svg" alt="" aria-hidden="true" className="size-9" />
            <span className="sr-only">Xclinicas</span>
            <span aria-hidden="true">clinicas</span>
          </h1>
          <p className="text-corpo text-texto-suave">Entre para acessar a agenda da clínica.</p>
        </div>

        {/* `required` nativo em vez da prop `obrigatorio`: o sufixo
            "(obrigatório)" existe para distinguir campos num formulário misto —
            aqui os dois são obrigatórios e o rótulo repetido só faria ruído */}
        <CampoTexto
          rotulo="E-mail"
          type="email"
          value={email}
          onChange={(evento) => {
            setEmail(evento.target.value)
          }}
          required
          autoComplete="username"
          tamanho="lg"
        />

        <CampoTexto
          rotulo="Senha"
          type="password"
          value={senha}
          onChange={(evento) => {
            setSenha(evento.target.value)
          }}
          required
          autoComplete="current-password"
          tamanho="lg"
        />

        {erro !== null ? (
          <p
            role="alert"
            className="flex items-center gap-2 rounded-campo bg-perigo-suave px-3 py-2 text-corpo text-perigo-texto"
          >
            <CircleAlert aria-hidden="true" className="size-4 shrink-0" />
            {erro}
          </p>
        ) : null}

        <Botao type="submit" tamanho="lg" carregando={enviando} className="w-full">
          {enviando ? 'Entrando…' : 'Entrar'}
        </Botao>
      </form>
    </main>
  )
}
