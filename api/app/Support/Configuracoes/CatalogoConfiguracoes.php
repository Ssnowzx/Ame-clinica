<?php

namespace App\Support\Configuracoes;

use App\Support\Financeiro\MensagemDeCobranca;
use Carbon\Carbon;
use InvalidArgumentException;

/**
 * Catálogo tipado das configurações conhecidas (design D5): chave → tipo + default.
 * O catálogo é METADADO e vive em código; o VALOR é dado (override da clínica no
 * banco). Cada change futura registra suas chaves aqui (§13).
 */
class CatalogoConfiguracoes
{
    public const TIPOS = ['string', 'bool', 'int'];

    /**
     * As SEÇÕES da tela de configurações, na ORDEM em que as abas aparecem — slug → rótulo.
     * Espelha `CatalogoCamposCadastro::SECOES`, e existe pelo mesmo motivo: agrupamento de
     * tela é decisão de produto, não consequência de como a chave foi nomeada. Antes desta
     * lista a aba era o PREFIXO da chave, e `mensagens.retencao_dias` ganhava uma aba
     * inteira para um controle só.
     *
     * A ordem do array é a ordem das abas; a tela não reordena.
     *
     * @var array<string, string>
     */
    public const SECOES = [
        'clinica' => 'Clínica',
        'agenda' => 'Agenda',
        'atendimento' => 'Atendimento',
        'financeiro' => 'Financeiro',
        'comunicacao' => 'Comunicação',
        'seguranca' => 'Segurança',
    ];

    /**
     * Os BLOCOS (subtítulos) dentro de uma seção — slug do prefixo da chave → rótulo.
     *
     * Uma seção pode reunir prefixos diferentes: "Comunicação" junta mensagens, WhatsApp,
     * lembretes e notificações. Agrupar por prefixo resolve QUEM vai junto, mas não diz de
     * onde sai o NOME do agrupamento — e o único mapa prefixo → rótulo vivia no front,
     * justamente a lista que esta change apagou de lá.
     *
     * O `bloco` de uma chave é derivado do prefixo AQUI, para a tela nunca repartir a chave.
     *
     * @var array<string, string>
     */
    public const BLOCOS = [
        'clinica' => 'Clínica',
        // o link que a família abre para se cadastrar sozinha (change cadastro-online-do-paciente)
        'cadastro_online' => 'Cadastro pelo link',
        // desde quando os indicadores contam e comparam (change inicio-dos-indicadores)
        'indicadores' => 'Indicadores',
        'agenda' => 'Agenda',
        'tratamentos' => 'Tratamentos',
        'evolucoes' => 'Evoluções',
        'financeiro' => 'Financeiro',
        // o WhatsApp vem PRIMEIRO em Comunicação: é o assunto que a clínica mais procura
        // aqui, e a conexão dele é o único item da tela que leva a outra página
        'whatsapp' => 'WhatsApp',
        'mensagens' => 'Mensagens',
        'lembretes' => 'Lembretes',
        'notificacoes' => 'Notificações',
        'seguranca' => 'Segurança',
    ];

    /**
     * Prefixo das chaves de EXIBIÇÃO da agenda: são lidas sob `agenda.ver`
     * (T-sag-02 — a grade não pode exigir `configuracoes.ver`, que dá acesso ao
     * catálogo inteiro).
     *
     * @var list<string>
     */
    public const CHAVES_EXIBICAO_AGENDA = [
        'agenda.granularidade_min',
        'agenda.fim_de_semana',
        'agenda.visao_padrao',
        'agenda.janela_padrao_inicio',
        'agenda.janela_padrao_fim',
        // toggle do gesto de arrastar para remarcar (change arrastar-para-remarcar, D4):
        // a grade decide a afordância na LEITURA de exibição, sem configuracoes.ver
        'agenda.arrastar_para_remarcar',
        'clinica.timezone',
        // A evolução se escreve DENTRO do diálogo da agenda, e o servidor a recusa sem
        // responsável técnico quando esta flag está ligada. Sem a tela saber disso, ligar a
        // configuração tornava IMPOSSÍVEL registrar qualquer evolução: 422 num campo que a
        // tela não tinha (gate CR, IMPORTANTE 1). Regra é DADO — e a tela precisa LER o dado.
        'evolucoes.responsavel_tecnico_obrigatorio',
        // salvar a evolução finaliza a sessão e desconta do pacote (evolucao-finaliza-a-sessao):
        // o painel da sessão diz isso ANTES do clique — efeito no pacote não chega de surpresa
        'evolucoes.status_ao_salvar',
    ];

