import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, LoaderCircle, Lock, TriangleAlert } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { Botao } from '@/componentes/ui/botao'
import { EstadoErro } from '@/componentes/ui/estado-erro'
import { EstadoVazio } from '@/componentes/ui/estado-vazio'
import { Skeleton } from '@/componentes/ui/skeleton'
import { usarToast } from '@/componentes/ui/toast'
import { chavesDoEstado, estadoDoCampo } from '@/hooks/usar-regua-do-cadastro'
import { chaves } from '@/lib/chaves-query'
import { ErroDeApi } from '@/lib/http'
import { buscarReguaDoCadastro, previaDaRegua, salvarReguaDoCadastro } from '@/servicos/campos-cadastro'
import type { CampoDaRegua, ChaveDaRegua, EstadoDoCampo, ReguaDoCadastro } from '@/tipos'

/**
 * A RÉGUA DO CADASTRO — o que a clínica exige e o que ela esconde do formulário de
 * paciente (capability `campos-do-cadastro-tela`).
 *
 * A forma NÃO é a da referência (§2 — "se parecer com o ClinicaÁgil, está errado"). Lá são
 * quatro caixas independentes empilhadas sob cada um dos 48 campos, e nada impede marcar
 * "obrigatório" E "desabilitado" ao mesmo tempo — um cadastro impossível de salvar,
 * descoberto só na recusa. Aqui os três estados que se excluem viram UMA escolha por
 * campo: a combinação impossível deixa de ser representável.
 *
 * Campo travado tem as opções IMPOSSÍVEIS desabilitadas — por CHAVE, não por campo: o CPF
 * pode virar obrigatório, só não pode sumir. Oferecer a escolha para recusá-la depois
 * ensina o usuário a desconfiar da tela.
 */

const ROTULOS: Record<EstadoDoCampo, string> = {
  obrigatorio: 'Obrigatório',
  opcional: 'Opcional',
  oculto: 'Não aparece',
}

const ORDEM: EstadoDoCampo[] = ['obrigatorio', 'opcional', 'oculto']

interface SecaoCamposDoCadastroProps {
  podeEditar: boolean
  /** A guarda de troca de aba da página — escolha feita e não salva conta como pendência. */
  aoMudarSujo?: (chave: string, sujo: boolean) => void
}

const idDoMotivoDoBotao = 'regua-motivo-salvar'

/**
 * A forma do esqueleto, para ele ter a CAIXA do conteúdo final (JSDoc do `Skeleton`:
 * "dimensiona pela caixa exata — CLS 0"). A primeira versão desenhava 3 seções onde a tela
 * tem 5, com altura fixa igual para a Identificação (7 campos) e para Contatos (1) —
 * estimados ~1.000px de salto (achado DQA-I1).
 *
 * O terceiro número é quantas linhas da seção carregam o MOTIVO DA TRAVA, que é um
 * parágrafo abaixo do grupo. Sem reservar essa caixa, o esqueleto nascia 195px mais curto
 * que o conteúdo (medido no passe de navegador de 25/08: `scrollHeight` 1606 → 1801), e
 * as quatro linhas travadas respondiam por 179px desse salto. Acertar a CONTAGEM de linhas
 * não bastava: faltava a ALTURA delas.
 *
 * Espelha `CatalogoCamposCadastro::SECOES` e o `motivo` de cada campo, no servidor. Se
 * divergirem, o salto volta — mas volta como salto visível, não como erro silencioso.
 */
const SECOES_ESPERADAS: Array<[string, number, number]> = [
  ['identificacao', 7, 3],
  ['responsaveis', 1, 1],
  ['contatos', 1, 0],
  ['endereco', 7, 0],
  ['outros', 3, 0],
]

