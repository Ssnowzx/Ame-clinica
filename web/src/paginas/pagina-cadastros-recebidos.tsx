import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { BotaoCopiarLinkDeCadastro } from '@/componentes/cadastro/botao-copiar-link-de-cadastro'
import { Botao } from '@/componentes/ui/botao'
import { CampoTexto } from '@/componentes/ui/campo-texto'
import { DialogConfirmacao } from '@/componentes/ui/dialog-confirmacao'
import { EstadoErro } from '@/componentes/ui/estado-erro'
import { EstadoVazio } from '@/componentes/ui/estado-vazio'
import { Skeleton } from '@/componentes/ui/skeleton'
import { usarToast } from '@/componentes/ui/toast'
import { chaves } from '@/lib/chaves-query'
import { buscarReguaDoCadastro } from '@/servicos/campos-cadastro'
import { aceitarEnvio, buscarFilaDeCadastro, descartarEnvio } from '@/servicos/fila-de-cadastro'
import type { CandidatoParecido, EnvioNaFila } from '@/tipos'

/**
 * A fila de conferência — os cadastros que as famílias enviaram pelo link
 * (change `cadastro-online-do-paciente`).
 *
 * É o outro lado da porta pública, e o que a torna suportável: nada entra na base sem alguém
 * olhar. A tela mostra o envio ao lado de quem já existe e registra a decisão.
 *
 * **Tudo aqui é texto de estranho.** Nenhum valor do envio vira endereço de link, de imagem ou de
 * estilo — um telefone ou e-mail que veio de fora MUST NOT virar `href`, porque o esquema do
 * endereço viria de quem enviou. Eles aparecem como texto, e quem confere copia se precisar.
 */

/**
 * O rótulo de cada campo vem da RÉGUA, não de uma lista mantida aqui.
 *
 * A lista paralela que existia neste arquivo não tinha `responsaveis_json`, `contatos_json` nem
 * `endereco_json` — que estão ligados no padrão do catálogo — e o `?? chave` botava o nome da
 * COLUNA na frente de quem confere. É o mesmo defeito que já vazou `required_unless` em inglês
 * para a tela em produção (change `texto-de-maquina-fora-da-tela`).
 *
 * Este mapa é só a rede para o caso de a régua não carregar: nome de coluna nunca aparece.
 */
const ROTULOS_DE_RESERVA: Record<string, string> = {
  nome: 'Nome',
  nome_social: 'Nome social',
  nascimento: 'Nascimento',
  sexo: 'Sexo',
  cpf: 'CPF',
  indicacao: 'Indicação',
  profissao: 'Profissão',
  obs: 'Observação',
  responsaveis_json: 'Responsáveis',
  contatos_json: 'Contatos',
  endereco_json: 'Endereço',
  convenio_id: 'Convênio',
  plano: 'Plano',
  carteirinha: 'Carteirinha',
  carteirinha_validade: 'Validade da carteirinha',
  necessidade: 'Necessidade',
  estado_civil: 'Estado civil',
}

/** Nome de coluna virando frase, quando nem a régua nem a reserva conhecem o campo. */
function humanizar(chave: string): string {
  const limpa = chave.replace(/_json$/, '').replace(/_id$/, '').replace(/_/g, ' ')

  return limpa.charAt(0).toUpperCase() + limpa.slice(1)
}

const SEXOS: Record<string, string> = {
  feminino: 'Feminino',
  masculino: 'Masculino',
  outro: 'Outro',
  nao_informado: 'Não informado',
}