    /**
     * `rotulo` e `secao` são OBRIGATÓRIOS em toda chave: são o nome que a clínica lê e a aba
     * onde a chave aparece. Antes eles viviam em duas listas no front, e a change
     * `mensageria-whatsapp` provou o custo disso — acrescentou as chaves `whatsapp.*`, as
     * listas não foram atualizadas, e a administradora viu `whatsapp.limite_mensal` cru na
     * tela. Aqui a omissão é erro de catálogo, pego pela suíte.
     *
     * @var array<string, array{rotulo: string, secao: string, tipo: string, default: mixed, min?: int, max?: int, formato?: string, opcoes?: list<string>, nao_futura?: bool, primeiro_do_mes?: bool, ajuda?: string}>
     */
    private const BASE = [
        'clinica.nome' => ['rotulo' => 'Nome da clínica', 'secao' => 'clinica', 'tipo' => 'string', 'default' => ''],
        // fuso IANA real: o cliente monta Intl.DateTimeFormat com este valor, e
        // um fuso inválido derruba a agenda inteira (SEC-R2)
        'clinica.timezone' => ['rotulo' => 'Fuso horário', 'secao' => 'clinica', 'tipo' => 'string', 'default' => 'America/Sao_Paulo', 'formato' => 'timezone'],
        // identidade visual (change identidade-da-clinica): o que a barra lateral exibe.
        // O ARQUIVO da logo não mora aqui (colunas server-set em `clinica` — decisão 1
        // do design: caminho gravável pelo cliente viraria leitura arbitrária no GET)
        'clinica.identidade' => ['rotulo' => 'Identidade na barra lateral', 'secao' => 'clinica', 'tipo' => 'string', 'default' => 'nome', 'opcoes' => ['nome', 'logo']],
        'clinica.fonte_do_nome' => [
            'rotulo' => 'Fonte do nome',
            'secao' => 'clinica',
            'tipo' => 'string',
            'default' => 'padrao',
            'opcoes' => ['padrao', 'serifada', 'arredondada', 'manuscrita'],
        ],
        // tema de cores da clínica (change tema-da-clinica): a paleta de cada opção é curadoria do
        // design system (`index.css`), com contraste AA conferido; aqui fica só a ESCOLHA, que é dado
        // da clínica (§13). A clínica nasce no Padrão — nenhum deploy troca a cor de ninguém.
        // `xclinicas` (change tema-xclinicas) é a marca do PRODUTO. Nenhuma opção leva o nome de
        // uma clínica (change tema-menta: o tema verde-água e rosa virou `menta`)
        'clinica.tema' => [
            'rotulo' => 'Tema de cores',
            'secao' => 'clinica',
            'tipo' => 'string',
            'default' => 'padrao',
            'opcoes' => ['padrao', 'menta', 'xclinicas'],
        ],
        /*
         * AUTO-CADASTRO PÚBLICO (change `cadastro-online-do-paciente`, §13).
         *
         * `ativo` nasce FALSE, e isso não é cautela decorativa: é a posição segura
         * de uma rota pública que ESCREVE. Ninguém ganha uma porta aberta por deploy — a clínica
         * gera o endereço, testa, e liga quando quiser. Desligar derruba a porta sem deploy, o
         * que também é o plano de rollback.
         *
         * O SLUG não entra aqui, e a razão é do parecer (D5): toda escrita em `configuracoes` é
         * auditada COM O VALOR EM CLARO, e a trilha é legível por quem tem `auditoria.ver` —
         * gravar o slug ali entregaria o endereço do formulário pela própria trilha. Ele mora em
         * coluna da clínica, e a auditoria registra que houve rotação, nunca para qual valor.
         */
        'cadastro_online.ativo' => ['rotulo' => 'Cadastro pelo link ligado', 'secao' => 'clinica', 'tipo' => 'bool', 'default' => false],
        // 30 dias: resposta da clínica (Mariana, 2026-08-31). Faixa validada na escrita; dado de
        // menor parado numa fila é dado guardado sem finalidade
        'cadastro_online.retencao_dias' => ['rotulo' => 'Apagar cadastro não conferido depois de (dias)', 'secao' => 'clinica', 'tipo' => 'int', 'default' => 30, 'min' => 1, 'max' => 365],
        // Desde quando os indicadores contam e comparam (change inicio-dos-indicadores, D1/D2). Antes
        // dela a clínica ainda estava implantando o sistema: o primeiro agendamento sozinho errou o
        // início por um mês na produção (12/08, com o uso real em meados de setembro). VAZIA é o
        // primeiro agendamento. Data futura é recusada, ou todo mês viraria "antes do início". Só o
        // DIA 1º: as séries e o número do mês cortam por MÊS — "a partir de 10 de setembro" contando
        // desde o dia 1º diria uma coisa e mostraria outra (gate r1, code-reviewer)
        'indicadores.comparar_a_partir_de' => [
            'rotulo' => 'Indicadores a partir de',
            'secao' => 'clinica',
            'tipo' => 'string',
            'default' => '',
            'formato' => 'date',
            'nao_futura' => true,
            'primeiro_do_mes' => true,
            'ajuda' => 'O dia 1º do mês em que a clínica passou a usar o sistema de verdade. Antes dele, os indicadores não comparam nem mostram tendência. Vazio: desde o primeiro agendamento.',
        ],
        // §7/§13: bloqueio opcional de tratamento duplicado com o mesmo serviço em aberto
        'tratamentos.bloquear_duplicado_mesmo_servico' => ['rotulo' => 'Bloquear tratamento duplicado com o mesmo serviço', 'secao' => 'atendimento', 'tipo' => 'bool', 'default' => false],
        // antecedência do aviso de PEDIDO MÉDICO a vencer (limites-e-pedidos, D5): dias
        // antes do vencimento em que o pedido entra no centro/painel. Faixa 7..180 na
        // ESCRITA aqui + clamp defensivo na LEITURA (PedidosMedicos::antecedenciaDias —
        // valor adulterado no banco nunca alarga além de 180; SEC-LP-16, dois lados).
        'tratamentos.pedido_aviso_antecedencia_dias' => ['rotulo' => 'Antecedência do aviso de pedido médico (dias)', 'secao' => 'atendimento', 'tipo' => 'int', 'default' => 60, 'min' => 7, 'max' => 180],
        // limiar do alerta de FIM DE PACOTE (change alerta-de-fim-de-pacote, §13): a partir
        // de quantas sessões restantes o card é realçado e o pacote entra na fila de cobrança.
        // Era constante em DOIS runtimes; virou dado como os três blocos irmãos do centro.
        // Faixa 1..20 na escrita aqui + clamp defensivo na leitura (RealceDoPacote).
        'tratamentos.saldo_alerta_sessoes' => ['rotulo' => 'Alertar fim de pacote a partir de (sessões restantes)', 'secao' => 'atendimento', 'tipo' => 'int', 'default' => 2, 'min' => 1, 'max' => 20],
        // §6/§13: agenda
        'agenda.permitir_retroativo' => ['rotulo' => 'Permitir agendamento retroativo', 'secao' => 'agenda', 'tipo' => 'bool', 'default' => false],
        // gesto de arrastar o card para remarcar (FA-13) — opt-in conservador como o
        // retroativo (D4); a grade o lê sob agenda.ver (CHAVES_EXIBICAO_AGENDA)
        'agenda.arrastar_para_remarcar' => ['rotulo' => 'Arrastar card para remarcar', 'secao' => 'agenda', 'tipo' => 'bool', 'default' => false],
        'agenda.permitir_reposicao_de_reposicao' => ['rotulo' => 'Permitir reposição de reposição', 'secao' => 'agenda', 'tipo' => 'bool', 'default' => false],
        // eixo PACIENTE do conflito (change conflito-do-paciente, §13): a mesma criança em
        // dois atendimentos sobrepostos — em profissionais/salas diferentes — não é conflito
        // de recurso, e por isso passava. Um dos dois é fantasma. A AÇÃO é dado porque a
        // sessão CONJUNTA (fono + TO na mesma criança) existe em clínica multidisciplinar e a
        // clínica pode ainda não praticar; `avisar`/`permitir` destravam sem deploy.
        // Vocabulário igual ao de `RegraLimiteConvenio.acao` — não se inventa um segundo.
        // NÃO é chave de exibição: quem decide é o servidor, a grade não redesenha por ela.
        'agenda.conflito_paciente' => [
            'rotulo' => 'Mesmo paciente em horários sobrepostos',
            'secao' => 'agenda',
            'tipo' => 'string',
            'default' => 'bloquear',
            'opcoes' => ['bloquear', 'avisar', 'permitir'],
        ],
        // §7/§13: evolução (etapa 6) — prazo em dias corridos do atendimento
        'evolucoes.prazo_dias' => ['rotulo' => 'Prazo para evolução (dias corridos)', 'secao' => 'atendimento', 'tipo' => 'int', 'default' => 100, 'min' => 1, 'max' => 3650],
        // carência da TRAVA do finalizar (change trava-de-evolucao, D4): dias ALÉM do
        // prazo antes de o registro de novas sessões do profissional ser recusado;
        // 0 = trava no dia seguinte ao próprio vencimento. NÃO entra em
        // CHAVES_EXIBICAO_AGENDA (D3): o aviso chega PRONTO ao front pelo centro de
        // notificações — a tela nunca lê a regra crua.
        'evolucoes.trava_carencia_dias' => ['rotulo' => 'Carência antes de travar a evolução (dias)', 'secao' => 'atendimento', 'tipo' => 'int', 'default' => 3, 'min' => 0, 'max' => 365],
        'evolucoes.responsavel_tecnico_obrigatorio' => ['rotulo' => 'Exigir responsável técnico na evolução', 'secao' => 'atendimento', 'tipo' => 'bool', 'default' => false],
        'evolucoes.bloquear_apos_status' => ['rotulo' => 'Bloquear evolução após o status final', 'secao' => 'atendimento', 'tipo' => 'bool', 'default' => false],
        // change evolucao-finaliza-a-sessao (D3): salvar a evolução aplica este status à sessão em
        // aberto. 0 = desligado. Só status que FINALIZA (desconta, ocupa horário, não é falta) — validado no
        // controller, como os outros ponteiros de status
        'evolucoes.status_ao_salvar' => ['rotulo' => 'Status aplicado ao salvar a evolução', 'secao' => 'atendimento', 'tipo' => 'int', 'default' => 0, 'min' => 0, 'formato' => 'status_que_finaliza'],
        // §9/§13/§14: financeiro (etapa 7) — default false é FAIL-CLOSED na
        // fronteira de convênios (T-fin-17), requisito e não sugestão
        'financeiro.lancar_convenio_no_caixa' => ['rotulo' => 'Lançar convênio no fluxo de caixa', 'secao' => 'financeiro', 'tipo' => 'bool', 'default' => false],
        'financeiro.contabil_padrao' => ['rotulo' => 'Marcar lançamentos como contábeis por padrão', 'secao' => 'financeiro', 'tipo' => 'bool', 'default' => true],
        // teto do desconto no FATURAMENTO (T-fin-16); 100 = sem teto (D10/P1 —
        // fidelidade à referência, a clínica aperta)
        'financeiro.desconto_maximo_pct' => ['rotulo' => 'Desconto máximo no faturamento (%)', 'secao' => 'financeiro', 'tipo' => 'int', 'default' => 100, 'min' => 0, 'max' => 100],
        // a cobrança pelo WhatsApp (change `cobranca-pelo-whatsapp`, D4): texto da clínica, com as
        // marcas de `MensagemDeCobranca::MARCAS` — marca desconhecida é recusada na escrita
        'financeiro.mensagem_cobranca' => ['rotulo' => 'Mensagem de cobrança pelo WhatsApp', 'secao' => 'financeiro', 'tipo' => 'string', 'default' => MensagemDeCobranca::PADRAO, 'formato' => 'mensagem_cobranca'],
        // §10/§13: notificações & automações (etapa 8)
        // corte inferior das janelas do centro — o teto de 366 dias vale SEMPRE
        'notificacoes.a_partir_de' => ['rotulo' => 'Considerar notificações a partir de', 'secao' => 'comunicacao', 'tipo' => 'string', 'default' => '', 'formato' => 'date'],
        'agenda.faltas_consecutivas_limite' => ['rotulo' => 'Limite de faltas consecutivas para alerta', 'secao' => 'agenda', 'tipo' => 'int', 'default' => 3, 'min' => 1, 'max' => 20],
        // dias sem próximo agendamento que caracterizam a pendência de RETORNO
        // (protocolo-de-pendencias, D5): 30 é o ">1 mês" que a clínica relatou.
        // A faixa vale na escrita E é clampada de novo na LEITURA (PendenciasDeRetorno).
        'agenda.pendencia_retorno_dias' => ['rotulo' => 'Dias sem próximo agendamento para entrar nas pendências', 'secao' => 'agenda', 'tipo' => 'int', 'default' => 30, 'min' => 7, 'max' => 180],
        // encadeamento nasce desligado (fail-closed, T-not-09); o alvo é
        // revalidado também na ESCRITA (status da clínica não-descontante — controller)
        'agenda.encadeamento_ativo' => ['rotulo' => 'Encadear status automaticamente', 'secao' => 'agenda', 'tipo' => 'bool', 'default' => false],
        'agenda.encadeamento_status_id' => ['rotulo' => 'Status-alvo do encadeamento', 'secao' => 'agenda', 'tipo' => 'int', 'default' => 0, 'min' => 0],
        // §13: desmarque em massa da agenda de um profissional (change desmarque-do-profissional).
        //
        // O status aplicado é DADO, no molde exato do encadeamento acima — e pelo mesmo motivo
        // semântico: automação (encadeamento) e DESMARQUE jamais consomem sessão da criança —
        // ela não foi atendida. A BAIXA POR STATUS consome DE PROPÓSITO: o operador escolhe o
        // status entre os que a clínica marcou `aplicavel_em_lote`, lê o número de sessões na
        // prévia e confirma (change `baixa-em-lote-por-status`). Por isso ela não tem chave de
        // status aqui — o status é escolhido no gesto — e tem teto próprio, logo abaixo.
        // `0` significa NÃO CONFIGURADO, e o desmarque recusa com o caminho em vez de escolher
        // um status por conta própria: adivinhar aqui gastaria sessão de dezenas de pacotes.
        // Revalidado na ESCRITA (status da clínica, não-descontante — controller) e ZERADO
        // quando o status apontado é excluído (StatusAgendamentoController).
        'agenda.status_desmarque_id' => ['rotulo' => 'Status aplicado ao desmarcar a agenda do profissional', 'secao' => 'agenda', 'tipo' => 'int', 'default' => 0, 'min' => 0, 'formato' => 'status'],
        // TETO do lote. Não é conforto de performance — é o freio do gesto: com intervalo de
        // datas, um clique alcança um semestre, e o aviso às famílias nasce marcado. O teto
        // tem MÁXIMO próprio porque um teto arbitrariamente alto esvazia o freio; 200 é o
        // limite do sistema, acima disso a operação deixa de ser revisável por quem confirma.
        'agenda.desmarque_em_lote_maximo' => ['rotulo' => 'Máximo de agendamentos por desmarque em lote', 'secao' => 'agenda', 'tipo' => 'int', 'default' => 60, 'min' => 1, 'max' => 200],
        // TETO da baixa em lote por status (change baixa-em-lote-por-status, D12) — o freio do
        // gesto que CONSOME sessão de propósito: é comparado contra os em aberto da janela,
        // ANTES de classificar qualquer linha (o maior número que a operação lê). Separado do
        // teto do desmarque, que é baixo porque dispara mensagem às famílias: 7 dias × ~14
        // atendimentos de um profissional dão ~100, e 60 recusaria o caso principal da clínica
        // na primeira semana. 200 é o limite do sistema — acima disso a prévia deixa de ser
        // revisável por quem confirma. NÃO é chave de exibição da agenda: a grade não precisa
        // dela para desenhar, e quem passa do teto é avisado pelo 422 com o número.
        'agenda.baixa_em_lote_maximo' => ['rotulo' => 'Máximo de agendamentos por baixa em lote', 'secao' => 'agenda', 'tipo' => 'int', 'default' => 100, 'min' => 1, 'max' => 200],
        // O NOME do template do aviso de desmarque — dado, como `lembretes.template` já é.
        // Vazio = não configurado: a operação desmarca e devolve a lista de famílias a avisar
        // à mão, em vez de inventar um template. O TEXTO precisa ser escrito COM a clínica
        // antes do primeiro uso real: é comunicação em nome dela, sobre a criança.
        'mensagens.template_desmarque' => ['rotulo' => 'Template do aviso de desmarque', 'secao' => 'comunicacao', 'tipo' => 'string', 'default' => ''],
        // Os NOMES dos modelos dos avisos do agendamento (change avisos-do-agendamento-por-whatsapp)
        // — dado, como `lembretes.template`. Vazio desliga aquele aviso: a gravação segue e a
        // resposta diz "não configurado", em vez de inventar texto em nome da clínica.
        'mensagens.template_confirmacao' => ['rotulo' => 'Modelo da confirmação do primeiro agendamento', 'secao' => 'comunicacao', 'tipo' => 'string', 'default' => 'confirmacao_agendamento'],
        'mensagens.template_remarcacao' => ['rotulo' => 'Modelo do aviso de mudança de horário', 'secao' => 'comunicacao', 'tipo' => 'string', 'default' => 'remarcacao_agendamento'],
        'mensagens.template_cancelamento' => ['rotulo' => 'Modelo do aviso de cancelamento pela clínica', 'secao' => 'comunicacao', 'tipo' => 'string', 'default' => 'cancelamento_agendamento'],
        // o freio por FAMÍLIA dos três avisos (SEC-AV-10): ir e voltar por horários diferentes mandava
        // uma mensagem paga por gravação e podia esgotar o teto do mês — o lembrete não conta aqui
        'mensagens.avisos_por_familia_dia' => ['rotulo' => 'Máximo de avisos do agendamento por família por dia', 'secao' => 'comunicacao', 'tipo' => 'int', 'default' => 4, 'min' => 1, 'max' => 20],
        // A fronteira manhã/tarde é REGRA DA CLÍNICA, não meio-dia universal: há turno que
        // vira 13:00. `if (hora < 12)` seria o hardcode que a §13 proíbe.
        'agenda.corte_manha_tarde' => ['rotulo' => 'Hora que separa manhã de tarde', 'secao' => 'agenda', 'tipo' => 'string', 'default' => '12:00', 'formato' => 'hora'],
        // §6/§13: EXIBIÇÃO da grade (change de telas) — regra de tela é DADO.
        // Lidas sob `agenda.ver` (CHAVES_EXIBICAO_AGENDA), não sob configuracoes.ver.
        'agenda.granularidade_min' => ['rotulo' => 'Granularidade da grade (minutos)', 'secao' => 'agenda', 'tipo' => 'int', 'default' => 40, 'min' => 5, 'max' => 120],
        'agenda.fim_de_semana' => [
            'rotulo' => 'Dias de fim de semana na grade',
            'secao' => 'agenda',
            'tipo' => 'string',
            'default' => 'nenhum',
            'opcoes' => ['nenhum', 'sabado', 'domingo', 'ambos'],
        ],
        'agenda.visao_padrao' => [
            'rotulo' => 'Visão padrão da agenda',
            'secao' => 'agenda',
            'tipo' => 'string',
            'default' => 'dia',
            'opcoes' => ['dia', 'semana', 'geral'],
        ],
        // janela da grade para profissional SEM janela cadastrada
        'agenda.janela_padrao_inicio' => ['rotulo' => 'Início da janela padrão da grade', 'secao' => 'agenda', 'tipo' => 'string', 'default' => '08:00', 'formato' => 'hora'],
        'agenda.janela_padrao_fim' => ['rotulo' => 'Fim da janela padrão da grade', 'secao' => 'agenda', 'tipo' => 'string', 'default' => '19:00', 'formato' => 'hora'],
        // §12/AP-13: governança de acesso (change segregacao-de-deveres) — regra é DADO.
        // LIGAR a dupla exige ≥2 admins ativos; LIGAR a segregação exige zero níveis
        // violadores; DESLIGAR qualquer `seguranca.*` com a dupla ligada vira pendência
        // de aprovação (SEC-SD-08) — tudo no boundary de escrita, não aqui.
        'seguranca.aprovacao_dupla' => ['rotulo' => 'Exigir aprovação de dois administradores nas mudanças de acesso', 'secao' => 'seguranca', 'tipo' => 'bool', 'default' => false],
        'seguranca.segregacao_financeira' => ['rotulo' => 'Separar controle de permissões da escrita financeira', 'secao' => 'seguranca', 'tipo' => 'bool', 'default' => false],
        // §10/§13: comunicação por WhatsApp (change mensageria-whatsapp).
        // Os SEGREDOS da conexão NÃO estão aqui, e não é descuido: toda escrita em
        // `configuracoes` é auditada com o valor CRU (o model é `Auditavel`) — o Access
        // Token entraria em claro na trilha. Credencial mora em `whatsapp_conexoes`,
        // cifrada. Aqui só o que a clínica de fato parametriza.
        //
        // O automático nasce DESLIGADO: ligar mensageria é decisão da clínica, e um
        // default ligado dispararia lembrete no primeiro deploy com credencial.
        'whatsapp.automatico' => ['rotulo' => 'Enviar mensagens automáticas', 'secao' => 'comunicacao', 'tipo' => 'bool', 'default' => false],
        // Teto de conversas INICIADAS pela clínica no mês (a Meta cobra por conversa).
        // `0` significa NENHUM envio iniciado — não "ilimitado": um teto que vira infinito
        // quando zerado é a pior surpresa possível numa configuração de custo.
        //
        // O DEFAULT SAI DA ESCALA REAL, não de um número redondo. A clínica de referência tem ~400
        // pacientes ativos e ~1.240 pacotes em andamento; a ~1 sessão semanal por pacote,
        // são ~3.000–5.000 sessões/mês. Com o lote ligado (uma mensagem por família/dia),
        // o lembrete gera algo entre 2.000 e 3.000 conversas iniciadas.
        //
        // O primeiro default era 1.000 — "conservador", e ERRADO: a clínica bateria o teto
        // por volta do dia 10 e os lembretes parariam no meio do mês. Um teto abaixo do uso
        // normal não protege a fatura; ele desliga a funcionalidade em silêncio.
        // 6.000 dá folga sobre o pior mês e continua barrando o laço de código, que é o que
        // este teto existe para pegar.
        'whatsapp.limite_mensal' => ['rotulo' => 'Teto de mensagens por mês', 'secao' => 'comunicacao', 'tipo' => 'int', 'default' => 6000, 'min' => 0, 'max' => 100000],
        // valor inicial do marcador de lembrete em agendamentos NOVOS
        'whatsapp.pre_selecionado' => ['rotulo' => 'Sugerir o WhatsApp já marcado no cadastro', 'secao' => 'comunicacao', 'tipo' => 'bool', 'default' => true],
        'lembretes.antecedencia_horas' => ['rotulo' => 'Antecedência do lembrete (horas)', 'secao' => 'comunicacao', 'tipo' => 'int', 'default' => 24, 'min' => 1, 'max' => 168],
        // QUAL template aprovado o disparo usa. É dado porque o texto é da clínica e da
        // aprovação da Meta: trocar a mensagem do lembrete não pode exigir deploy.
        'lembretes.template' => ['rotulo' => 'Modelo de mensagem do lembrete', 'secao' => 'comunicacao', 'tipo' => 'string', 'default' => 'lembrete_agendamento'],
        // uma mensagem com todos os horários da família no dia: a mãe com dois filhos em
        // terapia recebia quatro mensagens seguidas — e cada uma é uma conversa cobrada
        'lembretes.em_lote' => ['rotulo' => 'Enviar os lembretes em lote', 'secao' => 'comunicacao', 'tipo' => 'bool', 'default' => true],
        // sem isto, o lembrete de segunda sairia no DOMINGO — dia em que a clínica não
        // atende e a família não tem a quem responder
        'lembretes.segunda_na_sexta' => ['rotulo' => 'Antecipar para sexta o lembrete de segunda', 'secao' => 'comunicacao', 'tipo' => 'bool', 'default' => true],
        // a sessão marcada depois das 08:00 para o dia que o disparo já cobriu ficava sem lembrete
        // (change `repescagem-do-lembrete`): o mesmo disparo roda de hora em hora até esta hora.
        // Duas chaves, não "0 desliga": o catálogo valida faixa, e liga/desliga é o que a tela explica
        'lembretes.repescagem' => ['rotulo' => 'Lembrar quem é marcado depois das 8h', 'secao' => 'comunicacao', 'tipo' => 'bool', 'default' => true],
        'lembretes.repescagem_ate' => ['rotulo' => 'Último horário desses lembretes (hora)', 'secao' => 'comunicacao', 'tipo' => 'int', 'default' => 20, 'min' => 9, 'max' => 22],
        // reserva é compromisso provisório: avisá-la por padrão vira promessa
        'lembretes.incluir_reservas' => ['rotulo' => 'Incluir reservas nos lembretes', 'secao' => 'comunicacao', 'tipo' => 'bool', 'default' => false],
        // a resposta da família ao lembrete (change `lembrete-com-botoes-de-resposta`): o toque em
        // "Preciso desmarcar" SINALIZA por padrão — a recepção decide; desmarcar sozinho é escolha
        // da clínica, porque um toque errado liberaria o horário sem ninguém saber
        'lembretes.acao_desmarque' => [
            'rotulo' => 'Quando a família toca em "Preciso desmarcar"', 'secao' => 'comunicacao', 'tipo' => 'string',
            'default' => 'sinalizar', 'opcoes' => ['sinalizar', 'desmarcar'],
        ],
        // o status do desmarque PELA FAMÍLIA — ponteiro, como o do desmarque do profissional; 0 = não
        // configurado (o "Desmarcar" do card abre o menu de status, e o modo desmarcar só sinaliza)
        'lembretes.status_desmarque_familia_id' => ['rotulo' => 'Status aplicado quando a família desmarca', 'secao' => 'comunicacao', 'tipo' => 'int', 'default' => 0, 'min' => 0, 'formato' => 'status_que_libera'],
        // texto de comunicação é dado (§13): vazio desliga a resposta automática
        'lembretes.resposta_confirmou' => ['rotulo' => 'Resposta automática ao "Confirmo"', 'secao' => 'comunicacao', 'tipo' => 'string', 'default' => 'Obrigado! Presença confirmada ✅'],
        'lembretes.resposta_desmarque' => ['rotulo' => 'Resposta automática ao "Preciso desmarcar"', 'secao' => 'comunicacao', 'tipo' => 'string', 'default' => 'Recebemos 👍 A recepção vai falar com você para remarcar.'],
        // retenção do CONTEÚDO da conversa; passado o prazo, corpo e mídia são expurgados
        // e a linha do tempo permanece (§12, minimização)
        'mensagens.retencao_dias' => ['rotulo' => 'Retenção do histórico de mensagens (dias)', 'secao' => 'comunicacao', 'tipo' => 'int', 'default' => 730, 'min' => 30, 'max' => 3650],
    ];

