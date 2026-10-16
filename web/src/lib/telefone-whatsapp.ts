import { telefoneLegivel } from '@/lib/cobranca-pelo-whatsapp'
import {
  comecaComMais,
  digitosDepoisDoCodigo,
  paisEstrangeiroDoValor,
  paisPelaSigla,
  semOMais,
  trocarDePais,
  type PaisDoTelefone,
} from '@/lib/paises-do-telefone'
import type { TelefoneEmUso } from '@/tipos'

/**
 * O telefone do cadastro chega no WhatsApp? (change telefone-que-chega-no-whatsapp, D1)
 *
 * CÓPIA de `TelefoneE164::classificar()` do servidor — a regra que decide para onde o lembrete
 * vai. A cópia existe porque o campo responde ao sair dele, inclusive no formulário público, que
 * não tem sessão para perguntar ao servidor. E ela só é segura porque o teste de contrato
 * (`telefone-whatsapp.contrato.test.ts`) a confere contra a tabela de casos que a função de
 * produção gera (`php artisan telefones:casos --json`). Mexeu numa das duas, regere a fixture.
 *
 * Em 02/10 a clínica tinha 6 crianças sem lembrete porque o telefone foi digitado com DDI na frente
 * e um dígito a menos (`55 49912-3456`): o campo aceitava qualquer texto e ninguém via o número
 * estranho. Este é o aviso que faltava.
 *
 * O número de OUTRO PAÍS (change telefone-estrangeiro): só o `+` explícito diz que o número não é
 * brasileiro. Com `+` e um código que não é 55, a forma é E.164 como veio (`+447700900123`), sempre
 * celular. Sem o `+`, a regra brasileira de sempre — `447700900123` não vira estrangeiro.
 */

export type TipoDeTelefone = 'celular' | 'fixo'

export interface LeituraDoTelefone {
  /**
   * `+55DD########` ou `+55DD#########`, como a projeção do servidor grava, ou `+<dígitos>` do número
   * de fora do país; `null` = não chega
   */
  forma: string | null
  tipo: TipoDeTelefone | null
}

const DDI = '55'

/** E.164 depois do `+`: o código do país não começa por 0, e o total vai de 8 a 15 dígitos. */
const INTERNACIONAL = /^[1-9]\d{7,14}$/

const NADA: LeituraDoTelefone = { forma: null, tipo: null }

function normalizar(bruto: string): string | null {
  const digitos = bruto.replace(/\D+/g, '')
  if (digitos === '') {
    return null
  }

  // `+` e país que não é o Brasil: E.164 como veio, sem a régua de DDD e assinante. O `+55` segue
  // adiante, pela regra brasileira
  if (comecaComMais(bruto) && !digitos.startsWith(DDI)) {
    return INTERNACIONAL.test(digitos) ? `+${digitos}` : null
  }

  // só descasca o DDI quando o comprimento SÓ se explica com ele (12/13 dígitos): o DDD 55 do RS
  // não é o código do país
  const nacional = digitos.length >= 12 && digitos.startsWith(DDI) ? digitos.slice(2) : digitos
  const partes = /^(\d{2})(\d{8,9})$/.exec(nacional)
  if (partes === null) {
    return null
  }

  const ddd = partes[1] as string
  const assinante = partes[2] as string
  if (Number(ddd) < 11) {
    return null
  }

  // 9 dígitos: celular, sempre iniciado em 9. 8 dígitos: fixo (2–5) ou celular antigo (6–9)
  const valido = assinante.length === 9 ? assinante.startsWith('9') : Number(assinante[0]) >= 2

  return valido ? `+${DDI}${ddd}${assinante}` : null
}

/**
 * Os 67 DDDs que EXISTEM no Brasil, pelo plano de numeração da Anatel (Regulamento de Numeração do
 * STFC, códigos nacionais 11 a 99). Só servem ao aviso do número ambíguo: a regra do lembrete é a do
 * servidor (DDD de 11 em diante), e esta lista não entra nela. Não existem 20, 23, 25, 26, 29, 30, 36,
 * 39, 40, 50, 52, 56 a 60, 70, 72, 76, 78, 80 e 90.
 */
const DDDS_DO_BRASIL: ReadonlySet<string> = new Set([
  '11', '12', '13', '14', '15', '16', '17', '18', '19',
  '21', '22', '24', '27', '28',
  '31', '32', '33', '34', '35', '37', '38',
  '41', '42', '43', '44', '45', '46', '47', '48', '49',
  '51', '53', '54', '55',
  '61', '62', '63', '64', '65', '66', '67', '68', '69',
  '71', '73', '74', '75', '77', '79',
  '81', '82', '83', '84', '85', '86', '87', '88', '89',
  '91', '92', '93', '94', '95', '96', '97', '98', '99',
])

