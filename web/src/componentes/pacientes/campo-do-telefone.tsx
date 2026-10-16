import { useEffect, useRef, useState } from 'react'

import { SeletorDoPais } from '@/componentes/pacientes/seletor-do-pais'
import { SobreOTelefone } from '@/componentes/pacientes/sobre-o-telefone'
import { CampoTexto, type CampoTextoProps } from '@/componentes/ui/campo-texto'
import { usarTelefoneEmUso } from '@/hooks/usar-telefone-em-uso'
import { digitarNoNumero, numeroSemCodigo, paisAoReler, paisDoValor } from '@/lib/paises-do-telefone'
import {
  avisoDoTelefone,
  escolherPais,
  fraseDoRepetido,
  lerTelefone,
  TIPOS_TELEFONICOS,
} from '@/lib/telefone-whatsapp'

export interface CampoDoTelefoneProps
  extends Omit<CampoTextoProps, 'ajuda' | 'value' | 'onChange' | 'antesDoControle'> {
  /** O valor gravado: o número como foi digitado no Brasil, `+<código> <número>` nos outros países */
  value: string
  /** Recebe o valor INTEIRO, já com o `+código` do país escolhido — é ele que se grava */
  aoMudar: (valor: string) => void
  /** O tipo do contato (`celular`, `whatsapp`, `telefone`, `email`…); e-mail não recebe aviso */
  tipo?: string
  /** Pergunta se o número está em outro paciente — só na tela INTERNA (design D6) */
  conferirRepetido?: boolean
  /** O paciente em edição, que não conta como "outro" */
  pacienteId?: number | null
}

/** O que a região de voz diz, e de QUAL valor ela fala (gate r2, CR-TEL-11). */
interface Anuncio {
  valor: string
  texto: string
}

/**
 * A espera depois de escolher o país, antes de anunciar o aviso novo. No Windows, cada seta no
 * `<select>` fechado já troca o valor: sem a espera, o leitor de tela falaria um aviso por país
 * atravessado, por cima do nome de cada um.
 */
const ESPERA_DA_ESCOLHA_MS = 500

/** O que se anuncia quando o valor muda: o que pede ação, ou a correção do que pedia. */
function textoDoAnuncio(antes: string, agora: string, tipo: string): string {
  const depois = avisoDoTelefone(agora, tipo)

  return depois !== null && (depois.anunciar || avisoDoTelefone(antes, tipo)?.anunciar === true) ? depois.texto : ''
}

interface PaisDoCampo {
  sigla: string
  /** O que o campo do número mostra: sem o `+código` que a escolha já mostra */
  numero: string
  digitar: (texto: string) => void
  /** Troca o país e devolve o valor novo */
  escolher: (sigla: string) => string
  /** Na saída do campo: a bandeira segue o `+código` que foi digitado */
  reler: (valor: string) => void
}

/**
 * O país escolhido (change telefone-estrangeiro). Abre pelo valor gravado e o segue quando o valor
 * muda POR FORA (a ficha re-hidratada, o contato de cima removido — as listas identificam o contato
 * pela posição); o que esta peça mesma gravou não o muda, senão "+4" digitado em "Outro país" virava
 * outra coisa no meio da digitação.
 */
function usePaisDoCampo(value: string, aoMudar: (valor: string) => void, telefonico: boolean): PaisDoCampo {
  const [sigla, setSigla] = useState(() => paisDoValor(value))
  const [visto, setVisto] = useState(value)
  const [gravado, setGravado] = useState<string | null>(null)

  if (value !== visto) {
    setVisto(value)
    if (value !== gravado) {
      setSigla(paisDoValor(value))
    }
  }

  function gravar(novo: string): void {
    setGravado(novo)
    aoMudar(novo)
  }

  return {
    sigla,
    numero: telefonico ? numeroSemCodigo(value, sigla) : value,
    digitar(texto) {
      if (!telefonico) {
        gravar(texto)
        return
      }
      const digitacao = digitarNoNumero(sigla, texto)
      setSigla(digitacao.sigla)
      gravar(digitacao.valor)
    },
    escolher(nova) {
      const novo = escolherPais(value, nova)
      setSigla(nova)
      if (novo !== value) {
        gravar(novo)
      }

      return novo
    },
    reler(valor) {
      // o número vazio não diz país nenhum: quem escolheu o Reino Unido e passou pelo campo continua nele
      if (valor.trim() !== '') {
        setSigla((atual) => paisAoReler(valor, atual))
      }
    },
  }
}