    /** @var array<string, array{tipo: string, default: mixed}> extensões de teste */
    private static array $extras = [];

    /** @return array<string, array{tipo: string, default: mixed}> */
    public static function todas(): array
    {
        return array_merge(self::BASE, self::$extras);
    }

    public static function existe(string $chave): bool
    {
        return array_key_exists($chave, self::todas());
    }

    public static function tipo(string $chave): string
    {
        return self::definicao($chave)['tipo'];
    }

    /**
     * Metadados que acompanham a leitura. Dois grupos, com regras diferentes:
     *
     * - **sempre**: `rotulo` (o nome que a clínica lê) e `secao` (a aba onde a chave
     *   aparece). São o que impede a tela de manter lista própria e ficar desatualizada.
     * - **quando definidos**: `min`/`max`/`opcoes`/`formato` — o domínio de validação que a
     *   tela consome para renderizar o widget certo, sem duplicar o catálogo.
     *
     * Nunca `default` (é semente, não widget).
     *
     * ⚠️ FRONTEIRA (SEC-ADM-06): este mecanismo devolve o valor em CLARO por
     * `GET /configuracoes`. Chave de CREDENCIAL futura (token de mensageria/boleto/
     * WhatsApp, §13) NÃO entra no catálogo lido por aqui — precisa de tratamento próprio
     * (write-only/mascarado) e parecer. Metadado de widget nunca é segredo.
     *
     * @return array<string, mixed>
     */
    public static function metadados(string $chave): array
    {
        $definicao = self::definicao($chave);
        // sem isto, uma chave incompleta no BASE estoura `Undefined array key` no meio do laço
        // de `todasEfetivas()` — 500 em `GET /configuracoes`, sem dizer qual chave (CR-I6).
        //
        // Já NÃO derruba `/agenda/configuracoes`: desde o fecho do SEC-SDC-01 aquele endpoint
        // monta a projeção pela allowlist, sem passar por aqui — é o que `ConfiguracoesTest`
        // prova em "NÃO deve derrubar a grade quando OUTRA chave do catálogo está incompleta".
        // O comentário afirmava o contrário até a rodada 4 do gate.
        self::exigirApresentacao($chave, $definicao);

        return [
            'rotulo' => $definicao['rotulo'],
            'secao' => $definicao['secao'],
            'bloco' => self::bloco($chave),
            // `ajuda`: a frase sob o campo, quando o rótulo sozinho não diz o efeito (inicio-dos-indicadores)
            ...array_intersect_key($definicao, array_flip(['min', 'max', 'opcoes', 'formato', 'ajuda'])),
        ];
    }

