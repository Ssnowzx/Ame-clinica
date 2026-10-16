import type { Configuracao, LeituraDeConfiguracoes } from '@/tipos'

/**
 * Fábrica de configuração para teste (change secoes-das-configuracoes).
 *
 * `rotulo`, `secao` e `bloco` passaram a ser obrigatórios: eles vêm do catálogo do servidor,
 * e é essa obrigatoriedade que impede a tela de ter fallback e voltar a mostrar a chave crua.
 * A fábrica existe para o teste declarar só o que importa ao caso, sem repetir os três em
 * cada literal — e sem tentação de afrouxar o tipo para escapar disso.
 *
 * Os defaults de `secao` e `bloco` são **deliberadamente diferentes do prefixo da chave**. Se
 * espelhassem o prefixo — como faziam na primeira versão —, um teste que não declara `secao`
 * continuaria passando caso a tela voltasse a derivar a aba do prefixo, ou seja, provaria zero
 * sobre a tese desta change (achado CR, resposta 5). Quem exercita agrupamento declara.
 */
export function configuracaoFicticia(
  parcial: Partial<Configuracao> & Pick<Configuracao, 'chave'>,
): Configuracao {
  return {
    // o rótulo embute a CHAVE de propósito: teste que busca por rótulo prova que a tela usou
    // `config.rotulo`, e não um fallback para a chave crua
    rotulo: `Rótulo de ${parcial.chave}`,
    // canônicos, mas FIXOS: não derivam do prefixo da chave. Se derivassem, um teste que não
    // declara `secao` continuaria passando caso a tela voltasse a derivar a aba da chave.
    secao: 'clinica',
    bloco: 'clinica',
    tipo: 'string',
    valor: '',
    ...parcial,
  }
}

/**
 * As listas canônicas, com os rótulos de VERDADE.
 *
 * A primeira versão derivava os rótulos capitalizando o slug — e produzia um servidor que não
 * pode existir: `'Comunicacao'` sem acento, e um `<h3>Whatsapp</h3>` renderizado dentro do
 * teste de `axe`. Ou seja: o slug cru virando cabeçalho, que é exatamente o artefato de
 * 2026-08-21 que esta change existe para tornar impossível, reproduzido na suíte que deveria
 * provar que ele acabou (achado CR-IMPORTANTE-5).
 */
export const SECOES_FICTICIAS: LeituraDeConfiguracoes['secoes'] = [
  { secao: 'clinica', rotulo: 'Clínica' },
  { secao: 'agenda', rotulo: 'Agenda' },
  { secao: 'atendimento', rotulo: 'Atendimento' },
  { secao: 'financeiro', rotulo: 'Financeiro' },
  { secao: 'comunicacao', rotulo: 'Comunicação' },
  { secao: 'seguranca', rotulo: 'Segurança' },
]

export const BLOCOS_FICTICIOS: LeituraDeConfiguracoes['blocos'] = [
  { bloco: 'clinica', rotulo: 'Clínica' },
  { bloco: 'cadastro_online', rotulo: 'Cadastro pelo link' },
  { bloco: 'indicadores', rotulo: 'Indicadores' },
  { bloco: 'agenda', rotulo: 'Agenda' },
  { bloco: 'tratamentos', rotulo: 'Tratamentos' },
  { bloco: 'evolucoes', rotulo: 'Evoluções' },
  { bloco: 'financeiro', rotulo: 'Financeiro' },
  { bloco: 'whatsapp', rotulo: 'WhatsApp' },
  { bloco: 'mensagens', rotulo: 'Mensagens' },
  { bloco: 'lembretes', rotulo: 'Lembretes' },
  { bloco: 'notificacoes', rotulo: 'Notificações' },
  { bloco: 'seguranca', rotulo: 'Segurança' },
]

/**
 * A leitura completa. Sem listas explícitas, cai nas CANÔNICAS — nunca em rótulo derivado de
 * slug. Quem exercita divergência (seção ou bloco fora da lista) passa as suas.
 */
export function leituraFicticia(
  configuracoes: Configuracao[],
  secoes: LeituraDeConfiguracoes['secoes'] = SECOES_FICTICIAS,
  blocos: LeituraDeConfiguracoes['blocos'] = BLOCOS_FICTICIOS,
): LeituraDeConfiguracoes {
  return { configuracoes, secoes, blocos }
}

/**
 * O servidor CONTRADIZENDO o próprio catálogo: uma chave cuja `secao` não está na lista
 * `secoes` que ele mesmo publicou.
 *
 * É a hipótese que a aba de exceção existe para cobrir, e as três células que a exercitam
 * repetiam a mesma fixture literal (achado CR r4). Aqui a divergência entre cópias falharia
 * alto — todas clicam na aba "Outros ajustes" —, mas repetir estrutura de fixture é como a
 * quarta cópia da lista canônica nasceu.
 */
export function catalogoQueSeContradiz() {
  return {
    configuracoes: [
      { chave: 'clinica.nome', rotulo: 'Nome da clínica', secao: 'clinica', bloco: 'clinica', valor: 'Clínica' },
      { chave: 'seguranca.aprovacao_dupla', rotulo: 'Exigir aprovação de dois administradores', secao: 'governanca', bloco: 'seguranca', tipo: 'bool' as const, valor: false },
    ],
    secoes: [{ secao: 'clinica', rotulo: 'Clínica' }],
    blocos: [
      { bloco: 'clinica', rotulo: 'Clínica' },
      { bloco: 'seguranca', rotulo: 'Segurança' },
    ],
  }
}