/** O número com `+` lido como brasileiro, sem o `+`. */
interface LeituraBrasileira {
  ddd: string
  /** O assinante de 8 dígitos começando por 6 a 9: o celular de antes do nono dígito */
  celularAntigo: boolean
}

/** Os dígitos do valor com `+`, sem ele, pela regra brasileira — com DDD que existe; `null` se não. */
function lidoComoDoBrasil(valor: string): LeituraBrasileira | null {
  const digitos = valor.replace(/\D+/g, '')
  if (!comecaComMais(valor) || digitos.startsWith(DDI)) {
    return null
  }

  // a regra brasileira inteira devolve `+55DD` e o assinante
  const forma = normalizar(digitos)
  const ddd = forma?.slice(3, 5)
  if (forma === null || ddd === undefined || !DDDS_DO_BRASIL.has(ddd)) {
    return null
  }
  const assinante = forma.slice(5)

  return { ddd, celularAntigo: assinante.length === 8 && Number(assinante[0]) >= 6 }
}

/**
 * O número com `+` que TAMBÉM é um telefone do Brasil pela regra de antes (gates r1 e r2 do
 * telefone-estrangeiro): `+11 98765-4321` era um celular de São Paulo com o `+` na frente, e agora é
 * lido como um número de +1. Devolve o DDD quando os dígitos, sem o `+`, são um celular ou fixo
 * brasileiro com DDD que existe; `null` quando não são.
 *
 * O celular de 8 dígitos (6 a 9), de antes do nono dígito, também conta — é o legado que o
 * `telefones:conferir-mais` lista, e a ficha que ele aponta não pode dizer "WhatsApp: +2187654321"
 * (gate r2). Mas só quando a leitura de fora NÃO tem aviso de tamanho: o celular inglês com dois
 * dígitos a menos (`+44 7700 9001`) tem a forma de um número antigo de Maringá, e o que ajuda ali é
 * "Faltam 2 dígitos".
 *
 * Os números de fora que caem aqui — medidos por esta função sobre cada país da lista da tela (gate
 * r2). A ambiguidade é real, e o aviso não bloqueia nada: quem cadastra a família de fora sabe que
 * ela não é do Brasil, e a conferência do número repetido continua ligada.
 * - SEMPRE: o celular do Peru (`+51 9…`; 51 é Porto Alegre); todo número de 8 dígitos de Cuba (`+53`,
 *   Pelotas), da Dinamarca (`+45`, Foz do Iguaçu) e da Noruega (`+47`, Joinville); o fixo de 8
 *   dígitos da Bélgica (`+32`, Juiz de Fora) e da Nova Zelândia (`+64`, Goiás).
 * - EM PARTE: o celular russo `+7 99…` e o fixo de Moscou `+7 499…` (79 e 74 são DDDs, e o resto tem
 *   a forma do celular de 9 dígitos); o fixo espanhol `+34 9…` e o francês `+33 9…`.
 * - NUNCA: onde o código não forma DDD — o Chile (`+56`) — e o +1 dos Estados Unidos e do Canadá,
 *   que só cairia com código de área N9X, que lá não existe.
 */
export function dddDoBrasilComMais(valor: string): string | null {
  const leitura = lidoComoDoBrasil(valor)
  if (leitura === null) {
    return null
  }

  const pais = leitura.celularAntigo ? paisEstrangeiroDoValor(valor) : null

  return pais !== null && conferirTamanho(valor, pais) !== null ? null : leitura.ddd
}

/**
 * O valor depois de escolher outro país na lista. Escolher o Brasil num número cujos dígitos são um
 * telefone brasileiro tira só o `+` (gates r1 e r2): tirar o "+1" de `+11 8765-4321` comeria o DDD, e
 * tirar o "+47" de `+47 8765-4321`, o DDD inteiro. Vale também quando o aviso era o de tamanho:
 * guardar os dígitos nunca perde nada, e quem escolheu o Brasil vê o número inteiro para conferir.
 */
export function escolherPais(valor: string, para: string): string {
  return paisPelaSigla(para)?.codigo === DDI && lidoComoDoBrasil(valor) !== null
    ? semOMais(valor)
    : trocarDePais(valor, para)
}

/** Só a forma brasileira começa por `+55`. */
function estrangeira(forma: string): boolean {
  return !forma.startsWith(`+${DDI}`)
}

