/**
 * O MANIFESTO das capturas de tela do manual — um lugar só.
 *
 * Imagem de manual envelhece: a tela muda e a figura continua mostrando a de antes. Por isso
 * cada entrada carrega `capturadaEm` — daqui a seis meses dá para saber que a figura é anterior
 * à mudança sem abrir o histórico do repositório.
 *
 * Os arquivos moram em `web/public/capturas-do-manual/` (servidos como arquivo estático, FORA do
 * pacote de JavaScript: o peso das figuras não pode chegar em quem só quer abrir a agenda). A
 * pasta NÃO se chama `manual`: com o nome da rota, o nginx a servia no lugar da página e
 * `/manual` aberto pelo endereço caía num 301 para dentro do container (2026-10-01). A guarda em
 * `capturas.contrato.test.ts` reprova entrada sem arquivo e arquivo sem entrada.
 *
 * LGPD: tudo aqui saiu da clínica de EXEMPLO, com dados fictícios. Nenhuma criança, família,
 * profissional ou usuário real aparece em imagem publicada.
 */
export interface CapturaDoManual {
  /** Nome do arquivo dentro de `public/capturas-do-manual/` */
  arquivo: string
  /** O que a imagem MOSTRA — para quem não a enxerga. Nunca "captura de tela do sistema". */
  alt: string
  /** A legenda visível, abaixo da figura */
  legenda: string
  /** Dimensões reais do arquivo: sem elas a página pula enquanto a imagem carrega */
  largura: number
  altura: number
  /** Data da captura (AAAA-MM-DD) — a validade da figura */
  capturadaEm: string
}