    /** O bloco (subtítulo) de uma chave: o prefixo dela, que `BLOCOS` traduz. */
    public static function bloco(string $chave): string
    {
        $ponto = strpos($chave, '.');

        return $ponto === false ? $chave : substr($chave, 0, $ponto);
    }

    public static function default(string $chave): mixed
    {
        return self::definicao($chave)['default'];
    }

    /**
     * O vazio de uma DATA chega nulo: o `ConvertEmptyStringsToNull` do stack troca `''` por `null` antes
     * do controller, e "apagar a data" virava 422 de tipo (change inicio-dos-indicadores — esvaziar
     * volta ao primeiro agendamento). Só a data: nas outras chaves string, o nulo continua recusado.
     */
    public static function normalizarVazio(string $chave, mixed $valor): mixed
    {
        return $valor === null && (self::definicao($chave)['formato'] ?? null) === 'date' ? '' : $valor;
    }

    public static function valorEValido(string $chave, mixed $valor): bool
    {
        $definicao = self::definicao($chave);

        return match ($definicao['tipo']) {
            'bool' => is_bool($valor),
            // faixa opcional no catálogo (parecer P4: prazo_dias 1..3650)
            'int' => is_int($valor)
                && $valor >= ($definicao['min'] ?? PHP_INT_MIN)
                && $valor <= ($definicao['max'] ?? PHP_INT_MAX),
            'string' => is_string($valor) && self::stringEValida($definicao, $valor),
        };
    }

