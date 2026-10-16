import type { FiltroDeInteressados, FiltroDeLancamentos, FiltroDeTratamentos, InteressadoTipo, VisaoAgenda } from '@/tipos'

/**
 * Fábrica única das chaves de query — a change de escrita invalida a agenda por
 * `chaves.agenda()` sem caçar strings soltas pela base.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────
 * A REGRA DA FÁBRICA: **a chave do DETALHE nasce dentro do namespace da LISTA.**
 *
 * `['tratamentos', id]`, nunca `['tratamento', id]`. Enquanto o detalhe era SINGULAR e a
 * invalidação da lista PLURAL, as duas **não eram prefixo uma da outra** — e nenhuma
 * invalidação de lista alcançava o detalhe, em entidade nenhuma. Onde o formulário de edição
 * hidrata `useState` a partir do `useQuery` (e `useState` inicializa UMA vez), reabrir montava
 * sobre o cache VELHO e a segunda edição seguida **revertia a primeira, em silêncio**.
 *
 * Nos tratamentos isso apagou a **matrícula de um menor**. No prontuário apagaria a observação
 * clínica de uma criança — por isso `atendimentos`/`evolucoes` já nasceram assim.
 *
 * Não há colisão entre lista e detalhe: o segundo segmento é um **objeto de filtro** num caso e
 * um **number** no outro. É justamente o namespace comum que faz
 * `invalidateQueries(['tratamentos'])` **alcançar** `['tratamentos', 7]`.
 *
 * O `gcTime: 0` dos formulários de dado sensível PERMANECE — duas defesas independentes.
 * (⚠️ O `updateGcTime` do TanStack faz `Math.max`: o `gcTime` só SOBE. Um segundo observer com o
 * default, ou um `setQueryData` no `onSuccess`, anula o zero em silêncio. Com o prefixo correto,
 * o zero deixou de ser a ÚNICA linha de defesa.)
 *
 * Chave nova → classifique-a em `chaves-query.test.ts` (lista · detalhe · sem-detalhe), ou a
 * suíte reprova. É essa verificação de completude que impede a bomba de ser re-armada em
 * silêncio pela próxima tela.
 * ────────────────────────────────────────────────────────────────────────────────────────
 */
