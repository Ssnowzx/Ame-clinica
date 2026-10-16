import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState, type FormEvent, type RefObject } from 'react'
import { useParams } from 'react-router-dom'

import { CampoDoTelefone } from '@/componentes/pacientes/campo-do-telefone'
import { Botao } from '@/componentes/ui/botao'
import { CampoComMascara } from '@/componentes/ui/campo-com-mascara'
import { CampoSelect } from '@/componentes/ui/campo-select'
import { CampoTexto } from '@/componentes/ui/campo-texto'
import { CampoTextoLongo } from '@/componentes/ui/campo-texto-longo'
import { Skeleton } from '@/componentes/ui/skeleton'
import { ID_DO_CAMPO, usarConsultaDeCep, type ConsultaDeCep } from '@/hooks/usar-consulta-de-cep'
import { usarTemaDaClinica } from '@/hooks/usar-tema-da-clinica'
import { FORMATO_DO_CEP } from '@/lib/cep'
import { fonteDaMarca } from '@/lib/configuracoes-rotulos'
import { idadeEm, mascararDataBrasileira, paraDataDaApi } from '@/lib/data-brasileira'
import {
  buscarFormularioPublico,
  ehLinkIndisponivel,
  ehStatus,
  enviarCadastroPublico,
  errosDoServidor,
  urlDaLogoPublica,
} from '@/servicos/cadastro-publico'
import type { CampoPublico, ContatoDoEnvio, FormularioPublico, ResponsavelDoEnvio } from '@/tipos'

/**
 * A página que a família abre pelo link (change `cadastro-online-do-paciente`).
 *
 * Ela mora FORA do `app-shell` e não faz nenhuma chamada autenticada: o shell consulta sessão,
 * contadores e permissões, e montá-lo aqui significaria uma tela que falha em toda chamada para
 * quem não tem conta. O que se compartilha com o resto do produto são os tokens do design system;
 * o que não se compartilha é a casca.
 *
 * Três passos, no molde do sistema que a clínica já usa: informações do paciente, outras
 * informações, conclusão. Os campos NÃO são uma lista desta tela — vêm da régua da clínica, com
 * rótulo e obrigatoriedade decididos no servidor. Duas configurações produzem formulários diferentes
 * sem uma linha de condicional aqui.
 */

/** Os três passos, na ordem em que a família os percorre. */
const PASSOS = ['Informações do paciente', 'Outras informações', 'Conclusão'] as const

/**
 * Em qual campo do primeiro item mora a recusa da lista inteira — a que vem sem índice
 * (`responsaveis_json`), como "informe pelo menos um responsável".
 */
const PRIMEIRA_CHAVE: Record<string, string> = {
  responsaveis_json: 'nome',
  contatos_json: 'valor',
}

/** As seções de cada passo. Seção que a régua não trouxe simplesmente não aparece. */
const SECOES_DO_PASSO: Record<number, string[]> = {
  0: ['identificacao'],
  1: ['responsaveis', 'contatos', 'endereco', 'outros'],
}

const SEXOS = [
  { valor: 'feminino', rotulo: 'Feminino' },
  { valor: 'masculino', rotulo: 'Masculino' },
  { valor: 'outro', rotulo: 'Outro' },
  { valor: 'nao_informado', rotulo: 'Prefiro não informar' },
]

const TIPOS_DE_CONTATO = [
  { valor: 'celular', rotulo: 'Celular' },
  { valor: 'whatsapp', rotulo: 'WhatsApp' },
  { valor: 'telefone', rotulo: 'Telefone' },
  { valor: 'email', rotulo: 'E-mail' },
]