    /**
     * Domínio de uma chave string: whitelist `opcoes` e/ou `formato`
     * (T-sag-06 — antes, string sem formato aceitava QUALQUER valor).
     *
     * @param  array{tipo: string, default: mixed, opcoes?: list<string>, formato?: string, nao_futura?: bool, primeiro_do_mes?: bool}  $definicao
     */
    private static function stringEValida(array $definicao, string $valor): bool
    {
        if (isset($definicao['opcoes']) && ! in_array($valor, $definicao['opcoes'], true)) {
            return false;
        }

        return match ($definicao['formato'] ?? null) {
            // 'date' exige Y-m-d de calendário REAL — o round-trip barra o
            // overflow do PHP (2026-02-30 → 03-02; etapa 8, gate r1, CR-04)
            'date' => $valor === '' || (self::dataReal($valor) && self::motivoDaData($definicao, $valor) === null),
            // 'hora' é HH:MM de relógio real (23:59 passa; 24:00 e 08:60 não)
            'hora' => preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', $valor) === 1,
            // 'timezone' é identificador IANA existente (o cliente o entrega ao Intl)
            'timezone' => in_array($valor, timezone_identifiers_list(), true),
            'mensagem_cobranca' => MensagemDeCobranca::valida($valor),
            default => true,
        };
    }

