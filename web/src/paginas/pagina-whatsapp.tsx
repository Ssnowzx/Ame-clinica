import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, CircleAlert, PlugZap, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { EstadoErro } from '@/componentes/ui/estado-erro'
import { Botao } from '@/componentes/ui/botao'
import { CampoTexto } from '@/componentes/ui/campo-texto'
import { Skeleton } from '@/componentes/ui/skeleton'
import { usarToast } from '@/componentes/ui/toast'
import { chaves } from '@/lib/chaves-query'
import { distribuirErrosDoServidor } from '@/lib/erros'
import { gravarConexao, lerConexao, sincronizarTemplates, testarConexao } from '@/servicos/mensageria'
import type { PayloadDaConexao } from '@/tipos'

function motivoDoErro(erro: unknown): string {
  const { gerais } = distribuirErrosDoServidor(erro, new Set())
  return gerais[0] ?? 'Não foi possível concluir a ação. Tente novamente.'
}

const VAZIO: PayloadDaConexao = {
  phone_number_id: '',
  waba_id: '',
  access_token: '',
  app_secret: '',
  verify_token: '',
}

const ROTULO_DO_ESTADO = {
  nao_conectado: 'Não conectado',
  conectado: 'Conectado',
  invalido: 'Credencial inválida',
} as const

/**
 * A tela de conexão do WhatsApp (change mensageria-whatsapp, D1).
 *
 * É por aqui que a clínica liga o canal — SEM deploy, sem `.env`, sem console. Foi o pedido
 * explícito: o sistema fica pronto e passa a operar no dia em que a credencial chegar.
 *
 * O FORMULÁRIO NUNCA É PREENCHIDO DE VOLTA. O servidor não devolve segredo — só os 4 últimos
 * caracteres do token, para confirmar QUAL credencial está em uso. Reabrir a tela mostra
 * campos vazios, e isso é o comportamento correto, não um bug.
 */
