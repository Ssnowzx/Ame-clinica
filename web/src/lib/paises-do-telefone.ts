/**
 * O PAÍS do telefone (change telefone-estrangeiro, tarefa 1.3b).
 *
 * Pedido do dono: "igual os sistemas de cadastro que mostram a bandeira antes do número, já
 * configurado para não ter erro". O campo ganha a escolha do país, já em Brasil, e o VALOR gravado
 * continua um texto só — é ele que o servidor normaliza (`TelefoneE164::normalizar`):
 *
 * - **Brasil:** exatamente o que foi digitado, sem prefixo. Nada muda para o caso comum nem para os
 *   cadastros que já existem.
 * - **Outro país da lista:** `+<código> <número>` (`+44 7700 900123`). O código vem da escolha; o
 *   campo do número mostra só o que vem depois dele.
 * - **"Outro país":** o que foi digitado, com o `+` na frente — quem escolhe "Outro país" digita o
 *   código junto do número.
 *
 * Sem o `+`, o servidor lê o número como brasileiro (a regra é dele, e esta tela só a espelha): é por
 * isso que o código entra sozinho, e não pela digitação de cada um.
 */

export interface PaisDoTelefone {
  /** ISO 3166-1 alfa-2: identifica a opção e desenha a bandeira */
  sigla: string
  /** O nome em português do Brasil, como a recepção o procura na lista */
  nome: string
  /** A contração da frase do aviso: "um número **do** Reino Unido", "**da** Argentina", "**de** Portugal" */
  de: 'de' | 'do' | 'da' | 'dos'
  /** O código do país (DDI), só os dígitos */
  codigo: string
  /**
   * Quantos dígitos o número tem DEPOIS do código: `[mínimo, máximo]`. Serve só ao aviso "faltam / sobram
   * dígitos"; a forma canônica é a regra E.164 do servidor, que não conhece país.
   *
   * O critério: o tamanho do número nacional significativo do CELULAR (sem o código do país e sem o 0
   * da ligação de longa distância), como os planos de numeração que cada país registra na UIT
   * (ITU-T E.164, "National numbering plans") o descrevem — a mesma medida da tabela
   * `possibleLengths` de celular do libphonenumber (Google). A faixa é TOLERANTE: onde o país tem
   * celular de dois tamanhos (Alemanha, Itália, Coreia do Sul) ou o fixo comum tem outro tamanho
   * (Argentina, Bélgica), ela cobre os dois — um aviso que grita com número bom é aviso que a
   * recepção aprende a ignorar. Na dúvida, "Outro país" grava sem conferir tamanho.
   */
  digitos: readonly [number, number]
  /**
   * O número pode começar por 0 depois do código. Só a Itália: o fixo italiano leva o 0 até no
   * internacional (`+39 06 …`). Nos outros, o 0 é o da ligação nacional (`07700 …` no Reino Unido),
   * e com o código na frente ele faz o número chegar em outra pessoa — ou em ninguém.
   */
  zeroFazParte?: true
}

/** A escolha de quem digita o código do país junto do número. */
export const OUTRO_PAIS = 'outro'

const BRASIL: PaisDoTelefone = { sigla: 'BR', nome: 'Brasil', de: 'do', codigo: '55', digitos: [10, 11] }

/**
 * Os prováveis, no topo e nesta ordem (a combinada na change): o Brasil, os destinos mais comuns de
 * quem mora fora e os vizinhos do Sul. A família que motivou a change é do Reino Unido.
 */
export const PAISES_PROVAVEIS: readonly PaisDoTelefone[] = [
  BRASIL,
  { sigla: 'PT', nome: 'Portugal', de: 'de', codigo: '351', digitos: [9, 9] },
  { sigla: 'US', nome: 'Estados Unidos', de: 'dos', codigo: '1', digitos: [10, 10] },
  { sigla: 'GB', nome: 'Reino Unido', de: 'do', codigo: '44', digitos: [10, 10] },
  // o celular argentino leva o 9 depois do código (+54 9 11 …): 11 dígitos; o fixo, 10
  { sigla: 'AR', nome: 'Argentina', de: 'da', codigo: '54', digitos: [10, 11] },
  { sigla: 'PY', nome: 'Paraguai', de: 'do', codigo: '595', digitos: [9, 9] },
  { sigla: 'UY', nome: 'Uruguai', de: 'do', codigo: '598', digitos: [8, 8] },
  { sigla: 'ES', nome: 'Espanha', de: 'da', codigo: '34', digitos: [9, 9] },
  { sigla: 'IT', nome: 'Itália', de: 'da', codigo: '39', digitos: [9, 10], zeroFazParte: true },
  { sigla: 'DE', nome: 'Alemanha', de: 'da', codigo: '49', digitos: [10, 11] },
  { sigla: 'FR', nome: 'França', de: 'da', codigo: '33', digitos: [9, 9] },
  { sigla: 'JP', nome: 'Japão', de: 'do', codigo: '81', digitos: [10, 10] },
  { sigla: 'CA', nome: 'Canadá', de: 'do', codigo: '1', digitos: [10, 10] },
]