    /**
     * Por que o valor foi recusado, na língua de quem preenche. A data tem frase própria (change
     * inicio-dos-indicadores): "Valor incompatível com o tipo string" chegava à tela quando a data era só
     * futura — e não dizia nada a quem escolheu o dia no calendário.
     */
    public static function motivoDaRecusa(string $chave, mixed $valor): string
    {
        $definicao = self::definicao($chave);

        if (($definicao['formato'] ?? null) !== 'date') {
            return 'Valor incompatível com o tipo '.self::tipo($chave).'.';
        }

        return is_string($valor) && self::dataReal($valor)
            ? (self::motivoDaData($definicao, $valor) ?? 'Data inválida.')
            : 'Data inválida: escolha um dia que existe no calendário.';
    }

    /**
     * As regras de uma data REAL além do calendário, com a frase de cada uma; `null` quando ela passa.
     * A futura vem antes: "1º de dezembro" é dia 1º, e o que a recusa é o futuro.
     *
     * @param  array{nao_futura?: bool, primeiro_do_mes?: bool}  $definicao
     */
    private static function motivoDaData(array $definicao, string $valor): ?string
    {
        if (($definicao['nao_futura'] ?? false) && $valor > self::hojeNaClinica()) {
            return 'A data não pode ser depois de hoje.';
        }
        if (($definicao['primeiro_do_mes'] ?? false) && substr($valor, 8, 2) !== '01') {
            return 'Escolha o dia 1º do mês.';
        }

        return null;
    }

