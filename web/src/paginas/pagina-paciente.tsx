import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, LoaderCircle, TriangleAlert } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'

import { AcaoDeSituacao } from '@/componentes/pacientes/acao-de-situacao'
import {
  ListaDeConsentimentos,
  ListaDeContatos,
  ListaDeResponsaveis,
} from '@/componentes/pacientes/listas-do-paciente'
import {
  SecaoConvenio,
  SecaoEndereco,
  SecaoIdentificacao,
  SecaoOutros,
} from '@/componentes/pacientes/secoes-do-paciente'
import { ProtegidoPorPermissao } from '@/componentes/protegido-por-permissao'
import { BlocoDeTratamentos } from '@/componentes/tratamentos/bloco-de-tratamentos'
import { AvisoErro } from '@/componentes/ui/aviso-erro'
import { Botao } from '@/componentes/ui/botao'
import { Etiqueta } from '@/componentes/ui/etiqueta'
import { EstadoErro } from '@/componentes/ui/estado-erro'
import { Realce } from '@/componentes/ui/realce'
import { Skeleton } from '@/componentes/ui/skeleton'
import { usarMutacaoDePaciente } from '@/hooks/usar-mutacao-de-paciente'
import { usarReguaDoCadastro } from '@/hooks/usar-regua-do-cadastro'
import { chaves } from '@/lib/chaves-query'
import { apenasDigitos, ehMenorDeIdade, formatarCpf, nomeDeExibicao } from '@/lib/pacientes'
import { convenios } from '@/servicos/catalogos-de-apoio'

import { buscarRascunhoDoEnvio } from '@/servicos/fila-de-cadastro'
import { buscarPaciente } from '@/servicos/pacientes'
import { termos } from '@/servicos/termos'
import type {
  ContatoDoPaciente,
  EnderecoDoPaciente,
  Necessidade,
  NovoConsentimento,
  Paciente,
  PayloadPaciente,
  ResponsavelDoPaciente,
  Sexo,
} from '@/tipos'

interface Formulario {
  nome: string
  nome_social: string
  nascimento: string
  sexo: Sexo
  cpf: string
  // convênio VIGENTE (change convenio-no-cadastro-do-paciente): o de hoje. O que valia
  // quando cada pacote foi vendido continua no tratamento, e divergir é o registro
  // funcionando, não defeito
  convenio_id: string
  plano: string
  carteirinha: string
  carteirinha_validade: string
  indicacao: string
  necessidade: Necessidade
  estado_civil: string
  profissao: string
  obs: string
  responsaveis: ResponsavelDoPaciente[]
  contatos: ContatoDoPaciente[]
  endereco: EnderecoDoPaciente
}

// as seções de responsáveis e contatos ABREM com os campos de um item visíveis
// (pre-cadastro-de-paciente): quem preenche não precisa descobrir o botão; o item
// deixado totalmente em branco é filtrado no payload (nunca vira lixo no servidor)
const RESPONSAVEL_EM_BRANCO: ResponsavelDoPaciente = { nome: '', parentesco: '', telefone: '', email: '' }
const CONTATO_EM_BRANCO: ContatoDoPaciente = { tipo: 'celular', valor: '', obs: '' }

const VAZIO: Formulario = {
  nome: '',
  nome_social: '',
  nascimento: '',
  sexo: 'nao_informado',
  cpf: '',
  convenio_id: '',
  plano: '',
  carteirinha: '',
  carteirinha_validade: '',
  indicacao: '',
  necessidade: 'sem',
  estado_civil: '',
  profissao: '',
  obs: '',
  responsaveis: [RESPONSAVEL_EM_BRANCO],
  contatos: [CONTATO_EM_BRANCO],
  endereco: {},
}

/** Um item onde NADA foi digitado — o que o formulário pré-abre e o payload descarta. */
function itemEmBranco(item: object): boolean {
  return Object.entries(item).every(([chave, valor]) => chave === 'tipo' || valor === '' || valor == null)
}

/**
 * Campo opcional em branco vira `null`, não `""` (parecer SEC-09): o Laravel
 * aceita a string vazia e a GRAVA — o cadastro fica com "telefone: ''", que não
 * é ausência nem valor.
 */
function limparVazios<T extends object>(item: T): T {
  return Object.fromEntries(
    Object.entries(item).map(([chave, valor]) => [chave, valor === '' ? null : valor]),
  ) as T
}