export function PaginaCadastroPublico() {
  const { slug = '' } = useParams()

  const consulta = useQuery({
    queryKey: ['cadastro-publico', slug],
    queryFn: () => buscarFormularioPublico(slug),
    retry: false,
  })

  if (consulta.isPending) {
    return (
      <Moldura>
        {/* o esqueleto é `aria-hidden`: sem isto a página abre em SILÊNCIO para leitor de tela */}
        <div aria-busy="true" className="flex flex-col gap-3">
          <p className="sr-only" role="status">
            Carregando o formulário de cadastro.
          </p>
          <Skeleton className="h-64 w-full" />
        </div>
      </Moldura>
    )
  }

  /*
   * LINK INDISPONÍVEL — e a tela é a MESMA para endereço que nunca existiu, clínica inativa e link
   * desligado. O servidor já responde igual nos três casos; se a tela os separasse, o oráculo que
   * ele fechou voltaria pela interface.
   */
  if (consulta.isError) {
    return (
      <Moldura>
        <div className="flex flex-col gap-3 text-center">
          <h1 className="text-titulo font-semibold text-texto">Este link não está disponível</h1>
          <p className="text-corpo-lg leading-relaxed text-texto-suave">
            {ehLinkIndisponivel(consulta.error)
              ? 'O endereço pode ter mudado ou o cadastro pelo link pode estar temporariamente fechado. Fale com a clínica para receber um link novo.'
              : 'Não conseguimos carregar o formulário agora. Confira sua conexão e tente de novo.'}
          </p>

          {/*
            Só a falha de REDE tem o que tentar de novo. Link indisponível é resposta do servidor,
            e um botão ali convidaria a família a insistir num endereço que não vai passar a valer
          */}
          {ehLinkIndisponivel(consulta.error) ? null : (
            <div className="flex justify-center">
              <Botao type="button" onClick={() => { void consulta.refetch() }}>
                Tentar novamente
              </Botao>
            </div>
          )}
        </div>
      </Moldura>
    )
  }

  return <Assistente slug={slug} formulario={consulta.data} />
}