export function PaginaCadastrosRecebidos() {
  const navegar = useNavigate()
  /*
    Âncora do foco depois de descartar (2.4.3). O default do diálogo devolve o foco ao gatilho, e
    aqui o gatilho é apagado pela própria ação: o cartão sai da fila. Sem destino explícito o foco
    cai no `body` e o leitor de tela fica em silêncio.
  */
  const titulo = useRef<HTMLHeadingElement>(null)

  const consulta = useQuery({ queryKey: ['fila-de-cadastro'], queryFn: buscarFilaDeCadastro })

  // rótulo de campo vem da régua; a tela não mantém a própria lista (ver ROTULOS_DE_RESERVA)
  const regua = useQuery({ queryKey: chaves.reguaDoCadastro('paciente'), queryFn: () => buscarReguaDoCadastro('paciente') })

  const rotuloDe = (chave: string): string =>
    regua.data?.campos.find((campo) => campo.campo === chave)?.rotulo ??
    ROTULOS_DE_RESERVA[chave] ??
    humanizar(chave)

  return (
    // teto de largura: em 1440 o cartão esticava para ~1100px com valores curtos
    <div className="flex max-w-3xl flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 ref={titulo} tabIndex={-1} className="text-titulo font-semibold text-texto outline-none">
          Cadastros recebidos
          {consulta.isSuccess && consulta.data.total > 0 ? (
            <span className="ml-2 text-corpo font-normal text-texto-suave">{consulta.data.total}</span>
          ) : null}
        </h1>
        <p className="text-corpo text-texto-suave">
          O que as famílias enviaram pelo link. Nada vira paciente antes de você conferir.
        </p>
        {/* o endereço que alimenta esta fila, para mandar à família daqui mesmo */}
        <div className="mt-2">
          <BotaoCopiarLinkDeCadastro />
        </div>
      </header>

      {/* três caixas do tamanho de um cartão, não um bloco só: o conteúdo real são N cartões */}
      {consulta.isPending ? (
        <div className="flex flex-col gap-4">
          {[0, 1, 2].map((indice) => <Skeleton key={indice} className="h-40 w-full" />)}
        </div>
      ) : null}

      {consulta.isError ? (
        <EstadoErro
          mensagem="Não foi possível carregar os cadastros recebidos."
          aoTentarNovamente={() => { void consulta.refetch() }}
        />
      ) : null}

      {consulta.isSuccess && consulta.data.data.length === 0 ? (
        <EstadoVazio
          titulo="Nenhum cadastro esperando"
          descricao="Quando uma família preencher o formulário pelo link, ele aparece aqui para você conferir. O endereço do formulário é gerado e ligado em Configurações › Cadastro pelo link."
          acao={
            <Botao variante="secundario" onClick={() => { navegar('/configuracoes') }}>
              Abrir Configurações
            </Botao>
          }
        />
      ) : null}

      {consulta.isSuccess
        ? consulta.data.data.map((envio) => (
            <CartaoDoEnvio key={envio.id} envio={envio} rotuloDe={rotuloDe} ancoraDoFoco={() => titulo.current} />
          ))
        : null}
    </div>
  )
}

function CartaoDoEnvio({
  envio,
  rotuloDe,
  ancoraDoFoco,
}: {
  envio: EnvioNaFila
  rotuloDe: (chave: string) => string
  ancoraDoFoco: () => HTMLElement | null
}) {
  const queryClient = useQueryClient()
  const navegar = useNavigate()
  const { notificar } = usarToast()
  const [descartando, setDescartando] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [erroDoMotivo, setErroDoMotivo] = useState<string | undefined>(undefined)

  const aceite = useMutation({
    mutationFn: () => aceitarEnvio(envio.id),
    onSuccess: (resultado) => {
      void queryClient.invalidateQueries({ queryKey: ['fila-de-cadastro'] })
      /*
       * ACEITAR ABRE O FORMULÁRIO, não grava. É a decisão de desenho que impede um segundo
       * caminho de criação de paciente: quem cria continua sendo o cadastro de sempre, com todas
       * as guardas, e esta tela só entrega o rascunho já preenchido para a recepção corrigir.
       */
      void navegar('/pacientes/novo', { state: { preenchido: resultado.dados, envio: envio.id } })
    },
    onError: () => {
      notificar({ tom: 'erro', titulo: 'Não foi possível aceitar este cadastro.' })
    },
  })

  const descarte = useMutation({
    mutationFn: () => descartarEnvio(envio.id, motivo),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['fila-de-cadastro'] })
      setDescartando(false)
      setMotivo('')
      notificar({ tom: 'sucesso', titulo: 'Cadastro descartado.' })
    },
    onError: () => {
      setErroDoMotivo('Não foi possível descartar. Tente de novo.')
    },
  })

  return (
    <article className="flex flex-col gap-4 rounded-janela border border-linha bg-superficie p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-corpo-lg font-semibold text-texto">{textoDe(envio.dados['nome'])}</h2>
        <span className="text-meta text-texto-suave">Enviado em {dataLegivel(envio.enviado_em)}</span>
      </header>

      <dl className="grid gap-2 sm:grid-cols-2">
        {Object.entries(envio.dados)
          .filter(([chave]) => chave !== 'nome')
          .map(([chave, valor]) => (
            <div key={chave} className="flex flex-col gap-0.5 border-l-2 border-linha pl-3">
              <dt className="text-meta text-texto-suave">{rotuloDe(chave)}</dt>
              {/* TEXTO, sempre: nada do envio vira link, imagem ou estilo */}
              <dd className="text-corpo break-words text-texto">{textoDe(valor, chave)}</dd>
            </div>
          ))}
      </dl>

      {envio.parecidos !== undefined && envio.parecidos.length > 0 ? (
        <Parecidos candidatos={envio.parecidos} />
      ) : null}

      {/*
        O que aceitar CUSTA, dito onde a decisão é tomada. Aceitar tira o envio da fila na hora e
        não há como devolvê-lo — quem for interrompido no meio do formulário perde o preenchimento
        da família de vista. O desenho é esse de propósito ("conferido não se confere de novo",
        para não criar paciente em dobro), e por isso a consequência precisa estar na tela.
      */}
      <p className="text-meta text-texto-suave">
        Aceitar tira este cadastro da fila e abre o formulário já preenchido. Termine de salvar
        antes de sair da tela: o envio não volta para a fila.
      </p>

      <div className="flex flex-wrap justify-end gap-3">
        <Botao
          variante="secundario"
          className="w-full sm:w-auto"
          onClick={() => { setDescartando(true) }}
        >
          Descartar
        </Botao>
        <Botao
          className="w-full sm:w-auto"
          carregando={aceite.isPending}
          onClick={() => { aceite.mutate() }}
        >
          Aceitar e abrir cadastro
        </Botao>
      </div>

      <DialogConfirmacao
        aberto={descartando}
        aoMudarAberto={(aberto) => {
          setDescartando(aberto)
          if (!aberto) setErroDoMotivo(undefined)
        }}
        titulo={`Descartar o cadastro de ${textoDe(envio.dados['nome'])}?`}
        consequencia="O envio sai da fila e não vira paciente. O motivo fica registrado, e o conteúdo é apagado no prazo de retenção da clínica."
        rotuloConfirmar="Descartar cadastro"
        tom="perigo"
        carregando={descarte.isPending}
        // descartar APAGA o gatilho: o cartão sai da fila antes de o foco voltar para ele
        focoAoFechar={ancoraDoFoco}
        aoConfirmar={() => {
          if (motivo.trim().length < 3) {
            setErroDoMotivo('Diga por que este cadastro está sendo descartado.')
            throw new Error('motivo obrigatório')
          }
          setErroDoMotivo(undefined)
          descarte.mutate()
        }}
      >
        <CampoTexto
          rotulo="Motivo"
          obrigatorio
          erro={erroDoMotivo}
          value={motivo}
          onChange={(evento) => { setMotivo(evento.target.value) }}
        />
      </DialogConfirmacao>
    </article>
  )
}