/** O que o campo diz do número digitado: a forma que recebe a mensagem, e se é celular ou fixo. */
export function lerTelefone(valor: string): LeituraDoTelefone {
  const forma = normalizar(valor)
  if (forma === null) {
    return NADA
  }
  // de fora do país não se sabe se é fixo: para o lembrete e os avisos, é celular
  if (estrangeira(forma)) {
    return { forma, tipo: 'celular' }
  }

  const assinante = forma.slice(5)
  const fixo = assinante.length === 8 && Number(assinante[0]) <= 5

  return { forma, tipo: fixo ? 'fixo' : 'celular' }
}

/**
 * `+5549991234567` → `+55 (49) 99123-4567`, a mesma máscara da cobrança pelo WhatsApp. O número de
 * fora sai como a forma (`+447700900123`) — a regra é a do `telefoneLegivel`, num lugar só: sem a
 * tabela de cada país, separar o código do resto é chute, e um espaço no lugar errado faz o número
 * parecer de outro país.
 */
export function formaLegivel(forma: string): string {
  return telefoneLegivel(forma.replace(/^\+/, ''))
}

/** O que o campo de telefone diz abaixo dele. */
export interface AvisoDoTelefone {
  /** o número não chega — desenhado como alerta (ícone + cor) */
  alerta: boolean
  /** pede ação, e por isso é ANUNCIADO ao sair do campo (inválido, fixo); "WhatsApp: …" não é */
  anunciar: boolean
  /**
   * a tela interna pergunta se o número está em outro paciente: o que chega, o fixo e o ambíguo com o
   * Brasil (gate r2 — o ambíguo é alerta, mas o número é inteiro); o inválido e o de tamanho errado,
   * não
   */
  perguntarSeRepete: boolean
  texto: string
}

/**
 * Os tipos de contato que são telefone — cópia de `ContatoNormalizado::TIPOS_TELEFONICOS`, conferida
 * pelo teste de contrato contra a mesma fixture (gate r1, CR-TEL-10).
 */
export const TIPOS_TELEFONICOS: readonly string[] = ['telefone', 'celular', 'whatsapp']

/** O número com `+` que também é do Brasil. Escolher o Brasil já tira o `+` (gate r2). */
function textoDoAmbiguo(ddd: string): string {
  return `Este número também é um telefone do Brasil (DDD ${ddd}). Se for do Brasil, escolha Brasil no país do telefone.`
}

/** O número brasileiro que não chega. */
export const TEXTO_DO_INVALIDO = 'Este número não recebe WhatsApp. Confira o DDD e a quantidade de dígitos.'

/**
 * O número sem `+` comprido demais para ser do Brasil (change telefone-estrangeiro): pode ser de
 * outro país digitado sem o código, e o caminho é a escolha do país, que põe o `+` e o código.
 * Ainda pode ser um brasileiro com dígito a mais (`44 7712-345678` é DDD 44, do Paraná), e por isso
 * o DDD continua na frase.
 */
export const TEXTO_DO_QUE_PARECE_DE_FORA =
  'Este número não recebe WhatsApp. Confira o DDD e os dígitos ou, se for de outro país, escolha o país antes do número (o + e o código entram sozinhos).'

/** Com `+` e um código que não é o do Brasil, mas sem o tamanho de um número internacional. */
export const TEXTO_DO_CODIGO_INVALIDO = 'Este número não recebe WhatsApp. Confira o código do país e a quantidade de dígitos.'

/** Mais de 11 dígitos sem `+` e sem o 55 na frente: o brasileiro com DDI (`55 49912-3456`) não entra. */
function pareceDeFora(valor: string): boolean {
  const digitos = valor.replace(/\D+/g, '')

  return !comecaComMais(valor) && digitos.length > 11 && !digitos.startsWith(DDI)
}

/** "Falta 1 dígito", "Faltam 2 dígitos", "Sobra 1 dígito"… */
function contagem(numero: number, verbo: 'Falta' | 'Sobra'): string {
  return numero === 1 ? `${verbo} 1 dígito` : `${verbo}m ${String(numero)} dígitos`
}

/** "10", "10 ou 11", "de 8 a 10". */
function faixa([minimo, maximo]: readonly [number, number]): string {
  if (minimo === maximo) {
    return String(minimo)
  }

  return maximo === minimo + 1 ? `${String(minimo)} ou ${String(maximo)}` : `de ${String(minimo)} a ${String(maximo)}`
}