/**
 * O resto, em ordem alfabética (a guarda `paises-do-telefone.test.ts` cobra a ordem). Ficou de fora
 * quem tem celular de tamanho muito variável (Áustria, Finlândia): para eles, "Outro país".
 */
export const OUTROS_PAISES: readonly PaisDoTelefone[] = [
  { sigla: 'ZA', nome: 'África do Sul', de: 'da', codigo: '27', digitos: [9, 9] },
  { sigla: 'AO', nome: 'Angola', de: 'de', codigo: '244', digitos: [9, 9] },
  { sigla: 'AU', nome: 'Austrália', de: 'da', codigo: '61', digitos: [9, 9] },
  { sigla: 'BE', nome: 'Bélgica', de: 'da', codigo: '32', digitos: [8, 9] },
  { sigla: 'BO', nome: 'Bolívia', de: 'da', codigo: '591', digitos: [8, 8] },
  { sigla: 'CV', nome: 'Cabo Verde', de: 'de', codigo: '238', digitos: [7, 7] },
  { sigla: 'CL', nome: 'Chile', de: 'do', codigo: '56', digitos: [9, 9] },
  { sigla: 'CN', nome: 'China', de: 'da', codigo: '86', digitos: [11, 11] },
  { sigla: 'CO', nome: 'Colômbia', de: 'da', codigo: '57', digitos: [10, 10] },
  { sigla: 'KR', nome: 'Coreia do Sul', de: 'da', codigo: '82', digitos: [9, 10] },
  { sigla: 'CR', nome: 'Costa Rica', de: 'da', codigo: '506', digitos: [8, 8] },
  { sigla: 'CU', nome: 'Cuba', de: 'de', codigo: '53', digitos: [8, 8] },
  { sigla: 'DK', nome: 'Dinamarca', de: 'da', codigo: '45', digitos: [8, 8] },
  { sigla: 'AE', nome: 'Emirados Árabes Unidos', de: 'dos', codigo: '971', digitos: [9, 9] },
  { sigla: 'EC', nome: 'Equador', de: 'do', codigo: '593', digitos: [9, 9] },
  { sigla: 'GR', nome: 'Grécia', de: 'da', codigo: '30', digitos: [10, 10] },
  { sigla: 'NL', nome: 'Holanda', de: 'da', codigo: '31', digitos: [9, 9] },
  { sigla: 'IN', nome: 'Índia', de: 'da', codigo: '91', digitos: [10, 10] },
  { sigla: 'IE', nome: 'Irlanda', de: 'da', codigo: '353', digitos: [9, 9] },
  { sigla: 'IL', nome: 'Israel', de: 'de', codigo: '972', digitos: [9, 9] },
  // o "1" depois do código, que o celular mexicano usava até 2019, ainda aparece digitado
  { sigla: 'MX', nome: 'México', de: 'do', codigo: '52', digitos: [10, 11] },
  { sigla: 'MZ', nome: 'Moçambique', de: 'de', codigo: '258', digitos: [9, 9] },
  { sigla: 'NO', nome: 'Noruega', de: 'da', codigo: '47', digitos: [8, 8] },
  { sigla: 'NZ', nome: 'Nova Zelândia', de: 'da', codigo: '64', digitos: [8, 10] },
  { sigla: 'PA', nome: 'Panamá', de: 'do', codigo: '507', digitos: [8, 8] },
  { sigla: 'PE', nome: 'Peru', de: 'do', codigo: '51', digitos: [9, 9] },
  { sigla: 'PL', nome: 'Polônia', de: 'da', codigo: '48', digitos: [9, 9] },
  { sigla: 'RU', nome: 'Rússia', de: 'da', codigo: '7', digitos: [10, 10] },
  { sigla: 'SE', nome: 'Suécia', de: 'da', codigo: '46', digitos: [9, 9] },
  { sigla: 'CH', nome: 'Suíça', de: 'da', codigo: '41', digitos: [9, 9] },
  { sigla: 'TR', nome: 'Turquia', de: 'da', codigo: '90', digitos: [10, 10] },
  { sigla: 'VE', nome: 'Venezuela', de: 'da', codigo: '58', digitos: [10, 10] },
]

const TODOS: readonly PaisDoTelefone[] = [...PAISES_PROVAVEIS, ...OUTROS_PAISES]