/**
 * Quem já existe e pode ser a mesma pessoa.
 *
 * É o oposto do oráculo da porta pública: lá, dizer que o CPF já existe entregaria a clientela da
 * clínica a qualquer um; aqui, quem lê já tem permissão para saber quem é paciente. Por isso o
 * bloco só existe para quem tem `pacientes.ver` — e o servidor o omite, em vez de mandá-lo vazio.
 */
function Parecidos({ candidatos }: { candidatos: CandidatoParecido[] }) {
  return (
    /*
      Bloco NEUTRO, não de alerta. Telefone de mãe repetido entre irmãos é coincidência corriqueira
      numa clínica infantil: pintar a fila de âmbar no uso normal faz a cor parar de significar
      alguma coisa (design-QA, achado 14, e §2 da especificação — "cor com contenção").
    */
    <section className="flex flex-col gap-2 rounded-campo border border-linha-forte bg-fundo p-3">
      <h3 className="text-corpo font-semibold text-texto">Pode ser alguém que já está cadastrado</h3>
      <ul className="flex flex-col gap-1">
        {candidatos.map((candidato) => (
          <li key={candidato.id} className="text-corpo text-texto">
            {candidato.nome}
            <span className="text-meta text-texto-suave">
              {candidato.coincide_por === 'cpf' ? ' — mesmo CPF' : ' — mesmo telefone'}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * O valor do envio como TEXTO.
 *
 * Ele veio de fora, sem sessão e sem ninguém por trás: o que a tela faz com ele é escrever. Data
 * chega no formato da API e sai em português; lista vira contagem, porque a fila é para decidir,
 * não para auditar campo a campo.
 */
function textoDe(valor: unknown, chave?: string): string {
  if (valor === null || valor === undefined || valor === '') return '—'

  if (chave === 'nascimento' && typeof valor === 'string') return dataLegivel(valor)
  if (chave === 'sexo' && typeof valor === 'string') return SEXOS[valor] ?? valor

  if (Array.isArray(valor)) {
    return valor
      .map((item) =>
        typeof item === 'object' && item !== null
          ? Object.values(item as Record<string, unknown>).filter(Boolean).join(' · ')
          : String(item),
      )
      .join(' | ')
  }

  if (typeof valor === 'object') {
    return Object.values(valor as Record<string, unknown>).filter(Boolean).join(', ')
  }

  return String(valor)
}

/** `2018-03-15` ou `2026-09-02 14:00:00` → dia/mês/ano, sempre em português. */
function dataLegivel(valor: string): string {
  const soData = /^(\d{4})-(\d{2})-(\d{2})/.exec(valor)

  return soData === null ? valor : `${soData[3]}/${soData[2]}/${soData[1]}`
}
