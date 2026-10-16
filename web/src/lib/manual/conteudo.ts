import type { SecaoDoManual } from '@/lib/manual/tipos'

/**
 * O MANUAL, inteiro, como dado (change `manual-do-operador`).
 *
 * Escrito para quem OPERA a clínica — recepção, terapeuta, administração —, não para quem
 * programa. A régua do texto: descreva o gesto na tela ("clique em Marcar"), nunca o mecanismo
 * por trás dele. Nada de nome de endereço interno, de tabela, de permissão em código ou de
 * número de erro: quem lê está com a mãe de uma criança na frente, esperando.
 *
 * A ORDEM daqui é a ordem do índice e a ordem da página. Começa em como entrar; termina no que
 * fazer quando o sistema recusa alguma coisa.
 *
 * Cada `id` é endereço público (`/manual#agenda`) — trocar um id quebra o link que alguém
 * guardou. Trate-os como nomes próprios.
 */
export const SECOES_DO_MANUAL: readonly SecaoDoManual[] = [
  {
    id: 'primeiros-passos',
    titulo: 'Primeiros passos',
    resumo: 'Como entrar, o que aparece primeiro e o que fazer no fim do expediente.',
    blocos: [
      {
        tipo: 'paragrafo',
        texto:
          'O sistema abre no navegador — não é preciso instalar nada. Guarde o endereço nos favoritos do computador da recepção: é sempre o mesmo.',
      },
      {
        tipo: 'subtitulo',
        texto: 'Entrar',
      },
      {
        tipo: 'passos',
        passos: [
          'Abra o endereço do sistema no navegador.',
          'Digite o seu e-mail e a sua senha.',
          'Clique em Entrar. O sistema abre direto na Agenda.',
        ],
      },
      {
        tipo: 'paragrafo',
        texto:
          'Cada pessoa tem o seu próprio acesso, e o sistema guarda quem fez o quê. Por isso a senha não se empresta: se um colega precisa entrar, ele entra com a conta dele. Quem cria e libera contas é quem administra o sistema, pela tela de Usuários.',
      },
      {
        tipo: 'atencao',
        texto:
          'O computador da recepção é compartilhado. Ao terminar o seu turno, clique em Sair, no canto de cima à direita. Sem isso, o que o próximo fizer entra no sistema com o seu nome.',
      },
      {
        tipo: 'captura',
        id: 'visao-geral-da-tela',
      },
      {
        tipo: 'dica',
        texto:
          'Quando falta um cadastro para fazer alguma coisa (uma segunda conta para transferir, a especialidade de um profissional, um convênio para o pacote), a tela diz o que falta e onde se cadastra. Se você pode cadastrar, aparece o atalho; se não pode, a tela diz para pedir a quem administra o sistema.',
      },
    ],
  },
  {
    id: 'a-tela-por-dentro',
    titulo: 'A tela por dentro',
    resumo: 'As três partes que aparecem em toda tela e nunca mudam de lugar.',
    blocos: [
      {
        tipo: 'paragrafo',
        texto:
          'Não importa em que tela você esteja: a barra da esquerda leva aos destinos, a barra de cima mostra o que está esperando alguém, e o meio é onde o trabalho acontece. Na Agenda há ainda um quarto elemento: o painel da lista de espera, na borda direita, que nasce aberto e pode ser recolhido para um cartão estreito — recolhido, ele mantém à vista o nome "Lista de espera" e o selo com o número de quem aguarda.',
      },
      { tipo: 'subtitulo', texto: 'A barra da esquerda' },
      {
        tipo: 'paragrafo',
        texto:
          'No alto, o monograma e o nome da clínica (ou a logo, se a clínica enviou uma). Abaixo, os destinos vêm em três grupos: Atendimento (Agenda, Lista de espera, Pacientes, Cadastros recebidos, Profissionais, Tratamentos), Gestão (Financeiro, Tarefas, Mensagens, Indicadores) e Administração (Cadastros, Usuários, Auditoria). O destino em que você está fica com o fundo claro e um fio verde na esquerda. Embaixo, separados por um risco, ficam os dois que não são do dia a dia: o Manual (esta página) e as Configurações.',
      },
      {
        tipo: 'paragrafo',
        texto:
          'Você só enxerga os destinos que o seu acesso permite. Se um colega vê um item que você não vê, não é defeito: é o nível de permissão dele.',
      },
      {
        tipo: 'dica',
        texto:
          'O botão redondo na beirada da barra recolhe a lista, deixando só os ícones — a agenda ganha o espaço. Clique de novo para trazer os nomes de volta. O sistema lembra a sua escolha.',
      },
      { tipo: 'captura', id: 'barra-lateral' },
      { tipo: 'subtitulo', texto: 'Os contadores do topo' },
      {
        tipo: 'paragrafo',
        texto:
          'Cada ícone com um número é uma pilha de coisas esperando alguém. Clique num deles para ver a lista ou ir direto à tela correspondente. O que está zerado não ocupa a barra: fica reunido em "Em dia", à direita — clique nele para ver quais pilhas estão vazias e ir a cada tela.',
      },
      {
        tipo: 'lista',
        itens: [
          { termo: 'Evoluções', descricao: 'sessões atendidas cuja evolução ainda não foi escrita.' },
          { termo: 'Retornos', descricao: 'crianças em tratamento que estão há tempo demais sem próxima sessão marcada.' },
          { termo: 'Desmarques', descricao: 'sessões cuja família pediu para desmarcar pelo botão do lembrete, e que a recepção ainda não resolveu. A lista vem por dia, sem o nome da criança, e cada dia abre a agenda daquele dia. Quem atende vê só os pedidos da própria agenda.' },
          { termo: 'Tarefas', descricao: 'o que o mural da equipe tem para você.' },
          { termo: 'Mensagens', descricao: 'conversas de WhatsApp ainda não lidas.' },
          { termo: 'Aniversários', descricao: 'quem faz aniversário hoje.' },
          { termo: 'Termos', descricao: 'famílias que ainda não aceitaram o termo em vigor.' },
          { termo: 'Atrasos', descricao: 'contas a receber ou a pagar vencidas.' },
          { termo: 'Faltas', descricao: 'crianças que faltaram várias vezes seguidas.' },
          { termo: 'Pedidos', descricao: 'pedidos médicos que precisam de atenção.' },
          { termo: 'Pacotes', descricao: 'tratamentos chegando ao fim das sessões.' },
          { termo: 'Avisos', descricao: 'recados do sistema para a equipe.' },
        ],
      },
      { tipo: 'captura', id: 'barra-do-topo' },
      {
        tipo: 'dica',
        texto:
          'Tudo em "Em dia" é o objetivo do fim do dia. Se um número só cresce, é porque alguma rotina parou — vale conversar com a equipe antes que a pilha vire semana.',
      },
    ],
  },
  {
    id: 'agenda',
    titulo: 'A agenda do dia',
    resumo: 'Como ler a grade, trocar de dia e ver vários profissionais ao mesmo tempo.',
    blocos: [
      {
        tipo: 'paragrafo',
        texto:
          'A Agenda é a tela onde a clínica passa o dia. À esquerda, sob a legenda "Ver a agenda de", ficam os profissionais, cada um com a foto (ou as iniciais) num círculo da cor da especialidade: clicar num nome mostra só a agenda dele, e o escolhido fica com o fundo claro e um fio verde à esquerda — o mesmo desenho do item marcado no menu. "Todos os profissionais" é a primeira opção da lista e abre a Visão geral. Quem tem profissional vinculado ao próprio usuário abre o Dia e a Semana já na agenda dele; quem não tem (ou cujo profissional está inativo) cai no primeiro da lista. Ao lado, a grade de horários de quem está escolhido. Sob o título, a data do dia por extenso, com o dia da semana.',
      },
      { tipo: 'captura', id: 'agenda-grade' },
      { tipo: 'subtitulo', texto: 'O que cada cartão diz' },
      {
        tipo: 'lista',
        itens: [
          { termo: 'O horário e o nome', descricao: 'quem é atendido e o horário da sessão, do começo ao fim — por exemplo, "08:40 às 09:20". Na Visão geral, quando a coluna é estreita, o horário fica em cima e o nome logo abaixo. O horário de término é só da equipe: o lembrete do WhatsApp continua dizendo à família apenas a hora em que a sessão começa.' },
          { termo: 'O ícone ao lado da hora', descricao: 'a resposta da família ao lembrete daquela sessão. Ampulheta cinza: o lembrete saiu e ninguém respondeu ainda. Círculo verde com visto: a sessão está confirmada — pela família, no botão do lembrete, ou pela clínica, quando a família confirmou por telefone ou mensagem (passe o mouse para ver quem confirmou e a que horas). Círculo vermelho com X: a família pediu para desmarcar — clique no cartão e escolha "Desmarcar (a família pediu)" ou, se ela tocou errado e confirmou por telefone, "Manter a sessão (a família desistiu)". Balão amarelo com exclamação: o lembrete não foi entregue, e é preciso ligar para a família. Balão amarelo riscado: o lembrete nem saiu, e o motivo aparece ao passar o mouse — quase sempre o telefone do cadastro está vazio ou digitado errado. Corrija o cadastro e ligue para a família. Sessão sem lembrete por decisão (a família pediu para não receber, ou já recebeu a confirmação no mesmo dia), ou que já não está marcada, fica sem ícone. Ao abrir o cartão, a mesma resposta aparece escrita, com a hora — é o jeito de conferir no celular, onde não há mouse para passar por cima. Quando a família confirmar por telefone ou mensagem uma sessão sem resposta, com lembrete não entregue ou sem lembrete, abra o cartão e escolha "Marcar como confirmada": o ícone fica verde, a sessão passa a contar como confirmada na faixa, a família não recebe mensagem nenhuma e o lembrete daquela sessão não sai mais, nem depois de corrigir o telefone. Quem marcou fica no histórico da sessão.' },
          { termo: 'A etiqueta colorida', descricao: 'a situação do atendimento (Em Aberto, Finalizado, Não Compareceu…).' },
          { termo: 'As sessões', descricao: 'quantas sessões do pacote já foram usadas — por exemplo, 4/20.' },
          { termo: 'O rodapé do cartão', descricao: 'a especialidade e o convênio.' },
          { termo: 'A listra colorida na lateral', descricao: 'a cor da especialidade, para bater o olho e reconhecer.' },
          { termo: 'A linha verde da grade', descricao: 'é a hora de agora, no dia de hoje. A hora vem escrita ao lado do ponto, na coluna da esquerda, e desce sozinha a cada minuto. A linha corre por trás dos cartões: ela atravessa os horários livres e some onde há atendimento, para não riscar o nome de ninguém. Num dia que não é hoje, não aparece.' },
          { termo: 'Um horário vazio', descricao: 'ao passar o mouse, ele diz "Marcar às …": clicar abre a marcação já naquele horário e profissional.' },
          { termo: 'Um horário que VAGOU', descricao: 'quando o atendimento entra numa situação que libera o horário (hoje: "Não Compareceu", "Falta Justificada", "Desmarcado pelo Profissional" e "Desmarcado pelo Paciente"), o cartão continua ali e o horário volta a dizer "Marcar às …". Dá para marcar outra criança no mesmo horário, inclusive puxando alguém da lista de espera pelo Encaixar — os dois cartões ficam um embaixo do outro.' },
        ],
      },
      { tipo: 'subtitulo', texto: 'Trocar de dia e de visão' },
      {
        tipo: 'lista',
        itens: [
          { termo: 'Dia', descricao: 'um profissional, o dia inteiro. É a visão do balcão.' },
          { termo: 'Semana', descricao: 'o mesmo profissional, a semana toda.' },
          { termo: 'Visão geral', descricao: 'vários profissionais lado a lado, no mesmo dia, cada coluna com o rosto de quem atende — a visão de quem procura um encaixe. A visão escolhida fica pintada de verde.' },
          { termo: 'As setas, o campo de data e o calendário', descricao: 'as setas andam um dia para trás ou para frente; no campo você digita a data como dd/mm/aaaa; o ícone ao lado abre um calendário com mês e ano em listas; Hoje volta para o dia de hoje.' },
        ],
      },
      { tipo: 'captura', id: 'agenda-visao-geral' },
      {
        tipo: 'paragrafo',
        texto:
          'Horários fora do expediente do profissional aparecem sombreados, e dias de feriado cadastrado não abrem grade. Se um horário deveria existir e não aparece, o motivo costuma estar no cadastro do profissional ou na lista de feriados.',
      },
      { tipo: 'subtitulo', texto: 'Quem confirmou e quem não respondeu' },
      {
        tipo: 'paragrafo',
        texto:
          'Acima da grade, a faixa "Respostas ao lembrete" conta os cartões do período que está na tela: quantas famílias confirmaram, quantas estão sem resposta, quantas pediram para desmarcar, quantos lembretes não foram entregues e quantas sessões ficaram sem lembrete. O que está em zero não aparece, e sem nenhum lembrete no período a faixa inteira some. Clique num número para realçar os cartões daquele grupo: eles ganham um contorno na cor do grupo e os outros perdem a cor, mas nenhum sai do lugar. Clique de novo para desfazer. É o jeito de ligar só para quem não respondeu (e, quando a família confirmar na ligação, marcar a sessão como confirmada no cartão), ou de achar quem ficou sem lembrete e corrigir o telefone a tempo: corrigido na véspera até a última volta do lembrete (20h, se a clínica não mudou em Configurações), ele sai na volta seguinte.',
      },
      {
        tipo: 'paragrafo',
        texto:
          'A agenda se atualiza sozinha a cada minuto enquanto está aberta e à vista, e também quando você volta para a aba dela: a resposta da família aparece no cartão sem recarregar a página, inclusive na tela de quem atende. A atualização não muda o dia, o profissional, a rolagem, o realce da faixa nem o cartão aberto — e espera você terminar de arrastar um cartão ou de preencher o formulário de agendamento. Se ela falhar (a internet caiu, o sistema está sendo atualizado), a agenda continua na tela com o que já tinha, e um aviso amarelo diz de que horas ela é, com o botão "Tentar de novo"; na próxima atualização que der certo, o aviso some sozinho.',
      },
    ],
  },
  {
    id: 'marcar',
    titulo: 'Marcar, remarcar e desmarcar',
    resumo: 'O gesto mais comum do dia, do jeito mais curto — e como desfazer.',
    blocos: [
      { tipo: 'subtitulo', texto: 'Marcar um atendimento' },
      {
        tipo: 'passos',
        passos: [
          'Na grade, clique num horário vazio do profissional. A janela Novo agendamento abre já com o profissional, a data e a hora preenchidos.',
          'Escolha a criança no campo Paciente — dá para digitar parte do nome.',
          'Escolha a especialidade. Só aparecem as que aquele profissional atende.',
          'Se a criança tem pacote de sessões, escolha o tratamento: é dele que a sessão vai sair.',
          'Ajuste a duração, a sala e o médico solicitante, se for o caso.',
          'Clique em Marcar.',
        ],
      },
      { tipo: 'captura', id: 'agenda-novo-agendamento' },
      {
        tipo: 'dica',
        texto:
          'Para marcar várias sessões de uma vez, use o campo "Repetir" no fim do formulário: escolha toda semana, a cada duas semanas (quinzenal), a cada três ou a cada quatro — ou, para acompanhamento espaçado, "Todo mês" e "A cada dois meses", que guardam o DIA do mês (quem marca dia 31 cai no último dia de fevereiro, nunca em março). Depois diga onde a série termina — "Depois de N sessões" (contando esta) ou "Na data". Com um pacote escolhido, o número de sessões já vem preenchido com o que falta dele, e você pode mudar. Ou tudo é criado, ou nada é: se alguma data bater em conflito, o sistema diz o motivo — o horário do profissional já ocupado, a sala ocupada ou o equipamento sem disponibilidade —, mostra o horário que já está ocupado na primeira data em choque e as datas, e não cria nenhuma. Assim não sobra série pela metade, e dá para mudar o horário sem adivinhar.',
      },
      {
        tipo: 'paragrafo',
        texto:
          'Para reservar um horário sem paciente — reunião, supervisão, almoço, ausência —, marque "Bloqueio de agenda" no alto da janela. O que você escrever na observação vira o rótulo da faixa na grade.',
      },
      { tipo: 'subtitulo', texto: 'Atender mais de uma criança no mesmo horário' },
      {
        tipo: 'paragrafo',
        texto:
          'Quem atende em grupo pode receber duas, três ou quatro crianças no mesmo horário. Isso não vem ligado: em Profissionais (menu Atendimento), na edição do profissional, no campo "Atendimentos ao mesmo tempo", troque o 1 pelo número de crianças que aquele profissional atende de uma vez. Se o grupo usa sempre a mesma sala, faça o mesmo em Cadastros › Salas, no campo "Quantos cabem ao mesmo tempo" — senão a sala recusa o grupo que o profissional já aceita.',
      },
      {
        tipo: 'paragrafo',
        texto:
          'Depois disso, marcar é igual: clique no mesmo horário de novo e marque a criança seguinte. Os cartões aparecem empilhados na mesma casinha da grade, e o convite "Marcar às..." continua ali até o horário lotar. Cada criança segue com o pacote e a cobrança dela — nada é dividido.',
      },
      {
        tipo: 'dica',
        texto:
          'Quem atende uma criança por vez continua protegido: com o número em 1, o sistema recusa a segunda marcação no mesmo horário, que é o que evita marcar duas crianças por engano. E baixar o número depois NÃO desmarca ninguém — o que já está na agenda fica; só as marcações novas passam a ser recusadas. Folga, reunião ou atestado (o "Bloqueio de agenda") continuam fechando o horário inteiro, mesmo de quem atende em grupo.',
      },
      { tipo: 'subtitulo', texto: 'Remarcar' },
      {
        tipo: 'paragrafo',
        texto:
          'Clique no cartão, abra "Mais ações" e escolha Editar: o formulário abre com tudo preenchido — mude a data ou a hora e salve. Esse caminho existe sempre.',
      },
      {
        tipo: 'paragrafo',
        texto:
          'Se a clínica ligou o arraste (Configurações › Agenda), aparecem dois atalhos: arrastar o cartão direto para outro horário da grade, e o botão "Remarcar" no canto do próprio cartão — ele aparece ao passar o mouse sobre o cartão (no celular fica sempre à vista) e pede o novo horário na grade; enquanto o modo está ligado, um aviso azul no alto diz de quem é a remarcação, com o botão "Cancelar remarcação". Com o arraste desligado — que é como o sistema vem de fábrica —, esses dois não existem, e Editar é o caminho.',
      },
      {
        tipo: 'paragrafo',
        texto:
          'Em qualquer um desses caminhos, quando o dia, a hora ou o profissional mudam, aparece a caixa "Avisar a família pelo WhatsApp". Ela vem desmarcada: marque quando foi a clínica que mudou o horário — se a família pediu a troca, ela já sabe. Marcada, a família recebe a mensagem com o horário antigo e o novo, e um aviso na tela diz se ela foi avisada ou por que não foi (sem telefone cadastrado, WhatsApp desligado no agendamento, família que pediu para não receber). Escolher no cartão o status do desmarque do profissional abre uma pergunta antes de gravar, com a caixa já marcada: confirmado, a família recebe o aviso de cancelamento (desmarque a caixa se foi a família que pediu). A confirmação sai sozinha quando a criança ganha o primeiro agendamento, e uma vez só por criança. A mudança de horário e o cancelamento saem toda vez que a caixa estiver marcada — cada um é notícia nova para a família —, até o limite diário de avisos por família. Quando a caixa está marcada mas o aviso não pode sair (sessão que já passou, criança trocada no agendamento, sessão desmarcada), a tela diz o motivo para a família ser avisada à mão. O cancelamento só é oferecido a partir de uma sessão marcada: mudar para o desmarque do profissional uma sessão que a família já tinha desmarcado não manda "cancelado pela clínica".',
      },
      { tipo: 'subtitulo', texto: 'Lançar no financeiro' },
      {
        tipo: 'paragrafo',
        texto:
          'Depois de a sessão ser atendida, clique no cartão, abra "Mais ações" e escolha "Lançar no financeiro". Escolha a categoria, a forma de pagamento e a conta e confirme: o valor não se digita — ele vem da tabela de serviços do tratamento, e o sistema mostra quanto foi lançado. A baixa do pagamento continua sendo feita na tela do financeiro. Sessão sem pacote vinculado não tem de onde tirar o valor: a opção continua em "Mais ações", indisponível, e diz para vincular o pacote em Editar, no campo Tratamento.',
      },
      {
        tipo: 'paragrafo',
        texto:
          'Só aparece para quem pode criar lançamentos. Se a sessão ainda não foi consumida, se o tratamento não tem serviço com valor, se o convênio não é particular — a não ser que a clínica tenha ligado "Lançar convênio no fluxo de caixa" em Configurações › Financeiro — ou se a sessão já foi faturada, o sistema recusa e diz o motivo na hora. Nada é criado duas vezes.',
      },
      { tipo: 'subtitulo', texto: 'Falar com a família pelo WhatsApp' },
      {
        tipo: 'paragrafo',
        texto:
          'Clique no cartão, abra "Mais ações" e escolha "Avisar no WhatsApp": a tela Mensagens abre já na conversa da família daquela criança, pelo celular que está agora no cadastro. Se a família nunca trocou mensagem com a clínica, a conversa nasce vazia. Nada é enviado sozinho: quem escreve é você, e fora da janela de 24 horas da Meta a conversa oferece os modelos aprovados. Se o cadastro não tem celular válido, o painel diz o que falta (sem celular, telefone digitado errado ou só telefone fixo). O item só aparece para quem responde as conversas.',
      },
      { tipo: 'subtitulo', texto: 'Desmarcar um horário só' },
      {
        tipo: 'paragrafo',
        texto:
          'Desmarcar é trocar a SITUAÇÃO do atendimento: clique na etiqueta colorida do cartão (ou abra o cartão e clique nela lá dentro) e escolha uma situação que libere o horário — "Desmarcado pelo Profissional" é a que vem pronta para isso. O horário volta para a grade na hora.',
      },
      {
        tipo: 'atencao',
        texto:
          'O sistema só pede confirmação quando a troca mexe no pacote da criança — quando a nova situação desconta uma sessão, ou quando a antiga descontava e vai devolver. Trocar entre duas situações que não mexem no pacote acontece no clique, sem pergunta. Leia a etiqueta antes de clicar.',
      },
      { tipo: 'subtitulo', texto: 'Excluir um agendamento, e a série inteira' },
      {
        tipo: 'paragrafo',
        texto:
          'Desmarcar e excluir são coisas diferentes. Desmarcar troca a situação e deixa o registro na agenda; excluir APAGA o agendamento, e não tem volta. Para excluir, abra o cartão, clique em "Mais ações" e escolha Excluir.',
      },
      {
        tipo: 'paragrafo',
        texto:
          'Se o atendimento faz parte de uma série — foi criado com "Repetir" —, a confirmação traz a caixa "Excluir também os seguintes da série". Desmarcada, some só aquele dia e os outros ficam. Marcada, somem este e todos os seguintes, e o texto diz quantos são no total, inclusive os que estão fora da semana que você está vendo.',
      },
      {
        tipo: 'atencao',
        texto:
          'A exclusão em série apaga deste dia para a FRENTE. Os anteriores permanecem. Para apagar uma série inteira, abra a PRIMEIRA data dela — se abrir uma do meio, as de trás continuam na agenda.',
      },
      { tipo: 'captura', id: 'agenda-excluir-serie' },
      { tipo: 'subtitulo', texto: 'Desmarcar a agenda inteira de um profissional' },
      {
        tipo: 'paragrafo',
        texto:
          'Quando um profissional falta, use "Desmarcar agenda" — o botão de contorno vermelho no alto da tela. Escolha manhã, tarde ou o dia inteiro, o período de datas e o motivo — e o sistema mostra a lista do que será desmarcado ANTES de fazer qualquer coisa.',
      },
      { tipo: 'captura', id: 'agenda-desmarcar' },
      {
        tipo: 'lista',
        itens: [
          {
            termo: 'Bloquear o período na agenda',
            descricao: 'deixa o período marcado como ausência do profissional, para ninguém marcar em cima por engano.',
          },
          {
            termo: 'Avisar as famílias pelo WhatsApp',
            descricao: 'as mensagens saem assim que você confirma o desmarque.',
          },
        ],
      },
      {
        tipo: 'atencao',
        texto:
          'Se um horário da lista não puder ser desmarcado, o resto continua: o sistema desmarca o que dá e mostra o que ficou de fora, com o motivo. Confira essa lista antes de fechar a janela.',
      },
      { tipo: 'subtitulo', texto: 'Dar baixa em toda a agenda de um profissional' },
      {
        tipo: 'paragrafo',
        texto:
          'No fim do dia — ou da semana — a agenda de um profissional costuma estar cheia de atendimentos que aconteceram e continuam em "Em Aberto". Em vez de trocar a etiqueta cartão por cartão, use "Dar baixa", o botão ao lado de "Hoje" no alto da agenda: ele marca todos os atendimentos em aberto daquele profissional com a situação que você escolher, de uma vez só.',
      },
      {
        tipo: 'passos',
        passos: [
          'Abra a agenda do profissional na data que quer fechar e clique em "Dar baixa".',
          'Em "Marcar como", escolha a situação que os atendimentos vão receber — "Finalizado" já vem marcada. Sob a escolhida, o sistema diz o que ela faz: desconta uma sessão do pacote de cada criança, conta como falta, ou só muda a situação.',
          'Em "Quando", escolha o alcance: "Dia à vista" (o dia que a agenda está mostrando), "Últimos 7 dias" (contando para trás a partir desse dia — não é a semana de segunda a domingo) ou "Escolher datas", com De e Até.',
          'Confira os números da prévia. Ela aparece sozinha e é refeita a cada mudança de situação ou de alcance; se a agenda mexeu enquanto a janela estava aberta, clique em "Atualizar os números". A última linha da caixa diz a que horas os números foram conferidos, e essa hora muda a cada conferência — é assim que você sabe que o número na sua frente é o de agora.',
          'Clique em "Aplicar" — o botão diz a situação e quantos atendimentos vai marcar, como em Aplicar "Finalizado" em 3. Só nesse clique alguma coisa muda.',
        ],
      },
      { tipo: 'captura', id: 'agenda-dar-baixa' },
      {
        tipo: 'paragrafo',
        texto:
          'A prévia mostra quantos agendamentos e quantas crianças o alcance apanha, quantas sessões vão sair dos pacotes, quem está sem pacote ou já tinha a sessão descontada (esses só mudam de situação) e quem já tem atendimento registrado. Abaixo, em "Ficam de fora", vem quem a baixa não vai tocar, com o motivo — ainda não começou, sem saldo no pacote, produção do período já fechada — e um atalho para ver cada um na agenda. Se o profissional tem evoluções vencidas, a prévia avisa; a baixa não mexe nisso.',
      },
      {
        tipo: 'atencao',
        texto:
          'A baixa só alcança o que já aconteceu: nunca uma data futura, e um atendimento marcado para mais tarde no próprio dia fica de fora como "Ainda não começou". E o que ela desconta dos pacotes não tem botão de desfazer: voltar atrás é criança por criança, trocando a etiqueta pelo cartão. Leia os números antes de aplicar.',
      },
      {
        tipo: 'dica',
        texto:
          'Só entram os atendimentos em situação marcada como "Em aberto", e só aparecem em "Marcar como" as situações marcadas como "Pode ser aplicado em lote" — as duas regras ficam em Cadastros › Status de agendamento; se a lista de "Marcar como" vier vazia, é lá que se liga. Há também um teto de quantos atendimentos uma baixa alcança (Configurações › Agenda): passou dele, o sistema recusa e diz o número — estreite as datas.',
      },
    ],
  },
  {
    id: 'situacoes',
    titulo: 'As situações do atendimento',
    resumo: 'A etiqueta do cartão não é enfeite: ela desconta sessão, conta falta e libera horário.',
    blocos: [
      {
        tipo: 'paragrafo',
        texto:
          'Toda marcação nasce como Em Aberto. Conforme o dia anda, você troca a situação pelo próprio cartão, clicando na etiqueta colorida. Essa escolha tem consequência: é ela que decide se a sessão sai do pacote da criança e se o horário fica ocupado ou volta a ficar livre.',
      },
      { tipo: 'captura', id: 'status-de-agendamento' },
      {
        tipo: 'lista',
        itens: [
          { termo: 'Ocupa horário', descricao: 'ninguém mais pode ser marcado ali. Vale para quase todas as situações.' },
          { termo: 'Consome sessão', descricao: 'desconta uma sessão do pacote da criança.' },
          { termo: 'Conta como falta', descricao: 'entra na conta de faltas seguidas, que alimenta o aviso do topo.' },
          {
            termo: 'Libera o horário',
            descricao:
              'devolve o horário para a grade — é o que acontece quando o profissional desmarca. O cartão antigo CONTINUA aparecendo, para você saber por que aquele horário vagou, e o horário volta a dizer "Marcar às …" quando você passa o mouse. Dá para marcar outra criança ali, inclusive puxando alguém da lista de espera pelo botão Encaixar: as duas ficam uma embaixo da outra no mesmo horário.',
          },
          {
            termo: 'Marca reserva',
            descricao: 'a situação é uma reserva de horário, um compromisso provisório. Por isso ela só entra nos lembretes às famílias quando a clínica liga "Incluir reservas nos lembretes" em Configurações › Comunicação.',
          },
          {
            termo: 'Em aberto',
            descricao: 'a situação ainda não tem desfecho: o atendimento foi marcado e ninguém disse o que aconteceu. São esses os atendimentos que entram na baixa em lote, pelo botão "Dar baixa" da agenda.',
          },
          {
            termo: 'Pode ser aplicado em lote',
            descricao: 'a situação aparece como opção em "Marcar como" no botão "Dar baixa" da agenda — "Finalizado" e "Falta Justificada" já vêm assim.',
          },
        ],
      },
      {
        tipo: 'paragrafo',
        texto:
          'Duas dessas regras têm cerca. Uma situação não pode estar em aberto e ser opção de baixa ao mesmo tempo — o alvo da baixa nunca é a origem dela. E a situação com que toda marcação nasce precisa estar em aberto, senão nenhum atendimento novo entraria na baixa. Uma situação em aberto também não pode descontar sessão, contar falta, marcar reserva nem liberar o horário: em aberto é o que ainda não teve desfecho. Se você marcar uma combinação dessas, a tela recusa e diz qual regra está em conflito.',
      },
      {
        tipo: 'paragrafo',
        texto:
          'Repare no efeito prático, do jeito que a clínica configurou: "Não Compareceu" desconta a sessão do pacote e conta falta, porque a criança não avisou. "Falta Justificada" não desconta e não conta falta. As duas LIBERAM o horário — o que muda entre elas é o pacote da família e o alerta de faltas seguidas, não a agenda. Escolher a etiqueta errada mexe no pacote — na dúvida, pergunte antes de trocar.',
      },
      {
        tipo: 'paragrafo',
        texto:
          'Hoje quatro situações liberam o horário nesta clínica: "Não Compareceu", "Falta Justificada", "Desmarcado pelo Profissional" e "Desmarcado pelo Paciente". As três primeiras foram escolha da clínica, em 11/09/2026, pela razão que a Mariana deu: "nós fazemos muito disso, quando paciente desmarca sempre antecipamos ou encaixamos outro". As outras seguram o horário — e duas delas nem poderiam liberar: "Em Aberto" e "Aguardando Atendimento" são situações em aberto, e o sistema não deixa uma situação em aberto liberar horário.',
      },
      {
        tipo: 'paragrafo',
        texto:
          '"Desmarcado pelo Paciente" é a situação de quando a FAMÍLIA desmarca: ela libera o horário, não desconta sessão do pacote e não conta como falta. Ela chegou junto com os botões do lembrete, e é a que o botão "Desmarcar (a família pediu)" do cartão aplica — depois que a clínica a escolhe em Configurações › Comunicação, no ajuste "Status aplicado quando a família desmarca".',
      },
      {
        tipo: 'atencao',
        texto:
          'Liberar o horário numa situação MEXE NOS INDICADORES, e isso não é defeito. Em Indicadores › Agenda, um atendimento que liberou o horário passa a contar como desmarque e sai da ocupação; no detalhe de cada profissional (Indicadores › Equipe, clicando no nome), sai da conta de "marcado" e passa a aparecer em "horários liberados". Na prática: a Ocupação do mês cai um pouco e o Aproveitamento sobe, porque a hora devolvida deixa de contar como hora vendida. O "Não Compareceu" não se move, porque ele conta como falta antes de qualquer outra coisa.',
      },
      {
        tipo: 'dica',
        texto:
          'Quais situações existem e o que cada uma faz é decisão da clínica, não do programa: Cadastros › Status de agendamento mostra a lista e as regras de cada uma.',
      },
    ],
  },
  {
    id: 'atendimento',
    titulo: 'Registrar o atendimento e a evolução',
    resumo: 'O que o terapeuta faz depois da sessão — e por que o contador de evoluções existe.',
    blocos: [
      {
        tipo: 'paragrafo',
        texto:
          'Clique no cartão de um atendimento para abrir os detalhes: a criança, o pacote, o horário completo (por exemplo, "15/10/2026, das 08:40 às 09:20 · 40 min"), o profissional, o serviço e o convênio, além dos últimos atendimentos dela. Logo abaixo, já aberta, vem "Próximas sessões": as próximas quatro sessões da criança, cada uma com a data e o horário dela — num tratamento de 20 sessões, cada uma pode ter um horário diferente. Quando há mais, o painel diz quantas, e "Ver todas na ficha" leva à ficha da criança (para quem pode abrir fichas).',
      },
      { tipo: 'captura', id: 'agenda-detalhes' },
      {
        tipo: 'passos',
        passos: [
          'Abra o cartão do atendimento.',
          'Clique em Escrever evolução e escreva o que aconteceu na sessão.',
          'Clique em Registrar evolução.',
        ],
      },
      {
        tipo: 'paragrafo',
        texto:
          'Salvar a evolução registra a sessão junto: é um gesto só. Se a clínica ligou "Status aplicado ao salvar a evolução" (Configurações, aba Atendimento), a sessão também passa para esse status, normalmente "Finalizado com Evolução", e desconta do pacote. O painel avisa isso antes do clique, e o aviso depois de salvar confirma.',
      },
      {
        tipo: 'paragrafo',
        texto:
          'Só a sessão "Em Aberto" ou "Aguardando Atendimento" muda de status. Sessão com falta, desmarcada ou já finalizada fica como está. Quando o status não pode ser aplicado (o pacote está sem saldo, a sessão é de uma data futura ou o período já foi fechado), a evolução fica salva do mesmo jeito, e o painel diz por que a sessão não foi finalizada. Resolva pela situação do cartão. A exceção é a clínica que ligou também "Bloquear evolução após o status final": aí a evolução só é aceita junto com a finalização, e, recusado o status, nada é salvo e o aviso diz por quê.',
      },
      {
        tipo: 'paragrafo',
        texto:
          'Para registrar a sessão sem evolução, clique em Registrar sem evolução: aparece o campo de observações, e Registrar atendimento grava. Quem não escreve evolução, como a recepção, vê direto o campo e o botão. Registrar sem a evolução não desconta sessão do pacote — quem desconta é a situação do cartão.',
      },
      {
        tipo: 'paragrafo',
        texto:
          'A evolução também pode ser escrita depois, na ficha da criança, na seção Prontuário: cada sessão aparece numa linha, com o aviso "Em aberto" enquanto ninguém escreveu. É essa fila que aparece no contador de Evoluções do topo.',
      },
      {
        tipo: 'atencao',
        texto:
          'Evolução é documento clínico de uma criança. Escreva o que é da sessão, e nada além. Conversa interna da equipe vai para o mural de Tarefas, que por decisão da clínica não guarda dado de paciente.',
      },
    ],
  },
  {
    id: 'lista-de-espera',
    titulo: 'Lista de espera e encaixe',
    resumo: 'A fila de quem ainda não tem horário — e como transformar a fila em agendamento.',
    blocos: [
      {
        tipo: 'paragrafo',
        texto:
          'Quando não há horário para oferecer, a criança entra na fila em vez de sair pela porta sem nada. A tela mostra o que cada uma espera, a prioridade numa etiqueta (Urgente em vermelho, Alta em âmbar, Normal em cinza), há quantos dias está esperando e a observação da recepção — o dado que salva o encaixe ("só de manhã", "só com esta profissional").',
      },
      { tipo: 'captura', id: 'lista-de-espera' },
      {
        tipo: 'passos',
        passos: [
          'Clique em Entrar na fila para incluir uma criança, dizendo o que ela espera e a prioridade.',
          'Quando abrir um horário, procure na fila quem serve para aquele horário.',
          'Clique em Encaixar: a janela de marcação abre já com os dados da fila.',
          'Confirme e a criança sai da fila automaticamente.',
        ],
      },
      {
        tipo: 'dica',
        texto:
          'Vale escrever na observação o que a família aceita e o que não aceita. É esse texto que faz o encaixe acontecer em trinta segundos, em vez de uma ligação para descobrir de novo.',
      },
      {
        tipo: 'paragrafo',
        texto:
          'Sair da fila (o botão de contorno vermelho) é para quando a família desistiu ou resolveu por fora; o sistema pede confirmação. O encaixe já tira da fila sozinho — não precisa fazer os dois.',
      },
    ],
  },
  {
    id: 'retornos',
    titulo: 'Pendências de retorno',
    resumo: 'Quem está em tratamento e sumiu da agenda sem ninguém notar.',
    blocos: [
      {
        tipo: 'paragrafo',
        texto:
          'Uma criança em tratamento que fica sem próxima sessão marcada some da agenda em silêncio: ninguém liga, porque ninguém percebe. Esta tela é a lista dessas crianças, com há quantos dias estão sem agendamento e qual foi a última sessão.',
      },
      { tipo: 'captura', id: 'pendencias-de-retorno' },
      {
        tipo: 'paragrafo',
        texto:
          'O link Agendar retorno leva direto à marcação. Depois que o retorno é marcado, a criança sai da lista sozinha.',
      },
      {
        tipo: 'dica',
        texto:
          'A partir de quantos dias uma criança entra nesta lista é escolha da clínica, em Configurações › Agenda.',
      },
    ],
  },
  {
    id: 'pacientes',
    titulo: 'Crianças e famílias',
    resumo: 'Cadastrar, encontrar e acompanhar cada criança pela ficha.',
    blocos: [
      {
        tipo: 'paragrafo',
        texto:
          'A tela Pacientes é a lista de todas as crianças. Busque pelo nome no campo de cima, ou use os filtros Ativos, Inativos e Todos — a coluna Situação só aparece em Todos, que é quando ela diz algo. Ao lado de Cadastrar paciente fica "Copiar link do cadastro": é o endereço para a família preencher o cadastro em casa (ver Cadastros recebidos pelo link). Ele só aparece quando o link está gerado e ligado.',
      },
      { tipo: 'captura', id: 'pacientes' },
      {
        tipo: 'dica',
        texto:
          'A etiqueta âmbar "Cadastro incompleto" no fim da linha quer dizer que falta algum campo que a clínica marcou como obrigatório na aba Cadastro das Configurações. Aproveite a próxima visita da família para completar.',
      },
      {
        tipo: 'paragrafo',
        texto:
          'Os campos de texto do cadastro param no limite que o sistema aceita — não dá para digitar ou colar além dele. Quando o texto se aproxima do fim, aparece embaixo do campo quantas letras ainda cabem. Antes o excesso só era descoberto na hora de salvar, com a ficha inteira já preenchida.',
      },
      {
        tipo: 'paragrafo',
        texto:
          'No cadastro, comece o endereço pelo CEP: digite os oito números e o logradouro, o bairro, a cidade e o estado aparecem sozinhos — sobra digitar o número da casa, que é para onde o cursor vai. Se o CEP não for encontrado, ou se a internet estiver fora, aparece um aviso abaixo do campo e você preenche à mão normalmente; o cadastro salva do mesmo jeito. O CEP nunca mexe no número nem no complemento, que são seus.',
      },
      {
        tipo: 'paragrafo',
        texto:
          'Clique no nome para abrir a ficha. É nela que fica tudo o que se sabe sobre aquela criança, separado por seções no menu da esquerda.',
      },
      { tipo: 'captura', id: 'ficha-do-paciente' },
      {
        tipo: 'lista',
        itens: [
          { termo: 'Painel', descricao: 'o resumo: convênio, profissional, contrato, primeira e próxima sessão, sessões realizadas.' },
          { termo: 'Cadastro', descricao: 'os dados da criança e da família. É aqui que se corrige telefone e endereço — e aqui também o CEP preenche o endereço sozinho.' },
          { termo: 'Agendamentos', descricao: 'todo o histórico de horários, com a situação de cada um.' },
          { termo: 'Financeiro', descricao: 'o que a família deve e o que já pagou.' },
          { termo: 'Prontuário', descricao: 'as sessões atendidas e a evolução de cada uma.' },
          { termo: 'Anamnese', descricao: 'a ficha inicial que a especialidade preenche na primeira consulta.' },
          { termo: 'Presença', descricao: 'a chegada da criança no dia.' },
          { termo: 'Anexos', descricao: 'laudos, relatórios e documentos que a família traz.' },
          { termo: 'Contrato/Termo', descricao: 'o termo aceito pela família e a versão em vigor.' },
        ],
      },
      {
        tipo: 'passos',
        passos: [
          'Para cadastrar, clique em Cadastrar paciente.',
          'Preencha o que a clínica pede — os campos obrigatórios estão marcados.',
          'Salve. A criança já aparece na busca e pode ser marcada na agenda.',
        ],
      },
      { tipo: 'subtitulo', texto: 'Telefone de outro país', id: 'pacientes-telefone-de-fora' },
      {
        tipo: 'paragrafo',
        texto:
          'Antes de cada telefone fica a escolha do país, com a bandeira e o código. Ela já vem em Brasil (+55), e o número daqui não muda nada: digite como sempre, com o DDD.',
      },
      {
        tipo: 'passos',
        passos: [
          'Para o número de uma família que mora fora, clique na bandeira, antes do número, e escolha o país. Os mais comuns estão no topo; os outros, em ordem alfabética — com a lista aberta, digitar a primeira letra do nome leva até ele.',
          'Digite o número sem o código: o + e o código do país entram sozinhos. Se a família escreve o número com um 0 na frente, como no Reino Unido (07700 900123), digite sem o 0: 7700 900123.',
          'Saia do campo e leia o aviso embaixo dele. "WhatsApp:" seguido do número quer dizer que o lembrete e os avisos vão para ele, como para qualquer família. Se faltar ou sobrar dígito para aquele país, o aviso diz quantos.',
        ],
      },
      {
        tipo: 'dica',
        texto:
          'País que não está na lista: escolha "Outro país" e digite o código junto do número — o + entra sozinho. Se a família mandou o número já com o + na frente, pode colar como veio, mesmo com o Brasil escolhido: ao sair do campo, a bandeira passa para o país certo. Canadá e Estados Unidos têm o mesmo código (+1): a bandeira escolhida fica enquanto você edita, mas o cadastro reabre com a dos Estados Unidos; o número e o lembrete são os mesmos.',
      },
      {
        tipo: 'atencao',
        texto:
          'Sem o país escolhido, e sem o + na frente, o número é lido como brasileiro, e o lembrete não sai. Quando um número comprido aparecer com "Este número não recebe WhatsApp", confira se ele não é de fora do país. E o contrário: o número com + que também é um telefone do Brasil (como +11 98765-4321, digitado com o + por engano) ganha o aviso "Este número também é um telefone do Brasil". Se for do Brasil, escolha Brasil no país do telefone.',
      },
      {
        tipo: 'paragrafo',
        texto:
          'Paciente que deixou de ser atendido não se apaga: ele é desativado. O cadastro e o histórico continuam inteiros, mas o nome sai da lista de ativos e deixa de aparecer na hora de marcar — na agenda e na fila de espera. Por isso, quando você procura alguém para agendar e a busca diz que existe cadastro inativo com aquele nome, não cadastre a criança de novo: o cadastro dela está aqui, só desligado.',
      },
      {
        tipo: 'passos',
        passos: [
          'Para trazer de volta um paciente antigo, abra Pacientes e escolha o filtro Inativos.',
          'Clique no nome dele para abrir a ficha.',
          'No alto da ficha aparece o aviso "Cadastro inativo" — clique em Reativar, ao lado dele, e confirme.',
          'Pronto: ele volta para a lista de ativos e já pode ser escolhido na agenda. Para desativar de novo, o botão Desativar fica em Cadastro › Editar.',
        ],
      },
      {
        tipo: 'dica',
        texto:
          'O botão Reativar só aparece para quem tem permissão de editar cadastro de paciente. Se você vê o aviso mas não o botão, peça a quem cuida dos cadastros — o aviso continua ali para explicar por que a criança sumiu da agenda.',
      },
      {
        tipo: 'atencao',
        texto:
          'São dados de crianças. Não deixe a ficha aberta na tela do balcão quando sair, e não compartilhe o que está aqui fora do atendimento — o sistema registra quem abriu e quem alterou cada cadastro.',
      },
    ],
  },
  {
    id: 'cadastros-recebidos',
    titulo: 'Cadastros recebidos pelo link',
    resumo: 'O que as famílias preencheram sozinhas, esperando você conferir.',
    blocos: [
      {
        tipo: 'paragrafo',
        texto:
          'A clínica pode mandar um link para a família preencher o cadastro da criança pelo celular, em casa. O que ela envia NÃO vira paciente na hora: fica nesta tela, esperando alguém da recepção conferir. É por isso que o link pode ser divulgado sem medo — nada entra na base sem passar por uma pessoa.',
      },
      {
        tipo: 'passos',
        passos: [
          'Para mandar o link à família, clique em "Copiar link do cadastro" — o botão está no alto desta tela e ao lado de Cadastrar paciente, em Pacientes — e cole no WhatsApp. Ele só aparece quando o endereço foi gerado e está ligado em Configurações › Cadastro pelo link.',
          'Abra "Cadastros recebidos" na barra da esquerda. Os mais antigos aparecem primeiro.',
          'Leia os dados do envio. Se o sistema achar alguém parecido já cadastrado, ele aparece num quadro logo abaixo, dizendo se a coincidência é de CPF ou de telefone — confira se não é a mesma criança com o cadastro repetido. Telefone repetido entre irmãos é comum, e não quer dizer cadastro em dobro. A família que mora fora escolhe o país antes do número, como na ficha (ver Telefone de outro país, em Crianças e famílias).',
          'Se estiver tudo certo, clique em "Aceitar e abrir cadastro". O formulário de paciente abre já preenchido, e é ali que você corrige o que a família digitou errado antes de salvar.',
          'Se não for para cadastrar, clique em "Descartar" e escreva o motivo.',
        ],
      },
      {
        tipo: 'atencao',
        texto:
          'Aceitar ainda NÃO salva o paciente — e ao mesmo tempo tira o envio da fila, sem volta. Ele só existe como ficha depois que você clicar em salvar no formulário que abriu. Se for interrompida no meio, termine o cadastro antes de sair da tela: o envio não reaparece na lista.',
      },
      {
        tipo: 'dica',
        texto:
          'O aviso de "pode ser alguém que já está cadastrado" compara CPF e telefone. Nome parecido ele ainda não compara, então vale a pena olhar o nome também antes de aceitar.',
      },
      {
        tipo: 'atencao',
        texto:
          'Cadastro que ninguém conferir é apagado sozinho depois do prazo que a clínica configurou (o padrão é 30 dias). Não é faxina: é a lei — dado de criança parado numa fila é dado guardado sem motivo. A fila continua mostrando que houve um envio, sem os dados.',
      },
    ],
  },
  {
    id: 'profissionais',
    titulo: 'Profissionais',
    resumo: 'Quem atende, o que atende e em que horários — é isso que desenha a grade.',
    blocos: [
      {
        tipo: 'paragrafo',
        texto:
          'A lista mostra cada profissional, suas especialidades, os horários de atendimento e a situação. Clique no nome para abrir a ficha — o painel do mês, explicado logo abaixo —, ou em Editar para mudar o cadastro. Na ficha, quem edita o cadastro pode enviar a foto do profissional (Enviar foto: PNG, JPG ou WebP até 1 MB) — ela passa a aparecer na lista da agenda e nas colunas da Visão geral; sem foto, ficam as iniciais.',
      },
      { tipo: 'captura', id: 'profissionais' },
      {
        tipo: 'paragrafo',
        texto:
          'Os horários cadastrados aqui são o que a agenda desenha: se a grade de alguém está com o horário errado, o conserto é no cadastro do profissional, não na agenda.',
      },
      {
        tipo: 'dica',
        texto:
          'Um profissional que saiu da clínica deve ser marcado como inativo, nunca excluído: o histórico de atendimentos dele precisa continuar de pé.',
      },
      {
        tipo: 'paragrafo',
        texto:
          'Na edição também fica a caixa "Enviar mensagens automáticas às famílias", marcada para todos. Desmarque só para quem confirma as sessões com as famílias por conta própria: o passo a passo e o que muda estão em Mensagens (WhatsApp), no trecho "Tirar as mensagens automáticas de um profissional".',
      },
      { tipo: 'subtitulo', texto: 'A ficha do profissional: o painel do mês', id: 'profissionais-painel' },
      {
        tipo: 'paragrafo',
        texto:
          'A ficha é o painel do mês de cada profissional. O próprio profissional abre a dele em "Minha ficha", no alto da tela; quem administra abre a de qualquer um pelo nome, na lista de Profissionais, ou por "Abrir o painel", na aba Equipe dos Indicadores. No alto da ficha ficam as setas para trocar o mês e o botão Imprimir, que tira a ficha inteira em folha A4.',
      },
      {
        tipo: 'lista',
        itens: [
          { termo: 'Hoje na agenda', descricao: 'na própria ficha: o próximo atendimento em destaque, com a hora e a criança, quantos atendimentos há no dia e a situação de cada um. Na ficha de outro profissional, um atalho para a agenda dele.' },
          {
            termo: 'O mês em números',
            descricao:
              'atendimentos realizados, ocupação da grade, faltas, desmarques e evoluções em dia, cada um comparado com os mesmos dias do mês anterior. O "i" de cada número diz como a conta é feita. São os mesmos números da linha do profissional na aba Equipe dos Indicadores.',
          },
          {
            termo: 'Seis meses',
            descricao:
              'os atendimentos realizados e as faltas mês a mês, para quem vê a agenda e os atendimentos. O mês em curso leva um asterisco e conta só até agora, como o cartão de cima; os meses antes do início dos indicadores aparecem tracejados, como "sem dados" — nunca como zero.',
          },
          {
            termo: 'A semana e Onde a agenda não rendeu',
            descricao:
              'os dias e os períodos mais cheios e mais vazios, e o que se perdeu no mês: faltas, horários liberados, horários ocupados sem cobrança e as horas da grade que ficaram sem marcação.',
          },
          {
            termo: 'Pacientes',
            descricao: 'quantos tratamentos estão em andamento com o profissional, os pacotes perto do fim com o saldo de cada um e as sessões por convênio.',
          },
          {
            termo: 'Financeiro',
            descricao:
              'o que entrou no caixa da clínica pelos atendimentos DAQUELE profissional, com os seis meses, a forma de pagamento, o convênio e as sessões já realizadas e ainda sem pagamento. Nunca o total da clínica, nem o de colegas, nem despesas. Quem vê: o próprio profissional, se o nível de acesso dele tiver "Ver o que recebeu pelos próprios atendimentos" (ninguém ganha essa permissão sozinho — a clínica liga na grade de permissões), e quem fecha o repasse, um profissional por vez. A lista com o nome de cada criança nas sessões sem pagamento aparece só para quem vê a agenda; os outros veem só a quantidade. Convênio de plano não passa pelo caixa e não aparece. Nada se lança nem se cobra por aqui: a cobrança continua com o financeiro.',
          },
        ],
      },
      {
        tipo: 'dica',
        texto:
          'Cada gráfico tem, logo abaixo, "Ver os números em tabela" com os mesmos valores, e cada bloco aparece conforme a permissão de quem olha. Quem não tem a permissão de um bloco simplesmente não o vê — não aparece um espaço vazio nem um zero no lugar. Um profissional que vê só a própria agenda, ao abrir a ficha de um colega, encontra só os atalhos, nunca os números dele; quem vê a agenda da clínica inteira vê os números de todos, como já vê nos Indicadores. E se a ficha for consultada muitas vezes seguidas, ela pede um minuto antes de atualizar de novo.',
      },
      {
        tipo: 'atencao',
        texto:
          'Um terapeuta que vê só a própria agenda não vê os números de um colega: na ficha dele, o painel avisa que os números não estão no seu acesso, e o dia, as evoluções e os tratamentos viram atalhos para a agenda e para as filas. Não é defeito — um zero ali seria mentira.',
      },
    ],
  },
  {
    id: 'tratamentos',
    titulo: 'Tratamentos e pacotes de sessão',
    resumo: 'Quantas sessões a criança tem, quantas sobraram e quando o pacote acaba.',
    blocos: [
      {
        tipo: 'paragrafo',
        texto:
          'O tratamento é o pacote de sessões de uma criança: quantas foram contratadas, quantas já foram usadas e até quando vale. A cada atendimento com situação que consome sessão, o saldo cai.',
      },
      { tipo: 'captura', id: 'tratamentos' },
      {
        tipo: 'lista',
        itens: [
          { termo: 'Acabando', descricao: 'pacotes chegando ao fim — é a fila que a recepção precisa olhar toda semana.' },
          { termo: 'Vencidos', descricao: 'passaram da validade, com ou sem sessão sobrando.' },
          { termo: 'Parados', descricao: 'têm saldo, mas ninguém marca há tempo.' },
          { termo: 'Todos', descricao: 'a lista inteira.' },
        ],
      },
      {
        tipo: 'paragrafo',
        texto:
          'Os avisos ao lado das sessões existem para você falar com a família ANTES do pacote acabar, e não no dia em que a criança chega e não há sessão. Eles vêm em escada: laranja em "Faltam 2 sessões" e "Última sessão", vermelho em "Sem saldo" — que já é o pacote no fim.',
      },
      {
        tipo: 'dica',
        texto:
          'A partir de quantas sessões restantes o aviso aparece é escolha da clínica, nas Configurações. O mesmo aviso alimenta o contador de Pacotes no topo da tela.',
      },
    ],
  },
  {
    id: 'financeiro',
    titulo: 'Financeiro',
    resumo: 'O que entra, o que sai e o que está atrasado.',
    blocos: [
      {
        tipo: 'paragrafo',
        texto:
          'A tela tem duas partes: Lançamentos, que é a lista do que a clínica tem a receber e a pagar, e Fluxo de caixa, que mostra quanto tem em cada conta e o movimento por período.',
      },
      {
        tipo: 'lista',
        itens: [
          { termo: 'Em aberto / Pagos', descricao: 'separa o que ainda não foi quitado do que já foi.' },
          { termo: 'Receitas / Despesas', descricao: 'separa o que entra do que sai.' },
          { termo: 'Conta', descricao: 'filtra por conta da clínica, quando há mais de uma.' },
        ],
      },
      {
        tipo: 'passos',
        passos: [
          'Clique em Novo lançamento.',
          'Diga se é receita ou despesa, o valor, a data e a categoria.',
          'Escolha a forma de pagamento e a conta.',
          'Salve. O lançamento entra na lista e no fluxo de caixa.',
        ],
      },
      {
        tipo: 'paragrafo',
        texto:
          'A categoria, a forma de pagamento e a conta vêm dos Cadastros — o mesmo lugar onde ficam as especialidades e as salas. Se algum desses campos aparecer sem nada para escolher, é porque ainda não há o que escolher: o próprio formulário mostra o atalho para cadastrar, e o botão de salvar só volta a funcionar quando houver.',
      },
      {
        tipo: 'paragrafo',
        texto:
          'Para registrar o que a paciente pagou, use Novo lançamento como receita: ali você digita o valor, a forma de pagamento e a conta. Se a cobrança já estiver lançada e em aberto, o caminho é outro: clique em Pagar na linha dela, e o sistema marca a data do pagamento sozinho. Quem lança nem sempre é quem dá baixa — são permissões separadas de propósito.',
      },
      { tipo: 'subtitulo', texto: 'Lançar o que já foi pago, num passo só', id: 'financeiro-ja-pago' },
      {
        tipo: 'paragrafo',
        texto:
          'Quando a família paga na hora, não é preciso registrar e depois dar baixa. No Novo lançamento, marque "Já foi pago": o lançamento já nasce pago, com a data de hoje, e o botão passa a dizer "Registrar como pago" — é o aviso de que a baixa vai junto. No Faturar sessão da agenda é a mesma caixa, e a janela termina dizendo "Sessão faturada e paga".',
      },
      {
        tipo: 'passos',
        passos: [
          'Abra Novo lançamento (ou Faturar sessão, no cartão do atendimento).',
          'Preencha como sempre: valor, forma de pagamento, conta e categoria.',
          'Marque "Já foi pago".',
          'Clique em "Registrar como pago" (ou "Faturar como pago"). O lançamento entra na lista como pago e já aparece no fluxo de caixa.',
        ],
      },
      {
        tipo: 'dica',
        texto:
          'A caixa só aparece para quem pode dar baixa, e só ao criar — num lançamento que já existe, a baixa continua pelo botão Pagar. Com duas parcelas ou mais ela fica indisponível: cada parcela é paga no seu dia, com Pagar na linha dela.',
      },
      {
        tipo: 'atencao',
        texto:
          'A data do pagamento é sempre a de hoje. Se a família pagou ontem e você só está lançando agora, o pagamento fica com a data de hoje — igual ao botão Pagar. Marcou por engano? Quem pode dar baixa desfaz com Estornar, na linha do lançamento.',
      },
      { tipo: 'subtitulo', texto: 'Transferir entre contas', id: 'financeiro-transferir' },
      {
        tipo: 'paragrafo',
        texto:
          'Transferência é o dinheiro mudando de lugar entre duas contas da clínica: o depósito da gaveta no banco, o saque do banco para o troco. Não é receita nem despesa — por isso não se lança como despesa numa conta e receita na outra, o que inflaria os dois lados do mês. No Fluxo de caixa ela aparece numa linha própria e no total "Transferido", sem mexer nas entradas e nas saídas.',
      },
      {
        tipo: 'passos',
        passos: [
          'Em Financeiro, clique em "Transferir entre contas".',
          'Escolha De (a conta de onde o dinheiro sai) e Para (a conta para onde ele vai). A mesma conta nos dois lados não é aceita, e a tela diz por quê.',
          'Digite o valor. A data já vem com hoje; troque se o depósito foi em outro dia.',
          'Clique em Transferir. A transferência aparece no Fluxo de caixa.',
        ],
      },
      {
        tipo: 'paragrafo',
        texto:
          'Transferir pede duas contas ATIVAS. Com uma só (por exemplo, só o Caixa), a janela diz "Falta uma conta para transferir", mostra a conta que existe e oferece "Cadastrar conta" em vez dos campos. Conta inativa não aparece como opção numa transferência nova; ao editar uma antiga, a conta gravada continua lá mesmo que tenha sido desativada.',
      },
      {
        tipo: 'paragrafo',
        texto:
          'Para corrigir ou apagar uma transferência, vá à aba Fluxo de caixa e use Editar ou Excluir na linha dela. Excluir pede confirmação e diz o efeito: o dinheiro volta a constar na conta de origem.',
      },
      {
        tipo: 'paragrafo',
        texto:
          'O que está vencido e não foi quitado aparece no contador de Atrasos, lá no topo da tela — e a cobrança da família também aparece na ficha da criança, na seção Financeiro.',
      },
      { tipo: 'subtitulo', texto: 'Quanto tem em cada conta, e acertar com o banco', id: 'financeiro-saldo' },
      {
        tipo: 'paragrafo',
        texto:
          'A aba Fluxo de caixa abre com um cartão por conta — o caixa da recepção, cada banco — dizendo quanto tem nela hoje, e um cartão com o total. O número é o saldo de abertura da conta mais tudo o que foi pago e transferido desde então: receita paga soma, despesa paga subtrai, e a transferência tira de uma conta e põe na outra. O que está em aberto não entra; só o dinheiro que de fato passou pela conta.',
      },
      {
        tipo: 'lista',
        itens: [
          { termo: 'Clicar no cartão', descricao: 'mostra logo abaixo só o extrato daquela conta. Clicar de novo, ou no cartão "Todas as contas", volta ao extrato da clínica inteira.' },
          { termo: 'Saldo anterior', descricao: 'a primeira linha do extrato: quanto havia no fim do dia anterior ao período escolhido.' },
          { termo: 'Coluna Saldo', descricao: 'quanto ficou depois de cada movimento. Com uma conta escolhida, é o saldo dela; com todas, é o da clínica — e aí a transferência entre duas contas não muda o número, porque o dinheiro só mudou de lugar.' },
          { termo: 'Conta inativa', descricao: 'continua aparecendo enquanto tiver dinheiro, marcada como Inativa, para o total bater com a realidade.' },
        ],
      },
      {
        tipo: 'paragrafo',
        texto:
          'Uma conta que nunca teve saldo de abertura começa do zero e soma tudo o que foi lançado nela — por isso o cartão avisa que o número pode não bater com o banco. Para acertar, diga quanto havia na conta num dia em que você sabe o valor:',
      },
      {
        tipo: 'passos',
        passos: [
          'Pegue o extrato do banco (ou conte a gaveta) de um dia — por exemplo, o saldo do banco no início de 1º de outubro.',
          'Em Financeiro › Fluxo de caixa, no cartão da conta, clique em "Definir saldo de abertura".',
          'Informe o dia e o valor que havia na conta no início desse dia. Conta no cheque especial vai com o sinal de menos: -350,00.',
          'Clique em "Salvar abertura". O cartão e o extrato se refazem na hora, e a mudança fica registrada na auditoria.',
        ],
      },
      {
        tipo: 'dica',
        texto:
          'O que foi pago antes do dia da abertura continua no extrato daquele período, mas não mexe mais no saldo: já está dentro do valor de abertura. Se o cartão ainda não bater com o banco, procure, a partir daquele dia, o que falta lançar ou o que foi lançado na conta errada. Para corrigir a abertura depois, use "Ajustar abertura" no mesmo cartão.',
      },
      {
        tipo: 'atencao',
        texto:
          'Mudar o dia ou o valor da abertura refaz todos os saldos daquela conta, inclusive os do passado. Os cartões, os saldos e a abertura só aparecem para quem tem a permissão de ver o Fluxo de caixa; acertar a abertura pede também a de editar contas.',
      },
      { tipo: 'subtitulo', texto: 'Pagamento de pacote: diga de qual tratamento é', id: 'financeiro-tratamento' },
      {
        tipo: 'paragrafo',
        texto:
          'Quando a família paga, lance a receita com a criança como interessada. Se ela tem um só pacote particular em andamento, o campo Tratamento já vem preenchido (marcado como sugestão) e a tela diz para qual profissional o pagamento vai — confira e salve. Se não houver sugestão, escolha o pacote. É por ele que o pagamento chega ao profissional no Recebido por profissional; sem ele, o valor aparece em "Sem profissional". A sessão cobrada pela agenda (Faturar) já vem com o tratamento certo, e ele não se troca.',
      },
      {
        tipo: 'paragrafo',
        texto:
          'Esqueceu de escolher o tratamento num pagamento que já foi dado como pago? Abra Editar: no lançamento pago, só o tratamento, a observação e o documento mudam — o valor, a conta e a data do pagamento ficam como estão, e o pagamento continua no mês em que a família pagou. Trocar o tratamento de um pagamento já recebido é de quem dá baixa nos pagamentos; para os outros, o campo aparece só para leitura.',
      },
      {
        tipo: 'dica',
        texto:
          'Pacote pago adiantado não se fatura de novo sessão por sessão pela agenda: o profissional apareceria recebendo duas vezes no fechamento do mês.',
      },
      { tipo: 'subtitulo', texto: 'Ligar de uma vez os pagamentos que ficaram sem tratamento', id: 'financeiro-vincular' },
      {
        tipo: 'passos',
        passos: [
          'Em Financeiro, abra "Pagamentos sem tratamento" (ou clique em "Vincular pagamentos" no aviso do Recebido por profissional).',
          'Escolha o mês. A lista mostra cada pagamento com a criança, o valor e o tratamento sugerido — os que têm sugestão já vêm marcados.',
          'Confira. Para os sem sugestão (a criança tem mais de um pacote, ou nenhum), escolha o tratamento na própria linha, ou deixe desmarcado.',
          'Clique em "Vincular". Vai tudo ou nada: se uma linha for recusada, a tela aponta qual e nada é gravado. A data do pagamento não muda.',
        ],
      },
      { tipo: 'subtitulo', texto: 'Guardar o comprovante, a nota e o recibo', id: 'financeiro-anexos' },
      {
        tipo: 'paragrafo',
        texto:
          'Cada lançamento guarda os próprios arquivos: o comprovante do PIX, a nota fiscal do fornecedor, o recibo assinado. Quando o contador pedir a nota de março, ela está no lançamento — e a linha dele, na lista, mostra o selo "Com anexo".',
      },
      {
        tipo: 'passos',
        passos: [
          'Na lista de lançamentos, clique em Editar na linha do lançamento.',
          'Na seção Anexos, clique em "Anexar arquivo" e escolha o arquivo: PDF, imagem (JPEG, PNG ou WEBP) ou o XML da nota fiscal, de até 10 MB.',
          'Pronto: o arquivo fica guardado na hora, sem precisar salvar o lançamento. Para abrir, use Baixar.',
        ],
      },
      {
        tipo: 'dica',
        texto:
          'Vale também para lançamento já pago e para mês já fechado: o anexo não muda nenhum valor. Para ver os arquivos sem abrir a edição, clique no selo "Com anexo" da linha.',
      },
      {
        tipo: 'atencao',
        texto:
          'Um lançamento com anexo só pode ser excluído depois que os anexos forem excluídos — o sistema recusa e diz isso. O anexo excluído some do lançamento, mas continua guardado pelo prazo de retenção, e a exclusão fica registrada na auditoria.',
      },
      { tipo: 'subtitulo', texto: 'Cobrar pelo WhatsApp', id: 'financeiro-cobrar' },
      {
        tipo: 'paragrafo',
        texto:
          'Numa receita em aberto de uma criança, o botão Cobrar prepara a conversa com o responsável no WhatsApp, com a mensagem da clínica já escrita. Quem envia é você: o sistema não manda nada sozinho. O texto da mensagem é da clínica e se ajusta em Configurações › Financeiro.',
      },
      {
        tipo: 'passos',
        passos: [
          'Na lista de lançamentos, clique em Cobrar na linha da receita (ou em "Cobrar pelo WhatsApp", na edição do lançamento).',
          'Se a criança tem mais de um responsável com telefone, escolha a quem enviar.',
          'Clique em "Abrir conversa". O WhatsApp abre numa nova aba, com a mensagem pronta.',
          'Revise o texto e envie por lá.',
        ],
      },
      {
        tipo: 'dica',
        texto:
          'Antes de cobrar, olhe o aviso "Família já lembrada": ele diz quando a conversa foi aberta pela última vez e por quem. A edição do lançamento mostra a mesma coisa em "Cobrança aberta em". O sistema sabe que a conversa foi aberta, não que a mensagem foi enviada.',
      },
      {
        tipo: 'atencao',
        texto:
          'O WhatsApp que abre é o que estiver conectado neste computador. Use o WhatsApp da clínica, e não o seu pessoal: é por ele que a família reconhece a clínica e responde. Se a ficha da criança não tem telefone de responsável, a janela avisa e oferece abrir a ficha para cadastrar.',
      },
    ],
  },
  {
    id: 'tarefas',
    titulo: 'Tarefas da equipe',
    resumo: 'O mural interno: quem faz o quê, até quando.',
    blocos: [
      {
        tipo: 'paragrafo',
        texto:
          'O mural é da equipe, não do paciente: combinados internos, compras, ligações a fazer, pendências com convênio. Os cartões andam por quatro colunas.',
      },
      { tipo: 'captura', id: 'tarefas' },
      {
        tipo: 'lista',
        itens: [
          { termo: 'A fazer', descricao: 'o que ainda não começou.' },
          { termo: 'Em andamento', descricao: 'o que a equipe está fazendo agora.' },
          { termo: 'Aguardando', descricao: 'travado em terceiro — retorno de convênio, fornecedor, família.' },
          { termo: 'Concluída', descricao: 'feito. Arquive quando não precisar mais ver.' },
        ],
      },
      {
        tipo: 'paragrafo',
        texto:
          'Uma tarefa sem responsável mostra o botão Assumir: qualquer pessoa da equipe pode pegar para si. Dá para comentar dentro do cartão e chamar alguém escrevendo @ antes do nome — a pessoa vê o aviso no contador de Tarefas.',
      },
      {
        tipo: 'atencao',
        texto:
          'O mural não guarda dado de criança, de propósito. Se a tarefa é sobre um atendimento, escreva só o combinado ("confirmar horário de quinta com a família") — o dado clínico fica no prontuário.',
      },
    ],
  },
  {
    id: 'mensagens',
    titulo: 'Mensagens (WhatsApp)',
    resumo: 'As conversas com as famílias no número da clínica, sem celular pessoal.',
    blocos: [
      {
        tipo: 'paragrafo',
        texto:
          'As conversas do WhatsApp da clínica ficam aqui, à vista de quem tem permissão para responder — e não no celular particular de uma pessoa. A lista da esquerda separa Ativas, Não lidas, Sem paciente e Arquivadas.',
      },
      { tipo: 'captura', id: 'mensagens' },
      {
        tipo: 'paragrafo',
        texto:
          'Escolha uma conversa à esquerda para ler o histórico e responder. Conversas que ainda não foram ligadas a uma criança aparecem em "Sem paciente" — vincule para que o histórico apareça também na ficha.',
      },
      {
        tipo: 'paragrafo',
        texto:
          'Quando a família toca num botão do lembrete ("Confirmo" ou "Preciso desmarcar"), a conversa mostra "Tocou em:" seguido do botão. O toque já vale sozinho: a sessão aparece confirmada, ou com o pedido de desmarque em vermelho, no cartão da agenda, e a família recebe a resposta automática — ninguém precisa copiar a resposta à mão. Se o lembrete falava de mais de uma sessão, como irmãos no mesmo dia, o toque vale para todas. Resposta digitada, como "ok", continua sendo lida pela recepção.',
      },
      { tipo: 'subtitulo', texto: 'O que a família mandou' },
      {
        tipo: 'paragrafo',
        texto: 'Nem tudo o que chega é texto. Quando a família manda outra coisa, a conversa diz em palavras o que foi:',
      },
      {
        tipo: 'lista',
        itens: [
          {
            termo: '"Reagiu com 👍"',
            descricao:
              'a família reagiu a uma mensagem com um emoji; "Tirou a reação" quer dizer que ela desfez. A conversa ainda não mostra a qual mensagem a reação se refere.',
          },
          { termo: '"Enviou uma figurinha"', descricao: 'uma figurinha do WhatsApp. Ela abre em outra aba, pelo link "Abrir figurinha".' },
          {
            termo: '"Enviou uma localização"',
            descricao: 'o nome e o endereço do lugar, quando vieram junto. "Abrir no mapa" mostra o ponto num mapa, em outra aba.',
          },
          { termo: '"Enviou um contato"', descricao: 'o nome e o telefone de alguém que a família compartilhou, um por linha.' },
          {
            termo: '"A família editou uma mensagem"',
            descricao: 'o WhatsApp não mostra a edição ao sistema. A versão anterior continua na conversa, mais acima.',
          },
          {
            termo: '"A família enviou uma enquete"',
            descricao: 'o WhatsApp não mostra enquetes ao sistema. Se for importante, peça a resposta em texto.',
          },
          {
            termo: '"A família trocou de número no WhatsApp"',
            descricao:
              'o próprio WhatsApp avisa a troca. Confira o telefone no cadastro da criança: os lembretes continuam indo para o número antigo até alguém trocar.',
          },
          {
            termo: '"A família mandou um arquivo que o sistema não aceita"',
            descricao:
              'o arquivo chegou, mas o sistema recusou guardá-lo; logo abaixo vem o motivo, e a legenda, se houver. Se for importante, peça para mandar de outro jeito, como foto ou texto.',
          },
          {
            termo: '"O WhatsApp não mostra esta mensagem ao sistema"',
            descricao:
              'foto de visualização única e mensagem temporária, entre outras, não chegam até aqui: o próprio WhatsApp não entrega o conteúdo. Se for importante, peça à família para mandar em texto, foto ou áudio.',
          },
        ],
      },
      { tipo: 'subtitulo', texto: 'Tirar as mensagens automáticas de um profissional', id: 'mensagens-por-profissional' },
      {
        tipo: 'paragrafo',
        texto:
          'Há profissional que prefere confirmar as sessões com as famílias por conta própria. Para que essas famílias não recebam duas confirmações, o WhatsApp automático pode ser desligado só para ele, sem mexer nos outros profissionais nem na clínica toda.',
      },
      {
        tipo: 'passos',
        passos: [
          'Abra Profissionais e clique em Editar na linha do profissional.',
          'Desmarque "Enviar mensagens automáticas às famílias" e clique em Salvar.',
          'Leia o aviso que aparece e confirme em "Mudar as mensagens".',
        ],
      },
      {
        tipo: 'paragrafo',
        texto:
          'A partir daí, as famílias dele deixam de receber o lembrete da véspera e a confirmação do primeiro agendamento, inclusive das sessões que já estavam marcadas. Se a família também tem sessão com outro profissional no mesmo dia, o lembrete chega só com os horários desse outro. Ao marcar a primeira sessão de uma criança com ele, a tela avisa que a família não foi avisada pelo WhatsApp: é esperado, porque é o próprio profissional quem confirma.',
      },
      {
        tipo: 'dica',
        texto:
          'Os avisos de remarcação e de cancelamento continuam saindo quando a recepção marca "Avisar a família pelo WhatsApp". Na ficha do profissional aparece "Mensagens automáticas às famílias: desligadas", e para voltar ao normal basta marcar a caixa de novo.',
      },
      { tipo: 'subtitulo', texto: 'No celular' },
      {
        tipo: 'paragrafo',
        texto:
          'No celular, a lista e a conversa não cabem lado a lado. Ao tocar numa conversa, ela abre na tela inteira, e a seta no alto, à esquerda, volta para a lista. Silenciar lembretes, Arquivar e Vincular paciente ficam em "Mais ações", os três pontinhos no canto de cima, à direita. O campo de escrever fica sempre à vista, embaixo.',
      },
      {
        tipo: 'atencao',
        texto:
          'Se o número da clínica não estiver conectado, um aviso amarelo aparece no alto: o histórico continua legível, mas nada é enviado. Quem conecta o número é a administração, pelas Configurações.',
      },
    ],
  },
  {
    id: 'indicadores',
    titulo: 'Indicadores',
    resumo: 'Os números do mês com explicação: cartões que comparam, o "i" com a conta exata e as regras para os números saírem certos.',
    blocos: [
      {
        tipo: 'paragrafo',
        texto:
          'Indicadores mostra como a clínica está indo no mês, em cinco abas: Visão geral, Financeiro, Agenda, Pacientes e Equipe. Um único seletor de mês, acima das abas, vale para todas: trocar o mês numa aba troca em todas. O endereço da página leva o mês, então dá para copiar o link e mandar para alguém abrir o mesmo recorte. Só aparecem as abas e os cartões que a sua permissão deixa ver, por isso duas pessoas podem ver esta tela de maneiras diferentes.',
      },
      { tipo: 'captura', id: 'indicadores' },
      { tipo: 'subtitulo', texto: 'Como ler uma aba' },
      {
        tipo: 'lista',
        itens: [
          { termo: 'Linha do período', descricao: 'a linha pequena no alto diz o que está sendo medido e contra o quê ("De 1º a 6 de outubro, até hoje, comparado com 1º a 6 de setembro"), ou por que não há comparação.' },
          { termo: 'Cartões', descricao: 'cada um traz o número principal, a comparação com o mês anterior (seta e texto, em verde quando melhorou e em vermelho quando piorou) e uma frase que explica o número.' },
          { termo: 'O "i"', descricao: 'no canto de cada cartão, abre a definição exata da conta: o que entra, o que fica de fora e de que período. Se um número parecer estranho, comece por ele.' },
          { termo: 'Gráficos', descricao: 'o título já diz a conclusão ("As faltas se concentram na segunda-feira"). O dado que importa vem em destaque e o resto mais apagado. Embaixo, "Ver os números em tabela" mostra os mesmos valores em linhas.' },
          { termo: '"Sem dados"', descricao: 'os meses antes do início dos indicadores aparecem hachurados e com a palavra "sem dados", nunca como zero.' },
        ],
      },
      { tipo: 'subtitulo', texto: 'A comparação é justa' },
      {
        tipo: 'paragrafo',
        texto:
          'No mês em curso, o sistema compara do dia 1 até hoje com os MESMOS dias do mês anterior: no dia 5 de outubro, compara 1º a 5 de outubro com 1º a 5 de setembro. Comparar cinco dias com um mês inteiro mostraria sempre uma queda que não existe. Mês fechado compara com o mês anterior inteiro. Quando o período comparado não está inteiro depois do início dos indicadores — por exemplo outubro contra setembro, com os indicadores contando a partir de 1º de outubro —, não há comparação, e a frase do período diz desde quando os indicadores contam. O início é o primeiro agendamento ou, se preenchida, a data de Configurações › Clínica › "Indicadores a partir de". Quantidades são comparadas em números ("31 a mais"), dinheiro em porcentagem ("18% a menos") e taxas em pontos percentuais ("2,6 p.p. a mais"), que é a diferença entre duas porcentagens.',
      },
      { tipo: 'subtitulo', texto: 'Para os números ficarem certos' },
      {
        tipo: 'paragrafo',
        texto:
          'Os indicadores só contam o que foi registrado. No fim da Visão geral, um quadro curto lembra as quatro regras e mostra, com o número em destaque, a que está sendo quebrada agora: todo profissional com horário de atendimento cadastrado (sem ele, fica fora da ocupação); baixa em toda sessão que já passou ("em aberto" não conta como realizada); todo recebimento lançado no caixa (o dinheiro é só o que foi lançado); e a data a partir da qual os indicadores contam.',
      },
      { tipo: 'subtitulo', texto: 'As abas' },
      {
        tipo: 'lista',
        itens: [
          { termo: 'Visão geral', descricao: 'o mês da clínica inteira: os cartões Dinheiro, Agenda, Pacientes e Equipe, a tendência do recebido mês a mês e o quadro "Pede atenção". Cada cartão é uma porta para a aba dele.' },
          { termo: 'Financeiro', descricao: 'recebido, a receber no mês, a receber em atraso e valor médio por sessão; embaixo, os gráficos financeiros.' },
          { termo: 'Agenda', descricao: 'ocupação, sessões realizadas, faltas, desmarques e confirmações dos lembretes (pela família ou pela recepção); as faltas por dia da semana, o mapa de ocupação por dia e período, as faltas e desmarques por convênio e a situação das sessões que já passaram. Clicar numa situação abre a lista só das sessões que já passaram, as mesmas que a tabela conta.' },
          { termo: 'Pacientes', descricao: 'ativos, novos, os que saíram, pacotes no fim e fila de espera; os cadastros novos mês a mês e as contagens por sexo, faixa etária, convênio e indicação. Os números desta aba são da CLÍNICA INTEIRA, mesmo para quem vê só a própria agenda. A exceção é "Pacotes no fim": ele segue a agenda de quem olha e só aparece para quem tem Tratamentos › Ver. A fila de espera só aparece para quem tem Lista de espera › Ver. Quem está sem o sexo ou sem a data de nascimento no cadastro aparece como "Não informado".' },
          { termo: 'Equipe', descricao: 'evoluções em dia e atrasadas, quem está sem grade (sem horário ou sem especialidade no cadastro); os atendimentos por especialidade e convênio; e as duas tabelas — "Por profissional", que conta o PERÍODO (no mês em curso, só até hoje), e a produção do mês, que conta o mês INTEIRO.' },
        ],
      },
      { tipo: 'captura', id: 'indicadores-agenda' },
      { tipo: 'subtitulo', texto: 'O que cada número conta' },
      {
        tipo: 'lista',
        itens: [
          { termo: 'Ocupação', descricao: 'sessões marcadas ÷ horários disponíveis na grade dos profissionais, já sem feriados e bloqueios. Só entram os profissionais com horário e especialidade cadastrados, e o cartão diz quantos são.' },
          { termo: 'Realizadas', descricao: 'sessões que já passaram com situação que desconta do pacote e não marca falta. Uma situação que desconta E marca falta conta como falta.' },
          { termo: 'Faltas', descricao: 'sessões que já passaram com situação que marca falta, em % das sessões que já passaram. As que ainda vão acontecer nunca entram na conta.' },
          { termo: 'Desmarques', descricao: 'sessões que já passaram com situação que libera o horário. Cada sessão conta numa coisa só: o que é falta conta como falta, e o que foi realizado conta como realizado, mesmo que a situação também libere o horário.' },
          { termo: 'Confirmadas', descricao: 'lembretes do WhatsApp cuja sessão foi confirmada — pela família, tocando em "Confirmo", ou pela recepção, marcando a sessão como confirmada —, divididos pelos lembretes enviados.' },
          { termo: 'Novos', descricao: 'pacientes cadastrados no período. Quem veio do sistema anterior na importação não conta: já era paciente da clínica.' },
          { termo: 'Saíram', descricao: 'pacientes que passaram de ativo para inativo no período. Quem foi inativado, reativado e inativado de novo conta uma vez.' },
          { termo: 'Evoluções em dia', descricao: 'das sessões realizadas no período, quantas já têm a evolução escrita.' },
          { termo: 'Evoluções atrasadas', descricao: 'atendimentos sem evolução há mais dias que o prazo da clínica (Configurações). "Sem evolução" conta todas as que ainda não foram escritas, dentro ou fora do prazo.' },
          { termo: 'A receber em atraso', descricao: 'receitas vencidas e ainda não pagas. As contas a pagar ficam fora; o aviso de lançamentos vencidos do "Pede atenção" soma as duas.' },
        ],
      },
      {
        tipo: 'dica',
        texto:
          'Quem decide o que é falta, realizado ou desmarque é o cadastro de situações (Cadastros › Status de agendamento), não o programa: mudou a regra de uma situação, os indicadores mudam junto. E situação marcada errada no cartão da agenda aparece aqui no fim do mês como falta que não houve, ou atendimento que não aconteceu.',
      },
      { tipo: 'subtitulo', texto: 'Pede atenção' },
      {
        tipo: 'paragrafo',
        texto:
          'Na Visão geral, o quadro "Pede atenção" junta o que está esperando alguém agir: pedidos de desmarque pelo WhatsApp, pacotes no fim, atendimentos sem evolução e lançamentos vencidos. Ele mostra só a quantidade, nunca o nome de uma criança, e cada linha tem o atalho para a tela onde se resolve. Quando não há nada pendente, aparece "Nada pede atenção agora".',
      },
      { tipo: 'subtitulo', texto: 'A equipe, profissional por profissional' },
      {
        tipo: 'paragrafo',
        texto:
          'A aba Equipe tem uma linha por profissional, em ordem de sessões realizadas: ocupação, realizadas, faltas, evoluções em dia e atrasadas, sempre no período (no mês em curso, do dia 1 até hoje). Quem não tem grade — falta o horário ou a especialidade no cadastro — aparece com o aviso "Sem grade: falta horário ou especialidade" e o atalho "Abrir o cadastro": sem grade não há ocupação para calcular. Clicar no nome abre o detalhe do profissional, com a semana dia a dia, os percentuais com a conta escrita e onde a agenda não rendeu — esse detalhe é do mês INTEIRO, por isso os números dele podem ser maiores que os da linha da tabela.',
      },
      { tipo: 'captura', id: 'indicadores-equipe' },
      {
        tipo: 'lista',
        itens: [
          { termo: 'Capacidade', descricao: 'o que cabe na grade do mês: os horários cadastrados no profissional (Profissionais › horários), dia a dia, menos feriados e bloqueios, divididos pelo tempo de sessão da especialidade. Quem atende em grupo soma as vagas de cada horário.' },
          { termo: 'Produtividade', descricao: 'quanto da grade virou atendimento (realizado ÷ capacidade). A ocupação mede o que foi MARCADO; a produtividade, o que de fato aconteceu.' },
          { termo: 'Aproveitamento', descricao: 'no detalhe do profissional: quanto do que foi marcado aconteceu (realizado ÷ marcado). Baixo = muita falta ou desmarque.' },
          { termo: '"Sem grade neste mês"', descricao: 'no detalhe: o profissional TEM horários, mas o mês inteiro caiu em feriado ou bloqueio. Não pede cadastro nenhum.' },
          { termo: '"Outros, sem cobrança"', descricao: 'no detalhe, é onde caem as situações que SEGURARAM o horário sem descontar sessão e sem serem falta — hoje, nesta clínica, é o caso de "Reserva de Agenda". Não é "ainda vai acontecer". Quem liberou o horário não cai aqui: vai para "horários liberados", logo ao lado.' },
        ],
      },
      { tipo: 'subtitulo', texto: 'A produção do mês' },
      {
        tipo: 'lista',
        itens: [
          { termo: 'Atendimentos finalizados', descricao: 'as sessões registradas, contadas pelo término do atendimento. Pela evolução escrita direto da sessão, o término é o fim da sessão, e ela conta no dia da sessão mesmo escrita depois. Pelo "Registrar sem evolução", o término é a hora do registro: registrada depois, conta no dia em que foi registrada.' },
          { termo: 'Sessões consumidas', descricao: 'as sessões que descontaram do pacote, contadas pelo DIA DA SESSÃO. A baixa de uma sessão de setembro feita em outubro conta em setembro, o mês em que a sessão aconteceu.' },
          { termo: 'Evoluções preenchidas', descricao: 'as evoluções escritas no mês, contadas pelo dia em que foram escritas.' },
        ],
      },
      {
        tipo: 'paragrafo',
        texto:
          'Os três números contam coisas diferentes e por isso não precisam bater. Todos são do mês inteiro escolhido no alto, nunca de um dia só. Em Relatórios, os relatórios de Atendimentos e de Evoluções contam tudo pelo dia da sessão. Por isso uma sessão de setembro registrada sem evolução em outubro, ou com a evolução escrita em outubro, aparece em setembro lá e em outubro aqui.',
      },
      {
        tipo: 'dica',
        texto:
          '"Realizadas", nas abas Agenda e Equipe, é a situação marcada no cartão da agenda (a que desconta sessão), porque é isso que a recepção marca no balcão. Os atendimentos por especialidade, na Equipe, contam pelo registro clínico do atendimento — os dois números podem diferir quando o profissional ainda não registrou o atendimento no prontuário.',
      },
      { tipo: 'subtitulo', texto: 'Os gráficos financeiros' },
      {
        tipo: 'paragrafo',
        texto:
          'Embaixo dos cartões da aba Financeiro ficam quatro visões: de quais categorias veio o dinheiro que ENTROU no mês, para quais categorias foi o que SAIU no mês, o ano inteiro mês a mês, e o que ainda VAI VENCER. As setas de ano, ali, andam doze meses de uma vez e mexem no mesmo mês do alto — recuar de janeiro para dezembro também troca o ano. Há um período só, de propósito: assim é impossível ficar olhando as categorias de um mês ao lado do gráfico de outro ano e achar que combinam.',
      },
      {
        tipo: 'dica',
        texto:
          'Nessa parte há duas contas diferentes, e elas NUNCA se somam. "Já entrou e saiu" é o dinheiro que de fato passou pelo caixa. "Ainda vai vencer" é o que está registrado mas ninguém pagou, colocado no mês da data de vencimento. Somar as duas dá um número que não existe em relatório nenhum — por isso a tela não mostra esse total em lugar algum. E os dois valores de "já vencido" são a parte dos meses de baixo que passou da data: já estão contados ali, não são dinheiro a mais.',
      },
      {
        tipo: 'dica',
        texto:
          'Um cuidado no cadastro: os NOMES das categorias e subcategorias aparecem nessa tela para quem tem permissão de ver os totais do caixa — mesmo para quem não pode abrir o cadastro de categorias. Por isso nunca escreva o nome de uma criança numa categoria ("Sessões — Fulaninho"); use só o tipo de serviço.',
      },
      { tipo: 'subtitulo', texto: 'Imprimir' },
      {
        tipo: 'paragrafo',
        texto:
          'Toda aba tem o botão "Imprimir" no alto, à direita do mês. Ele gera uma folha A4 limpa, sem menu, sem botões e sem barra lateral: no alto vão a marca da clínica, a aba e o mês por extenso; embaixo, a linha do período, os cartões, os gráficos (em cor) e as tabelas da aba. O que não cabe continua nas páginas seguintes, sem partir um cartão ou um gráfico ao meio. Na janela de impressão do navegador, escolha "Salvar como PDF" para arquivar ou mandar ao convênio, ou imprima direto para assinar.',
      },
    ],
  },
  {
    id: 'relatorios',
    titulo: 'Relatórios',
    resumo: 'Os papéis de conferência: achar pelo nome antigo, escolher o recorte, imprimir.',
    blocos: [
      {
        tipo: 'paragrafo',
        texto:
          'Relatórios é a tela dos papéis do dia a dia: a lista de presença para assinar, os atendimentos do mês para conferir com o convênio, as sessões que estão acabando, os aniversariantes. Ela fica no menu, em Gestão, e mostra só os relatórios que a sua permissão alcança — cada relatório pede a permissão do assunto dele (quem vê a agenda vê os relatórios da agenda; a movimentação da agenda, que lê a auditoria, pede a permissão de auditoria).',
      },
      { tipo: 'captura', id: 'relatorios' },
      { tipo: 'subtitulo', texto: 'Achar o relatório' },
      {
        tipo: 'paragrafo',
        texto:
          'Os relatórios estão em cinco grupos — Agenda, Atendimentos, Tratamentos, Pacientes e Financeiro — e há uma busca no alto. São menos relatórios do que no sistema antigo, de propósito: cada um tem filtros e uma opção "Dividir por" que resolvem o que antes eram vários. Por isso cada cartão traz a linha "No ClinicaÁgil: …" com os nomes antigos que ele cobre, e a busca encontra também por esses nomes. Procure "Agenda por Status" e vai cair em Agendamentos.',
      },
      { tipo: 'subtitulo', texto: 'Escolher o recorte' },
      {
        tipo: 'lista',
        itens: [
          { termo: 'Período', descricao: 'de e até, com atalhos ao lado (hoje, este mês, mês passado, últimos 30 ou 90 dias, este ano). O teto é de um ano por vez; acima disso o botão Gerar fica desligado e a tela diz o porquê.' },
          { termo: 'Filtros', descricao: 'profissional, convênio, especialidade, situação, tipo de movimentação, ordenação — só aparecem os que fazem sentido naquele relatório, e o formulário muda com a situação escolhida (em Pacientes, "Ativas" não pede período; "Aniversariantes" pede o mês; "Sem atendimento" pede os dias).' },
          { termo: 'Resultado', descricao: '"Analítico" lista linha a linha (cada atendimento, cada criança); "Sintético" traz só os totais, divididos pelo que você escolher em "Dividir por" — por profissional, por convênio, por mês…' },
          { termo: 'O endereço guarda o recorte', descricao: 'depois de gerar, copie o link do navegador: quem abrir vê o mesmo relatório com os mesmos filtros.' },
        ],
      },
      { tipo: 'captura', id: 'relatorio-resultado' },
      { tipo: 'subtitulo', texto: 'Ler e imprimir' },
      {
        tipo: 'paragrafo',
        texto:
          'O resultado é uma tabela com a linha de totais no fim e a contagem de linhas; no sintético, um bloco por grupo, cada um com o seu total. "Imprimir" gera a folha limpa, com a marca da clínica, o nome do relatório, o período e os filtros usados no cabeçalho — assim o papel diz de que recorte ele é. Na janela do navegador, "Salvar como PDF" guarda o arquivo.',
      },
      {
        tipo: 'dica',
        texto:
          'Relatórios de conferência (lista de presença, atendimentos, sessões dos tratamentos, extrato) saem com o nome da criança, porque sem ele o faturamento não confere. Os puramente numéricos (ranking de serviços) saem sem nome nenhum. Nenhum relatório traz telefone, endereço ou documento — isso fica no cadastro.',
      },
      { tipo: 'subtitulo', texto: 'Baixar em planilha', id: 'relatorios-planilha' },
      {
        tipo: 'paragrafo',
        texto:
          'Ao lado de Imprimir, "Baixar planilha" leva o mesmo relatório que está na tela — o mesmo período, os mesmos filtros, analítico ou sintético — num arquivo que o Excel e o Google Planilhas abrem com dois cliques, já com vírgula nos centavos, datas em dia/mês/ano e os acentos certos. O arquivo começa com o nome do relatório, o período e os filtros, como o papel, e termina com os totais. É o caminho para mandar números ao contador ou somar o fechamento sem redigitar.',
      },
      {
        tipo: 'passos',
        passos: [
          'Gere o relatório com o recorte que você quer.',
          'Clique em "Baixar planilha". O arquivo vai para a pasta de downloads, com o nome do relatório e as datas.',
          'Abra no Excel ou suba no Google Planilhas.',
        ],
      },
      {
        tipo: 'atencao',
        texto:
          'A planilha leva o nome das crianças, como o papel: é dado de menor saindo do sistema. Cada planilha baixada fica registrada na auditoria — quem baixou, quando, qual relatório e com quais filtros (o conteúdo não é guardado). Mande só a quem precisa, e apague a cópia do computador quando não servir mais.',
      },
      { tipo: 'subtitulo', texto: 'Qual relatório do caixa responde qual pergunta', id: 'relatorios-do-caixa' },
      {
        tipo: 'paragrafo',
        texto:
          'No grupo Financeiro, cada relatório do caixa responde uma pergunta e conta por uma data só — que vem escrita no cartão, no cabeçalho e no papel. No sistema antigo era a pessoa quem escolhia entre vencimento, pagamento e competência, e o número mudava sem aviso; aqui a data faz parte do relatório.',
      },
      {
        tipo: 'lista',
        itens: [
          { termo: 'Quem deve e o que vence?', descricao: 'Contas a pagar e a receber (no sistema antigo, Contas a Pagar/Receber e Inadimplência). Só o que está em aberto, pela data de vencimento. Cada linha diz "Atrasado há N dias", "Vence hoje" ou "Vence em N dias", e os totais trazem o que está atrasado.' },
          { termo: 'Quanto entrou e saiu, e por onde?', descricao: 'Recebido e pago (Contas Pagas/Recebidas e Contas Por Categoria). Pela data do pagamento, com juros, multa e desconto; divide por forma de pagamento, categoria, conta ou dia. O resultado bate com o Fluxo de caixa do mesmo período.' },
          { termo: 'Quanto a clínica vendeu?', descricao: 'Vendas do período (Vendas e Resultado Mês). Pela competência — o mês do serviço —, pago ou não: o que foi vendido, quanto já entrou e quanto falta receber, com o serviço, o profissional e as sessões do pacote.' },
          { termo: 'Quem mexeu no financeiro?', descricao: 'Movimentação do financeiro (Histórico de Movimentação do Financeiro). Pela data da ação: quem criou, alterou, deu baixa, estornou ou excluiu cada lançamento e cada transferência. As observações não saem no papel.' },
          { termo: 'O caixa do dia bate?', descricao: 'Fechamento de caixa. Pela data do pagamento, já aberto no dia de hoje — veja abaixo.' },
          { termo: 'A clínica deu lucro?', descricao: 'DRE gerencial (no sistema antigo, DRE Gerencial). O resultado mês a mês, pelo pagamento ou pela competência — veja "O DRE" abaixo.' },
        ],
      },
      {
        tipo: 'paragrafo',
        texto:
          'Os filtros Conta e Categoria aparecem para quem pode ver esses cadastros. Quando o relatório — ou o que você escolheu em "Receber ou pagar", "Recebido ou pago" e "Entradas ou saídas" — já diz se é receita ou despesa, a Categoria só oferece as daquela natureza. Nas Vendas, o convênio serve só para achar o serviço (cada convênio tem a sua tabela): o relatório não se filtra por convênio.',
      },
      {
        tipo: 'dica',
        texto:
          'Os relatórios de dinheiro do caixa mostram o total da clínica e pedem a permissão de ver o Fluxo de caixa. As Vendas pedem também a de ver tratamentos, porque cada linha diz o serviço e o profissional; a Movimentação pede a de ver a auditoria.',
      },
      { tipo: 'subtitulo', texto: 'Fechar o caixa do dia', id: 'relatorios-fechamento' },
      {
        tipo: 'paragrafo',
        texto:
          'No fim do dia, quem cuida do caixa confere a gaveta: quanto entrou em dinheiro, em PIX e no cartão, e se bate com o que foi lançado. O Fechamento de caixa abre no dia de hoje e lista cada pagamento com a hora, a criança, a forma de pagamento, a conta e quem deu a baixa. Como mostra o total do dia, ele aparece só para quem vê o Fluxo de caixa.',
      },
      {
        tipo: 'passos',
        passos: [
          'Em Relatórios, procure "Fechamento de caixa".',
          'O período já vem com hoje. Em Resultado, "Sintético" dividido por Forma de pagamento dá o total do dinheiro, do PIX e do cartão, para comparar com a gaveta e com a maquininha.',
          'Imprima. O papel sai com duas linhas no fim, "Entregue por" e "Conferido por", para quem entrega o caixa e quem o recebe assinarem.',
        ],
      },
      {
        tipo: 'dica',
        texto:
          'Dividido por "Quem deu baixa", o fechamento mostra quanto cada pessoa da recepção recebeu. Para isso fazer sentido, cada pessoa entra com o próprio usuário: com um login compartilhado, o fechamento por pessoa perde o valor.',
      },
      {
        tipo: 'atencao',
        texto:
          'Baixa antiga de que o sistema não sabe o autor aparece como "Não registrado". Ele não inventa quem foi.',
      },
      { tipo: 'subtitulo', texto: 'O DRE: a clínica deu lucro ou prejuízo?', id: 'relatorios-dre' },
      {
        tipo: 'paragrafo',
        texto:
          'O DRE (Demonstração do Resultado) pega tudo o que entrou e vai tirando, em escada, o que saiu: primeiro os impostos, depois os custos do atendimento (o repasse aos profissionais, o material), depois as despesas de manter a clínica aberta, e por fim o que é financeiro (tarifas, taxas de cartão, rendimentos). Os subtotais — Receita líquida, Lucro bruto, Resultado operacional — saem realçados, e os últimos — Resultado líquido e, depois dos investimentos e empréstimos, Resultado final — dizem se sobrou ou faltou. Ele fica em Relatórios, no grupo Financeiro, e no botão "Ver o DRE" da aba Fluxo de caixa.',
      },
      {
        tipo: 'lista',
        itens: [
          { termo: 'Colunas', descricao: 'uma por mês do período e a do total. O período já vem com o ano inteiro.' },
          { termo: 'Sinais', descricao: 'o que sai (impostos, custos, despesas) aparece negativo; os subtotais já vêm calculados, realçados na tabela e no papel.' },
          { termo: 'Por dentro de cada linha', descricao: 'as categorias que a compõem, um pouco recuadas — é assim que se vê de onde veio cada número.' },
          { termo: 'Base', descricao: '"Pelo pagamento" conta o dinheiro que de fato entrou e saiu no mês (o regime de caixa, o padrão); "Pela competência" conta o mês do serviço, pago ou não.' },
          { termo: 'Somente lançamentos contábeis', descricao: 'deixa de fora o que foi lançado sem a marca Contábil.' },
        ],
      },
      {
        tipo: 'paragrafo',
        texto:
          'O DRE nunca sai zerado por falta de configuração: toda categoria já cai em alguma linha. Sem escolha, receita entra em "Prestação de serviços" e despesa em "Despesas administrativas" — e o relatório avisa quantas categorias estão assim. Conferir leva dois minutos:',
      },
      {
        tipo: 'passos',
        passos: [
          'Em Financeiro › Fluxo de caixa, clique em "Configurar DRE" (ou no botão do aviso, no próprio DRE).',
          'A tela mostra a escada inteira, cada linha com uma frase do que entra nela e as categorias que caem nela hoje. As que estão no padrão levam o selo "No padrão".',
          'Para cada uma no lugar errado — o repasse aos profissionais caindo em despesas administrativas, por exemplo —, escolha a linha certa no campo com o nome dela e clique em "Aplicar" ("Desfazer" volta ao que estava). Só aparecem as linhas da natureza dela: despesa nunca vai para uma linha de receita.',
          'Ao aplicar, a categoria muda de lugar na tela, e a troca vale para todos os meses. Uma subcategoria pode ter a sua própria linha; sem escolha, ela segue a da categoria.',
        ],
      },
      {
        tipo: 'dica',
        texto:
          'A mesma escolha aparece na página de cada categoria, em Cadastros › Categorias do caixa, na seção "Linha do DRE". Ver o DRE pede a permissão de ver o Fluxo de caixa; trocar a linha pede também a de editar categorias, e a troca fica na auditoria.',
      },
      { tipo: 'subtitulo', texto: 'Fechar o mês de um profissional', id: 'relatorios-recebido' },
      {
        tipo: 'paragrafo',
        texto:
          'O relatório Recebido por profissional (no sistema antigo, Serviços Executados) mostra quanto as famílias pagaram no mês para cada profissional. Conta o que foi pago no período, pela data do pagamento: a falta entra se a família pagou e fica de fora se não pagou, e o pacote entra inteiro no mês em que foi pago. Não há percentual — o acerto com o profissional continua sendo feito por vocês.',
      },
      {
        tipo: 'passos',
        passos: [
          'Em Relatórios, procure "Recebido por profissional" (ou "demonstrativo").',
          'Escolha o mês. Para só os particulares, escolha o convênio Particular; o serviço aparece depois do convênio.',
          'Em Resultado, "Sintético" dividido por Profissional dá o total de cada um; "Analítico" lista pagamento a pagamento, para conferir. No celular, prefira o Sintético: ele cabe na tela, e o Analítico precisa ser arrastado para o lado para mostrar o valor.',
          'Imprima. O cabeçalho do papel diz a base: pagamentos recebidos no caixa da clínica.',
        ],
      },
      {
        tipo: 'lista',
        itens: [
          { termo: 'Quem recebe', descricao: 'quem atendeu a sessão cobrada; no pacote pago adiantado, o profissional do tratamento.' },
          { termo: 'Sem profissional', descricao: 'pagamento da criança lançado sem tratamento. Ele soma no total; para ir para o profissional certo, edite o lançamento e escolha o tratamento (veja Financeiro).' },
          { termo: 'Origem', descricao: '"Sessão de 03/09" (cobrada pela agenda), "Pacote" (pagamento ligado ao tratamento) ou "Avulso" (sem ligação).' },
          { termo: 'Convênio', descricao: 'só aparece o que passou pelo caixa da clínica. O que a operadora paga fica no sistema de convênios e entra no fechamento por fora.' },
        ],
      },
      {
        tipo: 'dica',
        texto:
          'O relatório abre para quem tem a permissão "Repasse ao profissional" — o administrador a marca no nível da faturista, em Níveis. Quem não vê o fluxo de caixa escolhe um profissional por vez; a soma de todos, com o total da clínica, fica com quem vê o fluxo de caixa.',
      },
    ],
  },
  {
    id: 'cadastros',
    titulo: 'Cadastros',
    resumo: 'As listas que a agenda e o financeiro consomem.',
    blocos: [
      {
        tipo: 'paragrafo',
        texto:
          'São os cadastros de apoio: mexem pouco, mas quando estão errados a agenda mente. Ficam todos num só lugar para não virarem sete itens no menu.',
      },
      { tipo: 'captura', id: 'cadastros' },
      {
        tipo: 'lista',
        itens: [
          { termo: 'Especialidades', descricao: 'o tempo de sessão e a cor do marcador na grade.' },
          { termo: 'Salas', descricao: 'a agenda recusa dois atendimentos na mesma sala e horário.' },
          { termo: 'Equipamentos', descricao: 'quantidade disponível, por especialidade.' },
          { termo: 'Convênios e serviços', descricao: 'os convênios da clínica e a tabela de preços de cada um.' },
          { termo: 'Médicos solicitantes', descricao: 'quem encaminha a criança.' },
          { termo: 'Status de agendamento', descricao: 'as situações do cartão e o que cada uma faz.' },
          { termo: 'Feriados', descricao: 'dia não cadastrado é dia útil na grade.' },
          { termo: 'Modelos de anamnese', descricao: 'a ficha inicial que cada especialidade preenche.' },
          { termo: 'Termo de consentimento', descricao: 'o contrato que as famílias aceitam, e a versão em vigor.' },
          { termo: 'Contas', descricao: 'onde o dinheiro entra e sai: o caixa da recepção, o banco.' },
          { termo: 'Formas de pagamento', descricao: 'dinheiro, PIX, cartão, transferência.' },
          { termo: 'Categorias do caixa', descricao: 'classifica cada receita e despesa do financeiro.' },
          { termo: 'Cartões', descricao: 'a taxa e o prazo de cada máquina de cartão.' },
          { termo: 'Fornecedores', descricao: 'a quem a clínica paga aluguel, material e serviços.' },
          { termo: 'Funcionários', descricao: 'quem recebe salário da clínica.' },
        ],
      },
      { tipo: 'subtitulo', texto: 'Contas, formas de pagamento e categorias', id: 'cadastros-financeiros' },
      { tipo: 'captura', id: 'cadastros-contas' },
      {
        tipo: 'paragrafo',
        texto:
          'Os três primeiros são o que todo lançamento do financeiro pede. A conta é onde o dinheiro fica: normalmente "Caixa" para o que entra no balcão, e o banco, se a clínica separar. A forma de pagamento é como a família pagou: dinheiro, PIX, cartão de crédito, cartão de débito, transferência. A categoria classifica o movimento: "Atendimentos" para o que entra, "Despesas da clínica" para o que sai.',
      },
      {
        tipo: 'paragrafo',
        texto:
          'A clínica já começa com uma conta, cinco formas de pagamento e duas categorias prontas. São só um ponto de partida: renomeie, acrescente ou apague o que não usar. Se quiser mais detalhe no relatório do contador, abra uma categoria e cadastre subcategorias dentro dela — "Aluguel" e "Água e luz" dentro de "Despesas da clínica", por exemplo.',
      },
      {
        tipo: 'paragrafo',
        texto:
          'Cartões é o cadastro das máquinas: nome, se é crédito ou débito, a taxa que a operadora desconta, em quantos dias ela deposita e em qual conta. Por enquanto isso fica guardado para consulta — o sistema ainda não dá baixa sozinha no que a operadora deposita.',
      },
      {
        tipo: 'paragrafo',
        texto:
          'Três campos do cartão são opcionais e só para consulta: a bandeira (Visa, Mastercard, Elo…), a taxa separada por número de parcelas (preencha só as que a operadora cobra diferente — o resto fica em branco) e a marca de "Antecipação de crédito". Nenhum deles muda um lançamento: são anotação, não cálculo.',
      },
      {
        tipo: 'dica',
        texto:
          'Nada disso se exclui depois de usado: conta com lançamento, forma de pagamento já escolhida e categoria com movimento ficam no histórico — o sistema recusa a exclusão. Numa conta você pode desmarcar "Ativa" para registrar que ela saiu de uso; por enquanto isso é só um registro: a conta continua aparecendo para escolher nos lançamentos.',
      },
      { tipo: 'subtitulo', texto: 'Fornecedores e funcionários: a quem a clínica paga', id: 'cadastros-quem-recebe' },
      {
        tipo: 'paragrafo',
        texto:
          'São as pessoas e as empresas que recebem dinheiro da clínica: o dono da sala, a papelaria, o contador (Fornecedores), e a recepcionista, a auxiliar, quem recebe salário (Funcionários). Cadastrados, eles podem ser escolhidos como interessado de uma despesa — e o aluguel e o salário deixam de sair do caixa sem dono.',
      },
      {
        tipo: 'passos',
        passos: [
          'Em Cadastros, abra Fornecedores (ou Funcionários).',
          'Clique em "Cadastrar fornecedor". Só a razão social é obrigatória; no funcionário, o nome e a função.',
          'Se quiser, preencha o documento, os contatos e o endereço — o CEP completa o endereço sozinho.',
          'Salve. Ele aparece na lista e já pode ser escolhido numa despesa.',
        ],
      },
      {
        tipo: 'dica',
        texto:
          'O lançamento de um funcionário, como o salário, só aparece para quem tem Funcionários › Ver. Por isso, ao lançar um salário, escolha o funcionário como interessado: sem ele, o salário fica à vista de todos que veem os lançamentos.',
      },
      {
        tipo: 'paragrafo',
        texto:
          'No fornecedor, a "Categoria padrão" economiza um passo: quando você escolhe esse fornecedor numa despesa com a categoria ainda em branco, a categoria (e a subcategoria) vêm preenchidas. Se a categoria já estiver escolhida, nada muda — e no lançamento dá sempre para trocar.',
      },
      {
        tipo: 'dica',
        texto:
          'Está no meio de um lançamento e não acha quem vai receber? No campo Interessado, escolha Fornecedor ou Funcionário, busque pelo nome e, se não aparecer, clique em "Cadastrar novo". Abre o cadastro curto por cima do lançamento; ao salvar, o novo já volta escolhido, e o que você tinha digitado no lançamento continua lá.',
      },
      {
        tipo: 'paragrafo',
        texto:
          'Quem já tem lançamento não se exclui: o histórico do dinheiro precisa dizer a quem ele foi. Ao tentar, o sistema mostra a razão e oferece inativar ali mesmo. O inativo continua no histórico dos lançamentos dele; o documento, os contatos e o endereço nunca aparecem na lista, só no cadastro.',
      },
      { tipo: 'subtitulo', texto: 'Convênios e a tabela de serviços' },
      {
        tipo: 'paragrafo',
        texto:
          'Cada convênio é uma operadora: uma UNIMED, uma CELOS, um Particular. Dentro dele fica a "Tabela de serviços", que é a tabela de preços: uma linha por procedimento, com o valor. Não é preciso criar um convênio por procedimento — é um convênio por plano, com os procedimentos dentro.',
      },
      {
        tipo: 'paragrafo',
        texto:
          'Para os atendimentos que a família paga do próprio bolso, crie um convênio chamado "Particular" e marque a caixa "Atendimento particular" no cadastro dele. É essa marca que faz o pagamento cair no caixa da clínica em vez de seguir para a esteira do plano. Os campos de plano de saúde (Registro ANS, código da operadora, versão TISS, guia numerada) podem ficar em branco no Particular: o sistema guarda esses dados para referência, mas não emite guia nem envia faturamento para operadora.',
      },
      {
        tipo: 'paragrafo',
        texto:
          'No serviço, "Procedimento" é o nome que vocês leem ("Sessão de Fonoaudiologia") e "Código do procedimento" é opcional: é o número da tabela da operadora, para conferir com o portal dela. O código não entra no valor, no lançamento nem no recibo — ele fica guardado só como referência.',
      },
      {
        tipo: 'dica',
        texto:
          'O valor do faturamento vem daqui. Quando a recepção lança uma sessão no financeiro, o sistema pega o preço do serviço que está no pacote da criança — por isso o pacote precisa ter um serviço escolhido, e o serviço precisa ter valor.',
      },
      {
        tipo: 'dica',
        texto:
          'Antes de brigar com a agenda, confira o cadastro: sessão com duração estranha, sala sempre ocupada ou feriado que virou dia útil quase sempre começam aqui.',
      },
    ],
  },
  {
    id: 'usuarios',
    titulo: 'Usuários e permissões',
    resumo: 'Quem entra no sistema e o que cada um pode ver.',
    blocos: [
      {
        tipo: 'paragrafo',
        texto:
          'Esta tela é da administração. Ela tem três abas: Usuários (as contas), Níveis de permissão (o que cada nível pode fazer) e Aprovações (pedidos de acesso esperando liberação).',
      },
      { tipo: 'captura', id: 'usuarios' },
      {
        tipo: 'paragrafo',
        texto:
          'Cada pessoa recebe um nível, e o nível decide os destinos que ela enxerga e as ações que consegue fazer. Mudar o nível de alguém muda a tela dela na próxima vez que entrar.',
      },
      {
        tipo: 'atencao',
        texto:
          'Quem sai da clínica deve ter o acesso desativado no mesmo dia. Desativar não apaga o histórico — o que a pessoa fez continua registrado, como precisa ser.',
      },
      { tipo: 'subtitulo', texto: 'As duas caixas de "toda a clínica"', id: 'usuarios-escopo' },
      {
        tipo: 'paragrafo',
        texto:
          'Cada nível tem duas caixas no fim: "Operar a agenda e os pacotes de toda a clínica" e "Ler o prontuário de toda a clínica". A primeira é da recepção e do faturamento — sem ela, quem não é terapeuta não vê pacote nenhum, não fatura e não vê presença. A segunda abre o prontuário de todas as crianças, e por isso é só da administração.',
      },
      {
        tipo: 'lista',
        itens: [
          {
            termo: 'Terapeuta',
            descricao: 'Nenhuma das duas caixas. Vê e opera só a própria agenda, e só marca ou cadastra pacote para crianças que já atende.',
          },
          {
            termo: 'Recepção e faturamento',
            descricao: 'Só a primeira caixa. Alcançam a agenda, os pacotes e o faturamento de todos os profissionais, sem o prontuário.',
          },
          {
            termo: 'Administração',
            descricao: 'As duas caixas.',
          },
        ],
      },
      { tipo: 'subtitulo', texto: 'O que as telas novas exigem', id: 'usuarios-telas-novas' },
      {
        tipo: 'paragrafo',
        texto:
          'Nenhuma permissão nova foi criada para os Indicadores e os Relatórios: cada tela pede a permissão do ASSUNTO dela, que o nível já tem ou não. O efeito prático é que duas pessoas abrem a mesma tela e veem coisas diferentes — e alguém sem a permissão certa nem vê a aba ou o cartão, em vez de bater num aviso de acesso negado.',
      },
      {
        tipo: 'lista',
        itens: [
          { termo: 'Indicadores › Visão geral', descricao: 'abre com qualquer uma de Agenda, Atendimentos, Pacientes ou Fluxo de caixa (ver). Dentro dela, cada cartão aparece conforme a permissão da aba dele.' },
          { termo: 'Indicadores › Financeiro', descricao: 'Fluxo de caixa › Ver. Sem ela, a aba não aparece.' },
          { termo: 'Indicadores › Agenda', descricao: 'Agenda › Ver.' },
          { termo: 'Indicadores › Pacientes', descricao: 'Pacientes › Ver. O cartão "Pacotes no fim" pede também Tratamentos › Ver, e o "Fila de espera", Lista de espera › Ver; sem elas, o cartão e a frase somem.' },
          { termo: 'Indicadores › Equipe', descricao: 'exige DUAS: Agenda › Ver e Atendimentos › Ver. A capacidade e as marcações são dado da agenda; o que foi realizado e as evoluções são dado clínico. Faltando uma, a aba some.' },
          { termo: 'Relatórios (a tela)', descricao: 'aparece no menu para quem tem a permissão de pelo menos um relatório.' },
          { termo: 'Cada relatório', descricao: 'pede o assunto: Agendamentos e Lista de presença → Agenda › Ver; Atendimentos → Atendimentos › Ver; Evoluções → Evoluções › Ver E Atendimentos › Ver; Sessões dos tratamentos e Serviços → Tratamentos › Ver; Tratamentos sem lançamento → Tratamentos › Ver E Lançamentos › Ver; Pacientes → Pacientes › Ver; Extrato do paciente → Lançamentos › Ver E Agenda › Ver.' },
          { termo: 'Movimentação da agenda', descricao: 'pede Auditoria › Ver E Agenda › Ver. É o histórico de quem mexeu na agenda, com o nome da criança em cada linha — por isso não basta poder auditar, nem basta ver a agenda: precisa das duas.' },
          { termo: 'Sem Fluxo de caixa › Ver', descricao: 'nenhum total da clínica aparece. Serviços sai só com as quantidades, sem o valor; Tratamentos sem lançamento traz o valor de cada pacote, mas não o total; e o Fechamento de caixa não aparece.' },
          {
            termo: 'Ficha do profissional (o painel do mês)',
            descricao:
              'abre com Profissionais › Ver, e para o próprio profissional sem ela. Cada bloco pede o assunto dele: o mês em números e a semana, Agenda › Ver; as evoluções em dia, os seis meses e onde a agenda não rendeu, também Atendimentos › Ver; os pacotes perto do fim, Pacientes › Ver e Tratamentos › Ver. O Financeiro pede a caixa "Ver o que recebeu pelos próprios atendimentos" (logo abaixo) ou, na ficha de outro profissional, as três do relatório Recebido por profissional: Repasse ao profissional, Lançamentos › Ver e Tratamentos › Ver.',
          },
        ],
      },
      { tipo: 'subtitulo', texto: 'Ver o que recebeu pelos próprios atendimentos', id: 'usuarios-recebido-proprio' },
      {
        tipo: 'paragrafo',
        texto:
          'Na linha "Repasse ao profissional" da grade de permissões fica a caixa "Ver o que recebeu pelos próprios atendimentos". Marcada no nível dos profissionais, cada um passa a ver, na própria ficha, o bloco Financeiro: o que entrou no caixa da clínica pelos atendimentos dele — e de mais ninguém, mesmo que o nível opere a agenda de toda a clínica. Ela não abre o relatório Recebido por profissional, a lista de lançamentos nem o total da clínica. Só o Administrador já vem com ela; nos outros níveis, quem administra marca se quiser.',
      },
      {
        tipo: 'atencao',
        texto:
          'O login precisa estar ligado ao profissional, em Usuários. Sem esse vínculo, a caixa não mostra o financeiro de ninguém. E não é a parte do profissional: o acerto com ele continua sendo feito pela clínica.',
      },
      {
        tipo: 'dica',
        texto:
          'Ninguém dá o que não tem. Quem edita usuários só altera quem tem acesso igual ou menor que o seu — os outros aparecem com "Tem acesso que você não tem". Quem edita níveis só marca as permissões que tem, e não mexe num nível acima do seu. Na aprovação dupla, só aprova quem tem o acesso em jogo.',
      },
      {
        tipo: 'dica',
        texto:
          'As duas caixas de "toda a clínica" continuam mandando aqui também. Um terapeuta sem elas vê as abas Agenda e Equipe dos Indicadores só da própria agenda, e os relatórios trazem só as crianças e os horários dele. Na aba Pacientes, só "Pacotes no fim" segue a agenda dele; os outros números são da clínica inteira. Um nível de balcão SEM a primeira caixa e sem vínculo com um profissional abre essas abas vazias — não é defeito, é a proteção contra vínculo perdido.',
      },
      { tipo: 'subtitulo', texto: 'Quem atende e também marca para os colegas', id: 'usuarios-dois-chapeus' },
      {
        tipo: 'paragrafo',
        texto:
          'Uma terapeuta que também faz o trabalho da recepção — marcar horário ou cadastrar pacote para os colegas — precisa de dois logins: um de terapeuta, com o vínculo ao profissional dela, e um de recepção, sem vínculo. Cada chapéu entra com o seu, e o registro de auditoria mostra qual dos dois fez cada coisa.',
      },
      {
        tipo: 'atencao',
        texto:
          'Marcar "Ler o prontuário de toda a clínica" no nível da terapeuta NÃO resolve isso — só abre para ela o prontuário de todas as crianças, inclusive as que ela nunca atendeu. A caixa certa para operar pelos colegas é a primeira, e num login separado.',
      },
    ],
  },
  {
    id: 'auditoria',
    titulo: 'Auditoria',
    resumo: 'O histórico de tudo que foi criado, alterado e excluído.',
    blocos: [
      {
        tipo: 'paragrafo',
        texto:
          'Serve para responder "quem mexeu nisso?". Filtre por tipo de registro, por pessoa, por ação ou por período, e abra a linha para ver quais campos mudaram, de que valor para que valor.',
      },
      { tipo: 'captura', id: 'auditoria' },
      {
        tipo: 'paragrafo',
        texto:
          'Esta tela só consulta: nada aqui pode ser alterado ou apagado, nem por quem administra. É essa garantia que faz do histórico uma prova.',
      },
      {
        tipo: 'paragrafo',
        texto:
          'Uma operação em lote — dar baixa ou desmarcar a agenda de um profissional — deixa mais de uma linha aqui: uma por atendimento alterado, uma por pacote que teve sessão descontada, e uma linha da operação inteira, no registro do profissional, com a situação aplicada, as datas, as contagens e quem ficou de fora com o motivo. Todas carregam o mesmo identificador de lote, e é ele que liga as linhas de uma mesma operação. Os lotes feitos antes dessa novidade não têm identificador: as linhas deles existem, mas não podem ser reunidas por ele.',
      },
    ],
  },
  {
    id: 'configuracoes',
    titulo: 'Configurações',
    resumo: 'As regras da clínica, aba por aba: o que cada ajuste faz, qual é o padrão e o que muda quando você mexe.',
    blocos: [
      {
        tipo: 'paragrafo',
        texto:
          'Quase tudo que o sistema faz "sozinho" — barrar um horário, descontar uma sessão, avisar a família, alertar que o pacote está acabando — obedece a um ajuste desta tela. Nada aqui é decisão de programador: é decisão da clínica, e muda na hora, sem depender de ninguém de fora.',
      },
      { tipo: 'captura', id: 'configuracoes' },
      {
        tipo: 'lista',
        itens: [
          {
            termo: 'Quem pode ver e quem pode mudar',
            descricao: 'são permissões diferentes: há quem enxergue a tela sem conseguir salvar. Se os campos aparecem apagados, é isso.',
          },
          {
            termo: 'Como salvar',
            descricao: 'cada ajuste tem o próprio botão Salvar ao lado, e ele só acende quando você mudou aquele campo. As caixas de marcar salvam no clique.',
          },
          {
            termo: 'Para quem vale',
            descricao: 'para a clínica inteira, e na hora. Não é preferência sua: o que você mudar aqui muda a tela de todo mundo.',
          },
          {
            termo: 'Fica registrado',
            descricao: 'toda mudança entra na Auditoria com quem mudou, quando, e de qual valor para qual.',
          },
        ],
      },
      {
        tipo: 'dica',
        texto:
          'Trocar de aba com algo digitado e não salvo faz o sistema perguntar antes de descartar. Se aparecer essa pergunta, é porque existe uma alteração sua esperando o Salvar.',
      },

      { tipo: 'subtitulo', texto: 'Aba Clínica — nome, fuso, identidade e o link de cadastro', id: 'configuracoes-clinica' },
      {
        tipo: 'lista',
        itens: [
          {
            termo: 'Nome da clínica',
            descricao: 'o nome da clínica, que aparece no alto da barra da esquerda quando a identidade está como "Nome da clínica". Enquanto ninguém preenche, a barra mostra o nome do sistema.',
          },
          {
            termo: 'Fuso horário',
            descricao: 'padrão America/Sao_Paulo. É o relógio de toda a agenda — mexer aqui desloca a hora de tudo que aparece na tela. Só mude se a clínica funcionar em outro fuso.',
          },
          {
            termo: 'Identidade na barra lateral',
            descricao: 'escolhe entre mostrar o nome da clínica ou a logo, no alto da barra da esquerda. Padrão: nome. A escolha só passa a valer depois do botão "Salvar identidade", no fim da seção — enquanto não salvar, a tela avisa que há alteração pendente.',
          },
          {
            termo: 'Fonte do nome',
            descricao: 'quatro estilos para o nome — Padrão, Serifada, Arredondada e Manuscrita —, com a pré-visualização logo abaixo mostrando como fica.',
          },
          {
            termo: 'Logo',
            descricao: 'aceita PNG, JPG ou WebP de até 1 MB, com cada lado entre 64 e 4096 pixels. Fundo transparente fica melhor. Escolher o arquivo já envia — não há um botão separado para isso.',
          },
          {
            termo: 'Enviar a logo já a coloca na barra',
            descricao: 'se a clínica estava exibindo o nome, enviar uma logo passa a exibi-la na hora, e o sistema avisa que aplicou. Para voltar ao nome escrito, marque "Nome da clínica" e salve.',
          },
          {
            termo: 'Cores do sistema',
            descricao:
              'escolhe o visual do sistema, e vale só para esta clínica. São três opções, cada uma numa miniatura da tela já pintada, para comparar antes de escolher. Padrão: o visual de sempre. Menta: menta e rosa, uma fonte arredondada, cantos mais macios e botões em pílula — e o rosa marca onde você está: o item do menu, o profissional escolhido na agenda, a aba aberta, a linha do agora e o dia de hoje. Xclinicas: o ameixa e o rosé da marca do sistema, com os títulos em letra serifada. As três servem para qualquer clínica. Em todas, o texto e os avisos de erro continuam iguais. Também vale para o formulário de cadastro pelo link. A tela de entrada, onde se digita a senha, é a exceção: ela mostra sempre a marca Xclinicas, nas cores dela, qualquer que seja o tema escolhido aqui. Passa a valer depois de "Salvar identidade", na hora, sem recarregar a página.',
          },
          {
            termo: 'Endereço do cadastro pelo link',
            descricao:
              'é gerado aqui, uma vez, com "Gerar endereço" — e NÃO muda sozinho: é o mesmo endereço que a clínica divulga no WhatsApp e nas redes, e trocá-lo mata toda cópia que já circula. "Trocar o endereço" é só para quando o link foi parar onde não devia. A recepção copia o endereço em Pacientes e em Cadastros recebidos, sem precisar entrar aqui.',
          },
          {
            termo: 'Cadastro pelo link ligado',
            descricao:
              'liga o endereço que a família abre no celular para preencher o próprio cadastro. Nasce DESLIGADO em toda clínica, de propósito: enquanto estiver assim, o link não responde a ninguém. Ligue depois de gerar o endereço e testá-lo. Desligar derruba o formulário na hora, sem precisar de nada além desta caixa — é o que fazer se o link for parar onde não devia.',
          },
          {
            termo: 'Apagar cadastro não conferido depois de (dias)',
            descricao:
              'padrão 30 dias, de 1 a 365. Cadastro que a família enviou e ninguém conferiu é apagado sozinho depois desse prazo, e a fila guarda só o registro de que houve um envio, sem os dados. Não é faxina: é a lei — dado de criança parado numa fila é dado guardado sem motivo. O que já foi aceito vira paciente e não é alcançado.',
          },
          {
            termo: 'Remover logo',
            descricao: 'apaga o arquivo do servidor. A escolha continua em "Logo" — a tela avisa que não há arquivo e a barra mostra o nome até você enviar outra.',
          },
          {
            termo: 'Indicadores a partir de (bloco Indicadores)',
            descricao:
              'começa vazio, e vazio quer dizer "desde o primeiro agendamento". Preencha com o dia 1º do mês em que a clínica passou a usar o sistema de verdade: antes dele os números são da implantação (poucas sessões, caixa vazio, a base inteira sendo cadastrada), e os Indicadores não comparam nem mostram tendência antes dessa data. Só aceita o dia 1º, porque os indicadores contam por mês, e não aceita data futura. Esvaziar volta ao primeiro agendamento.',
          },
        ],
      },

      { tipo: 'subtitulo', texto: 'Aba Agenda — as regras de marcar', id: 'configuracoes-agenda' },
      { tipo: 'captura', id: 'configuracoes-agenda' },
      {
        tipo: 'lista',
        itens: [
          {
            termo: 'Permitir agendamento retroativo',
            descricao: 'desligado por padrão. Ligado, a recepção consegue marcar em data que já passou — útil para lançar o que aconteceu e ninguém registrou; arriscado porque some a barreira contra erro de digitação na data.',
          },
          {
            termo: 'Arrastar card para remarcar',
            descricao: 'desligado por padrão. Ligado, dá para pegar o cartão na grade e soltar em outro horário, e o cartão ganha um botão de remarcar. Desligado, os dois atalhos somem e remarcar é pelo caminho de sempre: abrir o cartão, Mais ações, Editar.',
          },
          {
            termo: 'Permitir reposição de reposição',
            descricao: 'desligado por padrão. Ligado, uma sessão de reposição que também foi perdida pode gerar outra reposição. Desligado, a corrente para na primeira.',
          },
          {
            termo: 'Mesmo paciente em horários sobrepostos',
            descricao: 'padrão "Bloquear o agendamento". A mesma criança marcada com dois profissionais na mesma hora é sempre um dos dois errado — salvo em sessão conjunta, que existe em clínica multidisciplinar. Por isso há três saídas: bloquear, avisar (deixa marcar e alerta) ou permitir (não checa).',
          },
          {
            termo: 'Limite de faltas consecutivas para alerta',
            descricao: 'padrão 3, de 1 a 20. A partir de quantas faltas seguidas a criança entra no contador de Faltas lá em cima.',
          },
          {
            termo: 'Dias sem próximo agendamento para entrar nas pendências',
            descricao: 'padrão 30, de 7 a 180. É o prazo que define quem aparece em Pendências de retorno.',
          },
          {
            termo: 'Encadear status automaticamente',
            descricao: 'desligado por padrão. Ligado, o sistema muda sozinho a situação dos atendimentos passados para o "Status-alvo do encadeamento" logo abaixo — serve para não deixar o dia de ontem cheio de "Em Aberto".',
          },
          {
            termo: 'Status-alvo do encadeamento',
            descricao: 'a situação que o encadeamento aplica. Vem "Desligado". A situação escolhida não pode ser uma que consome sessão: automação nunca gasta sessão do pacote de uma criança.',
          },
        ],
      },
      { tipo: 'captura', id: 'configuracoes-agenda-grade' },
      {
        tipo: 'lista',
        itens: [
          {
            termo: 'Status aplicado ao desmarcar a agenda do profissional',
            descricao: 'a situação que os atendimentos recebem no desmarque em lote. Escolha pelo nome, na lista — só aparecem as situações que não consomem sessão. Começa em "Não configurado", e aí o desmarque em lote avisa, logo ao abrir e antes de qualquer prévia, que falta escolher este status, em vez de escolher sozinho: errar aqui aplicaria a situação errada a dezenas de crianças de uma vez. É também este campo que liga o aviso de cancelamento pelo WhatsApp: mudar um agendamento, pelo cartão, para esta situação é o que conta como "a clínica cancelou" — sem situação escolhida, esse aviso nunca sai.',
          },
          {
            termo: 'Máximo de agendamentos por desmarque em lote',
            descricao: 'padrão 60, de 1 a 200. É o freio do gesto: com um intervalo de datas, um clique alcança meses. Passou do teto, o sistema recusa e pede um período menor.',
          },
          {
            termo: 'Máximo de agendamentos por baixa em lote',
            descricao: 'padrão 100, de 1 a 200. É o freio do botão "Dar baixa": quantos atendimentos em aberto uma baixa pode alcançar de uma vez. Passou do teto, o sistema recusa e diz quantos alcançou e qual é o máximo — estreite as datas e faça em duas vezes. É um ajuste separado do máximo do desmarque, e por um motivo: o desmarque avisa as famílias pelo WhatsApp, por isso o teto dele é baixo; a baixa não manda mensagem a ninguém, e uma semana inteira de um profissional já passa de 60.',
          },
          {
            termo: 'Hora que separa manhã de tarde',
            descricao: 'padrão 12:00. É o que o sistema entende por "manhã" e "tarde" — no desmarque em lote, por exemplo. Se o turno da clínica vira às 13:00, mude aqui.',
          },
          {
            termo: 'Granularidade da grade (minutos)',
            descricao: 'padrão 40, de 5 a 120. É de quantos em quantos minutos a grade é dividida. Atenção: sessão mais longa que a faixa ocupa duas — uma sessão de 50 minutos numa grade de 40 mostra 80 minutos ocupados.',
          },
          {
            termo: 'Dias de fim de semana na grade',
            descricao: 'padrão Nenhum. Escolha Sábado, Domingo ou ambos se a clínica atende no fim de semana — sem isso, o dia simplesmente não abre grade.',
          },
          {
            termo: 'Visão padrão da agenda',
            descricao: 'padrão Dia. É como a agenda abre quando alguém entra no sistema: Dia, Semana ou Visão geral.',
          },
          {
            termo: 'Início e fim da janela padrão da grade',
            descricao: 'padrão 08:00 e 19:00. Vale para profissional SEM horário cadastrado na ficha. Quem tem horário próprio segue o dele — este ajuste não o substitui.',
          },
        ],
      },
      {
        tipo: 'atencao',
        texto:
          'Três ajustes desta aba mexem no pacote da criança e na conta de falta: a situação do encadeamento, a situação do desmarque em lote e o "mesmo paciente em horários sobrepostos". Combine com a equipe antes de mudar qualquer um deles.',
      },

      { tipo: 'subtitulo', texto: 'Aba Atendimento — pacotes e evoluções', id: 'configuracoes-atendimento' },
      { tipo: 'captura', id: 'configuracoes-atendimento' },
      {
        tipo: 'lista',
        itens: [
          {
            termo: 'Bloquear tratamento duplicado com o mesmo serviço',
            descricao: 'desligado por padrão. Ligado, o sistema recusa abrir um segundo pacote do mesmo serviço para a criança enquanto o primeiro estiver em aberto — evita a criança com dois contratos iguais rodando juntos.',
          },
          {
            termo: 'Antecedência do aviso de pedido médico (dias)',
            descricao: 'padrão 60, de 7 a 180. Quantos dias antes de o pedido médico vencer ele entra no contador de Pedidos.',
          },
          {
            termo: 'Alertar fim de pacote a partir de (sessões restantes)',
            descricao: 'padrão 2, de 1 a 20. É o que acende o aviso laranja no cartão da agenda e na lista de Tratamentos, o que alimenta o contador de Pacotes e o que define quem entra em "Próximos do encerramento" no relatório Sessões dos tratamentos. Mudar aqui muda os quatro ao mesmo tempo — é de propósito: um número só para a clínica inteira. Aumente se quiser conversar com a família mais cedo.',
          },
          {
            termo: 'Prazo para evolução (dias corridos)',
            descricao: 'padrão 100 dias. Quanto tempo o profissional tem, depois da sessão, para escrever a evolução.',
          },
          {
            termo: 'Carência antes de travar a evolução (dias)',
            descricao: 'padrão 3, de 0 a 365. Quantos dias ALÉM do prazo antes de o sistema parar de aceitar novos registros daquele profissional. Em 0, a trava vale no dia seguinte ao vencimento.',
          },
          {
            termo: 'Exigir responsável técnico na evolução',
            descricao: 'desligado por padrão. Ligado, a evolução só é aceita com o responsável técnico indicado — e sem ele o registro é recusado na hora de salvar.',
          },
          {
            termo: 'Bloquear evolução após o status final',
            descricao: 'desligado por padrão. Ligado, depois que o atendimento chega à situação final ninguém escreve mais nada naquela sessão.',
          },
          {
            termo: 'Status aplicado ao salvar a evolução',
            descricao: 'desligado por padrão. Escolha o status que finaliza a sessão, normalmente "Finalizado com Evolução": a lista só mostra status que descontam do pacote, seguram o horário e não são falta. Ligado, salvar a evolução de uma sessão "Em Aberto" ou "Aguardando Atendimento" passa a sessão para esse status e desconta do pacote, sem o clique a mais na situação do cartão. Com o bloqueio após o status final ligado, a evolução dessa sessão continua aceita, porque ela mesma finaliza a sessão.',
          },
        ],
      },

      { tipo: 'subtitulo', texto: 'Aba Financeiro — o que entra no caixa', id: 'configuracoes-financeiro' },
      { tipo: 'captura', id: 'configuracoes-financeiro' },
      {
        tipo: 'lista',
        itens: [
          {
            termo: 'Lançar convênio no fluxo de caixa',
            descricao: 'desligado por padrão. Desligado, o que é do convênio não entra no caixa — a clínica fatura o convênio por fora, e o caixa fica só com o que de fato entra e sai por aqui. Ligue apenas se a clínica quiser ver o convênio junto.',
          },
          {
            termo: 'Marcar lançamentos como contábeis por padrão',
            descricao: 'ligado por padrão. É o valor com que o campo "contábil" já nasce marcado num lançamento novo; dá para desmarcar caso a caso.',
          },
          {
            termo: 'Desconto máximo no faturamento (%)',
            descricao: 'padrão 100, de 0 a 100 — e 100 significa SEM TETO. Baixe para o máximo que a clínica aceita dar de desconto; acima disso o sistema recusa.',
          },
          {
            termo: 'Mensagem de cobrança pelo WhatsApp',
            descricao:
              'o texto que abre pronto quando alguém usa "Cobrar pelo WhatsApp" numa receita em aberto. O sistema troca {responsavel}, {crianca}, {valor}, {vencimento} e {clinica} pelos dados do lançamento; outra marca entre chaves é recusada, com o nome dela, para nada sair escrito errado para a família. Quem cobra ainda revisa o texto antes de enviar.',
          },
        ],
      },

      { tipo: 'subtitulo', texto: 'Aba Comunicação — WhatsApp, mensagens, lembretes e notificações', id: 'configuracoes-comunicacao' },
      { tipo: 'captura', id: 'configuracoes-comunicacao' },
      {
        tipo: 'paragrafo',
        texto:
          'O primeiro cartão, "Conexão do WhatsApp", é o único item da tela que leva a outra página: é lá que se conecta o número da clínica e se sincronizam os modelos de mensagem. Os ajustes abaixo dele dizem o que sai, quando e quanto.',
      },
      {
        tipo: 'lista',
        itens: [
          {
            termo: 'Enviar mensagens automáticas',
            descricao: 'desligado por padrão. É a chave geral: desligada, nenhum lembrete sai sozinho — a caixa de entrada continua funcionando para responder as famílias. Para tirar um profissional só (por exemplo, quem confirma as famílias por conta própria), não mexa aqui: em Profissionais (menu Atendimento), clique em Editar no profissional e desmarque "Enviar mensagens automáticas às famílias". As famílias dele deixam de receber o lembrete da véspera e a confirmação do primeiro agendamento, inclusive das sessões já marcadas; os avisos de remarcação e de cancelamento continuam saindo quando a recepção pedir. A ficha do profissional mostra quando a caixa está desmarcada.',
          },
          {
            termo: 'Teto de mensagens por mês',
            descricao: 'padrão 6000. É um limite de custo, porque cada conversa iniciada pela clínica é cobrada. Cuidado: 0 significa NENHUMA mensagem iniciada, e não "ilimitado". Teto baixo demais desliga os lembretes no meio do mês, em silêncio.',
          },
          {
            termo: 'Sugerir o WhatsApp já marcado no cadastro',
            descricao: 'ligado por padrão. Faz o marcador de "avisar pelo WhatsApp" nascer marcado nos agendamentos novos.',
          },
          {
            termo: 'Template do aviso de desmarque (bloco Mensagens)',
            descricao: 'começa vazio. É o modelo usado quando a agenda de um profissional é desmarcada em lote com "avisar as famílias" ligado. Vazio significa não configurado: o desmarque acontece e o sistema devolve a lista de famílias para avisar à mão.',
          },
          {
            termo: 'Modelo da confirmação do primeiro agendamento',
            descricao: 'padrão "confirmacao_agendamento". Sai sozinho quando a criança ganha o PRIMEIRO agendamento no sistema (uma série conta uma vez só; quem veio do sistema antigo não recebe). Vazio desliga a confirmação.',
          },
          {
            termo: 'Modelo do aviso de mudança de horário',
            descricao: 'padrão "remarcacao_agendamento". Sai só quando, ao remarcar, alguém marca "Avisar a família pelo WhatsApp" — a caixa nasce desmarcada porque a família só é avisada quando foi a clínica que mudou. Vazio desliga o aviso.',
          },
          {
            termo: 'Modelo do aviso de cancelamento pela clínica',
            descricao: 'padrão "cancelamento_agendamento". Sai quando um agendamento é mudado, pelo card, para o status do desmarque do profissional (o mesmo escolhido na aba Agenda) e a pergunta é confirmada com "Avisar a família" marcado. Outro status, como o desmarque a pedido da família, não avisa. Vazio desliga o aviso.',
          },
          {
            termo: 'Máximo de avisos do agendamento por família por dia',
            descricao: 'padrão 4, de 1 a 20. Soma a confirmação, a mudança de horário e o cancelamento que uma mesma família recebeu no dia (o lembrete não entra). É o freio contra um remarca-e-desmarca repetido: cada aviso é uma mensagem paga e conta no teto mensal. Atingido o limite, a tela diz que a família não foi avisada, para avisar à mão se precisar.',
          },
          {
            termo: 'Retenção do histórico de mensagens (dias)',
            descricao: 'padrão 730 (dois anos), de 30 a 3650. Passado o prazo, o conteúdo das conversas é apagado e sobra a linha do tempo — quando falou, com quem. É minimização de dado, exigência da LGPD.',
          },
          {
            termo: 'Antecedência do lembrete (horas) (bloco Lembretes)',
            descricao: 'padrão 24, de 1 a 168 (uma semana). Quantas horas antes da sessão o lembrete sai.',
          },
          {
            termo: 'Modelo de mensagem do lembrete',
            descricao: 'padrão "lembrete_agendamento". É o nome do modelo aprovado que o disparo usa. Trocar o texto da mensagem é trocar o modelo — não se digita a frase aqui.',
          },
          {
            termo: 'Enviar os lembretes em lote',
            descricao: 'ligado por padrão. Junta todos os horários da mesma família no dia numa mensagem só. Desligado, a mãe com dois filhos em terapia recebe uma mensagem por horário — e cada uma custa.',
          },
          {
            termo: 'Antecipar para sexta o lembrete de segunda',
            descricao: 'ligado por padrão. Sem isso, o lembrete de segunda sai no domingo, dia em que a clínica não atende e a família não tem a quem responder.',
          },
          {
            termo: 'Lembrar quem é marcado depois das 8h',
            descricao: 'ligado por padrão. Os lembretes saem às 8h para as sessões do dia seguinte; a sessão marcada (ou remarcada para esse dia) depois disso ficaria sem lembrete. Ligado, o sistema confere de hora em hora, das 9h até o horário do ajuste abaixo, e manda o lembrete para quem ainda não recebeu — quem já recebeu às 8h não recebe de novo. Também tenta outra vez quem ficou sem lembrete de manhã, por exemplo depois que a recepção corrige o telefone. A criança nova que recebeu a confirmação do primeiro agendamento no mesmo dia não recebe o lembrete dessa sessão: ela acabou de ser avisada (se a criança ou o horário mudarem depois da confirmação, o lembrete volta a sair, com o horário novo). Essa conferência nunca manda lembrete de sessão do próprio dia.',
          },
          {
            termo: 'Último horário desses lembretes (hora)',
            descricao: 'padrão 20, de 9 a 22. A última hora cheia em que o sistema ainda manda o lembrete de quem foi marcado depois das 8h. Sessão marcada depois desse horário para o dia seguinte fica sem lembrete — é o limite para não mandar mensagem à família tarde da noite.',
          },
          {
            termo: 'Incluir reservas nos lembretes',
            descricao: 'desligado por padrão. Reserva é compromisso provisório; avisar a família dela vira promessa que a clínica pode não cumprir.',
          },
          {
            termo: 'Quando a família toca em "Preciso desmarcar"',
            descricao: 'padrão "Avisar a recepção, que resolve". Vale para o lembrete com os botões "Confirmo" e "Preciso desmarcar". No padrão, a sessão continua marcada: o cartão ganha o alerta vermelho, o pedido entra em "Desmarques" na barra do topo, e a recepção resolve ao abrir o cartão: "Desmarcar (a família pediu)" ou "Manter a sessão (a família desistiu)" — um toque errado da família não libera o horário sem ninguém ver. "Desmarcar sozinho" já aplica a situação do ajuste abaixo; se ela não estiver escolhida, ou se aquela sessão não puder mudar de situação, o sistema só marca em vermelho.',
          },
          {
            termo: 'Status aplicado quando a família desmarca',
            descricao: 'começa em "Não configurado". É a situação que o botão "Desmarcar (a família pediu)" do cartão aplica, e a que o "Desmarcar sozinho" usa. Escolha pelo nome, na lista: só aparecem situações que não consomem sessão e liberam o horário — é o que devolve a vaga para outra criança. Sem situação escolhida, o botão abre a lista de situações para a recepção escolher na hora. Para isso existe "Desmarcado pelo Paciente".',
          },
          {
            termo: 'Resposta automática ao "Confirmo"',
            descricao: 'padrão "Obrigado! Presença confirmada ✅". A família recebe logo depois de tocar em Confirmo, como mensagem comum: não leva nome nem horário e não conta no teto de mensagens do mês. Não sai para quem pediu para não receber mensagens. Vazio desliga a resposta.',
          },
          {
            termo: 'Resposta automática ao "Preciso desmarcar"',
            descricao: 'padrão "Recebemos 👍 A recepção vai falar com você para remarcar." Mesma regra da anterior: sai logo depois do toque, sem nome nem horário, fora do teto do mês. Vazio desliga a resposta.',
          },
          {
            termo: 'Considerar notificações a partir de (bloco Notificações)',
            descricao: 'começa vazio. É uma data de corte: nada anterior a ela entra nos contadores do topo. Serve principalmente na virada de sistema, para não herdar anos de pendência antiga no primeiro dia.',
          },
        ],
      },

      { tipo: 'subtitulo', texto: 'Aba Segurança — travas nas mudanças de acesso', id: 'configuracoes-seguranca' },
      { tipo: 'captura', id: 'configuracoes-seguranca' },
      {
        tipo: 'lista',
        itens: [
          {
            termo: 'Exigir aprovação de dois administradores nas mudanças de acesso',
            descricao: 'desligado por padrão. Ligado, mexer em usuário ou em nível de permissão passa a depender de um segundo administrador aprovar — as mudanças ficam esperando na aba Aprovações. Só é possível ligar com pelo menos dois administradores ativos, e desligar também vira uma aprovação.',
          },
          {
            termo: 'Separar controle de permissões da escrita financeira',
            descricao: 'desligado por padrão. Ligado, ninguém acumula "mudar permissões" e "mexer no financeiro" — é a separação clássica para que uma pessoa sozinha não consiga se dar acesso e lançar dinheiro. Só liga com a aprovação dupla ligada e se nenhum nível atual violar a regra; o sistema aponta quais precisam ser ajustados antes. Ligada, quem gere o acesso monta o nível do financeiro sem ter o dinheiro, e outra pessoa que gere o acesso aprova. Também com ela ligada, quem gere o acesso não troca a senha de quem mexe no dinheiro: tire o nível da pessoa, troque a senha e peça o nível de volta.',
          },
        ],
      },

      { tipo: 'subtitulo', texto: 'Aba Cadastro — o que a ficha da criança exige', id: 'configuracoes-cadastro' },
      { tipo: 'captura', id: 'configuracoes-cadastro' },
      {
        tipo: 'paragrafo',
        texto:
          'Esta aba não é uma lista de opções, é a régua do formulário: para cada campo da ficha do paciente você escolhe entre Obrigatório, Opcional e Não aparece.',
      },
      {
        tipo: 'lista',
        itens: [
          { termo: 'Obrigatório', descricao: 'o cadastro não é salvo sem esse campo preenchido.' },
          { termo: 'Opcional', descricao: 'o campo aparece no formulário e pode ficar em branco.' },
          { termo: 'Não aparece', descricao: 'o campo some do formulário — ninguém preenche nem vê.' },
          {
            termo: 'O cadeado',
            descricao: 'alguns campos têm um cadeado e uma explicação do porquê: são os que o sistema não deixa esconder. Nome e Nascimento, por exemplo — é a data de nascimento que diz se a criança é menor de idade e faz o sistema exigir um responsável.',
          },
        ],
      },
      {
        tipo: 'atencao',
        texto:
          'Mudar a régua não altera nenhuma ficha já gravada: vale a partir da próxima vez que alguém salvar aquele cadastro. Tornar um campo obrigatório não sai preenchendo o que faltou no passado.',
      },

      { tipo: 'subtitulo', texto: 'Onde fica o ajuste que eu procuro' },
      {
        tipo: 'lista',
        itens: [
          { termo: '"A grade não mostra sábado"', descricao: 'aba Agenda › Dias de fim de semana na grade.' },
          { termo: '"Os horários aparecem de 40 em 40 e a sessão é de 50"', descricao: 'aba Agenda › Granularidade da grade.' },
          { termo: '"Não consigo marcar em data que já passou"', descricao: 'aba Agenda › Permitir agendamento retroativo.' },
          { termo: '"Quero arrastar o cartão para outro horário"', descricao: 'aba Agenda › Arrastar card para remarcar.' },
          { termo: '"O aviso de pacote acabando chega tarde demais"', descricao: 'aba Atendimento › Alertar fim de pacote a partir de.' },
          { termo: '"As famílias não estão recebendo lembrete"', descricao: 'aba Comunicação › Enviar mensagens automáticas, e depois o Teto de mensagens por mês. Se são só as famílias de um profissional, abra a ficha dele: "Mensagens automáticas às famílias: desligadas" quer dizer que a caixa foi desmarcada no cadastro.' },
          { termo: '"A criança some da agenda e ninguém percebe"', descricao: 'aba Agenda › Dias sem próximo agendamento para entrar nas pendências.' },
          { termo: '"Quero exigir o CPF no cadastro"', descricao: 'aba Cadastro › o campo CPF, botão Obrigatório.' },
          { termo: '"A barra ainda mostra o nome do sistema"', descricao: 'aba Clínica › Nome da clínica e Identidade na barra lateral.' },
        ],
      },
    ],
  },
  {
    id: 'no-celular',
    titulo: 'No celular e no tablet',
    resumo: 'A mesma agenda na tela pequena, com a navegação em gaveta.',
    blocos: [
      {
        tipo: 'paragrafo',
        texto:
          'Em telas pequenas a barra da esquerda não cabe, então ela vira uma gaveta: toque no botão de menu, no canto de cima à esquerda, para abrir a lista de destinos, e escolha para onde ir. A gaveta fecha sozinha.',
      },
      {
        tipo: 'paragrafo',
        texto:
          'Na visão Dia, o celular mostra um profissional por vez — escolha quem você quer ver no seletor acima da grade. Na Visão geral, ele mostra todos, em uma lista por horário.',
      },
      {
        tipo: 'paragrafo',
        texto:
          'Nenhum DESTINO some no celular: a gaveta tem os mesmos itens da barra do computador. O que muda é a agenda, que vira lista — e a lista tem menos gestos que a grade:',
      },
      {
        tipo: 'lista',
        itens: [
          {
            termo: 'Só aparecem os horários com atendimento',
            descricao: 'os vazios ficam de fora, então não dá para tocar num horário livre para marcar. Marcar novo é pelo computador, ou pela lista de espera.',
          },
          {
            termo: 'Não dá para arrastar',
            descricao: 'o ARRASTE é gesto de mouse, e no toque o risco de remarcar a criança errada sem querer é grande demais — por isso ele não existe no celular. O botão "Remarcar" do cartão, esse sim, fica sempre à vista no toque; e continua valendo o caminho de sempre, abrir o cartão em Mais ações › Editar.',
          },
          {
            termo: 'O resto funciona igual',
            descricao: 'abrir o cartão, ver os detalhes, trocar a situação, registrar o atendimento.',
          },
        ],
      },
      {
        tipo: 'dica',
        texto:
          'Para consultar a agenda de casa ou do corredor, o celular resolve. Para marcar muita coisa seguida, o computador do balcão é bem mais rápido — e é lá que a grade tem todos os gestos.',
      },
    ],
  },
  {
    id: 'quando-da-errado',
    titulo: 'Quando o sistema não deixa',
    resumo: 'As recusas mais comuns, em português, e o que fazer com cada uma.',
    blocos: [
      {
        tipo: 'paragrafo',
        texto:
          'Quando o sistema recusa alguma coisa, ele diz o motivo no próprio campo que causou o problema — em vez de um aviso genérico no alto. Vale ler antes de tentar de novo: quase sempre a correção é de um clique.',
      },
      {
        tipo: 'lista',
        itens: [
          {
            termo: '"O profissional já tem atendimento nesse horário"',
            descricao: 'escolha outro horário, outro profissional, ou desmarque o que está lá antes.',
          },
          {
            termo: '"A sala já está ocupada"',
            descricao: 'troque a sala ou o horário. A lista de salas está em Cadastros.',
          },
          {
            termo: '"Este paciente já tem atendimento nesse horário"',
            descricao: 'a criança está marcada com outro profissional na mesma hora. Confira a agenda dela na ficha, em Agendamentos.',
          },
          {
            termo: '"Fora do horário de atendimento do profissional"',
            descricao: 'o horário não está no cadastro dele. Corrija o cadastro do profissional, se for o caso.',
          },
          {
            termo: '"Sem saldo no tratamento"',
            descricao: 'o pacote acabou. Fale com a família sobre a renovação antes de marcar.',
          },
          {
            termo: '"Não vejo a aba Equipe"',
            descricao: 'ela (a antiga Produtividade) exige DUAS permissões: Agenda › Ver e Atendimentos › Ver. Com só uma delas, a aba não aparece. Quem cuida dos níveis resolve em Usuários › Níveis de permissão.',
          },
          {
            termo: 'A aba Equipe abre vazia',
            descricao: 'ou não há profissional ativo, ou o seu nível não alcança os dois lados da conta. Um nível de balcão sem a caixa "Operar a agenda e os pacotes de toda a clínica", ou um terapeuta sem vínculo com o profissional dele, recebe lista vazia de propósito.',
          },
          {
            termo: '"Falta um relatório que eu usava"',
            descricao: 'procure pelo nome ANTIGO na busca da tela Relatórios — cada cartão diz quais nomes do ClinicaÁgil ele cobre. Se mesmo assim não aparecer, é permissão: cada relatório pede a do assunto dele (o histórico de movimentação da agenda, por exemplo, pede Auditoria › Ver).',
          },
          {
            termo: 'A tela pede permissão que você não tem',
            descricao: 'não é defeito: o seu nível não alcança aquela tela. Peça a quem administra.',
          },
        ],
      },
      {
        tipo: 'paragrafo',
        texto:
          'Se a série de agendamentos foi recusada, leia a mensagem inteira: ela diz O MOTIVO (o horário do profissional já ocupado, a sala, o equipamento ou a própria criança já marcada na hora), mostra o horário que está ocupado na primeira data em choque e lista as datas. Nada é criado. Com o motivo na mão dá para mudar o horário, o dia ou a sala — ou marcar a série mais curta — e tentar outra vez, sem adivinhar.',
      },
      {
        tipo: 'dica',
        texto:
          'A tela parece travada ou desatualizada? Atualize a página no navegador (F5). Se persistir, saia e entre de novo. Se ainda assim continuar, anote o que você estava fazendo e avise quem administra o sistema — a auditoria guarda o rastro e o problema fica fácil de achar.',
      },
    ],
  },
]