/** O país da opção; `undefined` para "Outro país". */
export function paisPelaSigla(sigla: string): PaisDoTelefone | undefined {
  return TODOS.find((pais) => pais.sigla === sigla)
}

/**
 * A bandeira em emoji, montada da sigla pelos dois "indicadores regionais" do Unicode.
 *
 * No Windows ela aparece como as duas letras ("GB"): por isso a lista diz sempre o nome e o código,
 * e a bandeira nunca é a única coisa que identifica o país.
 */
export function bandeira(sigla: string): string {
  return String.fromCodePoint(...[...sigla.toUpperCase()].map((letra) => 0x1f1e6 + letra.charCodeAt(0) - 65))
}

/** O que o `trim` do PHP tira: espaço, tabulação, quebra de linha, NUL e tabulação vertical. */
const BRANCOS_DO_TRIM_DO_PHP: ReadonlySet<string> = new Set([' ', '\t', '\n', '\r', '\u0000', '\u000B'])

function semBrancoNaFrente(valor: string): string {
  let inicio = 0
  while (inicio < valor.length && BRANCOS_DO_TRIM_DO_PHP.has(valor.charAt(inicio))) {
    inicio += 1
  }

  return valor.slice(inicio)
}

/**
 * O valor sem as marcas invisíveis do Unicode (categoria Cf), em qualquer posição — cópia do
 * `TelefoneE164::limpo` (gate r1). O número copiado do WhatsApp vem embrulhado em marcas de direção
 * de texto (`\u202A+44 …\u202C`): com elas, o `+` não era o primeiro caractere, e o celular de fora era
 * lido como brasileiro.
 */
function semMarcasInvisiveis(valor: string): string {
  return valor.replace(/\p{Cf}/gu, '')
}

/** O valor como o servidor o olha: sem as marcas invisíveis e sem os brancos da frente. */
function limpo(valor: string): string {
  return semBrancoNaFrente(semMarcasInvisiveis(valor))
}

/**
 * O valor começa com `+`? É a pergunta do servidor (`str_starts_with(limpo($bruto), '+')`), e o `trim`
 * do PHP só tira os brancos acima — o `trim()` do JavaScript tiraria também o espaço inquebrável, e um
 * número colado com ele seria estrangeiro aqui e brasileiro lá.
 */
export function comecaComMais(valor: string): boolean {
  return limpo(valor).startsWith('+')
}

function digitosDe(valor: string): string {
  return valor.replace(/\D+/g, '')
}

/**
 * O país de um valor gravado — o que o campo abre selecionado.
 *
 * Sem `+` é o Brasil, como o servidor o lê. Com `+`, o país de código MAIS LONGO que casar com o
 * começo dos dígitos (os códigos da UIT não são prefixo uns dos outros, então "o mais longo" só
 * desempata o que esta lista repete). O `+1` é dos Estados Unidos e do Canadá: o código não diz
 * qual dos dois é, e vence o primeiro da lista — os Estados Unidos. O número e o lembrete são os
 * mesmos; só a bandeira de uma família canadense reabre americana.
 */
export function paisDoValor(valor: string): string {
  if (!comecaComMais(valor)) {
    return BRASIL.sigla
  }

  const digitos = digitosDe(valor)
  let escolhido: PaisDoTelefone | undefined
  for (const pais of TODOS) {
    if (digitos.startsWith(pais.codigo) && pais.codigo.length > (escolhido?.codigo.length ?? 0)) {
      escolhido = pais
    }
  }

  return escolhido?.sigla ?? OUTRO_PAIS
}

/**
 * O país ao SAIR do campo: o do `+código` digitado, mas o escolhido fica quando o código dele é o mesmo
 * (gate r1) — o Canadá escolhido não vira Estados Unidos só porque os dois são +1. Ao reabrir o
 * cadastro, o valor sozinho não diz qual dos dois era, e vale `paisDoValor`.
 */
export function paisAoReler(valor: string, atual: string): string {
  const achado = paisDoValor(valor)
  const codigoAtual = paisPelaSigla(atual)?.codigo

  return codigoAtual !== undefined && codigoAtual === paisPelaSigla(achado)?.codigo ? atual : achado
}

/** O país de fora da lista que o valor nomeia pelo `+código`; `null` para o Brasil e o desconhecido. */
export function paisEstrangeiroDoValor(valor: string): PaisDoTelefone | null {
  const pais = paisPelaSigla(paisDoValor(valor))

  return pais === undefined || pais === BRASIL ? null : pais
}

/** Os dígitos que vêm DEPOIS do código do país. */
export function digitosDepoisDoCodigo(valor: string, pais: PaisDoTelefone): string {
  return digitosDe(valor).slice(pais.codigo.length)
}

/**
 * O código (com o que houver entre os dígitos dele) e o separador que vem depois — com o `+` na
 * frente, ou sem ele para o código digitado como se fosse parte do número.
 */
