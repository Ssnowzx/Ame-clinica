import { chaves } from '@/lib/chaves-query'

/**
 * A CLASSIFICAÇÃO das chaves de query — FONTE ÚNICA, consumida pelas duas guardas:
 *
 * - `chaves-query.test.ts` — a FORMA: o detalhe é prefixo da lista, e toda chave está
 *   classificada (completude).
 * - `detalhe-sem-cache.contrato.test.ts` — o COMPORTAMENTO: todo `useQuery` de chave de detalhe
 *   declara `gcTime: 0`.
 *
 * **Por que fonte única, e não uma lista em cada teste:** a segunda guarda nasceu com a lista
 * copiada à mão — e ela já nasceu DIVERGENTE (5 chaves em vez de 7). As duas que faltavam eram,
 * exatamente, as duas únicas queries de detalhe sem `gcTime: 0` no app: a guarda estava **verde
 * porque não olhava para o código que a reprovaria**. É a definição de proxy — o defeito que esta
 * change existe para matar (re-review r8, bloqueante).
 *
 * Chave nova entra AQUI, uma vez. As duas guardas a enxergam juntas.
 */

/** Chaves de LISTA: a raiz do namespace de cada entidade. */
export const LISTAS = {
  agenda: chaves.agenda(),
  profissionais: chaves.profissionais(),
  pacientes: chaves.pacientes({ busca: '', pagina: 1 }),
  tratamentos: chaves.tratamentos({ pagina: 1 }),
  convenios: chaves.convenios(),
  atendimentos: chaves.atendimentosDoAgendamento(1),
  evolucoes: chaves.evolucoesEmAberto({ pagina: 1 }),
  lancamentos: chaves.lancamentos({ pagina: 1 }),
  anamneses: chaves.anamnesesDoPaciente(1),
  usuarios: chaves.usuarios(),
  termos: chaves.termos(),
  tarefas: chaves.tarefas(),
  conversas: chaves.conversas({ filtro: 'ativas', busca: '', pagina: 1 }),
  // `categorias` virou namespace de LISTA (e deixou de ser só exibição) quando as
  // subcategorias ganharam tela: elas moram sob este prefixo.
  categorias: chaves.categorias(),
} as const

/** O nome, na fábrica, da função que produz a chave de LISTA de cada namespace. */
export const FABRICA_DA_LISTA: Record<keyof typeof LISTAS, string> = {
  agenda: 'agenda',
  profissionais: 'profissionais',
  pacientes: 'pacientes',
  tratamentos: 'tratamentos',
  convenios: 'convenios',
  atendimentos: 'atendimentosDoAgendamento',
  evolucoes: 'evolucoesEmAberto',
  lancamentos: 'lancamentos',
  anamneses: 'anamnesesDoPaciente',
  usuarios: 'usuarios',
  termos: 'termos',
  tarefas: 'tarefas',
  conversas: 'conversas',
  categorias: 'categorias',
}

/**
 * Chaves de DETALHE: carregam o id de UMA entidade.
 *
 * Cada uma DEVE (a) começar pela chave da sua lista e (b) declarar `gcTime: 0` no `useQuery` —
 * as duas guardas leem esta mesma lista.
 */