    /** `Y-m-d` de calendário REAL — o round-trip barra o overflow do PHP (2026-02-30 → 03-02; etapa 8, gate r1, CR-04). */
    public static function dataReal(string $valor): bool
    {
        return Carbon::canBeCreatedFromFormat($valor, 'Y-m-d')
            && Carbon::createFromFormat('Y-m-d', $valor)->format('Y-m-d') === $valor;
    }

    /** Hoje no relógio da clínica (`clinica.timezone`) — o "futuro" de `nao_futura` é o dela, não o do servidor. */
    private static function hojeNaClinica(): string
    {
        return now((string) app(ConfiguracaoService::class)->get('clinica.timezone'))->toDateString();
    }

    /** Serializa para a coluna `valor` (text). */
    public static function serializar(string $chave, mixed $valor): string
    {
        return match (self::tipo($chave)) {
            'bool' => $valor ? '1' : '0',
            default => (string) $valor,
        };
    }

    /** Reconstrói o valor tipado a partir da coluna `valor`. */
    public static function deserializar(string $chave, string $bruto): mixed
    {
        return match (self::tipo($chave)) {
            'bool' => $bruto === '1',
            'int' => (int) $bruto,
            'string' => $bruto,
        };
    }

    /**
     * Percorre o catálogo INTEIRO (base + extras) e falha na primeira chave incompleta.
     *
     * Existe público para a suíte chamar: antes, a regra vivia duas vezes — aqui e
     * reimplementada no teste de unidade —, que é exatamente o padrão "duas listas
     * paralelas" que esta change veio desfazer, um andar acima (achado CR-I6).
     *
     * @throws InvalidArgumentException na primeira chave incompleta, nomeando-a
     */
    public static function validarCatalogo(): void
    {
        foreach (self::todas() as $chave => $definicao) {
            self::exigirApresentacao($chave, $definicao);
        }
    }