function Assistente({ slug, formulario }: { slug: string; formulario: FormularioPublico }) {
  /*
    O TÍTULO da aba (2.4.2). É a única página do produto que alguém sem conta abre, e ela dizia
    o nome interno do produto na aba, no histórico e na prévia do link quando
    alguém o compartilha por WhatsApp. É também o primeiro texto que um leitor de tela anuncia.
  */
  useEffect(() => {
    const anterior = document.title
    document.title = `Cadastro de paciente — ${formulario.clinica.nome}`

    return () => { document.title = anterior }
  }, [formulario.clinica.nome])

  const [passo, setPasso] = useState(0)
  const [valores, setValores] = useState<Record<string, string>>({})
  const [responsaveis, setResponsaveis] = useState<ResponsavelDoEnvio[]>([
    { nome: '', parentesco: '', telefone: '' },
  ])
  const [contatos, setContatos] = useState<ContatoDoEnvio[]>([{ tipo: 'celular', valor: '' }])

  /*
   * O CEP responde o endereço, aqui pela MESMA peça que a recepção usa
   * (capability `consulta-de-cep`). Uma cópia própria para a família não divergiria com erro:
   * divergiria com a família tendo uma experiência diferente da recepção.
   *
   * `campoVisivel` é a régua desta clínica: o formulário público já vem com os campos que ela
   * publicou, e a consulta não preenche o que não está aqui.
   */
  const refDoNumero = useRef<HTMLInputElement>(null)
  const camposPublicados = useMemo(
    () => new Set(formulario.campos.map((campo) => campo.campo)),
    [formulario],
  )
  const cep = usarConsultaDeCep({
    aoPreencher: (endereco) => {
      setValores((atuais) => {
        const novos = { ...atuais }
        for (const [chave, valor] of Object.entries(endereco)) {
          novos[`endereco_${chave}`] = valor
        }
        return novos
      })
    },
    campoVisivel: (campo) => camposPublicados.has(campo),
    refDoNumero,
  })
  const [erros, setErros] = useState<Record<string, string[]>>({})
  const [enviando, setEnviando] = useState(false)
  const [concluido, setConcluido] = useState<string | null>(null)

  const porSecao = useMemo(() => agruparPorSecao(formulario), [formulario])
  const pedeResponsavel = ehMenorDeIdade(valores['nascimento'] ?? '')

  /*
    O foco acompanha a troca de etapa (2.4.3).
    Do passo 1 para o 2 o `<form>` sobrevive e o foco fica onde estava; do 2 para a revisão o
    `<form>` é trocado por um `<div>` e o botão que a pessoa apertou some — o foco caía no `body`.
    No celular isso importa duas vezes: o começo do passo novo nasce acima da dobra.
  */
  const focoDoPasso = useRef<HTMLHeadingElement>(null)
  const primeiroRender = useRef(true)

  useEffect(() => {
    if (primeiroRender.current) {
      primeiroRender.current = false
      return
    }

    focoDoPasso.current?.focus()
  }, [passo, concluido])

  /*
    Erro recusado leva o foco ao PRIMEIRO campo que o causou (3.3.1).
    Sem isto, o foco fica no botão do rodapé e vários `role="alert"` sobem ao mesmo tempo: a
    família ouve as reclamações e não sabe em qual campo está a primeira. O `passo` entra na lista
    porque a recusa do SERVIDOR troca de etapa antes de o campo existir na tela.
  */
  const areaDoPasso = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (Object.keys(erros).length === 0) return

    const invalido = areaDoPasso.current?.querySelector<HTMLElement>('[aria-invalid="true"]')

    invalido?.focus()
  }, [erros, passo])

  /*
   * A CONCLUSÃO não ecoa o que foi enviado, e o estado do assistente morre junto: reabrir o link
   * abre um formulário vazio. O envio é da clínica agora; a família não volta aqui para vê-lo, e
   * deixar o rascunho na tela seria dado de criança parado num aparelho compartilhado.
   */
  if (concluido !== null) {
    return (
      <Moldura marca={formulario.clinica} slug={slug}>
        {/*
          `h2` sob o `h1` da marca — dois `h1` na mesma página desfazem a hierarquia. E o foco vem
          para cá porque o botão que a família apertou foi DESMONTADO: sem isto o foco cai no
          `body`, nada é anunciado, e quem não enxerga não sabe se o envio deu certo (a11y, A1).
        */}
        <div role="status" className="flex flex-col gap-4 text-center">
          <h2 ref={focoDoPasso} tabIndex={-1} className="text-titulo font-semibold text-texto outline-none">
            Cadastro enviado
          </h2>
          <p className="text-corpo-lg leading-relaxed text-texto-suave">{concluido}</p>
          <p className="text-corpo leading-relaxed text-texto-suave">
            Se faltar alguma informação, entramos em contato.
          </p>
        </div>
      </Moldura>
    )
  }

  const camposDoPasso = (SECOES_DO_PASSO[passo] ?? [])
    .flatMap((secao) => porSecao[secao] ?? [])

  function avancar(evento: FormEvent) {
    evento.preventDefault()
    const faltando = obrigatoriosVazios(camposDoPasso, valores, responsaveis, contatos, pedeResponsavel)

    if (Object.keys(faltando).length > 0) {
      setErros(faltando)
      return
    }

    setErros({})
    setPasso((atual) => atual + 1)
  }

  async function enviar() {
    setEnviando(true)
    setErros({})

    try {
      const resposta = await enviarCadastroPublico(slug, montarEnvio(formulario, valores, responsaveis, contatos))
      setConcluido(resposta.mensagem)
    } catch (erro) {
      const doServidor = errosDoServidor(erro)
      setErros(Object.keys(doServidor).length > 0 ? comRedeDeSeguranca(doServidor, porSecao) : { geral: [aviso(erro)] })
      // volta ao passo do primeiro campo com erro para a família ver o que corrigir; o
      // preenchimento inteiro continua na tela — falha de rede não pode custar o formulário todo
      setPasso(passoDoErro(doServidor, porSecao))
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Moldura marca={formulario.clinica} slug={slug}>
      <div ref={areaDoPasso} className="contents">
        <Progresso passo={passo} foco={focoDoPasso} />

      {erros['geral'] !== undefined ? (
        <p role="alert" className="rounded-campo bg-perigo-suave p-3 text-corpo text-perigo-texto">
          {erros['geral'][0]}
        </p>
      ) : null}

      {passo < 2 ? (
        <form onSubmit={avancar} className="flex flex-col gap-5" noValidate>
          {(SECOES_DO_PASSO[passo] ?? []).map((secao) => {
            const campos = porSecao[secao] ?? []
            if (campos.length === 0) return null

            return (
              <fieldset key={secao} className="flex flex-col gap-4">
                <legend className="text-corpo-lg font-semibold text-texto">
                  {rotuloDaSecao(formulario, secao)}
                </legend>

                {campos.map((campo) =>
                  campo.lista ? (
                    <BlocoDeLista
                      key={campo.campo}
                      campo={campo}
                      pedeResponsavel={pedeResponsavel}
                      responsaveis={responsaveis}
                      contatos={contatos}
                      erros={erros}
                      aoMudarResponsaveis={setResponsaveis}
                      aoMudarContatos={setContatos}
                    />
                  ) : (
                    <CampoDoFormulario
                      key={campo.campo}
                      campo={campo}
                      valor={valores[campo.campo] ?? ''}
                      erro={erros[campo.campo]?.[0]}
                      cep={cep}
                      refDoNumero={refDoNumero}
                      aoMudar={(valor) => {
                        setValores((atuais) => ({ ...atuais, [campo.campo]: valor }))
                      }}
                    />
                  ),
                )}
              </fieldset>
            )
          })}

          <Navegacao passo={passo} aoVoltar={() => { setPasso((p) => p - 1) }} rotuloAvancar="Continuar" />
        </form>
      ) : (
        <div className="flex flex-col gap-5">
          <p className="text-corpo-lg leading-relaxed text-texto-suave">
            Confira os dados antes de enviar. Depois de enviar, a clínica recebe o cadastro para
            conferência.
          </p>

          {/*
            A conferência mostra TUDO que vai ser enviado, listas inclusive. Ela mostrava só os
            campos simples — e o responsável do menor, que é exigência legal e o dado que a
            família mais erra, ficava de fora de uma tela que promete "confira os dados antes de
            enviar" (design-QA, achado 4).
          */}
          <dl className="flex flex-col gap-2">
            {Object.entries(valores)
              .filter(([, valor]) => valor.trim() !== '')
              .map(([campo, valor]) => (
                <LinhaDaRevisao
                  key={campo}
                  rotulo={rotuloDoCampo(formulario, campo)}
                  valor={valorLegivel(campo, valor)}
                />
              ))}

            {responsaveis
              .filter((item) => item.nome.trim() !== '' || item.parentesco.trim() !== '')
              .map((item, indice) => (
                <LinhaDaRevisao
                  key={`responsavel-${String(indice)}`}
                  rotulo={`Responsável ${String(indice + 1)}`}
                  valor={[item.nome, item.parentesco, item.telefone].filter((v) => (v ?? '').trim() !== '').join(' · ')}
                />
              ))}

            {contatos
              .filter((item) => item.valor.trim() !== '')
              .map((item, indice) => (
                <LinhaDaRevisao
                  key={`contato-${String(indice)}`}
                  rotulo={rotuloDoTipoDeContato(item.tipo)}
                  valor={item.valor}
                />
              ))}
          </dl>

          <div className="flex flex-wrap justify-between gap-3">
            <Botao type="button" variante="secundario" onClick={() => { setPasso(1) }}>
              Voltar
            </Botao>
            <Botao type="button" carregando={enviando} onClick={() => { void enviar() }}>
              Enviar cadastro
            </Botao>
          </div>
        </div>
      )}
      </div>
    </Moldura>
  )
}