/**
 * O tamanho do número para o país do `+código` (tarefa 1.3b): o 0 da ligação nacional que entrou
 * depois do código, ou os dígitos que faltam ou sobram. `null` = o tamanho é o do país.
 *
 * É ajuda da TELA: a forma canônica continua a do servidor, que não conhece país — um número com
 * dígito a menos pode até ter forma E.164, e é justamente o que vai para a pessoa errada.
 */
function conferirTamanho(valor: string, pais: PaisDoTelefone): string | null {
  const depois = digitosDepoisDoCodigo(valor, pais)
  const [minimo, maximo] = pais.digitos
  const umNumero = `um número ${pais.de} ${pais.nome} tem ${faixa(pais.digitos)} depois do +${pais.codigo}`

  if (depois.startsWith('0') && pais.zeroFazParte !== true) {
    return `Tire o 0 do começo do número: com o +${pais.codigo} na frente, ele não entra.`
  }
  if (depois.length < minimo) {
    return `${contagem(minimo - depois.length, 'Falta')}: ${umNumero}.`
  }
  if (depois.length > maximo) {
    return `${contagem(depois.length - maximo, 'Sobra')}: ${umNumero}.`
  }

  return null
}

/** Por que o número não chega, com a pista que serve àquele jeito de digitar. */
function textoDoInvalido(valor: string): string {
  if (comecaComMais(valor) && !valor.replace(/\D+/g, '').startsWith(DDI)) {
    return TEXTO_DO_CODIGO_INVALIDO
  }

  return pareceDeFora(valor) ? TEXTO_DO_QUE_PARECE_DE_FORA : TEXTO_DO_INVALIDO
}

/**
 * O aviso do campo (design D2): para onde a mensagem vai, que um fixo só chega se tiver WhatsApp,
 * ou que o número não recebe. `null` para e-mail e para o campo vazio — campo vazio não é erro de
 * digitação, e a régua do cadastro é quem diz se ele é obrigatório.
 *
 * O número de outro país da lista ganha antes a conferência do tamanho daquele país (change
 * telefone-estrangeiro); o país vem do próprio `+código`, então o aviso é o mesmo com o país
 * escolhido na lista ou com o código digitado em "Outro país".
 */
export function avisoDoTelefone(valor: string, tipo = 'celular'): AvisoDoTelefone | null {
  if (!TIPOS_TELEFONICOS.includes(tipo) || valor.trim() === '') {
    return null
  }

  // antes do tamanho do país: `+11 3333-4444` (um fixo de São Paulo) faltaria um dígito para os EUA,
  // e o que ajuda é dizer que ele é do Brasil
  const ddd = dddDoBrasilComMais(valor)
  if (ddd !== null) {
    return { alerta: true, anunciar: true, perguntarSeRepete: true, texto: textoDoAmbiguo(ddd) }
  }

  const pais = paisEstrangeiroDoValor(valor)
  const tamanho = pais === null ? null : conferirTamanho(valor, pais)
  if (tamanho !== null) {
    return { alerta: true, anunciar: true, perguntarSeRepete: false, texto: tamanho }
  }

  const leitura = lerTelefone(valor)
  if (leitura.forma === null) {
    return { alerta: true, anunciar: true, perguntarSeRepete: false, texto: textoDoInvalido(valor) }
  }
  if (leitura.tipo === 'fixo') {
    return {
      alerta: false,
      anunciar: true,
      perguntarSeRepete: true,
      texto: 'Telefone fixo: o lembrete só chega se este número tiver WhatsApp.',
    }
  }

  return { alerta: false, anunciar: false, perguntarSeRepete: true, texto: `WhatsApp: ${formaLegivel(leitura.forma)}` }
}

/**
 * O alerta de número repetido em TEXTO corrido — o que a região de status anuncia. A tela desenha a
 * mesma frase com os nomes como links (`SobreOTelefone`); as duas saem daqui para não divergirem.
 */
export function fraseDoRepetido(repetido: TelefoneEmUso): string {
  const nomes = repetido.tambem_em.map((outro) => (outro.ativo ? outro.nome : `${outro.nome} (inativo)`))
  const mais = repetido.total > repetido.tambem_em.length ? ` e mais ${String(repetido.total - repetido.tambem_em.length)}` : ''

  return `${INICIO_DO_REPETIDO} ${nomes.join(', ')}${mais}. ${FIM_DO_REPETIDO}`
}

export const INICIO_DO_REPETIDO = 'Este número também está no cadastro de:'

export const FIM_DO_REPETIDO = 'Irmãos podem dividir o telefone. Confira se é a mesma família.'