export function PaginaWhatsapp() {
  const [formulario, setFormulario] = useState<PayloadDaConexao>(VAZIO)
  const clienteDeQuery = useQueryClient()
  const { notificar } = usarToast()

  const conexao = useQuery({ queryKey: chaves.conexaoWhatsapp(), queryFn: lerConexao })

  const invalidar = () => clienteDeQuery.invalidateQueries({ queryKey: chaves.conexaoWhatsapp() })

  const gravar = useMutation({
    mutationFn: () => gravarConexao(formulario),
    onSuccess: () => {
      setFormulario(VAZIO)
      void invalidar()
      notificar({ tom: 'sucesso', titulo: 'Credencial gravada.', descricao: 'Agora use “Testar conexão”.' })
    },
    onError: (erro) => notificar({ tom: 'erro', titulo: motivoDoErro(erro) }),
  })

  const testar = useMutation({
    mutationFn: testarConexao,
    onSuccess: (resultado) => {
      void invalidar()
      notificar(
        resultado.estado === 'conectado'
          ? { tom: 'sucesso', titulo: 'Conectado ao WhatsApp da clínica.' }
          : { tom: 'erro', titulo: 'A Meta recusou a credencial.', descricao: resultado.ultimo_erro ?? undefined },
      )
    },
    onError: (erro) => notificar({ tom: 'erro', titulo: motivoDoErro(erro) }),
  })

  const sincronizar = useMutation({
    mutationFn: sincronizarTemplates,
    onSuccess: (templates) => notificar({ tom: 'sucesso', titulo: `${templates.length} template(s) sincronizado(s).` }),
    onError: (erro) => notificar({ tom: 'erro', titulo: motivoDoErro(erro) }),
  })

  const completo = Object.values(formulario).every((valor) => valor.trim() !== '')

  if (conexao.isPending) return <Skeleton className="h-64 w-full max-w-2xl" />
  if (conexao.isError) {
    return <EstadoErro mensagem={motivoDoErro(conexao.error)} aoTentarNovamente={() => void conexao.refetch()} />
  }

  const estado = conexao.data.estado

  return (
    <div className="max-w-2xl space-y-6">
      <header>
        <Link to="/configuracoes" className="text-meta text-texto-suave underline underline-offset-2">
          ← Configurações
        </Link>
        <h1 className="mt-1 text-titulo font-semibold text-texto">WhatsApp da clínica</h1>
        <p className="text-meta text-texto-suave">
          Conexão com a API oficial da Meta (Cloud API), usando o número que a clínica já possui.
        </p>
      </header>

      <section
        aria-label="Estado da conexão"
        className="space-y-2 rounded-superficie bg-superficie p-4 ring-1 ring-linha"
      >
        <p className="flex items-center gap-2 text-corpo font-medium text-texto">
          {estado === 'conectado' ? (
            <CheckCircle2 className="size-4 text-sucesso-texto" aria-hidden />
          ) : (
            <CircleAlert className="size-4 text-alerta-texto" aria-hidden />
          )}
          {ROTULO_DO_ESTADO[estado]}
          {conexao.data.numero_exibicao !== null && ` · ${conexao.data.numero_exibicao}`}
        </p>

        {conexao.data.token_final !== null && (
          <p className="text-meta text-texto-suave">
            Token em uso terminado em <code>…{conexao.data.token_final}</code>
            {conexao.data.ultimo_teste_em !== null &&
              ` · testado em ${new Date(conexao.data.ultimo_teste_em).toLocaleString('pt-BR')}`}
          </p>
        )}

        {conexao.data.ultimo_erro !== null && (
          <p role="alert" className="rounded-campo bg-perigo-suave p-2 text-meta text-perigo-texto">
            {conexao.data.ultimo_erro}
          </p>
        )}

        <div className="space-y-1">
          <p className="text-meta font-medium text-texto">URL do webhook (cole no painel da Meta)</p>
          {/* rola na horizontal em telas estreitas: sem `tabIndex`, quem usa só teclado
              não consegue ler a URL inteira (WCAG 2.1.1) */}
          <code
            tabIndex={0}
            role="region"
            aria-label="URL do webhook"
            className="block overflow-x-auto rounded-campo bg-fundo p-2 text-meta text-texto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco"
          >
            {conexao.data.webhook_url}
          </code>
        </div>

        <div className="flex flex-wrap gap-2 pt-1">
          <Botao
            variante="secundario"
            onClick={() => testar.mutate()}
            disabled={testar.isPending || conexao.data.phone_number_id === null}
          >
            <PlugZap className="size-4" aria-hidden /> Testar conexão
          </Botao>
          <Botao
            variante="fantasma"
            onClick={() => sincronizar.mutate()}
            disabled={sincronizar.isPending || estado !== 'conectado'}
          >
            <RefreshCw className="size-4" aria-hidden /> Sincronizar templates
          </Botao>
        </div>
      </section>

      <form
        autoComplete="off"
        className="space-y-4 rounded-superficie bg-superficie p-4 ring-1 ring-linha"
        onSubmit={(evento) => {
          evento.preventDefault()
          if (completo) gravar.mutate()
        }}
      >
        <div>
          <h2 className="text-subtitulo font-semibold text-texto">Credencial</h2>
          <p className="text-meta text-texto-suave">
            Os cinco campos são obrigatórios: gravar substitui a credencial por inteiro. Token novo
            com Phone Number ID antigo é a combinação que “manda e não chega”.
          </p>
        </div>

        <CampoTexto
          rotulo="Phone Number ID"
          obrigatorio
          autoComplete="off"
          value={formulario.phone_number_id}
          onChange={(evento) => setFormulario({ ...formulario, phone_number_id: evento.target.value })}
          ajuda="Painel da Meta → WhatsApp → Configuração da API."
        />
        <CampoTexto
          rotulo="WABA ID"
          obrigatorio
          autoComplete="off"
          value={formulario.waba_id}
          onChange={(evento) => setFormulario({ ...formulario, waba_id: evento.target.value })}
        />
        <CampoTexto
          rotulo="Access Token"
          obrigatorio
          type="password"
          autoComplete="new-password"
          value={formulario.access_token}
          onChange={(evento) => setFormulario({ ...formulario, access_token: evento.target.value })}
          ajuda="Guardado cifrado. Não é devolvido por nenhuma tela depois de salvo."
        />
        <CampoTexto
          rotulo="App Secret"
          obrigatorio
          type="password"
          autoComplete="new-password"
          value={formulario.app_secret}
          onChange={(evento) => setFormulario({ ...formulario, app_secret: evento.target.value })}
          ajuda="Usado para conferir a assinatura das mensagens que a Meta entrega."
        />
        <CampoTexto
          rotulo="Verify Token"
          obrigatorio
          type="password"
          autoComplete="new-password"
          value={formulario.verify_token}
          onChange={(evento) => setFormulario({ ...formulario, verify_token: evento.target.value })}
          ajuda="Você escolhe este valor e repete o mesmo no painel da Meta."
        />

        <Botao type="submit" disabled={!completo || gravar.isPending}>
          Gravar credencial
        </Botao>
      </form>
    </div>
  )
}