function doPaciente(paciente: Paciente): Formulario {
  return {
    nome: paciente.nome,
    nome_social: paciente.nome_social ?? '',
    // pré-cadastro: ausência semeia como o formulário novo (o PUT completo exige)
    nascimento: paciente.nascimento ?? '',
    sexo: paciente.sexo,
    cpf: paciente.cpf !== null ? formatarCpf(paciente.cpf) : '',
    convenio_id: paciente.convenio_id != null ? String(paciente.convenio_id) : '',
    plano: paciente.plano ?? '',
    carteirinha: paciente.carteirinha ?? '',
    carteirinha_validade: paciente.carteirinha_validade ?? '',
    indicacao: paciente.indicacao ?? '',
    necessidade: paciente.necessidade ?? 'sem',
    estado_civil: paciente.estado_civil ?? '',
    profissao: paciente.profissao ?? '',
    obs: paciente.obs ?? '',
    // lista vazia também abre com os campos de um item (mesma razão do formulário novo)
    responsaveis:
      paciente.responsaveis_json != null && paciente.responsaveis_json.length > 0
        ? paciente.responsaveis_json
        : [RESPONSAVEL_EM_BRANCO],
    contatos:
      paciente.contatos_json != null && paciente.contatos_json.length > 0
        ? paciente.contatos_json
        : [CONTATO_EM_BRANCO],
    endereco: paciente.endereco_json ?? {},
  }
}

/** O envio guardado na busca do endereço, para reencontrar o rascunho depois de um F5. */
function lerEnvioDaBusca(busca: string): number | undefined {
  const valor = new URLSearchParams(busca).get('envio')
  const numero = valor === null ? Number.NaN : Number(valor)

  return Number.isInteger(numero) && numero > 0 ? numero : undefined
}

/**
 * O rascunho que a fila de conferência manda junto ao aceitar (change
 * `cadastro-online-do-paciente`).
 *
 * Ele chega pelo `state` da navegação porque **não é um paciente ainda**: quem cria continua
 * sendo `POST /pacientes`, com as guardas de sempre. Sem esta hidratação o aceite abria o
 * formulário EM BRANCO e o envio da família já tinha sido consumido do outro lado — a fila
 * esvaziava e o preenchimento sumia da tela (design-QA, achado 1).
 *
 * Os campos são os do catálogo, e o que não veio simplesmente fica como no formulário novo.
 */
function doEnvio(dados: Record<string, unknown>): Formulario {
  const texto = (chave: string): string => {
    const valor = dados[chave]

    return typeof valor === 'string' || typeof valor === 'number' ? String(valor) : ''
  }

  // enumeração não se copia do payload: valor fora da lista vira o padrão do formulário novo,
  // em vez de um `select` sem opção correspondente
  const umDe = <T extends string,>(chave: string, aceitos: readonly T[], padrao: T): T => {
    const valor = texto(chave)

    return (aceitos as readonly string[]).includes(valor) ? (valor as T) : padrao
  }

  const lista = <T,>(chave: string, emBranco: T): T[] => {
    const valor = dados[chave]

    return Array.isArray(valor) && valor.length > 0 ? (valor as T[]) : [emBranco]
  }

  return {
    ...VAZIO,
    nome: texto('nome'),
    nome_social: texto('nome_social'),
    nascimento: texto('nascimento'),
    sexo: umDe('sexo', ['feminino', 'masculino', 'outro', 'nao_informado'] as const, VAZIO.sexo),
    cpf: texto('cpf') !== '' ? formatarCpf(texto('cpf')) : '',
    convenio_id: texto('convenio_id'),
    plano: texto('plano'),
    carteirinha: texto('carteirinha'),
    carteirinha_validade: texto('carteirinha_validade'),
    indicacao: texto('indicacao'),
    necessidade: umDe('necessidade', ['sem', 'necessidades_especiais', 'outros'] as const, VAZIO.necessidade),
    estado_civil: texto('estado_civil'),
    profissao: texto('profissao'),
    obs: texto('obs'),
    responsaveis: lista<ResponsavelDoPaciente>('responsaveis_json', RESPONSAVEL_EM_BRANCO),
    contatos: lista<ContatoDoPaciente>('contatos_json', CONTATO_EM_BRANCO),
    endereco: (dados['endereco_json'] as EnderecoDoPaciente | null) ?? {},
  }
}