function prefixoDoCodigo(codigo: string, comMais = true): RegExp {
  return new RegExp(`^${comMais ? '\\+' : ''}\\D*${[...codigo].join('\\D*')}[\\s.)-]*`)
}

/** O valor sem o `+código` do país, se ele começar por esse código; `null` se não começar. */
function semOCodigo(valor: string, codigo: string): string | null {
  const texto = limpo(valor)
  const prefixo = prefixoDoCodigo(codigo)

  return prefixo.test(texto) ? texto.replace(prefixo, '') : null
}

/**
 * O que o campo do número mostra para o país escolhido: no Brasil e em "Outro país", o valor
 * inteiro; num país da lista, só o que vem depois do `+código` (que a escolha já mostra).
 */
export function numeroSemCodigo(valor: string, sigla: string): string {
  const pais = paisPelaSigla(sigla)
  if (pais === undefined || pais === BRASIL) {
    return valor
  }

  return semOCodigo(valor, pais.codigo) ?? valor
}

/** O que a digitação no campo do número grava, e se ela mudou o país escolhido. */
export interface Digitacao {
  sigla: string
  valor: string
}

/**
 * A digitação no campo do número vira o valor gravado.
 *
 * Num país da lista, quem digita um `+` está digitando o código por conta própria: o campo passa a
 * "Outro país" e grava o que foi digitado — sem isso, `+44` digitado com o Reino Unido escolhido
 * virava `+44 +44 …`. Ao sair do campo, `paisDoValor` devolve a bandeira certa.
 */
export function digitarNoNumero(sigla: string, texto: string): Digitacao {
  if (sigla === OUTRO_PAIS) {
    // quem escolheu "Outro país" digita o código: o `+` entra sozinho, porque sem ele o número
    // seria lido como brasileiro
    const valor = texto.trim() === '' || comecaComMais(texto) ? texto : `+${texto.trimStart()}`

    return { sigla, valor }
  }

  const pais = paisPelaSigla(sigla)
  if (pais === undefined || pais === BRASIL) {
    return { sigla, valor: texto }
  }
  if (comecaComMais(texto)) {
    return { sigla: OUTRO_PAIS, valor: texto }
  }

  return { sigla, valor: texto.trim() === '' ? '' : `+${pais.codigo} ${texto.trimStart()}` }
}

/** O valor sem o `+` da frente (e sem os brancos que o acompanham). */
export function semOMais(valor: string): string {
  return limpo(valor).replace(/^\+/, '').trimStart()
}

/** O número sem o `+código` que o valor tiver, para levá-lo a outro país. */
function parteNacional(valor: string): string {
  if (!comecaComMais(valor)) {
    return valor
  }

  const pais = paisPelaSigla(paisDoValor(valor))

  return (pais === undefined ? null : semOCodigo(valor, pais.codigo)) ?? semOMais(valor)
}

/**
 * O código digitado SEM o `+`, como parte do número (`447700900123`), quando só essa leitura cabe no
 * tamanho do país. `null` se, sem o código, o número não tem o tamanho do país (o celular italiano
 * `391 234 5678` começa por 39, e sem ele sobrariam 8 dígitos), e também quando as DUAS leituras
 * cabem: aí não se adivinha, como o servidor não adivinha o país do número sem `+`.
 */
function semOCodigoDigitado(numero: string, pais: PaisDoTelefone): string | null {
  const digitos = digitosDe(numero)
  const [minimo, maximo] = pais.digitos
  const cabe = (tamanho: number): boolean => tamanho >= minimo && tamanho <= maximo

  if (!digitos.startsWith(pais.codigo) || cabe(digitos.length) || !cabe(digitos.length - pais.codigo.length)) {
    return null
  }

  return limpo(numero).replace(prefixoDoCodigo(pais.codigo, false), '')
}

/**
 * O valor depois de escolher outro país: o número continua, e o código muda. Para "Outro país" o
 * valor fica como está, e o código passa a ser editável no campo do número.
 *
 * Quem digitou o número com o código e sem o `+` (`447700900123`) e então escolhe o Reino Unido —
 * o caminho que o aviso do número inválido ensina — fica com `+44 7700900123`, e não com o 44 duas
 * vezes.
 */
export function trocarDePais(valor: string, para: string): string {
  if (para === OUTRO_PAIS) {
    return valor
  }

  const nacional = parteNacional(valor)
  const pais = paisPelaSigla(para)
  if (pais === undefined || pais === BRASIL) {
    return nacional
  }

  const numero = semOCodigoDigitado(nacional, pais) ?? nacional

  return numero.trim() === '' ? '' : `+${pais.codigo} ${numero.trimStart()}`
}