    /**
     * Toda chave declara `rotulo` e `secao`, a `secao` pertence a `SECOES` e o prefixo tem
     * rótulo em `BLOCOS`. Aqui a omissão vira exceção NOMEANDO A CHAVE, em vez de
     * `Undefined array key` no meio da leitura.
     *
     * @param  array<string, mixed>  $definicao
     */
    private static function exigirApresentacao(string $chave, array $definicao): void
    {
        foreach (['rotulo', 'secao'] as $exigido) {
            if (! isset($definicao[$exigido]) || $definicao[$exigido] === '') {
                throw new InvalidArgumentException("A chave \"{$chave}\" não declara \"{$exigido}\" no catálogo.");
            }
        }

        if (! isset(self::SECOES[$definicao['secao']])) {
            throw new InvalidArgumentException("A chave \"{$chave}\" declara a seção \"{$definicao['secao']}\", que não existe em SECOES.");
        }

        $bloco = self::bloco($chave);
        if (! isset(self::BLOCOS[$bloco])) {
            throw new InvalidArgumentException("A chave \"{$chave}\" tem o prefixo \"{$bloco}\", que não tem rótulo em BLOCOS.");
        }
    }

    /**
     * Registra chaves extras em runtime — USO EXCLUSIVO DE TESTE (permite testar
     * o mecanismo de tipos sem inventar chaves de produto).
     *
     * @internal
     *
     * @param  array<string, array{rotulo: string, secao: string, tipo: string, default: mixed}>  $catalogo
     */
    public static function estender(array $catalogo): void
    {
        if (! app()->runningUnitTests()) {
            throw new InvalidArgumentException('estender() é exclusivo do ambiente de teste.');
        }

        // a mesma exigência que vale para o BASE vale para a extensão: sem isto um teste
        // registraria chave sem rótulo, e a leitura quebraria só quando alguém a lesse
        foreach ($catalogo as $chave => $definicao) {
            self::exigirApresentacao($chave, $definicao);
        }

        self::$extras = array_merge(self::$extras, $catalogo);
    }

    public static function limparExtensoes(): void
    {
        self::$extras = [];
    }

    /** @return array{tipo: string, default: mixed} */
    private static function definicao(string $chave): array
    {
        return self::todas()[$chave]
            ?? throw new InvalidArgumentException("Configuração desconhecida: {$chave}");
    }
}