export const DETALHES: ReadonlyArray<{ nome: string; chave: readonly unknown[]; lista: keyof typeof LISTAS }> = [
  // A THREAD de uma conversa é detalhe por FORMA e, por consequência, ganha `gcTime: 0`
  // — que aqui é bem-vindo por outro motivo: o teor da conversa de uma criança não fica
  // no cache do navegador depois que alguém sai da aba.
  { nome: 'conversa', chave: chaves.conversa(7), lista: 'conversas' },
  { nome: 'paciente', chave: chaves.paciente(7), lista: 'pacientes' },
  { nome: 'tratamento', chave: chaves.tratamento(7), lista: 'tratamentos' },
  { nome: 'convenio', chave: chaves.convenio(7), lista: 'convenios' },
  { nome: 'servicosDoConvenio', chave: chaves.servicosDoConvenio(7), lista: 'convenios' },
  // regras de limite: mesma natureza dos serviços — o form de edição da TelaDeCatalogo
  // hidrata `useState` do item da lista. ⚠️ A chave entra por PROP, e a guarda irmã do
  // `gcTime: 0` só enxerga `queryKey: chaves.<nome>(` escrito no lugar: para estas três
  // (`servicosDoConvenio`, `regrasDoConvenio`, `subcategoriasDaCategoria`) ela encontra
  // zero ocorrências e fica verde sem olhar. O que segura a reversão aqui NÃO é o
  // `gcTime` — é o `If-Match` do `TelaDeCatalogo`: editar sobre cache velho leva 409 com
  // "Recarregar", nunca sobrescrita em silêncio. Gatilho CHAVE-POR-PROP-CEGA em
  // docs/GATILHOS.md (achado do gate, rodada 1).
  { nome: 'regrasDoConvenio', chave: chaves.regrasDoConvenio(7), lista: 'convenios' },
  { nome: 'serieDoAgendamento', chave: chaves.serieDoAgendamento(7), lista: 'agenda' },
  // subcategorias: mesma natureza dos serviços do convênio — filhas sob o namespace da
  // mãe, lidas por chave PRÓPRIA (o formato difere do da lista de categorias, e duas
  // `queryFn` na mesma chave não coexistem) e escritas invalidando o prefixo da mãe
  {
    nome: 'subcategoriasDaCategoria',
    chave: chaves.subcategoriasDaCategoria(7),
    lista: 'categorias',
  },
  { nome: 'atendimento', chave: chaves.atendimento(7), lista: 'atendimentos' },
  { nome: 'evolucao', chave: chaves.evolucao(7), lista: 'evolucoes' },
  { nome: 'lancamento', chave: chaves.lancamento(7), lista: 'lancamentos' },
  { nome: 'anamnese', chave: chaves.anamnese(7), lista: 'anamneses' },
  // o form de edição de usuário hidrata de leitura fresca — gcTime: 0 (SEC-ADM-10)
  { nome: 'usuario', chave: chaves.usuario(7), lista: 'usuarios' },
  // a ficha do profissional HOSPEDA o form de edição e o hidrata por prop do próprio
  // dado — é detalhe por definição da guarda (CR-FPR-02): prefixo + gcTime: 0
  { nome: 'fichaProfissional', chave: chaves.fichaProfissional(7), lista: 'profissionais' },
  // o TEXTO de uma versão do termo (FA-08): a lista não o traz, e o formulário de correção
  // hidrata `useState` a partir dele — detalhe por definição (prefixo + gcTime: 0)
  { nome: 'termo', chave: chaves.termo(7), lista: 'termos' },
]

/**
 * Chaves SEM detalhe — catálogos, seleções e singletons: não têm formulário de edição que hidrate
 * `useState` a partir delas, então não armam a bomba do cache.
 *
 * Classificar aqui é uma DECISÃO, não um despacho: se a chave ganhar formulário de edição, ela
 * vira detalhe e passa a dever prefixo E `gcTime: 0`.
 */