/**
 * A casca da página: marca da clínica no topo, e nada mais da clínica.
 *
 * O `h1` existe SEMPRE, com a logo dentro dele quando a clínica usa logo. A versão anterior
 * trocava o `h1` pela `<img>`, e uma clínica com logo publicava uma página sem nenhum cabeçalho —
 * quem usa leitor de tela não tinha por onde se situar (a11y, achado A5).
 */
function Moldura({
  children,
  marca,
  slug,
}: {
  children: React.ReactNode
  marca?: FormularioPublico['clinica']
  slug?: string
}) {
  // logo que não carrega cai para o NOME, nunca para o ícone quebrado do navegador
  const [logoFalhou, setLogoFalhou] = useState(false)
  const mostraLogo = marca?.identidade === 'logo' && slug !== undefined && !logoFalhou
  // a família reconhece a clínica também pela cor (change tema-da-clinica)
  usarTemaDaClinica(marca?.tema)

  return (
    // `dvh`, não `vh`: a barra de endereço do navegador do celular faz parte da altura, e esta é
    // a tela cujo alvo declarado é o telefone
    <div className="min-h-dvh bg-fundo px-4 py-8">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
        {marca !== undefined ? (
          <header className="flex flex-col items-center gap-3 text-center">
            <h1 className="text-titulo font-semibold text-texto" style={{ fontFamily: fonteDaMarca(marca.fonte_do_nome) }}>
              {mostraLogo ? (
                <img
                  src={urlDaLogoPublica(slug)}
                  alt={marca.nome}
                  // `max-w-full` junto do teto de altura: logo de proporção larga (banner de
                  // clínica é tipicamente 5:1) estourava os 320 px e criava rolagem lateral
                  className="max-h-20 w-auto max-w-full object-contain"
                  onError={() => { setLogoFalhou(true) }}
                />
              ) : (
                marca.nome
              )}
            </h1>
            <p className="text-corpo text-texto-suave">Cadastro de paciente</p>
          </header>
        ) : null}

        <main className="flex flex-col gap-5 rounded-janela border border-linha bg-superficie p-6 shadow-e1 sm:p-8">
          {children}
        </main>
      </div>
    </div>
  )
}