export const CAPTURAS = {
  'visao-geral-da-tela': {
    arquivo: 'visao-geral-da-tela.jpg',
    alt: 'A tela do sistema aberta na Agenda: o monograma e o nome da clínica com os destinos em grupos à esquerda, os contadores e a sessão no topo, a lista "Ver a agenda de" com os profissionais (foto ou iniciais) e a escolhida marcada com fundo claro e fio verde, e a grade de horários dela com a data por extenso sob o título.',
    legenda: 'A tela inteira: destinos à esquerda, contadores e sua conta no topo, trabalho no meio.',
    largura: 1493,
    altura: 812,
    capturadaEm: '2026-09-03',
  },
  'barra-lateral': {
    arquivo: 'barra-lateral.jpg',
    alt: 'A barra da esquerda, com o monograma e o nome da clínica no alto e os destinos em três grupos — Atendimento (Agenda, Lista de espera, Pacientes, Cadastros recebidos, Profissionais, Tratamentos), Gestão (Financeiro, Tarefas, Mensagens, Indicadores) e Administração (Cadastros, Usuários, Auditoria); a Agenda está marcada com o fundo claro e um fio verde; no rodapé, Manual e Configurações.',
    legenda: 'A barra da esquerda: os destinos em três grupos, e o de agora marcado com o fio verde.',
    largura: 260,
    altura: 785,
    capturadaEm: '2026-09-02',
  },
  'barra-do-topo': {
    arquivo: 'barra-do-topo.jpg',
    alt: 'A barra do topo com os contadores Evoluções 39, Retornos 1, Tarefas 3, Aniversários 1 e Termos 13, o controle "Em dia" ao lado deles, e a sessão (Admin Exemplo, Sair) na ponta direita.',
    legenda: 'Os contadores do topo: só o que tem pendência aparece; o que está zerado fica em "Em dia".',
    largura: 1135,
    altura: 38,
    capturadaEm: '2026-09-02',
  },
  'agenda-grade': {
    arquivo: 'agenda-grade.jpg',
    alt: 'A grade do dia de uma profissional: a coluna de horários à esquerda, o cabeçalho com a foto e o nome dela, e os cartões de atendimento com a hora, o nome da criança, a etiqueta da situação, as sessões usadas (16/20) e a especialidade com o convênio; embaixo, na faixa das 14:00, a hora de agora aparece escrita em verde ao lado de um ponto, e a linha do agora passa por trás do cartão, sem cruzar o nome.',
    legenda: 'A grade de um profissional: um cartão por atendimento e, na coluna da esquerda, a hora de agora escrita ao lado do ponto.',
    largura: 738,
    altura: 743,
    capturadaEm: '2026-09-11',
  },
  'agenda-visao-geral': {
    arquivo: 'agenda-visao-geral.jpg',
    alt: 'A Visão geral: cinco profissionais lado a lado, cada coluna com a foto ou as iniciais e o nome no cabeçalho, os cartões de atendimento distribuídos pelo dia, a linha verde do agora cruzando a grade perto das 12:30, e as setas para ver mais colunas.',
    legenda: 'A Visão geral: vários profissionais no mesmo dia, com a linha do agora cruzando a grade.',
    largura: 1493,
    altura: 812,
    capturadaEm: '2026-09-02',
  },
  'agenda-novo-agendamento': {
    arquivo: 'agenda-novo-agendamento.jpg',
    alt: 'A janela Novo agendamento com os campos profissional, paciente, especialidade, tratamento, data em dd/mm/aaaa, hora, duração, sala, médico solicitante e observação; no fim, "Repetir" com "Todo mês" escolhido, o aviso de que a série é tudo-ou-nada e, abaixo, "Terminar" com "Depois de N sessões" e o campo "Quantas sessões".',
    legenda: 'A janela de marcar. Os campos com "(obrigatório)" são os que o sistema exige; no fim, a repetição da série, por semanas ou por meses.',
    largura: 688,
    altura: 851,
    capturadaEm: '2026-09-11',
  },
  'agenda-detalhes': {
    arquivo: 'agenda-detalhes.jpg',
    alt: 'A janela Detalhes do agendamento mostrando criança, sessões do pacote, quando, profissional, serviço, convênio, e o campo de observações com o botão Registrar atendimento.',
    legenda: 'Os detalhes de um atendimento. É daqui que se registra o que aconteceu na sessão.',
    largura: 580,
    altura: 620,
    capturadaEm: '2026-08-28',
  },
  'agenda-desmarcar': {
    arquivo: 'agenda-desmarcar.jpg',
    alt: 'A janela Desmarcar a agenda de uma profissional, com escolha de manhã, tarde ou dia inteiro, período de datas, motivo, e as opções de bloquear o período e avisar as famílias pelo WhatsApp.',
    legenda: 'Desmarcar a agenda de um profissional. Nada acontece antes de você ver a lista do que será desmarcado.',
    largura: 580,
    altura: 540,
    capturadaEm: '2026-08-28',
  },
  'agenda-excluir-serie': {
    arquivo: 'agenda-excluir-serie.jpg',
    alt: 'A confirmação de excluir um agendamento que faz parte de uma série: o título nomeia a criança, o texto diz que este e os seguintes serão excluídos, 12 no total, inclusive os que estão fora do período à vista, e que os anteriores permanecem; abaixo, a caixa marcada "Excluir também os seguintes da série" e os botões Cancelar e Excluir agendamento.',
    legenda: 'A escolha entre apagar só um dia e apagar a série fica na própria confirmação.',
    largura: 464,
    altura: 331,
    capturadaEm: '2026-09-11',
  },
  'agenda-dar-baixa': {
    arquivo: 'agenda-dar-baixa.jpg',
    alt: 'A janela "Dar baixa na agenda de Ana Fictícia Souza": as situações Finalizado e Falta Justificada em "Marcar como", o alcance "Dia à vista" em "Quando" (quinta, 10 de setembro), e a prévia com 3 agendamentos e 3 crianças, 2 sessões a descontar, 1 sem pacote, o aviso de que desfazer é criança por criança e, em "Ficam de fora", um atendimento sem saldo no pacote; no rodapé, Cancelar, Atualizar os números e Aplicar "Finalizado" em 3.',
    legenda: 'Dar baixa na agenda de um profissional: os números primeiro, o botão de aplicar depois — e ele diz quantos vai marcar.',
    largura: 672,
    altura: 630,
    capturadaEm: '2026-09-11',
  },
  'status-de-agendamento': {
    arquivo: 'status-de-agendamento.jpg',
    alt: 'A tela Status de agendamento listando dez situações em ordem, cada uma com as regras que carrega: ocupa horário, consome sessão, conta como falta, libera o horário, em aberto ou opção de baixa em lote. Em Aberto e Aguardando Atendimento estão "em aberto"; Finalizado e Falta Justificada têm "opção de baixa em lote"; Não Compareceu, Falta Justificada e Desmarcado pelo Profissional liberam o horário. O aviso do topo lembra que o status de menor ordem precisa estar em aberto.',
    legenda: 'As situações e o que cada uma faz. Quem manda no pacote, na falta, no horário e no que o "Dar baixa" alcança é esta tabela.',
    largura: 1148,
    altura: 861,
    capturadaEm: '2026-09-11',
  },
  'lista-de-espera': {
    arquivo: 'lista-de-espera.jpg',
    alt: 'A lista de espera com três crianças: para cada uma, o que espera, a prioridade numa etiqueta (Urgente em vermelho, Alta em âmbar, Normal em cinza), há quantos dias está na fila, a observação da recepção e os botões Encaixar, Editar e Sair da fila.',
    legenda: 'A fila: o que cada criança espera, a prioridade em etiqueta e a observação que faz o encaixe acontecer.',
    largura: 1493,
    altura: 812,
    capturadaEm: '2026-09-02',
  },
  'pendencias-de-retorno': {
    arquivo: 'pendencias-de-retorno.jpg',
    alt: 'A tela Pendências de retorno com uma criança em tratamento sem próxima sessão marcada, há quantos dias está sem agendamento e o link Agendar retorno.',
    legenda: 'Quem está em tratamento e sumiu da agenda aparece aqui.',
    largura: 1162,
    altura: 757,
    capturadaEm: '2026-08-28',
  },
  pacientes: {
    arquivo: 'pacientes.jpg',
    alt: 'A lista de pacientes com a busca por nome, o filtro Ativos, os botões Copiar link do cadastro e Cadastrar paciente no alto, e em cada linha o nome, a idade, a necessidade e a etiqueta âmbar Cadastro incompleto.',
    legenda: 'Pacientes: a busca, os filtros, o link do cadastro ao lado de Cadastrar, e a etiqueta de cadastro incompleto.',
    largura: 1493,
    altura: 812,
    capturadaEm: '2026-09-02',
  },
  'ficha-do-paciente': {
    arquivo: 'ficha-do-paciente.jpg',
    alt: 'A ficha de uma criança aberta no Painel, com o menu lateral Painel, Cadastro, Agendamentos, Financeiro, Prontuário, Anamnese, Presença, Anexos e Contrato/Termo, e os dados de convênio, profissional, contrato e sessões.',
    legenda: 'A ficha da criança. O menu à esquerda troca a seção sem sair da ficha.',
    largura: 1162,
    altura: 757,
    capturadaEm: '2026-08-28',
  },
  profissionais: {
    arquivo: 'profissionais.jpg',
    alt: 'A lista de profissionais com nome, especialidades, horários de atendimento, conselho e situação, e em cada linha os botões Editar e Excluir; no alto, Cadastrar profissional.',
    legenda: 'Profissionais: quem atende, o que atende e em que horários.',
    largura: 1493,
    altura: 812,
    capturadaEm: '2026-09-02',
  },
  tratamentos: {
    arquivo: 'tratamentos.jpg',
    alt: 'A tela Tratamentos com filtros Acabando, Vencidos, Parados e Todos, e a lista mostrando sessões usadas do total, a situação e avisos como Faltam 2 sessões, Última sessão e Sem saldo.',
    legenda: 'Os pacotes em andamento. O aviso em laranja é o pacote chegando ao fim.',
    largura: 1162,
    altura: 757,
    capturadaEm: '2026-08-28',
  },
  tarefas: {
    arquivo: 'tarefas.jpg',
    alt: 'O mural Tarefas da equipe com as colunas A fazer, Em andamento, Aguardando e Concluída, e cartões com prioridade, etiquetas, prazo e responsável.',
    legenda: 'O mural da equipe. O cartão anda de coluna conforme a tarefa anda.',
    largura: 1162,
    altura: 757,
    capturadaEm: '2026-08-28',
  },
  mensagens: {
    arquivo: 'mensagens.jpg',
    alt: 'A tela Mensagens sem nenhuma conversa ainda: os filtros Ativas, Não lidas, Sem paciente e Arquivadas à esquerda, o aviso de que o WhatsApp não está conectado no alto, e o convite para escolher uma conversa à direita.',
    legenda: 'A tela de Mensagens antes da primeira conversa. Com o número conectado, as conversas aparecem na lista da esquerda.',
    largura: 1162,
    altura: 757,
    capturadaEm: '2026-08-28',
  },
  indicadores: {
    arquivo: 'indicadores.jpg',
    alt: 'A Visão geral dos Indicadores: o título, o seletor de mês com as setas e o botão Imprimir à direita, as abas Visão geral, Financeiro, Agenda, Pacientes e Equipe, a linha do período ("De 1º a 6 de outubro de 2026, até hoje, sem comparação: os indicadores contam a partir de 1º de outubro de 2026."), os quatro cartões — Dinheiro, Agenda, Pacientes e Equipe —, cada um com o número principal, a comparação (Dinheiro, Agenda e Equipe dizem "sem comparação", porque outubro é o primeiro mês dos indicadores; Pacientes mostra os novos do período), uma frase que explica e o "i" no canto, e embaixo a tendência do recebido e o "Pede atenção".',
    legenda: 'A Visão geral: a linha do período no alto e um cartão por frente, cada um com a comparação e a explicação.',
    largura: 1148,
    altura: 757,
    capturadaEm: '2026-10-06',
  },
  'indicadores-agenda': {
    arquivo: 'indicadores-agenda.jpg',
    alt: 'A aba Agenda dos Indicadores: a linha do período, cinco cartões — ocupação, realizadas, faltas, desmarques e confirmadas dos lembretes —, cada um com a comparação e uma frase, e, embaixo, o gráfico "As faltas se concentram na segunda-feira" ao lado do mapa de ocupação por dia e período.',
    legenda: 'A aba Agenda: os números da agenda e os gráficos com a conclusão no título.',
    largura: 1148,
    altura: 757,
    capturadaEm: '2026-10-06',
  },
  'indicadores-equipe': {
    arquivo: 'indicadores-equipe.jpg',
    alt: 'A tabela "Por profissional" da aba Equipe, com a janela de 1º a 5 de outubro escrita no alto: um profissional fictício por linha, com o nome e a especialidade, a barra de ocupação com o percentual, as sessões realizadas, as faltas, o percentual de evoluções em dia e as atrasadas; dois profissionais sem grade aparecem com o aviso "Sem grade: falta horário ou especialidade" e o atalho "Abrir o cadastro".',
    legenda: 'Equipe: uma linha por profissional, e quem está sem horário aparece como pendência.',
    largura: 1148,
    altura: 757,
    capturadaEm: '2026-10-05',
  },
  relatorios: {
    arquivo: 'relatorios.jpg',
    alt: 'A tela Relatórios: o campo de busca "Nome de agora, ou o que ele tinha no ClinicaÁgil" e os relatórios em cartões agrupados por categoria — em Agenda, os cartões Agendamentos, Lista de presença e Movimentação da agenda; em Atendimentos, Atendimentos e Evoluções. Cada cartão traz uma linha do que ele responde e, abaixo, os nomes que ele tinha no sistema antigo.',
    legenda: 'O catálogo: cada cartão diz o que responde e como o relatório se chamava antes.',
    largura: 1162,
    altura: 757,
    capturadaEm: '2026-09-03',
  },
  'relatorio-resultado': {
    arquivo: 'relatorio-resultado.jpg',
    alt: 'Um relatório aberto: em cima o formulário com período, profissional, convênio, especialidade, status, Resultado (Sintético) e Dividir por (Profissional), com os botões Gerar e Limpar filtros; embaixo o resultado — "5 grupos · 1º a 30 de setembro de 2026", o botão Imprimir e a tabela com uma linha por profissional, agendamentos e minutos, terminando na linha Total geral.',
    legenda: 'O mesmo formulário em todos os relatórios; o resultado sempre com totais e o botão Imprimir.',
    largura: 1162,
    altura: 757,
    capturadaEm: '2026-09-03',
  },
  cadastros: {
    arquivo: 'cadastros.jpg',
    alt: 'A tela Cadastros com treze cartões em duas colunas: Especialidades, Salas, Equipamentos, Convênios e serviços, Médicos solicitantes, Status de agendamento, Feriados, Modelos de anamnese, Termo de consentimento, Contas, Formas de pagamento, Categorias do caixa e Cartões — cada um com uma linha dizendo para que serve.',
    legenda: 'Os cadastros que a agenda e o financeiro consomem — os quatro últimos são os do dinheiro.',
    largura: 1162,
    altura: 757,
    capturadaEm: '2026-09-03',
  },
  'cadastros-contas': {
    arquivo: 'cadastros-contas.jpg',
    alt: 'A tela Contas, com o link "Cadastros" no topo, o botão "Cadastrar conta" à direita e uma tabela de duas linhas com as colunas Conta, Código contábil, Situação e Ações — cada linha com os botões Editar e Excluir.',
    legenda: 'A tela de Contas: onde o dinheiro entra e sai. As outras três do financeiro têm a mesma forma.',
    largura: 1162,
    altura: 757,
    capturadaEm: '2026-09-03',
  },
  usuarios: {
    arquivo: 'usuarios.jpg',
    alt: 'A tela Usuários com as abas Usuários, Níveis de permissão e Aprovações, e a lista com nome, e-mail, nível e situação.',
    legenda: 'Quem entra no sistema e com qual nível.',
    largura: 1162,
    altura: 757,
    capturadaEm: '2026-08-28',
  },
  auditoria: {
    arquivo: 'auditoria.jpg',
    alt: 'A tela Auditoria com filtros por entidade, registro, usuário, ação e período, e a lista de alterações com quando, ação, entidade, autor e campos alterados.',
    legenda: 'A trilha do que foi criado, alterado e excluído — e por quem.',
    largura: 1162,
    altura: 757,
    capturadaEm: '2026-08-28',
  },
  configuracoes: {
    arquivo: 'configuracoes.jpg',
    alt: 'A aba Clínica das configurações: nome da clínica, fuso horário e o bloco Identidade na barra lateral — a escolha entre nome e logo, as quatro fontes, o envio da logo, a pré-visualização e, ao fim, o botão Salvar identidade.',
    legenda: 'Aba Clínica: é aqui que a clínica ganha nome e cara. O botão Salvar identidade fecha a seção.',
    largura: 1162,
    altura: 757,
    capturadaEm: '2026-08-28',
  },
  'configuracoes-atendimento': {
    arquivo: 'configuracoes-atendimento.jpg',
    alt: 'A aba Atendimento das configurações, com os blocos Tratamentos (bloquear tratamento duplicado, antecedência do aviso de pedido médico, alerta de fim de pacote) e Evoluções (prazo, carência antes de travar, responsável técnico obrigatório, bloquear após o status final).',
    legenda: 'Aba Atendimento: as regras do pacote de sessões e da evolução.',
    largura: 1100,
    altura: 612,
    capturadaEm: '2026-08-28',
  },
  'configuracoes-financeiro': {
    arquivo: 'configuracoes-financeiro.jpg',
    alt: 'A aba Financeiro das configurações, com lançar convênio no fluxo de caixa, marcar lançamentos como contábeis por padrão e desconto máximo no faturamento em porcentagem.',
    legenda: 'Aba Financeiro: três decisões que mudam o que entra no caixa.',
    largura: 1100,
    altura: 287,
    capturadaEm: '2026-08-28',
  },
  'configuracoes-comunicacao': {
    arquivo: 'configuracoes-comunicacao.jpg',
    alt: 'A aba Comunicação das configurações, com o cartão de conexão do WhatsApp, envio de mensagens automáticas, teto de mensagens por mês, sugestão do WhatsApp no cadastro, template do aviso de desmarque e retenção do histórico de mensagens.',
    legenda: 'Aba Comunicação: o que sai da clínica pelo WhatsApp, e quanto.',
    largura: 1100,
    altura: 631,
    capturadaEm: '2026-08-28',
  },
  'configuracoes-seguranca': {
    arquivo: 'configuracoes-seguranca.jpg',
    alt: 'A aba Segurança das configurações, com duas opções: exigir aprovação de dois administradores nas mudanças de acesso e separar controle de permissões da escrita financeira.',
    legenda: 'Aba Segurança: duas travas para mudanças de acesso.',
    largura: 1100,
    altura: 210,
    capturadaEm: '2026-08-28',
  },
  'configuracoes-cadastro': {
    arquivo: 'configuracoes-cadastro.jpg',
    alt: 'A aba Cadastro das configurações, com cada campo da ficha do paciente e três botões — Obrigatório, Opcional e Não aparece —, alguns com cadeado indicando que não podem sumir do formulário.',
    legenda: 'Aba Cadastro: o que a ficha da criança exige, o que é opcional e o que nem aparece.',
    largura: 1100,
    altura: 631,
    capturadaEm: '2026-08-28',
  },
  'configuracoes-agenda-grade': {
    arquivo: 'configuracoes-agenda-grade.jpg',
    alt: 'A parte de baixo da aba Agenda das configurações: status do encadeamento, status aplicado ao desmarcar, máximo por desmarque em lote (60), máximo por baixa em lote (100), hora que separa manhã de tarde, granularidade da grade, dias de fim de semana, visão padrão e início e fim da janela padrão.',
    legenda: 'Ainda na aba Agenda: o desenho da grade e os freios do desmarque e da baixa em lote.',
    largura: 1100,
    altura: 793,
    capturadaEm: '2026-09-11',
  },
  'configuracoes-agenda': {
    arquivo: 'configuracoes-agenda.jpg',
    alt: 'A aba Agenda das configurações, com as caixas de agendamento retroativo, arrastar cartão para remarcar e reposição de reposição todas desmarcadas, e os campos de mesmo paciente em horários sobrepostos, limite de faltas, dias para entrar nas pendências e status do encadeamento.',
    legenda: 'As regras da agenda, aqui nos valores de fábrica. Mudam na hora, sem depender de ninguém do lado de fora.',
    largura: 1162,
    altura: 758,
    capturadaEm: '2026-08-28',
  },
} as const satisfies Record<string, CapturaDoManual>

/** O id de uma captura — só existe o que está no manifesto acima. */
export type IdDaCaptura = keyof typeof CAPTURAS