export const SEM_DETALHE = [
  'selecaoDaAgenda',
  // a mesma seleção com os desligados (o filtro do repasse): oferta de opções, não fonte de form
  'selecaoComDesligados',
  'pacientesDaBusca',
  // os modos LISTA da escolha de paciente (change busca-de-paciente-com-lista): oferta de
  // opções, nunca fonte de formulário — não há detalhe que possa ser revertido a partir delas
  'pacientesEmLista',
  'pacientesRecentes',
  'pacientesDoCadastroEmLista',
  'pacientesDoCadastroNaBusca',
  // o número em outro paciente (change telefone-que-chega-no-whatsapp): um alerta ao lado do campo,
  // nunca fonte de formulário
  'telefoneEmUso',
  // resolução de NOME por id (modo retorno): o formulário hidrata `form.paciente` a partir dela,
  // mas o valor que é SALVO é o `paciente_id` — que vem da URL, não do cache. Um nome de cache
  // velho seria um rótulo desatualizado por um instante, nunca uma escrita revertida: não é a
  // bomba que a guarda persegue. O precedente exato é `tratamentosDoPaciente(id)`: chave COM id que
  // alimenta o mesmo formulário e serve só à escolha/exibição. Ganhando edição do cadastro por aqui,
  // vira detalhe — e passa a dever prefixo E `gcTime: 0`.
  'pacienteDaSelecao',
  'tratamentosDoPaciente',
  'profissionaisDoCadastro',
  // o painel do mês na ficha (painel-do-profissional): só exibição — o formulário de edição da ficha
  // hidrata da `fichaProfissional`, nunca daqui
  'painelDoProfissional',
  'especialidades',
  'statusAgendamento',
  'feriados',
  'configuracaoAgenda',
  // a RÉGUA do cadastro (campos-do-cadastro): é PARAMETRIZAÇÃO, não registro editável. O
  // formulário de paciente a lê para saber o que desenhar, mas nada nela hidrata `useState`
  // de um formulário de edição — a tela de configuração da régua monta o seu estado a
  // partir da RESPOSTA da gravação, e a gravação devolve a régua efetiva inteira. Não há
  // detalhe singular que uma invalidação de lista pudesse deixar para trás.
  'reguaDoCadastro',
  /*
    O rascunho de um envio já aceito. Chave COM id, mas SEM-DETALHE de propósito: ela não é o
    detalhe de NENHUMA lista — a fila só mostra pendentes, e o aceito sai dela. Não há lista da
    qual esta chave possa ser prefixo-extensão, que é a forma que a guarda fiscaliza.

    A justificativa que estava aqui ia além disso e prometia que "não há hidratação tardia que
    possa reverter o que a recepção digitou". Havia — duas vezes, na rodada 3 e na 4. Promessa
    numa guarda desarma o próximo revisor exatamente onde ela deveria armá-lo.
  */
  'rascunhoDoEnvio',
  'notificacoes',
  'listaEspera',
  'cbos',
  'salas',
  'equipamentos',
  'medicos',
  'auditoriaDoAgendamento',
  // trilha completa da tela de auditoria: leitura pura paginada, nenhum formulário hidrata dela
  'trilhaDeAuditoria',
  // leituras do painel: SÓ exibição (sem formulário que hidrate useState) — não armam a bomba.
  // `agendamentoDetalhe` traz a obs; `comparecimentoRecente` traz o mini-histórico (90 dias).
  'agendamentoDetalhe',
  'comparecimentoRecente',
  // assiduidade da seção Presença — só exibição (o servidor calcula; a tela formata)
  'presencaDoPaciente',
  // agendamentos da ficha (próximos + recentes) — só exibição, como o comparecimento
  'agendamentosDoPaciente',
  // resumo do Painel da ficha do paciente — só leitura (o cadastro é editado por outra chave).
  'pacienteResumo',
  // anexos da ficha: lista de metadados; upload/exclusão invalidam a lista (sem form que hidrate)
  'anexosDoPaciente',
  // anexos do lançamento (anexo-no-lancamento): a mesma natureza dos do paciente — metadados de
  // exibição; enviar e excluir invalidam a lista, e nenhum formulário hidrata `useState` daqui
  'anexosDoLancamento',
  // a cobrança pelo WhatsApp (cobranca-pelo-whatsapp): leitura de UMA ação — os responsáveis com
  // telefone e a mensagem pronta. Nenhum formulário hidrata daqui; o que ela exige é não ficar no
  // cache (ver `SEM_CACHE_POR_SER_DADO_DE_MENOR`)
  'cobrancaDoLancamento',
  // ciclos de faturamento do convênio: a lista de fechamentos e o próximo período são
  // SÓ exibição. O único formulário da seção é o MOTIVO da reabertura, e ele nasce
  // vazio a cada abertura do diálogo — não hidrata de query nenhuma, então não arma a
  // bomba do cache. Se um dia a seção ganhar edição de fechamento, vira DETALHE.
  'ciclosDoConvenio',
  'proximoCicloDoConvenio',
  // financeiro: o extrato do fluxo e as leituras do recibo são SÓ exibição. Os catálogos
  // (`contas`, `tiposPagamento`, `cartoes`) ganharam TELA na change
  // `cadastros-financeiros-tela` e passaram a hidratar o formulário do `TelaDeCatalogo` —
  // mas continuam aqui, e por um motivo que não é o antigo: são chaves de LISTA, não de
  // DETALHE. A lista fica ATIVA enquanto o formulário está aberto (é a mesma tela), então
  // a invalidação a alcança de imediato; e a reversão silenciosa é barrada pelo `If-Match`.
  'fluxoCaixa',
  // o saldo das contas (saldo-das-contas): a lista dos cartões. O diálogo da abertura hidrata do
  // CARTÃO por prop — a lista fica ativa enquanto ele está aberto (é a mesma tela), e a reversão
  // silenciosa é barrada pelo `If-Match` com o `updated_at` lido aqui.
  'saldosDasContas',
  // a configuração do DRE (dre-gerencial): leitura da escada e das categorias. O seletor da linha
  // não hidrata `useState` — o valor mostrado é o do servidor, e a troca vai direto com o If-Match
  'configuracaoDoDre',
  // o vínculo conduzido (vincular-pagamentos-ao-tratamento). A SUGESTÃO não hidrata `useState`:
  // o formulário a DERIVA a cada render enquanto o campo está vazio e intocado, e o que vai no
  // corpo é decidido ali — a consulta ainda declara `gcTime: 0`, então cada abertura do
  // formulário pergunta de novo. A LISTA do lote é exibição: a marcação de cada linha é estado
  // local por id, derivado da sugestão que chegou, nunca um registro editado a partir do cache.
  'sugestaoDeTratamento',
  'pagamentosSemTratamento',
  'contas',
  'tiposPagamento',
  'cartoes',
  // a quem a clínica paga (caixa-do-dia-a-dia): as LISTAS de fornecedores e funcionários. Nenhum
  // formulário hidrata delas — a linha nem traz o `updated_at`. A edição relê o DETALHE direto do
  // servidor a cada abertura, fora do cache, e por isso não há chave de detalhe a vigiar aqui. Se
  // um dia a edição passar a ler por `useQuery`, nasce `fornecedor(id)` sob este prefixo, com
  // `gcTime: 0`, e estas duas viram LISTAS.
  'fornecedores',
  'funcionarios',
  'nomeDaClinica',
  'documentoDoInteressado',
  // anamnese: o catálogo de modelos é SÓ leitura (nenhum formulário de edição hidrata
  // `useState` a partir dele — o form de edição hidrata do DETALHE, por prop).
  'modelosDeAnamnese',
  // prontuário da ficha: a linha do tempo é SÓ exibição (metadados); a evolução abre
  // pela chave de DETALHE `evolucao` (gcTime: 0, leitura auditada — SEC-PF-07).
  'atendimentosDoPaciente',
  // fila de RETORNOS: lista derivada, SÓ exibição — a pendência não se edita (ela some
  // sozinha quando o agendamento nasce), então não há formulário que hidrate `useState`.
  'pendenciasDeRetorno',
  // administração: níveis, catálogo de permissões, configurações e alvos do encadeamento
  // são SÓ exibição — o form de nível hidrata do item da lista por prop; configurações
  // não têm form que hidrate `useState` de um detalhe.
  'niveisPermissao',
  'catalogoPermissoes',
  'configuracoes',
  'alvosEncadeamento',
  // indicadores do dashboard (§11): agregados SÓ exibição — números e rótulos de
  // apoio; nenhum formulário hidrata `useState` a partir deles.
  'indicadores',
  // drill-down das caixas: listas paginadas SÓ exibição (a ação vive na
  // agenda/prontuário) — nenhum formulário hidrata `useState` de um item.
  'indicadoresItens',
  // a tela Gráficos Financeiros (§11): quatro agregados SÓ exibição, todos em
  // string decimal. Nenhum formulário nasce daqui — a tela não edita lançamento.
  'graficosFinanceiros',
  // a área de relatórios: índice (sem dado) e resultado por slug + recorte — SÓ exibição.
  // O formulário do relatório é hidratado da URL, e o que sai no papel é o que veio do
  // servidor naquela chamada; nenhum formulário de edição nasce daqui.
  'indiceDeRelatorios',
  'relatorio',
  // pendências do maker-checker (AP-13): lista SÓ exibição; aprovar/recusar/cancelar
  // invalidam a lista — nenhum formulário hidrata `useState` de uma pendência.
  'aprovacoesDeAcesso',
  // a régua em vigor (FA-08): NOMEIA o termo para o cadastro do paciente. Nenhum formulário
  // hidrata `useState` a partir dela — o que é salvo (termo e versão) é decidido pelo
  // SERVIDOR, então um valor de cache velho seria um rótulo desatualizado por um instante,
  // nunca uma escrita revertida. Mesmo racional do `pacienteDaSelecao`.
  'termoVigente',
  // mural de tarefas (kanban-da-equipe): a conversa de uma tarefa é exibição — o
  // composer nasce vazio e a edição de comentário hidrata do ITEM por prop. Fica
  // DENTRO do namespace `['tarefas', id, 'comentarios']` de propósito (invalidar o
  // quadro alcança a conversa aberta), mas não é detalhe: nenhum form de EDIÇÃO DE
  // TAREFA hidrata dela. Ganhando um, vira detalhe — prefixo E `gcTime: 0`.
  'comentariosDaTarefa',
  // participantes do mural: catálogo id+nome para responsáveis e menções
  'participantesDoMural',
  // canal de WhatsApp: o catálogo de templates é SÓ exibição (o seletor monta a prévia) e
  // a conexão nunca preenche o formulário de volta — o segredo não sai do servidor.
  'templatesDeMensagem',
  'conexaoWhatsapp',
] as const

/**
 * Chaves que NÃO são detalhe de lista nenhuma, mas que precisam de `gcTime: 0` pela outra razão:
 * elas carregam dado de MENOR e o balcão é máquina compartilhada.
 *
 * A guarda de comportamento (`detalhe-sem-cache.contrato.test.ts`) nasceu perseguindo a reversão
 * de formulário, e por isso varria só `DETALHES`. O rascunho do envio escapava das duas guardas ao
 * mesmo tempo: da de FORMA porque não é prefixo-extensão de lista alguma (e isso está certo), e da
 * de comportamento por tabela. Remover o `gcTime: 0` da consulta dele deixava a suíte web inteira
 * verde, com o cadastro completo de uma criança parado 5 minutos no cache (rodada 5).
 */
export const SEM_CACHE_POR_SER_DADO_DE_MENOR = [
  'rascunhoDoEnvio',
  // o telefone de cada responsável e a mensagem com o nome da criança (cobranca-pelo-whatsapp):
  // servem ao clique de UMA cobrança e não sobrevivem ao diálogo que os pediu
  'cobrancaDoLancamento',
] as const