interface LeituraDoCampo {
  /**
   * O valor de que o aviso e a região de voz falam: o da última leitura com o campo em foco, o atual
   * fora dele (o formulário pode ser re-hidratado por fora). Com o campo em foco, a região fala do
   * valor da ENTRADA (gate r3, A11Y-TEL-08): comparar com o valor digitado a esvaziava e a repunha
   * no meio da digitação, e o leitor falava por cima das teclas.
   */
  valorLido: string
  anuncio: Anuncio | null
  /** O número mudou desde a entrada no campo */
  editando: boolean
  entrar: () => void
  sair: (aoReler: (saida: string) => void) => void
  anunciarEscolha: (antes: string, agora: string) => void
}

/**
 * A leitura do número e o que se anuncia dele — as regras dos gates de acessibilidade e de código:
 *
 * - **O aviso é o da última LEITURA e não some no foco** (r1, A11Y-TEL-01). Quem volta ao campo
 *   para corrigir continua ouvindo "Confira o DDD…", e ele só muda na próxima saída.
 * - **A leitura nova entra DEPOIS que o foco chegou ao próximo campo** (r2, A11Y-TEL-04). Trocar o
 *   aviso dentro do próprio `blur`, quando o navegador já escolheu o próximo alvo, desmontava o link
 *   do repetido debaixo do Tab, e, dentro do diálogo do Radix, a remoção de nós com o foco no `body`
 *   mandava o foco para o contêiner. Pela mesma razão, **os links do repetido saem assim que o
 *   número é editado**, com o foco ainda no campo.
 * - **O que pede ação é ANUNCIADO** numa região de status que já existe, vazia, desde a montagem.
 *   Só depois de uma saída do campo em que o número MUDOU (r2, A11Y-TEL-05 / CR-TEL-12): abrir a
 *   ficha de irmãos não fala sozinho, e passar pelo campo sem mexer não repete. A correção que
 *   resolve um aviso é confirmada ("WhatsApp: +55…"). O anúncio fica preso ao valor de que fala:
 *   remover o contato de cima ou trocar o tipo para e-mail não deixa a voz falando do número errado
 *   (r2, CR-TEL-11, porque as listas identificam o contato pela posição).
 * - **Escolher o país também é uma mudança do número** (change telefone-estrangeiro): o aviso novo
 *   é anunciado pela mesma regra, quando a pessoa para de trocar de país.
 */
function useLeituraDoCampo(value: string, tipo: string): LeituraDoCampo {
  const [emFoco, setEmFoco] = useState(false)
  // o valor da última leitura: o que estava no campo ao entrar ou ao sair dele
  const [lido, setLido] = useState(value)
  const [entrada, setEntrada] = useState<string | null>(null)
  const [anuncio, setAnuncio] = useState<Anuncio | null>(null)
  const pendentes = useRef<number[]>([])
  const escolha = useRef<{ antes: string; pendente: number } | null>(null)

  useEffect(
    () => () => {
      pendentes.current.forEach((pendente) => {
        window.clearTimeout(pendente)
      })
      if (escolha.current !== null) {
        window.clearTimeout(escolha.current.pendente)
      }
    },
    [],
  )

  function depois(acao: () => void, atraso = 0): void {
    const pendente = window.setTimeout(() => {
      pendentes.current = pendentes.current.filter((outro) => outro !== pendente)
      acao()
    }, atraso)
    pendentes.current.push(pendente)
  }

  return {
    valorLido: emFoco ? lido : value,
    anuncio,
    editando: emFoco && value !== lido,
    entrar() {
      pendentes.current.forEach((pendente) => {
        window.clearTimeout(pendente)
      })
      pendentes.current = []
      setLido(value)
      setEntrada(value)
      setEmFoco(true)
    },
    sair(aoReler) {
      const saida = value
      const naEntrada = entrada
      depois(() => {
        setLido(saida)
        setEmFoco(false)
        aoReler(saida)
        if (naEntrada === null || saida === naEntrada) {
          return
        }
        const texto = textoDoAnuncio(naEntrada, saida, tipo)
        // vazia e depois a frase: a mesma frase de antes (outro número inválido) também é lida
        setAnuncio(null)
        depois(() => {
          setAnuncio({ valor: saida, texto })
        }, 50)
      })
    },
    anunciarEscolha(antesDaEscolha, agora) {
      // a série de setas conta como UMA troca: compara o valor de antes da primeira com o da última
      const antes = escolha.current?.antes ?? antesDaEscolha
      if (escolha.current !== null) {
        window.clearTimeout(escolha.current.pendente)
      }
      const pendente = window.setTimeout(() => {
        escolha.current = null
        if (agora !== antes) {
          setAnuncio({ valor: agora, texto: textoDoAnuncio(antes, agora, tipo) })
        }
      }, ESPERA_DA_ESCOLHA_MS)
      escolha.current = { antes, pendente }
    },
  }
}

