import { CATALOGOS_DE_APOIO } from '@/lib/catalogos'
import { useAuthStore } from '@/stores/auth-store'

/** Onde se resolve um pré-requisito, e quem consegue resolver lá. */
export interface CaminhoDoCadastro {
  rota: string
  /** O link dentro de uma frase: "Cadastrar em Cadastros › Contas" */
  rotulo: string
  /** O botão de um estado vazio: "Cadastrar conta" */
  rotuloCurto: string
  /**
   * O caminho em TEXTO, sem link, para quem pode resolver mas está num formulário longo que não guarda
   * o que foi digitado — seguir o link apagaria tudo (design D7): "Cadastre em Cadastros › Contas."
   */
  instrucao: string
  /** Para quem não tem a permissão: a quem pedir, e o quê */
  pedido: string
  /**
   * TODAS as permissões de que a pessoa precisa para resolver lá: o `ver` que o guarda da rota (ou a
   * leitura da tela) exige E o `criar`/`editar` da ação. "Criar" não implica "ver" nos níveis da
   * clínica, e com uma faltando o link leva a uma tela bloqueada (gate CR-AVI-01).
   */
  permissoes: readonly string[]
}

const PEDIDO_DE_CADASTRO = 'Peça a quem administra o sistema para cadastrar.'

/** Um catálogo de apoio, pela mesma lista que monta a navegação e o índice de cadastros. */
function doCatalogo(modulo: string, rotuloCurto: string): CaminhoDoCadastro {
  const catalogo = CATALOGOS_DE_APOIO.find((candidato) => candidato.modulo === modulo)
  if (catalogo === undefined) {
    throw new Error(`Catálogo de apoio desconhecido: ${modulo}`)
  }

  return {
    rota: catalogo.rota,
    rotulo: `Cadastrar em Cadastros › ${catalogo.rotulo}`,
    rotuloCurto,
    instrucao: `Cadastre em Cadastros › ${catalogo.rotulo}.`,
    pedido: PEDIDO_DE_CADASTRO,
    permissoes: [`${modulo}.ver`, `${modulo}.criar`],
  }
}

/** Os cadastros e configurações de que alguma ação do sistema depende (change `o-sistema-avisa-o-que-falta`, D1). */
export const CAMINHOS = {
  conta: doCatalogo('contas', 'Cadastrar conta'),
  categoria: doCatalogo('categorias', 'Cadastrar categoria'),
  tipoPagamento: doCatalogo('tipos_pagamento', 'Cadastrar forma de pagamento'),
  especialidade: doCatalogo('especialidades', 'Cadastrar especialidade'),
  convenio: doCatalogo('convenios', 'Cadastrar convênio'),
  // o termo se PUBLICA (o aceite só é cobrado do termo publicado) — "cadastrar" dizia o verbo errado
  termo: {
    ...doCatalogo('termos_consentimento', 'Publicar termo'),
    rotulo: 'Publicar em Cadastros › Termo de consentimento',
    instrucao: 'Publique em Cadastros › Termo de consentimento.',
    pedido: 'Peça a quem administra o sistema para publicar o termo.',
  },
  modeloDeAnamnese: doCatalogo('anamnese_modelos', 'Cadastrar modelo de anamnese'),
  profissional: {
    rota: '/profissionais',
    rotulo: 'Cadastrar em Profissionais',
    rotuloCurto: 'Cadastrar profissional',
    instrucao: 'Cadastre em Profissionais.',
    pedido: PEDIDO_DE_CADASTRO,
    permissoes: ['profissionais.ver', 'profissionais.criar'],
  },
  configuracoes: {
    rota: '/configuracoes',
    rotulo: 'Abrir Configurações',
    rotuloCurto: 'Abrir Configurações',
    instrucao: 'Configure em Configurações.',
    pedido: 'Peça a quem administra o sistema para configurar.',
    permissoes: ['configuracoes.ver', 'configuracoes.editar'],
  },
  // os três abaixo são os caminhos do bloco "Para os números ficarem certos" dos Indicadores (change
  // inicio-dos-indicadores, D6): o horário de atendimento se cadastra na ficha, a partir da lista
  horarioDoProfissional: {
    rota: '/profissionais',
    rotulo: 'Cadastrar os horários em Profissionais',
    rotuloCurto: 'Cadastrar horários',
    instrucao: 'Cadastre os horários em Profissionais.',
    pedido: 'Peça a quem administra o sistema para cadastrar os horários.',
    permissoes: ['profissionais.ver', 'profissionais.editar'],
  },
  baixaNaAgenda: {
    rota: '/agenda',
    rotulo: 'Dar baixa na Agenda',
    rotuloCurto: 'Abrir a agenda',
    instrucao: 'Dê baixa na Agenda.',
    pedido: 'Peça a quem atende para dar baixa nas sessões.',
    permissoes: ['agenda.ver', 'agenda.editar'],
  },
  inicioDosIndicadores: {
    rota: '/configuracoes',
    // espaços que não quebram em volta do "›": a 390 px, "› Clínica" caía sozinho na linha de baixo
    rotulo: 'Mudar em Configurações\u00a0›\u00a0Clínica',
    rotuloCurto: 'Abrir Configurações',
    instrucao: 'Mude em Configurações › Clínica.',
    pedido: 'Quem administra o sistema muda essa data.',
    permissoes: ['configuracoes.ver', 'configuracoes.editar'],
  },
  whatsapp: {
    rota: '/configuracoes/whatsapp',
    rotulo: 'Abrir Configurações › WhatsApp',
    rotuloCurto: 'Abrir Configurações › WhatsApp',
    instrucao: 'Configure em Configurações › WhatsApp.',
    pedido: 'Peça a quem administra o WhatsApp da clínica.',
    permissoes: ['mensagens.conectar'],
  },
} as const satisfies Record<string, CaminhoDoCadastro>