/**
 * O indicador de progresso.
 *
 * A troca de passo é ANUNCIADA (`role="status"`, no MESMO nó DOM entre passos — região viva
 * montada condicionalmente não é anunciada de forma confiável) e o foco vem para o título, que é
 * o começo da etapa nova.
 *
 * O nome da etapa é a orientação principal da tela, e por isso é um TÍTULO. Ele vivia em
 * `text-meta` — o papel mais fraco do sistema, o mesmo de "Enviado em…" — o que fazia a única
 * frase que diz onde a pessoa está ser a menor da página (design-QA, achado 13).
 */
function Progresso({ passo, foco }: { passo: number; foco: React.Ref<HTMLHeadingElement> }) {
  return (
    <div className="flex flex-col gap-2">
      <h2
        ref={foco}
        tabIndex={-1}
        role="status"
        aria-live="polite"
        className="text-subtitulo font-semibold text-texto outline-none"
      >
        {`Passo ${String(passo + 1)} de ${String(PASSOS.length)}: ${PASSOS[passo]}`}
      </h2>
      <ol className="flex gap-1.5" aria-hidden="true">
        {PASSOS.map((nome, indice) => (
          <li
            key={nome}
            className={`h-1.5 flex-1 rounded-pilula ${indice <= passo ? 'bg-acento' : 'bg-linha'}`}
          />
        ))}
      </ol>
    </div>
  )
}

function Navegacao({
  passo,
  aoVoltar,
  rotuloAvancar,
}: {
  passo: number
  aoVoltar: () => void
  rotuloAvancar: string
}) {
  return (
    <div className="flex flex-wrap justify-between gap-3">
      {passo > 0 ? (
        <Botao type="button" variante="secundario" onClick={aoVoltar}>
          Voltar
        </Botao>
      ) : (
        <span />
      )}
      <Botao type="submit">{rotuloAvancar}</Botao>
    </div>
  )
}

/** Um campo simples, escolhido pelo nome que veio da régua. */
function CampoDoFormulario({
  campo,
  valor,
  erro,
  cep,
  refDoNumero,
  aoMudar,
}: {
  campo: CampoPublico
  valor: string
  erro?: string
  cep?: ConsultaDeCep
  refDoNumero?: RefObject<HTMLInputElement | null>
  aoMudar: (valor: string) => void
}) {
  // os quatro campos que a consulta escreve levam id ESTÁVEL: é por ele que o hook sabe em
  // qual deles a pessoa está digitando, para não sobrescrever por baixo dela
  const idEstavel = ID_DO_CAMPO[campo.campo.replace('endereco_', '') as keyof typeof ID_DO_CAMPO]

  const comum = {
    rotulo: campo.rotulo,
    obrigatorio: campo.obrigatorio,
    erro,
    value: valor,
    limite: campo.tamanho ?? undefined,
    ...(idEstavel !== undefined ? { id: idEstavel } : {}),
  }

  // o CEP responde o endereço; o Número é o único campo que ele não sabe, e é para ele que o
  // foco vai — por isso a referência desce até aqui
  if (campo.campo === 'endereco_cep') {
    return (
      <CampoComMascara
        rotulo={campo.rotulo}
        obrigatorio={campo.obrigatorio}
        erro={erro}
        formato={FORMATO_DO_CEP}
        value={valor}
        ajuda={cep?.ajuda}
        anuncio={cep?.mensagem}
        onChangeValor={(digitos) => {
          aoMudar(digitos)
          cep?.aoDigitarCep(digitos)
        }}
      />
    )
  }

  if (campo.campo === 'endereco_numero') {
    return (
      <CampoTexto
        {...comum}
        ref={refDoNumero}
        inputMode="numeric"
        onChange={(evento) => { aoMudar(evento.target.value) }}
      />
    )
  }

  if (campo.campo === 'nascimento') {
    return (
      <CampoTexto
        {...comum}
        inputMode="numeric"
        placeholder="dd/mm/aaaa"
        ajuda="No formato dia/mês/ano. Exemplo: 15/03/2018."
        onChange={(evento) => { aoMudar(mascararDataBrasileira(evento.target.value)) }}
      />
    )
  }

  if (campo.campo === 'sexo') {
    return (
      <CampoSelect
        {...comum}
        opcoes={SEXOS}
        placeholder="Selecione"
        onChange={(evento) => { aoMudar(evento.target.value) }}
      />
    )
  }

  if (campo.campo === 'obs') {
    return (
      <CampoTextoLongo
        {...comum}
        rows={4}
        onChange={(evento) => { aoMudar(evento.target.value) }}
      />
    )
  }

  return (
    <CampoTexto
      {...comum}
      inputMode={campo.campo === 'cpf' ? 'numeric' : undefined}
      onChange={(evento) => { aoMudar(evento.target.value) }}
    />
  )
}