export function SecaoCamposDoCadastro({ podeEditar, aoMudarSujo }: SecaoCamposDoCadastroProps) {
  const clienteDeConsulta = useQueryClient()
  const { notificar } = usarToast()

  const consulta = useQuery({
    queryKey: chaves.reguaDoCadastro('paciente'),
    queryFn: () => buscarReguaDoCadastro('paciente'),
  })

  // o estado digitado, por campo — vazio significa "nada mudou desde a última leitura"
  const [escolhas, setEscolhas] = useState<Record<string, EstadoDoCampo>>({})
  const [previa, setPrevia] = useState<{
    total: number
    incompletos: number
  } | null>(null)
  /** Recusas do servidor por campo (422), para a mensagem cair na LINHA que a causou. */
  const [recusas, setRecusas] = useState<Record<string, string>>({})
  /** Sequência da prévia: resposta atrasada de uma escolha antiga não pode sobrescrever. */
  const sequencia = useRef(0)

  const sujo = Object.keys(escolhas).length > 0
  useEffect(() => {
    aoMudarSujo?.('campos-do-cadastro', sujo)
    return () => {
      aoMudarSujo?.('campos-do-cadastro', false)
    }
  }, [sujo, aoMudarSujo])

  const porSecao = useMemo(() => agruparPorSecao(consulta.data), [consulta.data])

  const salvar = useMutation({
    mutationFn: async (enviadas: Record<string, EstadoDoCampo>) => {
      const campos = Object.fromEntries(
        Object.entries(enviadas).map(([campo, estado]) => [campo, chavesDoEstado(estado)]),
      )
      return salvarReguaDoCadastro(campos, 'paciente')
    },
    onSuccess: (regua, enviadas) => {
      /*
       * O formulário de paciente lê a MESMA chave: escrever aqui faz a próxima abertura
       * dele já nascer com a régua nova, sem recarregar a aplicação.
       *
       * `setQueryData` SOZINHO, sem `invalidateQueries` atrás: a gravação já devolve a
       * régua EFETIVA — é exatamente o que um refetch traria. Invalidar em seguida dispara
       * uma ida à rede que sobrescreve o valor recém-posto pelo mesmo valor, e enquanto ela
       * não volta a tela mostra o estado velho.
       */
      clienteDeConsulta.setQueryData(chaves.reguaDoCadastro('paciente'), regua)

      // Só as escolhas ENVIADAS saem. Um `setEscolhas({})` cego apagava o que o usuário
      // mexeu durante o voo da requisição — e ainda dizia "salvo" (achado do design QA):
      // é o mesmo SHALL "sem deixar na tela uma escolha que não foi persistida", pela
      // outra ponta.
      setEscolhas((atuais) =>
        Object.fromEntries(Object.entries(atuais).filter(([campo]) => enviadas[campo] === undefined)),
      )
      setPrevia(null)
      setRecusas({})
      notificar({ tom: 'sucesso', titulo: 'Configuração do cadastro salva.' })
    },
    onError: (erro) => {
      /*
       * 422 e queda de rede são coisas diferentes, e tratá-las igual jogava fora a
       * mensagem por campo que o servidor escreveu com cuidado — "tentar de novo"
       * reproduziria a mesma recusa para sempre (achados CR-I1 e DQA-B1).
       */
      const porCampo: Record<string, string> = {}
      const semDono: string[] = []

      if (erro instanceof ErroDeApi && erro.motivo === 'invalido') {
        for (const [chave, mensagens] of Object.entries(erro.camposInvalidos)) {
          if (mensagens[0] === undefined) continue
          const campo = chave.replace(/^campos\./, '')
          // erro chaveado em `campos` puro (ex.: "Há um campo que não existe no cadastro.")
          // não casa com linha nenhuma e evaporava — vai para o toast
          if (campo === 'campos' || campo === chave) semDono.push(mensagens[0])
          else porCampo[campo] = mensagens[0]
        }
      }

      /*
       * `motivo === 'invalido'` NÃO basta: o `http.ts` manda qualquer 4xx que não seja
       * 401/403/409 para esse motivo. Um **429** cairia aqui com `camposInvalidos` vazio,
       * nenhuma linha marcada, e um toast que não diz o que houve nem oferece tentar de
       * novo — e ele é alcançável, porque a prévia é POST no balde de mutação (achado
       * DQA-B1'). Só entra no ramo de validação quem trouxe erro de campo de verdade.
       */
      if (Object.keys(porCampo).length > 0 || semDono.length > 0) {
        setRecusas(porCampo)
        // as escolhas recusadas voltam ao que de fato vale — deixar na tela uma escolha
        // que não foi persistida é o que a spec proíbe
        setEscolhas((atuais) =>
          Object.fromEntries(Object.entries(atuais).filter(([campo]) => porCampo[campo] === undefined)),
        )
        notificar({
          tom: 'erro',
          titulo: 'A configuração não pôde ser salva como está.',
          ...(semDono.length > 0 ? { descricao: semDono.join(' ') } : {}),
        })

        return
      }

      // rede: as escolhas NÃO são descartadas — quem digitou não perde o trabalho
      notificar({
        tom: 'erro',
        titulo: 'Não foi possível salvar a configuração do cadastro.',
        descricao: 'O que você escolheu continua aqui. Tente de novo.',
      })
    },
  })

  async function conferirImpacto(proximas: Record<string, EstadoDoCampo>): Promise<void> {
    if (Object.keys(proximas).length === 0) {
      setPrevia(null)
      return
    }

    const minha = ++sequencia.current

    try {
      const campos = Object.fromEntries(
        Object.entries(proximas).map(([campo, estado]) => [campo, chavesDoEstado(estado)]),
      )
      const resultado = await previaDaRegua(campos, 'paciente')

      // resposta de uma escolha JÁ SUPERADA não pode sobrescrever a atual: sem isto, duas
      // respostas fora de ordem faziam o aviso prometer um número que não era o da escolha
      // na tela (achados CR-I2, DQA-I7 e A11Y-09)
      if (minha === sequencia.current) setPrevia(resultado)
    } catch {
      // a prévia é um CONFORTO, não uma guarda: falhar em contar não pode impedir salvar
      if (minha === sequencia.current) setPrevia(null)
    }
  }

  function escolher(campo: CampoDaRegua, estado: EstadoDoCampo): void {
    const proximas = { ...escolhas }
    if (estado === estadoDoCampo(campo)) {
      delete proximas[campo.campo] // voltou ao que já valia: deixa de ser mudança
    } else {
      proximas[campo.campo] = estado
    }
    setEscolhas(proximas)
    // a recusa do servidor era daquela escolha; mudar de opção a torna obsoleta
    setRecusas(({ [campo.campo]: _descartada, ...resto }) => resto)
    void conferirImpacto(proximas)
  }

  if (consulta.isPending) {
    // `aria-busy` no CONTAINER: o `Skeleton` é `aria-hidden`, então sem isto a região fica
    // acessivelmente vazia e ninguém é avisado de que há carga em curso (JSDoc do próprio
    // Skeleton; achados A11Y-05 e DQA-I1). A forma imita a lista real, não um bloco solto.
    return (
      <div aria-busy="true" className="flex flex-col gap-6">
        <Skeleton className="h-10 w-full max-w-2xl" />
        {SECOES_ESPERADAS.map(([secao, campos, comMotivo]) => (
          <div key={secao} className="flex flex-col gap-2">
            <Skeleton className="h-5 w-40" />
            <ul className="flex flex-col divide-y divide-linha rounded-superficie border border-linha-forte bg-superficie">
              {Array.from({ length: campos }, (_, i) => (
                <li key={i} className="flex items-center justify-between px-4 py-2.5">
                  <Skeleton className="h-5 w-32" />
                  <div className="flex flex-col items-end gap-1">
                    <Skeleton className="h-8 w-56" />
                    {/*
                      A caixa do motivo da trava. `h-10` é a média medida das quatro linhas
                      travadas reais (88, 104, 104 e 87px de linha inteira): com ela a soma
                      do esqueleto dá 384px contra 383px do conteúdo.
                    */}
                    {i < comMotivo ? <Skeleton className="h-10 w-64" /> : null}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <Skeleton className="h-10 w-40" />
      </div>
    )
  }

  if (consulta.isError) {
    return (
      <EstadoErro
        mensagem="Não foi possível carregar a configuração do cadastro. Sem ela não dá para saber o que a clínica exige hoje."
        aoTentarNovamente={() => {
          void consulta.refetch()
        }}
      />
    )
  }

  if (porSecao.length === 0) {
    // o quarto estado do Design System (SHALL da spec): sem ele a tela mostrava só o
    // parágrafo de introdução e um botão morto, sem uma palavra (achado DQA-B2)
    return (
      <EstadoVazio
        titulo="Nenhum campo configurável neste formulário."
        descricao="Quando o cadastro ganhar campos ajustáveis, eles aparecem aqui."
      />
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="text-corpo text-texto-suave">
        Defina o que o cadastro de paciente exige e o que nem aparece no formulário. Nenhuma ficha já gravada
        é alterada: o que você definir aqui vale a partir da próxima vez que alguém salvar o cadastro.
      </p>

      {porSecao.map(({ secao, rotulo, campos }) => (
        <section key={secao} className="flex flex-col gap-2">
          <h3 className="text-subtitulo font-semibold text-texto">{rotulo}</h3>
          <ul className="flex flex-col divide-y divide-linha rounded-superficie border border-linha-forte bg-superficie">
            {campos.map((campo) => (
              <LinhaDoCampo
                key={campo.campo}
                campo={campo}
                escolhido={escolhas[campo.campo] ?? estadoDoCampo(campo)}
                alterado={escolhas[campo.campo] !== undefined}
                podeEditar={podeEditar}
                recusa={recusas[campo.campo]}
                aoEscolher={(estado) => {
                  escolher(campo, estado)
                }}
              />
            ))}
          </ul>
        </section>
      ))}

      {/*
        A região viva nasce SEMPRE, vazia — só o texto dentro dela muda. Região `status`
        inserida já com conteúdo é o caso historicamente não confiável: parte das
        combinações leitor/navegador só observa mutações de regiões que já existiam na
        árvore, e o aviso podia nunca ser anunciado (achado A11Y-04).
      */}
      <div role="status" aria-live="polite">
        {previa !== null && previa.incompletos > 0 ? (
          <p className="flex items-start gap-2 rounded-campo bg-alerta-suave p-3 text-corpo text-alerta-texto">
            <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
            <span>
              Com esta configuração, {frase(previa.incompletos, previa.total)} passariam a aparecer como cadastro
              incompleto na lista. Nenhuma delas é alterada — a lista só passa a avisar o que falta.
            </span>
          </p>
        ) : null}
      </div>

      {podeEditar ? (
        <div className="flex items-center gap-3">
          {/*
            `aria-disabled`, não `disabled`, e "Descartar" SEMPRE montado (achado A11Y-03).
            O botão era desabilitado enquanto estava focado e o irmão desmontava no sucesso:
            o foco caía em `&lt;body&gt;` e quem usa teclado recomeçava do topo — com 19 campos,
            ~20 paradas de Tab para voltar. O próprio `Botao` do Design System documenta
            esta saída: inerte MAS focável, para o motivo não sumir junto.
          */}
          <Botao
            type="button"
            aria-disabled={!sujo || salvar.isPending}
            aria-busy={salvar.isPending || undefined}
            aria-describedby={sujo ? undefined : idDoMotivoDoBotao}
            onClick={() => {
              if (sujo && !salvar.isPending) salvar.mutate(escolhas)
            }}
          >
            {/*
              NÃO uso a prop `carregando` do `Botao`: ela liga o `disabled` NATIVO
              (`botao.tsx`: `disabled={disabled === true || carregando}`), e o botão que o
              usuário acabou de acionar com Enter sai da árvore de foco em voo — o mesmo
              defeito que o `aria-disabled` veio corrigir (achado A11Y-RCD-03 residual). O
              spinner e o `aria-busy` ficam aqui até o `Botao` resolver isso na origem.
            */}
            {salvar.isPending ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : null}
            Salvar
          </Botao>
          <Botao
            type="button"
            variante="secundario"
            aria-disabled={!sujo}
            aria-describedby={sujo ? undefined : idDoMotivoDoBotao}
            onClick={() => {
              if (!sujo) return
              setEscolhas({})
              setPrevia(null)
              setRecusas({})
            }}
          >
            Descartar
          </Botao>
          {/*
            O `Botao` documenta que `aria-disabled` existe para o controle "continuar na
            sequência de Tab, para poder DIZER, pelo `aria-describedby`, o que falta". Eu
            tinha adotado o custo sem o benefício: quem chegava por teclado ouvia "Salvar,
            botão, indisponível" e nada mais (achado A11Y-RCD-12).
          */}
          {!sujo ? (
            <p id={idDoMotivoDoBotao} className="text-meta text-texto-suave">
              Nada para salvar: mude o estado de algum campo primeiro.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function LinhaDoCampo({
  campo,
  escolhido,
  alterado,
  podeEditar,
  recusa,
  aoEscolher,
}: {
  campo: CampoDaRegua
  escolhido: EstadoDoCampo
  alterado: boolean
  podeEditar: boolean
  /** Mensagem do servidor para ESTE campo (422) — a recusa cai onde ela nasceu. */
  recusa?: string
  aoEscolher: (estado: EstadoDoCampo) => void
}) {
  const idDoGrupo = `regua-${campo.campo}`
  const idDoMotivo = `${idDoGrupo}-motivo`
  const explicado = campo.travas.length > 0 && campo.motivo_trava !== null

  /*
   * A trava é por CHAVE, não por campo — e a tela precisa respeitar isso opção a opção.
   *
   * A primeira versão desabilitava o grupo INTEIRO quando havia qualquer trava, e com isso
   * impedia o que a API permite: o CPF é travado só em `desabilitado` (não pode sumir da
   * tela, ou a recusa por CPF repetido fica sem onde aparecer), mas PODE ser tornado
   * obrigatório — e há teste no servidor garantindo exatamente isso. A tela dizia não a uma
   * escolha legítima. O mesmo valia para "Responsáveis".
   *
   * A regra correta: uma opção é oferecida quando, para cada chave TRAVADA do campo, o
   * valor que ela produziria é o mesmo que a trava fixa.
   */
  const permitido = (estado: EstadoDoCampo): boolean => {
    const proposto = chavesDoEstado(estado)
    // só as travas das chaves que ESTE controle propõe. `online` é eixo independente (o campo
    // entrar ou não no formulário público) e tem controle próprio: uma trava nela não pode
    // apagar da tela a escolha entre obrigatório, opcional e oculto — foi o mesmo erro que a
    // primeira versão desta função cometeu com o CPF, uma camada acima.
    return campo.travas
      .filter((chave): chave is 'obrigatorio' | 'desabilitado' => chave !== 'online')
      .every((chave) => proposto[chave] === campoTravadoEm(campo, chave))
  }

  /*
   * RÁDIOS NATIVOS, não `<button role="radio">`.
   *
   * A primeira versão eram botões com `role="radio"` dentro de um `role="radiogroup"`. O
   * padrão ARIA exige, aí, roving tabIndex e navegação por SETAS escritos à mão — sem eles
   * o grupo é alcançável por Tab mas os três estados não são percorríveis por teclado, o
   * que reprova WCAG 2.2 AA num fluxo core. `<input type="radio">` com `name` compartilhado
   * entrega isso de graça, junto com a leitura correta por leitor de tela ("Sexo, opcional,
   * 2 de 3"). A skin de controle segmentado é só o `<label>` estilizado por `peer-checked`.
   */
  return (
    <li className="flex flex-col gap-2 px-4 py-2.5 transition-colors duration-(--duracao-1) hover:bg-hover-de-linha md:flex-row md:items-center md:justify-between">
      <div className="flex items-center gap-2">
        <span id={idDoGrupo} className="text-corpo text-texto">
          {campo.rotulo}
        </span>
        {alterado ? <span className="text-meta text-acento">alterado</span> : null}
        {campo.travas.length > 0 ? <Lock aria-hidden className="size-3.5 text-texto-suave" /> : null}
      </div>

      <div className="flex flex-col items-start gap-1 md:items-end">
        {/*
          SOMENTE LEITURA vira TEXTO, não três controles inertes (achado A11Y-06).
          Com 57 rádios desabilitados, a única informação da tela — qual é a régua de cada
          campo — era lida a 2,8:1 e não havia uma parada de Tab na seção inteira. A
          exceção de contraste da 1.4.3 existe para "controle que você não pode usar", não
          para "conteúdo que você precisa ler".
        */}
        {!podeEditar ? (
          <p className="text-corpo text-texto">{ROTULOS[escolhido]}</p>
        ) : (
        <div
          role="radiogroup"
          aria-labelledby={idDoGrupo}
          aria-describedby={explicado ? idDoMotivo : undefined}
          className="grid w-full grid-cols-3 gap-1 md:flex md:w-auto"
        >
          {ORDEM.map((estado) => (
            <label
              key={estado}
              className="cursor-pointer text-center whitespace-nowrap has-disabled:cursor-not-allowed"
            >
              <input
                type="radio"
                name={idDoGrupo}
                value={estado}
                checked={escolhido === estado}
                disabled={!permitido(estado) || !podeEditar}
                onChange={() => {
                  aoEscolher(estado)
                }}
                className="peer sr-only"
              />
              {/*
                Os CINCO estados que o Design System exige de todo componente do núcleo —
                faltavam hover e active, e o desabilitado usava `opacity-60`, que compõe
                uma cor fora da paleta (medida em 2,76:1) em vez dos tokens desenhados
                para isso. O foco usa `outline-foco`, que é o token de PAPEL: `acento`
                resolve no mesmo hex hoje, e deixaria de acompanhar no dia em que o anel
                de foco precisasse mudar (achado DQA-B3).

                O hover sinaliza por BORDA e TEXTO, não por fundo (achado DQA-R3-01, 2ª
                volta). `hover:bg-fundo` sobre `bg-superficie` dá 1,05:1, e a `<li>` inteira
                escurece junto: a pílula sob o ponteiro ficava a 1,091:1 da linha enquanto
                as vizinhas, intocadas, ficavam a 1,148:1 — o sinal estava INVERTIDO, quem
                era apontado destacava-se menos. Com `acento` o texto vai a 6,54:1 sobre
                branco e a borda salta de cinza para verde, que é um canal com contraste de
                verdade. Mesmo caminho da variante `outline` do Design System.
              */}
              <span className="flex items-center justify-center gap-1 rounded-controle [&>svg]:invisible peer-checked:[&>svg]:visible border border-borda-campo bg-superficie px-3 py-1.5 text-meta text-texto transition-colors hover:border-acento hover:text-acento peer-checked:border-acento peer-checked:bg-acento peer-checked:text-sobre-acento peer-checked:hover:bg-acento-intenso peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-foco peer-active:translate-y-px peer-disabled:border-linha-forte peer-disabled:bg-neutro-desativado peer-disabled:text-texto-desativado">
                {/*
                  O check aparece só no marcado. Em `forced-colors` o sistema substitui o
                  fundo de acento e o rádio nativo está em `sr-only`: sem glifo, as três
                  pílulas ficariam indistinguíveis no alto contraste do Windows — modo real
                  no balcão de clínica (achado A11Y-07).
                */}
                <Check aria-hidden className="size-3 shrink-0" />
                {ROTULOS[estado]}
              </span>
            </label>
          ))}
        </div>
        )}
        {explicado ? (
          <p id={idDoMotivo} className="max-w-md text-meta text-texto-suave">
            {campo.motivo_trava}
          </p>
        ) : null}
        {recusa !== undefined ? (
          <p role="alert" className="max-w-md text-meta text-perigo-texto">
            {recusa}
          </p>
        ) : null}
      </div>
    </li>
  )
}

/**
 * O valor que a trava fixa naquela chave — é o PADRÃO do catálogo, que o servidor recusa
 * mudar. `nome` trava `obrigatorio` em `true` e `desabilitado` em `false`; `cpf` trava só
 * `desabilitado` em `false`.
 *
 * Lê do estado EFETIVO do campo: para chave travada, efetivo e padrão são a mesma coisa
 * por construção (o servidor nunca deixou gravar outro valor).
 */
function campoTravadoEm(campo: CampoDaRegua, chave: ChaveDaRegua): boolean {
  if (chave === 'obrigatorio') return campo.obrigatorio
  if (chave === 'desabilitado') return campo.desabilitado
  return campo.online
}

function agruparPorSecao(
  regua: ReguaDoCadastro | undefined,
): Array<{ secao: string; rotulo: string; campos: CampoDaRegua[] }> {
  if (regua === undefined) return []

  return regua.secoes
    .map(({ secao, rotulo }) => ({
      secao,
      rotulo,
      campos: regua.campos.filter((campo) => campo.secao === secao),
    }))
    .filter(({ campos }) => campos.length > 0)
}

/**
 * "3 de 120 fichas" · "todas as 19 fichas" · "1 ficha de 120".
 *
 * A primeira versão compunha `formatarFichas(a)` + " de " + `formatarFichas(b)` e produzia
 * **"19 fichas de 19 fichas"** — a palavra repetida nos dois números, e o caso "todas"
 * dito da forma mais confusa possível justamente quando ele é o mais alarmante.
 */
function frase(incompletos: number, total: number): string {
  const plural = (n: number) => (n === 1 ? '1 ficha' : `${n.toLocaleString('pt-BR')} fichas`)

  if (incompletos >= total) return `todas as ${plural(total)}`
  if (incompletos === 1) return `1 ficha de ${total.toLocaleString('pt-BR')}`
  return `${incompletos.toLocaleString('pt-BR')} de ${plural(total)}`
}