/**
 * O campo de telefone que diz se o número chega no WhatsApp (change telefone-que-chega-no-whatsapp)
 * e, antes do número, a escolha do país (change telefone-estrangeiro). As regras de leitura e de
 * anúncio estão em `useLeituraDoCampo`; as do país, em `usePaisDoCampo` e `paises-do-telefone.ts`.
 */
export function CampoDoTelefone({
  value,
  aoMudar,
  tipo = 'celular',
  conferirRepetido = false,
  pacienteId = null,
  limite,
  tamanho,
  disabled,
  onFocus,
  onBlur,
  id,
  ...props
}: CampoDoTelefoneProps) {
  const telefonico = TIPOS_TELEFONICOS.includes(tipo)
  const pais = usePaisDoCampo(value, aoMudar, telefonico)
  const leitura = useLeituraDoCampo(value, tipo)

  const aviso = avisoDoTelefone(leitura.valorLido, tipo)
  const forma = conferirRepetido && aviso?.perguntarSeRepete === true ? lerTelefone(leitura.valorLido).forma : null
  const consulta = usarTelefoneEmUso(forma, pacienteId)
  const repetido = consulta !== null && consulta.total > 0 && !leitura.editando ? consulta : null
  const anuncioAtual =
    leitura.anuncio !== null &&
    leitura.anuncio.valor === leitura.valorLido &&
    avisoDoTelefone(leitura.valorLido, tipo) !== null
      ? [leitura.anuncio.texto, repetido === null ? '' : fraseDoRepetido(repetido)].filter(Boolean).join(' ')
      : ''
  // o `+código` que a escolha mostra fica fora do campo do número, mas conta no teto do servidor
  const limiteDoNumero = limite === undefined ? undefined : Math.max(0, limite - (value.length - pais.numero.length))

  return (
    <div className="flex flex-col">
      <CampoTexto
        {...props}
        id={id}
        tamanho={tamanho}
        disabled={disabled}
        limite={limiteDoNumero}
        value={pais.numero}
        onChange={(evento) => {
          pais.digitar(evento.target.value)
        }}
        antesDoControle={
          telefonico ? (
            <SeletorDoPais
              sigla={pais.sigla}
              disabled={disabled}
              tamanho={tamanho}
              aoEscolher={(sigla) => {
                leitura.anunciarEscolha(value, pais.escolher(sigla))
              }}
            />
          ) : undefined
        }
        onFocus={(evento) => {
          leitura.entrar()
          onFocus?.(evento)
        }}
        onBlur={(evento) => {
          leitura.sair(pais.reler)
          onBlur?.(evento)
        }}
        ajuda={aviso === null ? undefined : <SobreOTelefone aviso={aviso} repetido={repetido} />}
      />
      <span role="status" className="sr-only">
        {anuncioAtual}
      </span>
    </div>
  )
}
