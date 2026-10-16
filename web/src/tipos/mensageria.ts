import type { PacienteDoCard } from '@/tipos/agenda'

/**
 * O canal de WhatsApp (change mensageria-whatsapp).
 *
 * Da criança só chega o whitelist mínimo (id/nome/nome_social — `PacienteDoCard`) — a aba fica aberta o dia
 * inteiro num balcão de recepção, à vista de quem passa.
 */

export type EstadoDaConexao = 'nao_conectado' | 'conectado' | 'invalido'

export type FiltroDeConversas = 'ativas' | 'nao_lidas' | 'nao_vinculadas' | 'arquivadas'

export type StatusDeMensagem = 'pendente' | 'enviada' | 'entregue' | 'lida' | 'falhou' | 'recebida'

export interface Conversa {
  id: number
  telefone: string
  nome_perfil: string | null
  paciente: PacienteDoCard | null
  nao_lidas: number
  sem_lembretes: boolean
  arquivada: boolean
  /** instante em que a janela de 24h expira; `null` = nunca houve mensagem recebida */
  janela_expira_em: string | null
  janela_aberta: boolean
  ultima_mensagem_em: string | null
  /** trecho da última mensagem — só na LISTA (o centro de notificações não traz teor) */
  trecho?: string | null
}

export interface MidiaDaMensagem {
  id: number
  mime: string
  tamanho: number
  /** `false` depois do expurgo da retenção — o arquivo some, a linha permanece */
  disponivel: boolean
}

/**
 * Os tipos que o servidor grava (`Mensagem::TIPOS`). `botao` é o toque da família num botão de
 * resposta rápida (change lembrete-com-botoes-de-resposta): o corpo é o texto do botão.
 *
 * Os da change conversa-legivel, e o que o `corpo` carrega em cada um:
 * - `reacao`: o emoji; nulo = a família TIROU a reação;
 * - `figurinha`: nulo — a figurinha vem em `midia`, como uma foto;
 * - `localizacao`: nome e endereço, um por linha (nulo quando é só o pino); o link é `mapa_url`;
 * - `contato`: um contato por linha, "Nome — telefone".
 *
 * A lista NÃO é fechada na prática: um tipo que o servidor venha a gravar antes de a tela
 * conhecê-lo cai no tratamento de `nao_suportado` — nunca numa bolha vazia.
 */
type TipoDeMensagem =
  | 'texto'
  | 'imagem'
  | 'audio'
  | 'documento'
  | 'video'
  | 'template'
  | 'botao'
  | 'reacao'
  | 'figurinha'
  | 'localizacao'
  | 'contato'
  | 'nao_suportado'

export interface Mensagem {
  id: number
  direcao: 'recebida' | 'enviada'
  tipo: TipoDeMensagem
  corpo: string | null
  template_nome: string | null
  status: StatusDeMensagem
  erro_motivo: string | null
  /** enviada pelo disparo do sistema, não por uma pessoa */
  automatica: boolean
  enviada_por: number | null
  /** conteúdo apagado pela retenção; a linha do tempo permanece */
  expurgada: boolean
  midia: MidiaDaMensagem | null
  /**
   * O link do mapa de uma `localizacao`, MONTADO PELO SERVIDOR a partir de coordenadas
   * validadas — o texto da família nunca vira link. Nulo em qualquer outro tipo, e numa
   * localização sem coordenada.
   */
  mapa_url: string | null
  /**
   * O `type` CRU da Meta, para diagnóstico e para a tela dizer o que houve com o que não chega:
   * no não suportado vem como `unsupported:<subtipo>` (`unsupported:edit`,
   * `unsupported:poll_creation`). Nulo nas enviadas e nas recebidas antes da change.
   */
  tipo_original: string | null
  em: string | null
}

export interface ThreadDaConversa {
  conversa: Conversa
  /** há mensagens mais antigas que as carregadas — a thread vem em janela, não inteira */
  tem_anteriores: boolean
  mensagens: Mensagem[]
}

export interface ListaDeConversas {
  conexao: EstadoDaConexao
  conversas: Conversa[]
  pagina: number
  ultima_pagina: number
  total: number
}

export interface TemplateDeMensagem {
  nome: string
  idioma: string
  categoria: string | null
  corpo: string | null
  /** chaves `{{n}}` do corpo, em ordem — a tela cobra todas antes de deixar enviar */
  variaveis: string[]
  aprovado: boolean
  sincronizado_em: string | null
}

/**
 * O que a tela de conexão mostra. NUNCA traz o segredo: só os 4 últimos caracteres do
 * token, o suficiente para confirmar QUAL credencial está em uso.
 */
export interface ConexaoWhatsapp {
  estado: EstadoDaConexao
  phone_number_id: string | null
  waba_id: string | null
  numero_exibicao: string | null
  token_final: string | null
  ultimo_teste_em: string | null
  ultimo_erro: string | null
  /** a URL que a clínica cola no painel da Meta */
  webhook_url: string
}

export interface PayloadDaConexao {
  phone_number_id: string
  waba_id: string
  access_token: string
  app_secret: string
  verify_token: string
}

export type PayloadDeEnvio =
  | { tipo: 'texto'; corpo: string }
  | { tipo: 'template'; template: string; variaveis: Record<string, string> }