/** A ficha do profissional — onde se escolhem as especialidades que ele atende. */
export function caminhoDaFichaDoProfissional(profissionalId: number): CaminhoDoCadastro {
  return {
    rota: `/profissionais/${profissionalId}`,
    rotulo: 'Abrir a ficha do profissional',
    rotuloCurto: 'Abrir a ficha do profissional',
    instrucao: 'Complete a ficha dele em Profissionais.',
    pedido: 'Peça a quem administra o sistema para completar a ficha do profissional.',
    // a ficha se autoguarda por `profissionais.ver`, e as caixas de especialidade vêm de `/api/especialidades`
    permissoes: ['profissionais.ver', 'profissionais.editar', 'especialidades.ver'],
  }
}

/**
 * O pacote mora no cadastro da criança: a tela lê o paciente (`pacientes.ver`), a rota exige editá-lo,
 * e o bloco dos pacotes só aparece com `tratamentos.ver` — cadastrar pede `tratamentos.criar`.
 */
export function caminhoDoPacoteDoPaciente(pacienteId: number): CaminhoDoCadastro {
  return {
    rota: `/pacientes/${pacienteId}/editar`,
    rotulo: 'Cadastrar o pacote no cadastro da criança',
    rotuloCurto: 'Cadastrar pacote',
    instrucao: 'Cadastre o pacote no cadastro da criança.',
    pedido: 'Peça a quem administra o sistema para cadastrar o pacote.',
    // + os três catálogos que o "Novo tratamento" lê: sem eles os seletores ficam vazios (gate CR-AVI-R2-02)
    permissoes: [
      'pacientes.ver',
      'pacientes.editar',
      'tratamentos.ver',
      'tratamentos.criar',
      'convenios.ver',
      'especialidades.ver',
      'profissionais.ver',
    ],
  }
}

/** A pessoa consegue resolver o pré-requisito? Só com TODAS as permissões que a rota pede. */
export function usePodeResolver(caminho: CaminhoDoCadastro): boolean {
  return useAuthStore((estado) => caminho.permissoes.every((permissao) => estado.temPermissao(permissao)))
}