export const chaves = {
  agenda: (parametros?: { de: string; ate: string; profissionalId?: number | null; visao?: VisaoAgenda }) =>
    parametros === undefined ? (['agenda'] as const) : (['agenda', parametros] as const),
  selecaoDaAgenda: () => ['agenda-selecao'] as const,
  selecaoComDesligados: () => ['agenda-selecao', 'com-desligados'] as const,
  pacientesDaBusca: (termo: string) => ['agenda-selecao', 'pacientes', termo] as const,
  // Modos SEPARADOS de propósito (change busca-de-paciente-com-lista): digitar não pode
  // invalidar a lista já rolada, e reabrir a caixa não deve refazer a página já vista.
  pacientesEmLista: () => ['agenda-selecao', 'pacientes-em-lista'] as const,
  pacientesRecentes: () => ['agenda-selecao', 'pacientes-recentes'] as const,
  // NOMEAR um paciente pelo id (modo retorno). Segmento SINGULAR de propósito: não é uma busca
  // com termo numérico, e misturar as duas no mesmo prefixo faria a invalidação de uma alcançar
  // a outra sem que ninguém tivesse decidido isso.
  pacienteDaSelecao: (pacienteId: number) => ['agenda-selecao', 'paciente', pacienteId] as const,
  tratamentosDoPaciente: (pacienteId: number) => ['agenda-selecao', 'tratamentos', pacienteId] as const,
  // a série é um detalhe da AGENDA: invalidar a grade passa a alcançá-la (antes, editar o
  // agendamento deixava a série do diálogo servida pelo cache)
  serieDoAgendamento: (id: number) => ['agenda', 'serie', id] as const,
  // detalhe de UM agendamento (traz a `obs` que o card da grade omite — detail-only)
  agendamentoDetalhe: (id: number) => ['agenda', 'agendamento', id] as const,
  // comparecimento recente de UM paciente (90 dias) — leitura sob demanda do painel;
  // sob o namespace da agenda, então invalidar a grade a alcança
  comparecimentoRecente: (pacienteId: number) => ['agenda', 'comparecimento', pacienteId] as const,
  // agendamentos do paciente na FICHA (próximos + recentes) — mesmo namespace da agenda,
  // então mexer na grade (marcar presença, remarcar) invalida a seção junto
  agendamentosDoPaciente: (pacienteId: number) => ['agenda', 'agendamentos-do-paciente', pacienteId] as const,
  // assiduidade da seção Presença — sob o namespace da agenda (como o comparecimento):
  // marcar falta na grade invalida a agenda e ALCANÇA a assiduidade (SEC-PRES-05)
  presencaDoPaciente: (pacienteId: number) => ['agenda', 'presenca', pacienteId] as const,
  profissionais: () => ['profissionais'] as const,
  especialidades: () => ['especialidades'] as const,
  statusAgendamento: () => ['status-agendamento'] as const,
  feriados: () => ['feriados'] as const,
  configuracaoAgenda: () => ['configuracao-agenda'] as const,
  notificacoes: () => ['notificacoes'] as const,
  listaEspera: () => ['lista-espera'] as const,
  // o TERMO da busca entra na chave (é cache, memória do processo) — mas nunca na
  // URL: nome de menor não vai para histórico, Referer nem log (design D2)
  pacientes: (filtro: { busca: string; ativo?: boolean; pagina: number }) => ['pacientes', filtro] as const,
  // a listagem SEM termo (a caixa de escolha aberta), acumulada por rolagem
  pacientesDoCadastroEmLista: () => ['pacientes', 'em-lista'] as const,
  // a BUSCA da caixa de escolha, separada da busca da TELA de pacientes: as duas mandam o
  // mesmo termo para o mesmo endpoint, mas com `per_page` diferente (20 × 50) — e o
  // `per_page` não entra na chave `pacientes`. Compartilhando o namespace, buscar "ana" na
  // tela e logo depois na caixa servia à caixa as 50 fichas já cacheadas, com `nascimento` e
  // `necessidade`, furando o teto que existe justamente para minimizar (achado SEC-BPL-11).
  // O prefixo `pacientes` é mantido de propósito: a invalidação por prefixo alcança as três.
  pacientesDoCadastroNaBusca: (termo: string) => ['pacientes', 'escolha', termo] as const,
  // o número de outra família no cadastro (change telefone-que-chega-no-whatsapp): a FORMA
  // canônica na chave — escrito com ou sem máscara, é a mesma pergunta. Prefixo `pacientes`: salvar
  // um paciente invalida a resposta, e o alerta reflete o cadastro novo
  telefoneEmUso: (forma: string, ignorarPacienteId: number | null) =>
    ['pacientes', 'telefone-em-uso', forma, ignorarPacienteId] as const,
  paciente: (id: number) => ['pacientes', id] as const,
  // resumo do Painel da ficha — chave de leitura no namespace do paciente (Decisão 4):
  // invalidar `['pacientes']` alcança o resumo; não hidrata form (SEM_DETALHE)
  pacienteResumo: (id: number) => ['pacientes', id, 'resumo'] as const,
  // anexos do paciente (seção da ficha) — leitura de exibição; mutações invalidam a lista
  anexosDoPaciente: (pacienteId: number) => ['pacientes', pacienteId, 'anexos'] as const,
  profissionaisDoCadastro: () => ['profissionais', 'cadastro'] as const,
  // a FICHA do profissional: leitura pura (a edição hidrata do dado por prop no
  // dialog) — prefixo do namespace para a invalidação do editar alcançá-la
  fichaProfissional: (id: number) => ['profissionais', 'ficha', id] as const,
  // o PAINEL do mês na ficha (painel-do-profissional): leitura pura, nenhum formulário hidrata
  // daqui (SEM_DETALHE). Sob `profissionais` de propósito — editar o cadastro invalida o namespace
  // e o painel acompanha; o mês entra na chave: dois meses nunca servem cache um do outro
  painelDoProfissional: (id: number, mes: string) => ['profissionais', 'painel', id, { mes }] as const,
  cbos: () => ['cbos'] as const,
  salas: () => ['salas'] as const,
  equipamentos: () => ['equipamentos'] as const,
  convenios: () => ['convenios'] as const,
  convenio: (id: number) => ['convenios', id] as const,
  servicosDoConvenio: (convenioId: number) => ['convenios', convenioId, 'servicos'] as const,
  // regras de limite do convênio (filha, como os serviços): prefixo do namespace —
  // invalidar `['convenios']` alcança a tabela de regras
  regrasDoConvenio: (convenioId: number) => ['convenios', convenioId, 'regras'] as const,
  // ciclos de faturamento do convênio (change fechamento-de-ciclo): a HISTÓRIA dos
  // fechamentos e o próximo período fechável. Filhas do convênio, como as regras —
  // fechar/reabrir invalida `['convenios', id]` e alcança as duas. SÓ exibição: nenhum
  // formulário hidrata `useState` a partir delas (o motivo da reabertura nasce vazio).
  ciclosDoConvenio: (convenioId: number) => ['convenios', convenioId, 'ciclos'] as const,
  proximoCicloDoConvenio: (convenioId: number) =>
    ['convenios', convenioId, 'ciclos', 'proximo'] as const,
  medicos: () => ['medicos'] as const,
  tratamentos: (filtro: FiltroDeTratamentos) => ['tratamentos', filtro] as const,
  tratamento: (id: number) => ['tratamentos', id] as const,

  /*
   * FINANCEIRO (§9). `lancamento` é DETALHE prefixo-correto: o formulário de edição
   * hidrata `useState` a partir dele para trazer a `obs` (detail-only) — então nasce
   * DENTRO do namespace da lista e o `useQuery` do detalhe declara `gcTime: 0`, como
   * tratamentos/evoluções (gatilho CHAVE-DETALHE). O extrato, os catálogos e as leituras
   * do recibo são SÓ exibição (sem formulário que hidrate) — SEM_DETALHE.
   */
  lancamentos: (filtro: FiltroDeLancamentos) => ['lancamentos', filtro] as const,
  lancamento: (id: number) => ['lancamentos', id] as const,
  // os anexos de UM lançamento (change `anexo-no-lancamento`): filhos do detalhe, como os do
  // paciente — metadados só de exibição, nenhum formulário hidrata daqui
  anexosDoLancamento: (lancamentoId: number) => ['lancamentos', lancamentoId, 'anexos'] as const,
  // a cobrança de UM lançamento (change `cobranca-pelo-whatsapp`): o telefone e a mensagem de
  // cada responsável. Dado de MENOR numa máquina compartilhada — a consulta declara `gcTime: 0`
  cobrancaDoLancamento: (lancamentoId: number) => ['lancamentos', lancamentoId, 'cobranca'] as const,
  // o vínculo conduzido (change vincular-pagamentos-ao-tratamento). A LISTA do lote mora sob os
  // lançamentos: vincular (um a um ou em lote) invalida `['lancamentos']` e a alcança. O segundo
  // segmento é uma palavra, nunca um id nem um objeto de filtro — não colide com a lista nem com o
  // detalhe. A SUGESTÃO fica FORA: ela depende dos tratamentos da criança, não dos lançamentos, e
  // sob `lancamentos` cada gravação do formulário a pedia de novo por nada.
  pagamentosSemTratamento: (periodo: { de: string; ate: string }) =>
    ['lancamentos', 'sem-tratamento', periodo] as const,
  sugestaoDeTratamento: (pacienteId: number) => ['sugestao-de-tratamento', pacienteId] as const,
  fluxoCaixa: (parametros: { de: string; ate: string; contaId?: number }) =>
    ['fluxo-caixa', parametros] as const,
  // o saldo de cada conta hoje (change `saldo-das-contas`) mora SOB o extrato, de propósito: toda
  // escrita que já reconsulta o fluxo (pagar, estornar, faturar, transferir) mexe no saldo também,
  // e `invalidateQueries(['fluxo-caixa'])` alcança os dois sem ninguém lembrar de uma chave nova.
  // O segundo segmento é uma palavra, nunca o objeto de filtro do extrato — não colidem.
  saldosDasContas: () => ['fluxo-caixa', 'saldos'] as const,
  contas: () => ['contas'] as const,
  categorias: () => ['categorias'] as const,
  // a configuração do DRE (change `dre-gerencial`): onde cada categoria cai e o `updated_at` do
  // If-Match. Mora SOB `categorias` de propósito — editar o nome da categoria muda a versão, e a
  // invalidação da lista alcança esta chave; e trocar a linha invalida `categorias` e alcança o
  // formulário do cadastro. O segundo segmento é uma palavra: não colide com lista nem com id
  configuracaoDoDre: () => ['categorias', 'dre'] as const,
  /* Subcategorias são lidas sob chave PRÓPRIA (formato diferente do da lista), mas
     ficam SOB o prefixo `categorias` — assim invalidar a mãe alcança as filhas. */
  subcategoriasDaCategoria: (categoriaId: number) =>
    ['categorias', categoriaId, 'subcategorias'] as const,
  tiposPagamento: () => ['tipos-pagamento'] as const,
  cartoes: () => ['cartoes'] as const,
  // A QUEM A CLÍNICA PAGA (change `caixa-do-dia-a-dia`): listas paginadas com busca no servidor.
  // Sem argumento, a raiz do namespace — é por ela que criar, editar e excluir invalidam todas as
  // páginas e buscas de uma vez. NÃO existe chave de detalhe: a edição relê o cadastro do servidor
  // a cada abertura, sem cache, então não há detalhe velho de onde um formulário hidratar.
  fornecedores: (filtro?: FiltroDeInteressados) =>
    filtro === undefined ? (['fornecedores'] as const) : (['fornecedores', filtro] as const),
  funcionarios: (filtro?: FiltroDeInteressados) =>
    filtro === undefined ? (['funcionarios'] as const) : (['funcionarios', filtro] as const),
  // recibo: identidade da clínica e documento do interessado — leitura pura, gated no chamador
  nomeDaClinica: () => ['clinica-nome'] as const,
  documentoDoInteressado: (tipo: InteressadoTipo, id: number) =>
    ['interessado-documento', tipo, id] as const,

  /*
   * ATENDIMENTO E EVOLUÇÃO — chaves PREFIXO-CORRETAS, de propósito.
   *
   * Todas as chaves acima têm a mesma bomba armada (gatilho CHAVE-DETALHE): o detalhe é
   * SINGULAR (`['tratamento', id]`) e a invalidação da lista é PLURAL (`['tratamentos']`)
   * — não são prefixo um do outro, então nenhuma invalidação de lista alcança o detalhe.
   * Onde o formulário de edição hidrata `useState` a partir do `useQuery`, reabrir monta
   * sobre cache velho e a segunda edição REVERTE a primeira. Nos tratamentos isso apagou a
   * matrícula de um menor.
   *
   * Aqui o dado revertido seria a OBSERVAÇÃO CLÍNICA DE UMA CRIANÇA. Então o detalhe nasce
   * DENTRO do namespace da lista: `invalidateQueries(['evolucoes'])` alcança
   * `['evolucoes', id]`, porque agora é prefixo de verdade.
   */
  atendimentosDoAgendamento: (agendamentoId: number) => ['atendimentos', { agendamentoId }] as const,
  /** A linha do tempo do PRONTUÁRIO da ficha — leitura pura (sem edição): SEM_DETALHE. */
  atendimentosDoPaciente: (pacienteId: number, pagina: number) =>
    ['atendimentos', { pacienteId, pagina }] as const,
  atendimento: (id: number) => ['atendimentos', id] as const,
  evolucoesEmAberto: (filtro: { profissionalId?: number | null; pagina: number }) =>
    ['evolucoes', 'em-aberto', filtro] as const,
  /** A fila de RETORNOS — leitura pura (sem edição): SEM_DETALHE. */
  pendenciasDeRetorno: (filtro: { pagina: number }) => ['pendencias-de-retorno', filtro] as const,
  evolucao: (id: number) => ['evolucoes', id] as const,

  /** Trilha de auditoria de UM agendamento — leitura pura (sem edição): SEM_DETALHE. */
  auditoriaDoAgendamento: (agendamentoId: number) => ['auditoria', 'agendamentos', agendamentoId] as const,
  /** Trilha completa com filtros (auditoria-tela) — leitura pura paginada: SEM_DETALHE. */
  trilhaDeAuditoria: (filtros: Record<string, string | number | undefined>) =>
    ['auditoria', 'trilha', filtros] as const,

  /*
   * ANAMNESE (§7) — dado de saúde de MENOR (art. 11).
   *
   * `anamnese` é DETALHE prefixo-correto (nasce DENTRO do namespace da lista): o
   * `show` traz `respostas_json` e é AUDITADO no servidor. Além do gcTime:0 do gatilho
   * CHAVE-DETALHE, o `useQuery` do detalhe fixa staleTime:0 + retry:false +
   * refetchOnReconnect:false — a trilha `consultou` reflete leitura HUMANA, não render,
   * e uma leitura de prontuário de menor não pode re-disparar sozinha (SEC-ANM-02/03).
   *
   * O form de edição hidrata de PROP (o detalhe já carregado), nunca de um segundo
   * `useQuery` de detalhe; o `onSuccess` do PUT invalida a LISTA e fecha — sem
   * setQueryData semeando a chave. Os modelos são catálogo da clínica (SEM_DETALHE).
   */
  anamnesesDoPaciente: (pacienteId: number) => ['anamneses', { pacienteId }] as const,
  anamnese: (id: number) => ['anamneses', id] as const,
  modelosDeAnamnese: () => ['anamnese-modelos'] as const,

  /*
   * TERMO de consentimento (FA-08). A lista é SÓ exibição (o formulário de publicação
   * nasce vazio; o de correção hidrata do detalhe carregado sob demanda) — SEM_DETALHE
   * no sentido do contrato acima, com uma chave de detalhe própria para o TEXTO, que a
   * lista não traz.
   *
   * `termoVigente` é chave de OUTRO consumidor: o cadastro do paciente, que só precisa
   * saber qual régua está valendo. Fica fora do namespace da lista de propósito — quem
   * registra aceite tem `pacientes.editar` e pode não ter permissão de ver o catálogo,
   * então invalidar um não deve arrastar o outro.
   */
  termos: () => ['termos-consentimento'] as const,
  termo: (id: number) => ['termos-consentimento', id] as const,
  termoVigente: () => ['termo-vigente'] as const,

  /*
   * ADMINISTRAÇÃO DA CLÍNICA (§12). `usuario` é DETALHE prefixo-correto: o formulário de
   * edição hidrata `useState` a partir dele (leitura fresca do servidor), então nasce
   * DENTRO do namespace da lista e o `useQuery` do detalhe declara `gcTime: 0`. Aqui a
   * bomba do cache teria sabor de segurança: um form hidratado de cache velho reverteria
   * `ativo: false` e reativaria um usuário desligado em silêncio (SEC-ADM-10).
   *
   * Níveis/catálogo/configurações/alvos são SÓ exibição (o form de nível hidrata do
   * item da lista por prop; configurações não têm form que hidrate `useState` de detalhe)
   * — SEM_DETALHE.
   */
  usuarios: () => ['usuarios'] as const,
  usuario: (id: number) => ['usuarios', id] as const,
  // pendências do maker-checker (AP-13): SÓ exibição — decidir invalida a lista
  aprovacoesDeAcesso: () => ['aprovacoes-de-acesso'] as const,

  // indicadores do dashboard (§11): agregados SÓ leitura, cada vista sob o módulo
  // dono — vista e mês entram na chave; nada aqui hidrata formulário (SEM_DETALHE)
  indicadores: (
    vista:
      | 'atendimentos'
      | 'pacientes'
      | 'profissionais'
      | 'produtividade'
      // os painéis por frente (indicadores-profissionais): a Visão geral e a aba de detalhe da
      // MESMA frente leem a mesma chave — trocar de aba não busca de novo o que já chegou
      | 'painel-dinheiro'
      | 'painel-agenda'
      | 'painel-pacientes'
      | 'painel-equipe',
    mes: string,
  ) =>
    ['indicadores', vista, { mes }] as const,
  // a tela Gráficos Financeiros: chave PRÓPRIA, nunca a do bloco do painel — as
  // duas leem períodos diferentes do mesmo mês e compartilhar chave faria uma
  // servir cache da outra
  graficosFinanceiros: (mes: string) => ['graficos-financeiros', { mes }] as const,
  // a área de RELATÓRIOS (area-de-relatorios): o índice (slugs e permissões, sem dado) e
  // o resultado de um relatório por slug + recorte. Ambos SÓ exibição — o formulário nasce
  // da URL, nunca do cache; nada hidrata `useState` daqui (SEM_DETALHE). O slug e os
  // parâmetros entram na chave: dois recortes do mesmo relatório nunca servem cache um do outro
  indiceDeRelatorios: () => ['relatorios', 'indice'] as const,
  relatorio: (slug: string, parametros: Record<string, string | undefined>) =>
    ['relatorios', slug, parametros] as const,
  // drill-down das caixas: listas paginadas SÓ leitura (SEM_DETALHE) — origem,
  // filtros por id e página entram na chave
  indicadoresItens: (
    origem: 'agenda' | 'atendimentos',
    filtros: Record<string, number | string | undefined>,
  ) => ['indicadores-itens', origem, filtros] as const,
  niveisPermissao: () => ['niveis-permissao'] as const,
  catalogoPermissoes: () => ['permissoes'] as const,
  configuracoes: () => ['configuracoes'] as const,
  alvosEncadeamento: () => ['alvos-encadeamento'] as const,
  // A RÉGUA DO CADASTRO (campos-do-cadastro): lida por DOIS públicos — a tela de
  // configuração (que a escreve) e o formulário de paciente (que se monta com ela). Chave
  // única por formulário; salvar a régua reescreve esta chave, e o formulário aberto em
  // outra aba se corrige na próxima montagem.
  reguaDoCadastro: (formulario: string) => ['regua-do-cadastro', formulario] as const,
  /** O rascunho de um envio já aceito — a releitura que faz o formulário sobreviver a um F5. */
  rascunhoDoEnvio: (envio: number) => ['rascunho-do-envio', envio] as const,

  /*
   * MURAL DE TAREFAS (kanban-da-equipe). O quadro carrega inteiro (a clínica tem
   * dezenas de tarefas, não milhares) e o modal de edição hidrata do ITEM da lista
   * por prop — sem chave de detalhe que arme a bomba (o precedente é o form de
   * nível). Comentários são exibição + composer que nasce vazio; participantes é
   * catálogo (id+nome). Comentários ficam DENTRO do namespace por FORMA (a regra
   * da fábrica) — mas a página invalida o quadro com `exact: true` de propósito,
   * então a conversa NÃO é invalidada por tabela: ela renasce fresca a cada
   * abertura do painel (staleTime 0), que é quando o lido_em recarimba (CR-KB-08).
   */
  tarefas: (filtro?: { arquivadas: boolean }) =>
    filtro === undefined ? (['tarefas'] as const) : (['tarefas', filtro] as const),
  comentariosDaTarefa: (tarefaId: number) => ['tarefas', tarefaId, 'comentarios'] as const,
  participantesDoMural: () => ['tarefas-participantes'] as const,

  /*
   * CANAL DE WHATSAPP (mensageria-whatsapp). A thread fica DENTRO do namespace da lista
   * (a regra da fábrica): responder invalida `['conversas']` e a thread aberta acompanha
   * — sem isso, a mensagem que acabou de sair não apareceria até alguém recarregar.
   *
   * Nenhuma dessas chaves hidrata `useState` de formulário: o campo de escrita nasce
   * VAZIO e o formulário da conexão nunca é preenchido de volta (o segredo não sai do
   * servidor). Se um dia a tela ganhar edição que hidrate daqui, vira detalhe com
   * `gcTime: 0` — o precedente do gatilho CHAVE-DETALHE.
   */
  conversas: (filtro: { filtro: string; busca: string; pagina: number }) => ['conversas', filtro] as const,
  conversa: (id: number) => ['conversas', id] as const,
  templatesDeMensagem: () => ['mensagem-templates'] as const,
  conexaoWhatsapp: () => ['whatsapp-conexao'] as const,
}