/** Responsáveis e contatos: blocos que se repetem. */
function BlocoDeLista({
  campo,
  pedeResponsavel,
  responsaveis,
  contatos,
  erros,
  aoMudarResponsaveis,
  aoMudarContatos,
}: {
  campo: CampoPublico
  pedeResponsavel: boolean
  responsaveis: ResponsavelDoEnvio[]
  contatos: ContatoDoEnvio[]
  erros: Record<string, string[]>
  aoMudarResponsaveis: (lista: ResponsavelDoEnvio[]) => void
  aoMudarContatos: (lista: ContatoDoEnvio[]) => void
}) {
  // `erros[campo.campo]` é a recusa da lista inteira ("informe pelo menos um responsável") e
  // mora no primeiro item; a recusa de um item vem em `responsaveis_json.2.nome`
  const erroDoItem = (indice: number, chave: string) =>
    erros[`${campo.campo}.${indice}.${chave}`]?.[0] ??
    (indice === 0 && chave === PRIMEIRA_CHAVE[campo.campo] ? erros[campo.campo]?.[0] : undefined)

  if (campo.campo === 'responsaveis_json') {
    return (
      <div className="flex flex-col gap-3">
        {/*
          A exigência aparece quando a data digitada indica MENOR — é a lei (art. 14), não
          preferência da clínica, e por isso ela não segue a marca de obrigatório da régua. Quem
          decide de verdade é o servidor; aqui a família descobre antes de tentar enviar.
        */}
        <p className="text-corpo text-texto-suave">
          {pedeResponsavel
            ? 'Para menor de idade, informe pelo menos um responsável.'
            : 'Se quiser, informe um responsável.'}
        </p>

        {/*
          `fieldset`/`legend` por item: o agrupamento existia só como BORDA. Com dois responsáveis
          na tela, o leitor de tela anunciava "Nome do responsável" duas vezes, sem dizer de qual
          (a11y, achado A4) — e a borda que os separa tem contraste 1,29:1, invisível para baixa
          visão.
        */}
        {responsaveis.map((responsavel, indice) => (
          <fieldset key={indice} className="flex flex-col gap-3 rounded-campo border border-linha p-3">
            <legend className="px-1 text-meta font-medium text-texto-suave">
              {`Responsável ${String(indice + 1)}`}
            </legend>
            <CampoTexto
              rotulo="Nome do responsável"
              limite={campo.tamanhos_dos_itens['nome']}
              obrigatorio={pedeResponsavel && indice === 0}
              erro={erroDoItem(indice, 'nome')}
              value={responsavel.nome}
              onChange={(evento) => {
                aoMudarResponsaveis(trocarItem(responsaveis, indice, { nome: evento.target.value }))
              }}
            />
            <CampoTexto
              rotulo="Parentesco"
              limite={campo.tamanhos_dos_itens['parentesco']}
              ajuda="Mãe, pai, avó, responsável legal…"
              obrigatorio={pedeResponsavel && indice === 0}
              erro={erroDoItem(indice, 'parentesco')}
              value={responsavel.parentesco}
              onChange={(evento) => {
                aoMudarResponsaveis(trocarItem(responsaveis, indice, { parentesco: evento.target.value }))
              }}
            />
            <CampoTexto
              rotulo="Telefone do responsável"
              limite={campo.tamanhos_dos_itens['telefone']}
              inputMode="tel"
              autoComplete="tel"
              erro={erroDoItem(indice, 'telefone')}
              value={responsavel.telefone ?? ''}
              onChange={(evento) => {
                aoMudarResponsaveis(trocarItem(responsaveis, indice, { telefone: evento.target.value }))
              }}
            />
          </fieldset>
        ))}

        {responsaveis.length < 5 ? (
          <Botao
            type="button"
            variante="secundario"
            onClick={() => {
              aoMudarResponsaveis([...responsaveis, { nome: '', parentesco: '', telefone: '' }])
            }}
          >
            Adicionar outro responsável
          </Botao>
        ) : null}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {contatos.map((contato, indice) => (
        <fieldset key={indice} className="flex flex-col gap-3 rounded-campo border border-linha p-3">
          <legend className="px-1 text-meta font-medium text-texto-suave">
            {`Contato ${String(indice + 1)}`}
          </legend>
          <CampoSelect
            rotulo="Tipo de contato"
            opcoes={TIPOS_DE_CONTATO}
            value={contato.tipo}
            onChange={(evento) => {
              aoMudarContatos(trocarItem(contatos, indice, { tipo: evento.target.value as ContatoDoEnvio['tipo'] }))
            }}
          />
          {/* só a VALIDADE do número (change telefone-que-chega-no-whatsapp): este formulário
              nunca diz se um número já existe — seria contar que outra criança é paciente */}
          <CampoDoTelefone
            rotulo="Contato"
            tipo={contato.tipo}
            limite={campo.tamanhos_dos_itens['valor']}
            obrigatorio={campo.obrigatorio && indice === 0}
            erro={erroDoItem(indice, 'valor')}
            value={contato.valor}
            aoMudar={(valor) => {
              aoMudarContatos(trocarItem(contatos, indice, { valor }))
            }}
          />
        </fieldset>
      ))}

      {contatos.length < 5 ? (
        <Botao
          type="button"
          variante="secundario"
          onClick={() => { aoMudarContatos([...contatos, { tipo: 'celular', valor: '' }]) }}
        >
          Adicionar outro contato
        </Botao>
      ) : null}
    </div>
  )
}

function trocarItem<T>(lista: T[], indice: number, mudanca: Partial<T>): T[] {
  return lista.map((item, i) => (i === indice ? { ...item, ...mudanca } : item))
}

function agruparPorSecao(formulario: FormularioPublico): Record<string, CampoPublico[]> {
  const agrupado: Record<string, CampoPublico[]> = {}

  for (const campo of formulario.campos) {
    agrupado[campo.secao] = [...(agrupado[campo.secao] ?? []), campo]
  }

  return agrupado
}

function rotuloDaSecao(formulario: FormularioPublico, secao: string): string {
  return formulario.secoes.find((s) => s.secao === secao)?.rotulo ?? secao
}

function rotuloDoCampo(formulario: FormularioPublico, campo: string): string {
  return formulario.campos.find((c) => c.campo === campo)?.rotulo ?? campo
}

function ehMenorDeIdade(nascimento: string): boolean {
  const anos = idadeEm(nascimento)

  return anos !== null && anos < 18
}

/** Os obrigatórios vazios deste passo — a validação da TELA, que só evita ida e volta. */
function obrigatoriosVazios(
  campos: CampoPublico[],
  valores: Record<string, string>,
  responsaveis: ResponsavelDoEnvio[],
  contatos: ContatoDoEnvio[],
  pedeResponsavel: boolean,
): Record<string, string[]> {
  const faltando: Record<string, string[]> = {}

  for (const campo of campos) {
    if (campo.campo === 'responsaveis_json') {
      if (pedeResponsavel && responsaveis.every((r) => r.nome.trim() === '')) {
        faltando[campo.campo] = ['Informe pelo menos um responsável.']
      }

      continue
    }

    if (campo.campo === 'contatos_json') {
      if (campo.obrigatorio && contatos.every((c) => c.valor.trim() === '')) {
        faltando[campo.campo] = ['Informe pelo menos um contato.']
      }

      continue
    }

    if (campo.obrigatorio && (valores[campo.campo] ?? '').trim() === '') {
      faltando[campo.campo] = ['Preencha este campo.']
    }
  }

  // a data existe? `31/02` não vira `03/03` em silêncio: cadastro de criança não é lugar
  // para o sistema adivinhar o que a família quis dizer
  const nascimento = valores['nascimento'] ?? ''
  if (nascimento.trim() !== '' && paraDataDaApi(nascimento) === null) {
    faltando['nascimento'] = ['Confira a data. Use o formato dia/mês/ano.']
  }

  return faltando
}

/**
 * Quem procura o campo na tela precisa achá-lo — e quando não acha, a mensagem tem que aparecer
 * em ALGUM lugar.
 *
 * A recusa `missing` nomeia, por definição, um campo que a régua tirou da tela: a clínica desligou
 * o CPF enquanto a família tinha o formulário aberto. Sem esta rede, essa mensagem — que existe
 * justamente para explicar isso — não chegava a ninguém: o campo não estava desenhado, o aviso do
 * topo só aparece com a chave `geral`, e o assistente ia para a revisão em silêncio. A família
 * clicava em "Enviar cadastro" e a tela não mudava.
 */
function comRedeDeSeguranca(
  doServidor: Record<string, string[]>,
  porSecao: Record<string, CampoPublico[]>,
): Record<string, string[]> {
  const naTela = (chave: string) => {
    const raiz = chave.split('.')[0]

    return Object.values(porSecao).some((campos) => campos.some((c) => c.campo === raiz))
  }

  if (Object.keys(doServidor).some(naTela)) return doServidor

  const primeira = Object.values(doServidor)[0]?.[0]

  return primeira === undefined ? doServidor : { ...doServidor, geral: [primeira] }
}

/** O aviso de uma falha que não trouxe campo: a causa muda o que a família deve fazer. */
function aviso(erro: unknown): string {
  if (ehStatus(erro, 429)) {
    return 'Recebemos envios demais deste local agora há pouco. Espere um minuto e tente de novo.'
  }

  if (ehStatus(erro, 413)) return 'O formulário ficou grande demais. Encurte as observações e tente de novo.'

  return 'Não conseguimos enviar agora. Confira sua conexão e tente de novo.'
}

/** Uma linha da conferência. `break-words` porque o valor é texto digitado por quem enviou. */
function LinhaDaRevisao({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="flex flex-col gap-0.5 border-l-2 border-linha pl-3">
      <dt className="text-meta text-texto-suave">{rotulo}</dt>
      <dd className="text-corpo break-words text-texto">{valor}</dd>
    </div>
  )
}

/**
 * O valor como a família o LÊ, não como o servidor o guarda.
 *
 * A conferência ecoava o `value` do `<option>`: quem escolheu "Prefiro não informar" via
 * `nao_informado` na tela em que deveria conferir os próprios dados (design-QA, achado 3).
 */
function valorLegivel(campo: string, valor: string): string {
  if (campo === 'sexo') return SEXOS.find((opcao) => opcao.valor === valor)?.rotulo ?? valor

  return valor
}

/** O tipo do contato em português — mesma razão do `valorLegivel`. */
function rotuloDoTipoDeContato(tipo: string): string {
  return TIPOS_DE_CONTATO.find((opcao) => opcao.valor === tipo)?.rotulo ?? 'Contato'
}

/**
 * Em que passo mora o primeiro campo que o servidor recusou.
 *
 * A chave de um item de lista vem pontilhada (`contatos_json.1.valor`); quem sabe em que passo o
 * campo mora é a RAIZ dela. Procurar a chave inteira devolvia sempre a revisão, e a família
 * chegava lá sem nenhuma mensagem na tela.
 */
function passoDoErro(erros: Record<string, string[]>, porSecao: Record<string, CampoPublico[]>): number {
  const chave = Object.keys(erros)[0]
  const primeiro = chave?.split('.')[0]

  if (primeiro === undefined) return 2

  for (const [passo, secoes] of Object.entries(SECOES_DO_PASSO)) {
    const temOCampo = secoes.some((secao) => (porSecao[secao] ?? []).some((c) => c.campo === primeiro))

    if (temOCampo) return Number(passo)
  }

  return 2
}

/** O corpo do envio, no formato que o boundary espera. */
function montarEnvio(
  formulario: FormularioPublico,
  valores: Record<string, string>,
  responsaveis: ResponsavelDoEnvio[],
  contatos: ContatoDoEnvio[],
): Record<string, unknown> {
  const envio: Record<string, unknown> = {}
  const endereco: Record<string, string> = {}

  for (const campo of formulario.campos) {
    if (campo.lista) continue

    const valor = (valores[campo.campo] ?? '').trim()
    if (valor === '') continue

    if (campo.campo === 'nascimento') {
      envio['nascimento'] = paraDataDaApi(valor)
      continue
    }

    if (campo.campo.startsWith('endereco_')) {
      endereco[campo.campo.replace('endereco_', '')] = valor
      continue
    }

    envio[campo.campo] = valor
  }

  if (Object.keys(endereco).length > 0) envio['endereco_json'] = endereco

  const responsaveisPreenchidos = responsaveis.filter((r) => r.nome.trim() !== '')
  if (formulario.campos.some((c) => c.campo === 'responsaveis_json')) {
    envio['responsaveis_json'] = responsaveisPreenchidos.map((r) => ({
      nome: r.nome.trim(),
      parentesco: r.parentesco.trim(),
      ...(r.telefone !== undefined && r.telefone.trim() !== '' ? { telefone: r.telefone.trim() } : {}),
    }))
  }

  const contatosPreenchidos = contatos.filter((c) => c.valor.trim() !== '')
  if (contatosPreenchidos.length > 0 && formulario.campos.some((c) => c.campo === 'contatos_json')) {
    envio['contatos_json'] = contatosPreenchidos.map((c) => ({ tipo: c.tipo, valor: c.valor.trim() }))
  }

  return envio
}