/**
 * Cadastro do paciente (§5) — PÁGINA, não dialog (design D1): são ~15 campos e
 * três listas, e é o formulário em que a recepção passa mais tempo.
 *
 * As regras continuam do servidor (menor exige responsável, CPF único, schema
 * fechado dos JSONs): a tela **explica** e leva cada recusa ao campo — ou ao
 * ITEM da lista — que a causou.
 */
export function PaginaPaciente() {
  const { id } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const rascunho = location.state as { preenchido?: Record<string, unknown>; envio?: number } | null

  const pacienteId = Number(id)
  const editando = Number.isInteger(pacienteId) && pacienteId > 0

  /*
    O rascunho tem DUAS origens, e elas nunca valem ao mesmo tempo:

    - a navegação vinda da fila traz o preenchimento no `state`;
    - depois de um F5 (ou de fechar a aba), o `state` não existe mais e o rascunho vem do SERVIDOR,
      pelo id que ficou na busca do endereço.

    As duas são congeladas no PRIMEIRO render, em `ref`. É a diferença entre um formulário que
    hidrata uma vez e um que hidrata de novo quando a resposta chega — e o segundo apagava o que a
    recepção já tinha digitado por cima, que é justamente a conferência que a fila existe para
    provocar (rodada dirigida 3, CR3-01).
  */
  const envioDeOrigem = useRef<number | undefined>(rascunho?.envio ?? lerEnvioDaBusca(location.search))
  const veioDoState = useRef(rascunho?.preenchido !== undefined)
  const [form, setForm] = useState<Formulario>(() =>
    rascunho?.preenchido !== undefined ? doEnvio(rascunho.preenchido) : VAZIO,
  )

  /*
    O PREENCHIMENTO sai do histórico do navegador; o ID do envio fica no endereço.

    O React Router grava o `state` em `window.history.state.usr`, e ali ele sobrevive ao logout —
    `encerrarSessaoLocal` limpa o cache e o store, não o histórico. O balcão é máquina
    compartilhada e o dado é o cadastro de uma criança (SEC-CO-33).

    Só apagá-lo, porém, fazia um F5 destruir o preenchimento para sempre (CR2-06). Quem guarda o
    rascunho é o SERVIDOR — o envio aceito e ainda sem ficha continua legível, sob as mesmas
    permissões do aceitar. Guardá-lo no navegador resolveria o F5 e devolveria o problema do
    histórico, agora sem portão nenhum.

    O id do envio não é dado pessoal, e é o que permite reencontrar o rascunho depois do F5.
  */
  useEffect(() => {
    if (rascunho?.preenchido === undefined) return

    // o id do envio migra para a BUSCA do endereço e o preenchimento sai do histórico. O id não é
    // dado pessoal — é o que permite reencontrar o rascunho no servidor depois de um F5
    const busca = rascunho.envio !== undefined ? `?envio=${String(rascunho.envio)}` : ''

    navigate(`${location.pathname}${busca}`, { replace: true, state: null })
  }, [rascunho?.preenchido, rascunho?.envio, navigate, location.pathname])
  const [iniciado, setIniciado] = useState(false)
  /**
   * O `updated_at` do cadastro que ESTÁ na tela — o token do `If-Match` do PUT.
   *
   * `useState` e não `useRef` pelo motivo do vizinho `iniciado`: ele é escrito durante o render,
   * no mesmo bloco que hidrata o formulário, e escrever `ref` no render contraria o React (com
   * `StrictMode` ligado, o dobro de renders). **Toda** re-hidratação atualiza este valor junto —
   * são dois pontos hoje, e descolar um deles é o defeito que a rodada 2 do gate pegou.
   */
  const [versaoHidratada, setVersaoHidratada] = useState<string | null>(null)
  /** Aceites adicionados nesta edição — o SERVIDOR os data ao salvar (SEC-01) */
  const [novosConsentimentos, setNovosConsentimentos] = useState<NovoConsentimento[]>([])

  const { criar, atualizar, erros, gravando } = usarMutacaoDePaciente()

  /**
   * A RÉGUA em vigor (FA-08): o formulário precisa saber qual termo o aceite vai gravar
   * — e se existe algum. Sem versão publicada, a seção mostra o próximo passo em vez de
   * oferecer um registro que o servidor recusaria (422).
   *
   * Endpoint próprio, mínimo (id/título/versão, sem o texto) e sob a permissão de quem
   * registra o aceite — não a de quem administra o catálogo.
   */
  const consultaDoTermo = useQuery({
    queryKey: chaves.termoVigente(),
    queryFn: termos.vigente,
  })

  const consulta = useQuery({
    queryKey: chaves.paciente(pacienteId),
    queryFn: () => buscarPaciente(pacienteId),
    enabled: editando,
    // ESTE formulário hidrata `useState` do `useQuery` (o `setForm` logo abaixo, uma vez só) —
    // é a condição exata que apagou a matrícula de um menor nos tratamentos. Aqui o dado que
    // se perderia é o CADASTRO da criança.
    //
    // O `gcTime: 0` é a defesa por CONTRATO: sem entrada no cache, o formulário só nasce com
    // dado do servidor. Ele só vale porque o `setQueryData` saiu do hook da mutação — o
    // `updateGcTime` do TanStack faz `Math.max`, então um `setQueryData` CRIAVA a entrada com
    // o gcTime padrão (5 min) e este zero não conseguia baixá-la (re-review r8).
    gcTime: 0,
  })

  const paciente = consulta.data

  /*
    Depois de um F5, o rascunho vem do SERVIDOR — não do navegador.

    A condição olha `veioDoState.current`, congelado no primeiro render, e NÃO `rascunho?.preenchido`
    — que é apagado de propósito logo acima. Olhando o valor vivo, a consulta disparava no caminho
    do ACEITE (onde o formulário já estava preenchido) e, quando a resposta chegava, trocava o
    formulário inteiro pelo payload cru da família: a conferência da recepção ia embora
    (rodada dirigida 3, CR3-01).
  */
  const recarregado = useQuery({
    queryKey: chaves.rascunhoDoEnvio(envioDeOrigem.current ?? 0),
    queryFn: () => buscarRascunhoDoEnvio(envioDeOrigem.current ?? 0),
    enabled: !editando && envioDeOrigem.current !== undefined && !veioDoState.current,
    retry: false,
    gcTime: 0,
  })

  // uma vez só, e `iniciado` fecha a porta para qualquer hidratação posterior
  if (recarregado.data !== undefined && !iniciado) {
    setForm(doEnvio(recarregado.data.dados))
    setIniciado(true)
  }

  /**
   * O cadastro do SERVIDOR entra na tela — corpo e versão, sempre juntos.
   *
   * Uma função e não duas linhas repetidas porque este par já descolou **duas vezes em duas
   * rodadas do gate**: o `If-Match` tem de descrever o cadastro que está NA TELA, e quem lê o
   * token do cache vivo manda corpo velho com token novo — o servidor aceita, e a alteração da
   * outra recepcionista é sobrescrita em silêncio (CR2-BLOQ-01 / CR3-BLOQ-01). Os dois valores
   * saem do MESMO objeto, então não há como lerem versões diferentes.
   */
  function hidratarDoServidor(cadastro: Paciente): void {
    setForm(doPaciente(cadastro))
    setVersaoHidratada(cadastro.updated_at)
  }

  if (editando && paciente !== undefined && !iniciado) {
    hidratarDoServidor(paciente)
    setIniciado(true)
  }

  // Formulário edit-only: a LEITURA agora é a ficha (`/pacientes/:id`). A rota
  // garante a permissão (criar em `/novo`, editar em `/:id/editar`), então o
  // modo-leitura degradado (fieldset desabilitado) deixou de existir — a ficha o
  // substituiu (change ficha-do-paciente, Decisão 0). Os campos são sempre editáveis.
  const somenteLeitura = false
  // a régua da clínica decide o que aparece e o que leva asterisco (campos-do-cadastro)
  const regua = usarReguaDoCadastro()

  /*
   * Os convênios ATIVOS da clínica, para a escolha da seção de convênio.
   *
   * `enabled` pela visibilidade da seção: a clínica que só atende particular esconde os
   * quatro campos, e aí não faz sentido pedir catálogo ao servidor para montar um select
   * que ninguém vai ver. Uma requisição por abertura de cadastro não é gratuita.
   */
  const consultaDeConvenios = useQuery({
    queryKey: chaves.convenios(),
    queryFn: convenios.listar,
    enabled: regua.secaoVisivel('convenio'),
  })
  const conveniosAtivos = (consultaDeConvenios.data ?? []).filter((convenio) => convenio.ativo)

  const menor = form.nascimento !== '' && ehMenorDeIdade(form.nascimento)

  function montarPayload(): PayloadPaciente {
    /*
     * As chaves ESCONDIDAS pela régua são OMITIDAS, não enviadas nulas: o servidor usa
     * `missing`, que recusa a PRESENÇA da chave com qualquer valor. Mandar `null` num
     * campo que a clínica escondeu seria 422 — e o formulário nem mostra o campo, então a
     * recusa não teria onde aparecer.
     *
     * As duas ajudantes ficam ANTES de `endereco`: o `filter` abaixo as executa na hora, e
     * declará-las depois seria ReferenceError em tempo de execução (o `tsc` não acusa, por
     * o uso estar dentro de um callback).
     */
    const oculto = (campo: string) => !regua.visivel(campo)
    // devolve `Partial<T>`, que é a verdade: as chaves escondidas SAEM. Sem isso seria
    // preciso um `as T` mentindo ao compilador sobre o próprio contrato (achado CR-I6)
    const semOcultos = <T extends Record<string, unknown>>(
      campos: Record<string, string>,
      alvo: T,
    ): Partial<T> =>
      Object.fromEntries(
        Object.entries(alvo).filter(([chave]) => campos[chave] === undefined || !oculto(campos[chave])),
      ) as Partial<T>

    const cpf = apenasDigitos(form.cpf)
    const endereco = Object.fromEntries(
      Object.entries(form.endereco).filter(
        ([chave, valor]) => valor !== '' && valor != null && !oculto(`endereco_${chave}`),
      ),
    )

    const completo = {
      nome: form.nome,
      nome_social: form.nome_social !== '' ? form.nome_social : null,
      nascimento: form.nascimento,
      sexo: form.sexo,
      cpf: cpf !== '' ? cpf : null,
      convenio_id: form.convenio_id !== '' ? Number(form.convenio_id) : null,
      plano: form.plano !== '' ? form.plano : null,
      carteirinha: form.carteirinha !== '' ? form.carteirinha : null,
      carteirinha_validade: form.carteirinha_validade !== '' ? form.carteirinha_validade : null,
      indicacao: form.indicacao !== '' ? form.indicacao : null,
      necessidade: form.necessidade,
      estado_civil: form.estado_civil !== '' ? form.estado_civil : null,
      profissao: form.profissao !== '' ? form.profissao : null,
      obs: form.obs !== '' ? form.obs : null,
      // o item pré-aberto e intocado NÃO viaja: salvar com ele em branco = lista vazia
      responsaveis_json: form.responsaveis.filter((item) => !itemEmBranco(item)).map(limparVazios),
      contatos_json: form.contatos.filter((item) => !itemEmBranco(item)).map(limparVazios),
      endereco_json: Object.keys(endereco).length > 0 ? endereco : null,
      // só os NOVOS aceites: o servidor carimba e anexa aos já registrados
      consentimentos_json: novosConsentimentos,
    }

    // o mapa chave-do-payload → campo-do-catálogo; o que não está aqui não é configurável
    const parcial = semOcultos(
      {
        nome: 'nome',
        nome_social: 'nome_social',
        nascimento: 'nascimento',
        sexo: 'sexo',
        cpf: 'cpf',
        convenio_id: 'convenio_id',
        plano: 'plano',
        carteirinha: 'carteirinha',
        carteirinha_validade: 'carteirinha_validade',
        indicacao: 'indicacao',
        necessidade: 'necessidade',
        estado_civil: 'estado_civil',
        profissao: 'profissao',
        obs: 'obs',
        contatos_json: 'contatos_json',
        // sem esta entrada, as duas metades do fix discordavam: `regua.visivel(...)` tirava
        // a seção da tela e a chave continuava no payload — 422 com a mensagem sem lugar
        // para pousar, que é a classe exata do defeito do pré-cadastro
        responsaveis_json: 'responsaveis_json',
      },
      completo,
    )

    /*
     * `nome` e `nascimento` são reafirmados porque são campos TRAVADOS no catálogo do
     * servidor — nunca podem ser escondidos, então nunca saem do payload. Dizer isso ao
     * compilador aqui é o que permite `semOcultos` devolver `Partial<T>` honestamente, em
     * vez de um `as` que apagaria o contrato inteiro.
     */
    return {
      ...parcial,
      nome: completo.nome,
      nascimento: completo.nascimento,
      consentimentos_json: completo.consentimentos_json,
      /*
        A ORIGEM, quando a ficha veio do link público. Não é campo do catálogo e não é
        configurável: é o vínculo que faz a ficha saber de onde veio e — o que importa mais — faz
        o expurgo saber que aquele envio já virou prontuário. Sem ele, apagar o paciente não
        alcançava a cópia do dado guardada no envio (SEC-CO-34).
      */
      ...(envioDeOrigem.current !== undefined ? { envio_de_cadastro_id: envioDeOrigem.current } : {}),
    }
  }

  function submeter(evento: React.FormEvent) {
    evento.preventDefault()

    /*
     * O botão de enviar é `aria-disabled` em voo, não `disabled` — inerte MAS focável.
     * `aria-disabled` não impede o submit, então quem recusa o duplo envio é esta guarda.
     */
    if (gravando) return

    if (editando) {
      atualizar.mutate(
        { id: pacienteId, payload: montarPayload(), versao: versaoHidratada ?? '' },
        {
          onSuccess: () => {
            setNovosConsentimentos([])
            // edição é DESTINO: salvar volta à ficha de leitura (Decisão 0)
            navigate(`/pacientes/${pacienteId}`)
          },
        },
      )
      return
    }

    criar.mutate(montarPayload(), {
      onSuccess: (criado) => {
        // a rota muda mas o componente NÃO remonta: sem isto, o consentimento
        // recém-GRAVADO continuaria listado como "a salvar", com botão de remover
        // — o oposto do append-only que a spec exige (parecer code-review §3)
        setNovosConsentimentos([])
        navigate(`/pacientes/${criado.id}`, { replace: true })
      },
    })
  }

  // Espera a RÉGUA antes de desenhar o formulário. Sem isso, o cadastro abriria com todos
  // os campos e nenhum asterisco, e as marcas de obrigatório apareceriam meio segundo
  // depois — quem já começou a digitar veria a tela se rearranjar embaixo do cursor.
  // o RASCUNHO entra no mesmo portão. Sem isso, o formulário nascia editável enquanto a
  // releitura estava em voo e a resposta apagava o que a recepção tivesse digitado nesse
  // intervalo — o mesmo defeito da rodada 3, vivo no caminho do F5 (rodada 4, CR4-02).
  //
  // A condição é `isLoading` (`isPending && isFetching` no TanStack v5): verdadeira só na PRIMEIRA
  // leitura. `isPending` puro prenderia o cadastro de balcão num esqueleto eterno — consulta
  // desabilitada fica `pending` para sempre. E `isFetching` puro cobria demais: uma reconsulta de
  // fundo (o wifi do balcão piscando, via `refetchOnReconnect`) desmontava o formulário no meio da
  // digitação, e as teclas daquele instante caíam no vazio — o conserto interrompendo justamente
  // quem ele existe para proteger (rodada 5).
  if ((editando && consulta.isPending) || regua.carregando || recarregado.isLoading) {
    // `aria-busy` no CONTAINER: o `Skeleton` é `aria-hidden` por contrato, então sem ele a
    // página fica acessivelmente VAZIA durante a carga. Era pré-existente, mas o
    // `|| regua.carregando` desta change acrescentou uma segunda requisição bloqueante e
    // alongou a janela de silêncio (achado A11Y-RCD-05).
    return (
      <div aria-busy="true">
        <Skeleton className="h-96 w-full" />
      </div>
    )
  }

  /*
   * A RÉGUA É BLOQUEANTE TAMBÉM NO ERRO, não só no carregamento.
   *
   * Sem esta guarda, régua em erro abria o formulário INTEIRO — as 6 seções, todos os
   * campos, e ZERO marcas de "(obrigatório)", inclusive no `nome`, que o catálogo trava
   * como obrigatório e o servidor sempre recusa vazio. Nenhum aviso na tela. O operador
   * preenchia às cegas, e o campo que a clínica escondeu voltava a viajar no payload, onde
   * o servidor o recusa com um `missing` que a tela não tem onde mostrar. É exatamente o
   * par de defeitos que esta change existe para impedir, chegando pela porta do erro de
   * rede (achado N4 do passe de navegador de 25/08).
   */
  if (regua.erro) {
    return (
      <EstadoErro
        mensagem="Não foi possível carregar a configuração do cadastro. Sem ela não dá para saber o que esta clínica exige, e o formulário abriria pedindo a coisa errada."
        aoTentarNovamente={regua.recarregar}
      />
    )
  }

  if (editando && consulta.isError) {
    return (
      <EstadoErro
        mensagem="Não foi possível carregar o cadastro."
        aoTentarNovamente={() => {
          void consulta.refetch()
        }}
      />
    )
  }


  return (
    <section className="flex flex-col gap-6">
      {/*
        O rascunho não voltou — e o aviso fica ACIMA do formulário, nunca no lugar dele.
        Substituir a tela deixava a recepção com um único botão, que refaz a mesma falha para
        sempre no caso mais provável (o envio já virou ficha). Cadastrar do zero é uma saída
        legítima, e ela precisa continuar na tela (rodada 4, CR4-03).
      */}
      {/*
        `role="status"`: o aviso aparece DEPOIS de um carregamento, sem mudar o foco — é status
        message (4.1.3). O `Realce` é um `div` sem `role`, porque também serve para dica estática,
        onde região viva seria errado; quem anuncia é o consumidor. Trocar `EstadoErro` por
        `Realce` tinha calado a mensagem, e a asserção do teste caiu junto (rodada 5).
      */}
      {recarregado.isError ? (
        <div role="status" aria-label="Atenção">
          <Realce
            tom="atencao"
            rotulo="Atenção"
            icone={<TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-alerta-texto" />}
            texto="Não foi possível recuperar o cadastro que a família enviou. Ele pode já ter virado uma ficha. Você pode tentar de novo pela fila, ou preencher este cadastro do zero."
          />
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link to="/pacientes" className="flex items-center gap-1 text-meta text-texto-suave hover:text-texto">
            <ArrowLeft size={14} aria-hidden="true" />
            Pacientes
          </Link>
          <h1 className="mt-1 text-titulo font-semibold text-texto">
            {editando && paciente !== undefined ? nomeDeExibicao(paciente) : 'Novo paciente'}
          </h1>
          {/* ETIQUETA, não texto solto: situação onde a etiqueta cabe é MUST NOT do contrato do
              Design System, e o produto dizia "inativo" de três jeitos em três telas — etiqueta na
              lista, pílula artesanal na ficha e esta frase aqui (achado DQ-PIS-04) */}
          {editando && paciente !== undefined && !paciente.ativo ? (
            <p className="mt-1">
              <Etiqueta tom="neutro">Inativo</Etiqueta>
            </p>
          ) : null}
        </div>

        {/* NÃO existe excluir paciente (design D3): a API não a tem, e desativar
            preserva a trilha (§12). O gatilho, a confirmação e a escrita vivem no
            componente — a ficha do paciente usa o MESMO (change paciente-inativo-com-saida) */}
        {editando && paciente !== undefined ? (
          <AcaoDeSituacao
            paciente={paciente}
            aoConcluir={(salvo) => {
              // a troca de situação grava o cadastro do SERVIDOR: re-hidratar é o que impede a
              // tela de seguir exibindo edição não salva (parecer code-review §9) — e o
              // `PATCH /situacao` grava pelo model, então o `updated_at` avança junto
              hidratarDoServidor(salvo)
              setNovosConsentimentos([])
            }}
          />
        ) : null}
      </div>

      <form onSubmit={submeter} className="flex flex-col gap-8">
        <AvisoErro mensagens={erros.gerais} />

        <SecaoIdentificacao
          regua={regua}
          dados={form}
          somenteLeitura={somenteLeitura}
          erros={erros}
          aoMudar={(mudanca) => {
            setForm((atual) => ({ ...atual, ...mudanca }))
          }}
        />

        <SecaoConvenio
          regua={regua}
          convenios={conveniosAtivos}
          dados={form}
          somenteLeitura={somenteLeitura}
          erros={erros}
          aoMudar={(mudanca) => {
            setForm((atual) => ({ ...atual, ...mudanca }))
          }}
        />

        {/*
          As DUAS listas também obedecem à régua. Enquanto elas ficaram de fora, a seção
          continuava na tela, a recepção digitava o telefone, e `montarPayload` descartava a
          chave em silêncio — com o toast dizendo "salvo". Foi achado por três frentes do
          gate (code review, design QA e a11y) pelo mesmo caminho.
        */}
        {regua.visivel('responsaveis_json') ? (
          <ListaDeResponsaveis
            limiteDoItem={(sub) => regua.limiteDoItem('responsaveis_json', sub)}
            responsaveis={form.responsaveis}
            somenteLeitura={somenteLeitura}
            exigido={menor}
            exigidoPelaRegua={regua.obrigatorio('responsaveis_json')}
            erros={erros}
            aoMudar={(responsaveis) => {
              setForm((atual) => ({ ...atual, responsaveis }))
            }}
          />
        ) : null}

        {regua.visivel('contatos_json') ? (
          <ListaDeContatos
            limiteDoItem={(sub) => regua.limiteDoItem('contatos_json', sub)}
            contatos={form.contatos}
            somenteLeitura={somenteLeitura}
            exigidoPelaRegua={regua.obrigatorio('contatos_json')}
            avisarWhatsapp
            conferirRepetido
            pacienteId={editando ? pacienteId : null}
            erros={erros}
            aoMudar={(contatos) => {
              setForm((atual) => ({ ...atual, contatos }))
            }}
          />
        ) : null}

        <SecaoEndereco
          regua={regua}
          dados={form.endereco}
          somenteLeitura={somenteLeitura}
          erros={erros}
          aoMudar={(mudanca) => {
            setForm((atual) => ({ ...atual, endereco: { ...atual.endereco, ...mudanca } }))
          }}
        />

        <ListaDeConsentimentos
          registrados={paciente?.consentimentos_json ?? []}
          novos={novosConsentimentos}
          termoVigente={consultaDoTermo.data ?? null}
          // carregando ou com erro (rede, 403), o `null` acima não prova "nenhum termo publicado" (CR-AVI-08);
          // `data` e não `isSuccess`: a régua já lida continua valendo se uma releitura falhar
          termoLido={consultaDoTermo.data !== undefined}
          aoTentarLerOTermo={
            consultaDoTermo.isError && consultaDoTermo.data === undefined
              ? () => {
                  void consultaDoTermo.refetch()
                }
              : undefined
          }
          somenteLeitura={somenteLeitura}
          erros={erros}
          aoAdicionar={(consentimento) => {
            setNovosConsentimentos((atuais) => [...atuais, consentimento])
          }}
          aoRemoverNovo={(indice) => {
            setNovosConsentimentos((atuais) => atuais.filter((_, i) => i !== indice))
          }}
        />

        <SecaoOutros
          regua={regua}
          dados={form}
          somenteLeitura={somenteLeitura}
          erros={erros}
          aoMudar={(mudanca) => {
            setForm((atual) => ({ ...atual, ...mudanca }))
          }}
        />

        <div className="flex justify-end gap-3">
          <Botao
            type="button"
            variante="secundario"
            tamanho="lg"
            disabled={gravando}
            onClick={() => {
              // cancelar edição volta à ficha; cancelar criação volta à lista
              navigate(editando ? `/pacientes/${pacienteId}` : '/pacientes')
            }}
          >
            Cancelar
          </Botao>
          {/*
            NÃO uso a prop `carregando`: ela liga o `disabled` NATIVO
            (`botao.tsx`: `disabled={disabled === true || carregando}`), e o botão que o
            operador acabou de acionar com Enter sai da árvore de foco em voo. Medido no
            passe de navegador de 25/08: depois de uma recusa 422, `activeElement` era
            `<body>` e um Tab caía no toast — num formulário de ~25 paradas. É o mesmo
            `aria-disabled` que a régua do cadastro já usa, pelo mesmo motivo
            (`BOTAO-CARREGANDO-TIRA-O-FOCO`, que continua sendo defeito do `Botao`).
          */}
          <Botao
            type="submit"
            tamanho="lg"
            aria-disabled={gravando || undefined}
            aria-busy={gravando || undefined}
          >
            {/*
              Sempre montado, `invisible` fora do voo: renderizar condicionalmente fazia o
              botão crescer 24px (16 do ícone + 8 do `gap-2`) no instante do clique e
              empurrar o "Cancelar" para a esquerda, num container `justify-end` — bem onde
              o ponteiro acabou de estar (achado DQA-R3-02). É a mesma reserva de caixa que
              o tique das pílulas da régua já usa.
            */}
            <LoaderCircle
              aria-hidden
              className={gravando ? 'size-4 animate-spin' : 'invisible size-4'}
            />
            {editando ? 'Salvar' : 'Cadastrar'}
          </Botao>
        </div>
      </form>

      {/* FORA do <form> do paciente: entidades diferentes, permissões diferentes,
          escritas diferentes. Um `PUT` de paciente carregando os tratamentos junto
          traria de volta o bug do cache que este projeto já pagou. */}
      {editando && paciente !== undefined ? (
        <ProtegidoPorPermissao permissao="tratamentos.ver">
          <BlocoDeTratamentos
            pacienteId={paciente.id}
            padraoDoCadastro={{
              convenioId: paciente.convenio_id,
              carteirinha: paciente.carteirinha,
            }}
          />
        </ProtegidoPorPermissao>
      ) : null}

    </section>
  )
}
