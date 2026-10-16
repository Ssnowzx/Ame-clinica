// Administração da clínica (§12/§13) — usuários, níveis de permissão e configurações.
// O tipo `Usuario` vive no índice (`tipos/index.ts`), consumido em toda a app.

/** Nível de permissão da clínica (role do Spatie) — a lista traz o conjunto completo. */
export interface NivelPermissao {
  id: number
  nome: string
  /** Lista plana `modulo.acao` que o nível concede. */
  permissoes: string[]
  /** Quantos usuários carregam este nível — governa se ele pode ser excluído. */
  usuarios_count?: number
  /** token da concorrência otimista (If-Match) */
  updated_at: string
}

export interface PayloadNivel {
  nome: string
  /** O conjunto COMPLETO de permissões (o servidor faz sync — round-trip integral). */
  permissoes: string[]
}

export interface PayloadUsuario {
  nome: string
  email: string
  /** Só entra no payload quando preenchida (criação exige; edição redefine). */
  senha?: string
  acesso_mobile?: boolean
  ativo?: boolean
  /** `null` desvincula; ausente preserva o vínculo atual (contrato `sometimes`). */
  profissional_id?: number | null
}

/** Tipos de widget que o catálogo de configurações declara. */
export type TipoConfiguracao = 'string' | 'bool' | 'int'

/** Formatos de string que pedem input dedicado. */
/**
 * `mensagem_cobranca` (change `cobranca-pelo-whatsapp`): texto longo com marcas, que ganha o
 * widget da prévia — decidido pelo FORMATO que o catálogo publica, nunca pela chave.
 *
 * `status` e `status_que_libera` (change `lembrete-com-botoes-de-resposta`): o valor é o id de um
 * status da clínica, escolhido numa LISTA pelo nome — nunca digitado como número interno. O
 * segundo só oferece status que liberam o horário.
 *
 * `status_que_finaliza` (change `evolucao-finaliza-a-sessao`): o status que salvar a evolução aplica.
 * Só oferece status que desconta a sessão, segura o horário e não é falta — os que FINALIZAM.
 */
export type FormatoConfiguracao =
  | 'hora'
  | 'date'
  | 'timezone'
  | 'mensagem_cobranca'
  | 'status'
  | 'status_que_libera'
  | 'status_que_finaliza'

/**
 * Uma configuração efetiva da clínica, com os metadados que o catálogo expõe (SEC-ADM-06).
 *
 * Dois grupos, com regras diferentes de propósito: `rotulo` e `secao` são **obrigatórios**
 * — é o que impede a tela de ter fallback e voltar a inventar rótulo, como quando as chaves
 * `whatsapp.*` chegaram cruas à tela da clínica. Os de widget seguem opcionais, presentes só
 * quando definidos.
 */
export interface Configuracao {
  chave: string
  /** O nome que a clínica lê, em pt-BR. Vem do catálogo do servidor, nunca do front. */
  rotulo: string
  /** Slug da aba onde a chave aparece. Não é o prefixo da chave. */
  secao: string
  /** Slug do subtítulo dentro da aba. Derivado do prefixo NO SERVIDOR — a tela não reparte chave. */
  bloco: string
  tipo: TipoConfiguracao
  valor: string | number | boolean
  min?: number
  max?: number
  opcoes?: string[]
  formato?: FormatoConfiguracao
  /** A frase sob o campo, quando o rótulo sozinho não diz o efeito — do catálogo, nunca do front */
  ajuda?: string
}

/** Uma aba da tela de configurações. A ORDEM da lista é a ordem das abas. */
export interface SecaoDeConfiguracao {
  secao: string
  rotulo: string
}

/** Um subtítulo dentro de uma aba. A ORDEM da lista é a ordem dos subtítulos. */
export interface BlocoDeConfiguracao {
  bloco: string
  rotulo: string
}

/** O que `GET /configuracoes` devolve: as chaves, as abas e os subtítulos. */
export interface LeituraDeConfiguracoes {
  configuracoes: Configuracao[]
  secoes: SecaoDeConfiguracao[]
  blocos: BlocoDeConfiguracao[]
}

/**
 * Status que não desconta sessão — o alvo elegível do encadeamento e dos ponteiros de status das
 * Configurações (formatos `status` e `status_que_libera`).
 */
export interface AlvoEncadeamento {
  id: number
  nome: string
  /**
   * Segura o horário? O ponteiro `status_que_libera` só oferece quem LIBERA. Ausente (payload
   * anterior) não é oferecido nesse ponteiro: na dúvida, o status fica de fora da lista.
   */
  ocupa_horario?: boolean
}

/** Status que FINALIZA a sessão (desconta, segura o horário, não é falta) — a lista do formato `status_que_finaliza`. */
export interface StatusQueFinaliza {
  id: number
  nome: string
}

/** O que `GET /configuracoes/alvos-encadeamento` devolve: as duas listas dos ponteiros de status. */
export interface ListasDeStatus {
  alvos: AlvoEncadeamento[]
  finalizam: StatusQueFinaliza[]
}

/** Pendência do maker-checker de acesso (AP-13) — o payload é o PROPOSTO, não o vigente. */
export interface AprovacaoDeAcesso {
  id: number
  tipo: 'editar_nivel' | 'atribuir_nivel' | 'configurar_seguranca'
  alvo: { id: number; rotulo: string }
  payload: Record<string, unknown>
  solicitante: { id: number; nome: string } | null
  status: 'pendente' | 'aprovada' | 'recusada' | 'cancelada'
  decidido_por: { id: number; nome: string } | null
  decidido_em: string | null
  criado_em: string | null
  /**
   * A régua do decisor para quem lê (change `trava-de-usuarios-e-niveis`): só aprova quem tem o acesso
   * em jogo. Calculado pelo SERVIDOR — a tela não repete a regra.
   */
  voce_pode_aprovar: boolean
}

/**
 * Resultado de uma mutação GOVERNADA pelo maker-checker: com a aprovação dupla
 * ligada o servidor responde 202 e NADA aplicou — a tela avisa "enviada para
 * aprovação" e o estado vigente permanece (tratar 202 como sucesso mentiria).
 */
export type ResultadoDeMutacaoGovernada<T> =
  | { aplicado: true; dados: T }
  | { aplicado: false; aprovacao: AprovacaoDeAcesso }

/*
 * A RÉGUA DO CADASTRO (capability `campos-do-cadastro`).
 *
 * Rótulo, seção e travas vêm do SERVIDOR: nenhuma tela mantém esse dicionário por conta
 * própria — foi lista à mão que deixou texto de máquina chegar ao usuário em produção.
 */

/** Os três estados que se excluem. A API os representa em dois booleanos. */
export type EstadoDoCampo = 'obrigatorio' | 'opcional' | 'oculto'

/** Chaves da régua que têm efeito hoje (`rapido` segue declarada e inerte — change 3 da cadeia). */
export type ChaveDaRegua = 'obrigatorio' | 'desabilitado' | 'online'

export interface CampoDaRegua {
  campo: string
  rotulo: string
  secao: string
  /** Campo-coleção (responsáveis, contatos): obrigatório significa "ao menos um". */
  lista: boolean
  obrigatorio: boolean
  desabilitado: boolean
  /**
   * O campo entra no formulário público de auto-cadastro (change `cadastro-online-do-paciente`).
   * Já vem resolvido pelo servidor: campo escondido nunca chega aqui com `online` verdadeiro.
   */
  online: boolean
  /**
   * O TETO de caracteres do campo, quando ele é de texto — vem do servidor, derivado da mesma
   * declaração que o boundary usa para recusar (change `tetos-do-cadastro-na-tela`).
   *
   * `null` para campo sem teto de texto (data, lista fechada, número) e para campo-lista, cujo
   * `max` conta ITENS. A tela NÃO PODE manter esse número por conta própria: foi a divergência
   * entre o que a tela aceita e o que o servidor recusa que fez a recepção perder uma ficha
   * inteira no salvar.
   */
  tamanho: number | null
  /** Tetos dos subcampos de um campo-lista (`nome`, `parentesco`, `valor`…). */
  tamanhos_dos_itens: Record<string, number>
  /** Chaves que a clínica não pode mexer neste campo. */
  travas: ChaveDaRegua[]
  motivo_trava: string | null
}

export interface SecaoDaRegua {
  secao: string
  rotulo: string
}

export interface ReguaDoCadastro {
  formulario: string
  secoes: SecaoDaRegua[]
  campos: CampoDaRegua[]
}
