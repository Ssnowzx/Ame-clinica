<?php

use Illuminate\Support\Facades\Route;

/**
 * GUARDA DE IDIOMA "escopado por padrão" (D11 · parecer SEC-VP-07) — a rede de COMPLETUDE.
 *
 * Toda rota servida por um controller SENSÍVEL (agenda/clínica) TEM de estar classificada: SCOPED
 * (aplica o `EscopoDoProfissional`) ou PLANO (intencional, justificado). Uma rota/método NOVO num
 * desses controllers REPROVA até ser classificado — é o que impede uma 4ª superfície futura de
 * nascer PLANA e vazar o dado de um menor (fecha o resíduo SEC-PD-04/SEC-NC-04b). A classificação
 * prova a COMPLETUDE (nada esquecido); a IMPLEMENTAÇÃO de cada SCOPED é provada pelos abuse-cases
 * (EscopoProfissionalTest/EscopoClinicoTest).
 */

/** Controllers cujo dado é escopável por vínculo profissional (agenda + clínica). */
const CONTROLLERS_SENSIVEIS = [
    'AgendamentoController', 'AgendaSelecaoController', 'ComparecimentoRecenteController',
    'PresencaDoPacienteController', 'AgendamentosDoPacienteController', 'AnexoController',
    'PendenciaDeRetornoController',
    'AtendimentoController', 'EvolucaoController', 'AnamneseController', 'PacienteController',
    'NotificacaoController', 'RelatorioController', 'ListaEsperaController', 'FaturamentoController',
    'IndicadorController', 'TermoConsentimentoController',
    // pacotes da criança (achado SEC-FP-03 do gate de `alerta-de-fim-de-pacote`): a lista
    // serve nome de menor + especialidade (vínculo art. 11 pela SEC-PD-01) e estava FORA da
    // rede — um método novo aqui nasceria plano sem nada reprovar. Entrou porque o contador
    // de "pacotes acabando" passou a apontar para ela, e contador escopado levando a lista
    // plana é o escopo sumindo no caminho.
    'TratamentoController',
    // baixa em massa da agenda (change desmarque-do-profissional): opera sobre agendamentos de
    // UM profissional escolhido no payload. Sem escopo, um profissional vinculado desmarcaria a
    // agenda de um colega — e em massa, com aviso automático às famílias dele.
    'DesmarqueEmLoteController',
    // baixa em lote por status (change baixa-em-lote-por-status): a mesma natureza do desmarque —
    // opera sobre a agenda de UM profissional do payload, e agora consumindo sessão de propósito.
    'BaixaEmLoteController',
    // canal de WhatsApp (mensageria-whatsapp, SEC-WA-08): serve nome de menor + telefone da
    // família + texto livre onde cabe diagnóstico + mídia. Entrou aqui porque a guarda é
    // whitelist por NOME DE CLASSE — sem a entrada, o módulo mais sensível do produto
    // nasceu fora da rede de completude e a 2ª rota dele nasceria sem ninguém perguntar.
    'ConversaController', 'MensagemController', 'MensagemTemplateController', 'LembreteController',
    // fila do auto-cadastro (change cadastro-online-do-paciente): o bloco de candidatos parecidos
    // serve NOME DE MENOR de quem já é paciente. Sem esta entrada, um método novo aqui nasceria
    // plano e ninguém perguntaria (parecer pré-código, condição 7)
    'FilaDeCadastroController',
    // cobrança pelo WhatsApp (change cobranca-pelo-whatsapp, nit do gate CR-API2): serve o
    // telefone da família e o nome da criança — entra na rede para um método novo não nascer
    // plano sem ninguém perguntar
    'LancamentoCobrancaController',
    // "Manter a sessão (a família desistiu)" (change lembrete-com-botoes-de-resposta, CRB-08): mexe
    // no estado da sessão de uma criança — a posse do profissional vem antes da existência
    'ConfirmacaoDoLembreteController',
    // "Avisar no WhatsApp" — a conversa da família de uma sessão (avisar-no-whatsapp-abre-a-conversa)
    'ConversaDaSessaoController',
    // os painéis dos indicadores (change indicadores-profissionais): agregam agenda e evolução —
    // um método novo aqui nasceria plano sem ninguém perguntar
    'PainelDeIndicadoresController',
    // o painel do mês de UM profissional (change painel-do-profissional): embute os painéis acima
    // no recorte de um id — um método novo aqui nasceria plano sem ninguém perguntar
    'PainelDoProfissionalController',
];

/** Classificação de cada método: 'scoped' (aplica o escopo) | 'plano' (intencional, com razão). */
const CLASSIFICACAO_DE_ESCOPO = [
    /*
     * PACOTES DA CRIANÇA — TODOS escopados (rodada 4 de `vinculo-previo-para-agendar`, `SEC-VP-51`).
     *
     * `index` escopa desde `alerta-de-fim-de-pacote` (achado SEC-FP-03: contador escopado levando à
     * lista plana). `show`/`update`/`destroy` decidem a posse do pacote EXISTENTE pelo eixo agenda
     * (`SEC-VP-33`/`SEC-VP-44`), e `store`/`update` decidem a posse do VÍNCULO pelos dois eixos no
     * `authorize()` da `TratamentoRequest` (`SEC-VP-21`/`SEC-VP-31`). Esta grade os classificava
     * como `plano — decisão da clínica pendente` DEPOIS de o código os ter escopado: `plano` é
     * passe livre aqui, e remover a posse deles não derrubava nada. O `TRAT-ESCOPO` foi fechado
     * junto (`GATILHOS.md`).
     */
    'TratamentoController@index' => 'scoped',
    'TratamentoController@show' => 'scoped',
    'TratamentoController@store' => 'scoped',
    'TratamentoController@update' => 'scoped',
    'TratamentoController@destroy' => 'scoped',

    /*
     * CANAL DE WHATSAPP — PLANO, por decisão de produto, em todos os métodos.
     *
     * A recepção responde as famílias de TODAS as crianças da clínica; escopar no eixo
     * clínico deixaria quem atende o balcão sem ver a conversa que acabou de chegar — o
     * mesmo raciocínio do `AnexoController` (carteirinha na recepção). O contrapeso não é
     * escopo: é a permissão própria (`mensagens.*`, sem herança de `pacientes.*`/`agenda.*`)
     * e a governança — a distribuição de `mensagens.ver` fica pendente de ratificação da
     * clínica, e até lá só o Administrador a tem.
     */
    'ConversaController@index' => 'plano',
    'ConversaController@show' => 'plano',
    'ConversaController@vincular' => 'plano',
    'ConversaController@arquivar' => 'plano',
    'ConversaController@desarquivar' => 'plano',
    'ConversaController@lembretes' => 'plano',
    'MensagemController@store' => 'plano',
    'MensagemController@reenviar' => 'plano',
    'MensagemController@midia' => 'plano',
    'MensagemTemplateController@index' => 'plano',
    'MensagemTemplateController@sincronizar' => 'plano',
    'LembreteController@index' => 'plano',
    // AgendamentoController — eixo AGENDA (todos escopados)
    'AgendamentoController@periodo' => 'scoped',
    'AgendamentoController@serie' => 'scoped',
    'AgendamentoController@store' => 'scoped',
    // as duas escopam pelo MESMO motivo do `store`: o `profissional_id` vem do cliente, e para
    // o usuário escopado ele só pode ser o próprio. A prévia escopa junto — vazar a CONTAGEM
    // da agenda de um colega já é vazamento (quantas crianças ele atende naquela tarde).
    'DesmarqueEmLoteController@previa' => 'scoped',
    'DesmarqueEmLoteController@executar' => 'scoped',
    // a baixa por status escopa pelo mesmo motivo, nas duas rotas (D13 de `baixa-em-lote-por-status`)
    'BaixaEmLoteController@previa' => 'scoped',
    'BaixaEmLoteController@executar' => 'scoped',
    'AgendamentoController@show' => 'scoped',
    'AgendamentoController@update' => 'scoped',
    'ConfirmacaoDoLembreteController@manter' => 'scoped',
    'ConfirmacaoDoLembreteController@confirmar' => 'scoped',
    'ConversaDaSessaoController@abrir' => 'scoped',
    'AgendamentoController@destroy' => 'scoped',
    // AgendaSelecaoController
    'AgendaSelecaoController@index' => 'scoped',        // lista só o próprio profissional
    // A ação tem QUATRO modos, e desde a rodada 4 de `vinculo-previo-para-agendar` (`SEC-VP-36`)
    // os quatro passam pela fonte única: `restringirAosPacientesDoEscopo` aplica o MESMO predicado
    // da trava (`EXISTS` em agendamentos ∪ tratamentos) — o escopado só vê as crianças que já
    // atende; `plano` continua vendo a base inteira; sem vínculo e sem flag, lista vazia. Antes,
    // `busca`/`id`/`pagina` eram PLANOS e a caixa oferecia a criança que o servidor ia recusar como
    // "não existe" — o convite para o gesto impossível. O modo `recentes` já era escopado
    // (parecer SEC-BPL-01). A ressalva `ESCOPO-CEGO-A-MODO` (SEC-BPL-06) fecha para esta rota.
    'AgendaSelecaoController@pacientes' => 'scoped',
    // Catálogo de pacotes de UMA criança: CALA (lista vazia) para criança fora do escopo — recusar
    // seria o mesmo oráculo com outra roupa (`SEC-CP-01`). Era o resíduo "plano" da família.
    'AgendaSelecaoController@tratamentos' => 'scoped',
    // ComparecimentoRecenteController
    'ComparecimentoRecenteController@index' => 'scoped', // portão por-id (conteúdo multidisciplinar)
    // PresencaDoPacienteController (presenca-na-ficha): mesmo portão por-id do comparecimento
    'PresencaDoPacienteController@index' => 'scoped',
    // AgendamentosDoPacienteController (agendamentos-na-ficha): a seção Agendamentos da ficha —
    // próximos + recentes. MESMO portão por-id do comparecimento e da presença; o que amplia é a
    // janela FUTURA (registrada no inventário do gatilho ENUM), não a permissão nem a classe.
    'AgendamentosDoPacienteController@index' => 'scoped',
    // PendenciaDeRetornoController (protocolo-de-pendencias): a fila de quem parou de ser
    // agendado. SCOPED no eixo AGENDA, mas por LISTA (não por-id): o escopo entra dentro da
    // fonte única `PendenciasDeRetorno`, filtrando `tratamentos.profissional_id` — o escopado
    // vê só os pacientes dos SEUS tratamentos; sem vínculo, fila vazia (fail-closed).
    'PendenciaDeRetornoController@index' => 'scoped',
    // AnexoController (anexos-do-paciente) — PLANO INTENCIONAL com ressalva art. 11
    // (SEC-AX-03): permissão própria `anexos.*` sem escopo por vínculo — escopar no
    // eixo clínico deixaria a recepção (sem vínculo → fail-closed) sem carteirinhas.
    // O preço, registrado no ENUM: 1º read de potencial art. 11 sem escopo clínico;
    // `anexos.ver` só vai a papéis de confiança plena (ratificação da clínica).
    'AnexoController@index' => 'plano',
    'AnexoController@store' => 'plano',
    'AnexoController@download' => 'plano',
    'AnexoController@destroy' => 'plano',
    // ListaEsperaController — a fila é da clínica (permissão lista_espera.*); só o encaixe é escopado
    'ListaEsperaController@index' => 'plano',
    'ListaEsperaController@store' => 'plano',
    'ListaEsperaController@update' => 'plano',
    'ListaEsperaController@destroy' => 'plano',
    'ListaEsperaController@encaixar' => 'scoped',
    // AtendimentoController — eixo CLÍNICO
    'AtendimentoController@index' => 'scoped',
    'AtendimentoController@store' => 'scoped',
    'AtendimentoController@show' => 'scoped',
    'AtendimentoController@update' => 'scoped',
    'AtendimentoController@destroy' => 'scoped',
    // EvolucaoController — eixo CLÍNICO
    'EvolucaoController@emAberto' => 'scoped',
    'EvolucaoController@store' => 'scoped',
    // a evolução escrita direto da sessão (evolucao-finaliza-a-sessao): assegurarPosse do agendamento
    'EvolucaoController@storeDaSessao' => 'scoped',
    'EvolucaoController@show' => 'scoped',
    'EvolucaoController@update' => 'scoped',
    // AnamneseController — eixo CLÍNICO (art. 11)
    'AnamneseController@index' => 'scoped',
    'AnamneseController@store' => 'scoped',
    'AnamneseController@show' => 'scoped',
    'AnamneseController@update' => 'scoped',
    // PacienteController — cadastro é multidisciplinar (fora do eixo); só o resumo é clínico-escopado
    'PacienteController@index' => 'plano',
    'PacienteController@store' => 'plano',
    // pré-cadastro do balcão (pre-cadastro-de-paciente): mesma natureza do store
    'PacienteController@preCadastro' => 'plano',
    'PacienteController@show' => 'plano',
    'PacienteController@resumo' => 'scoped',
    /*
     * FILA DO AUTO-CADASTRO. `index` é SCOPED porque o bloco de candidatos parecidos lê pacientes
     * da clínica — um profissional escopado não passa a enxergar criança de colega porque ela
     * apareceu ao lado de um envio. `aceitar`/`descartar` são PLANOS: operam sobre o ENVIO, que
     * não é de profissional nenhum — não há vínculo a respeitar, e quem os alcança já tem a
     * permissão de conferir a fila inteira.
     */
    'FilaDeCadastroController@index' => 'scoped',
    'FilaDeCadastroController@aceitar' => 'plano',
    'FilaDeCadastroController@descartar' => 'plano',
    // reler o rascunho é a continuação de um aceite interrompido: o envio não é de profissional
    // nenhum, e quem o alcança tem as mesmas permissões de quem aceitou (`conferir` + `criar`)
    'FilaDeCadastroController@rascunho' => 'plano',
    'PacienteController@update' => 'plano',
    // situação (ativo/inativo) segue a natureza do `update`: o CADASTRO é multidisciplinar, e quem
    // tem `pacientes.editar` já edita o cadastro inteiro de qualquer paciente da clínica — escopar
    // só a troca de situação não protegeria nada que a porta vizinha não abra
    'PacienteController@situacao' => 'plano',
    // NotificacaoController — o index escopa seus blocos clínicos/agenda por dentro.
    // O bloco `pedidos_medicos` é escopado pelo eixo AGENDA dentro da fonte única `PedidosMedicos`
    // desde a rodada 4 de `vinculo-previo-para-agendar` (`SEC-VP-45`): "plano por construção"
    // (SEC-LP-06) era anterior ao perfil escopado da AP-10, e listava para o profissional o pedido
    // médico de toda criança da clínica.
    'NotificacaoController@index' => 'scoped',
    // RelatorioController — produção por profissional escopa; o financeiro por período é agregado
    // (não é por criança). `sessoesVendidasRealizadas` NÃO é agregado: é uma lista POR CRIANÇA
    // (nome, convênio, modalidade, saldo), o mesmo dado que `GET /tratamentos` recorta — escopado
    // pelo eixo agenda desde a rodada 4 (`SEC-VP-45`).
    'RelatorioController@producaoPorProfissional' => 'scoped',
    'RelatorioController@financeiroPorPeriodo' => 'plano',
    'RelatorioController@sessoesVendidasRealizadas' => 'scoped',
    // a ÁREA de relatórios (change area-de-relatorios): `indice` é o catálogo — slugs, títulos e
    // permissões, SEM dado de negócio, nada a escopar. `executar` injeta o escopo pelo EIXO que
    // cada relatório DECLARA (D6): agenda/clínico passam pela fonte única; eixo nulo é relatório
    // da clínica (auditoria, caixa) e sai plano por declaração no próprio relatório, não por
    // esquecimento — `RelatoriosContratoTest` varre cada um.
    'RelatorioController@indice' => 'plano',
    'RelatorioController@executar' => 'scoped',
    // a planilha passa pela MESMA porta do `executar` (change `relatorio-em-planilha`, D2)
    'RelatorioController@planilha' => 'scoped',
    // LancamentoCobrancaController — o telefone sai sob `lancamentos.ver` E `pacientes.ver`: é o
    // MESMO dado que o `PacienteController@show` (plano: cadastro multidisciplinar) já entrega a
    // quem tem `pacientes.ver`; o caixa é da clínica, sem eixo por profissional
    'LancamentoCobrancaController@mostrar' => 'plano',
    'LancamentoCobrancaController@registrar' => 'plano',
    // FaturamentoController — o faturamento pende do agendamento (eixo agenda): posse (SEC-VP-13/P3)
    'FaturamentoController@store' => 'scoped',
    // IndicadorController — dashboard §11: as vistas de agenda/clínico escopam (o escopado
    // vê os PRÓPRIOS números); pacientes/financeiro são agregados da clínica sem eixo
    // por-profissional (mesmo racional do RelatorioController@financeiroPorPeriodo)
    // a produtividade mistura os DOIS eixos (capacidade/marcações da agenda, realizado clínico):
    // escopa pela INTERSEÇÃO (`EscopoDoProfissional::agendaEClinico`) — o escopado em
    // qualquer eixo vê só a própria linha
    'IndicadorController@produtividade' => 'scoped',
    'IndicadorController@agenda' => 'scoped',
    'IndicadorController@atendimentos' => 'scoped',
    'IndicadorController@pacientes' => 'plano',
    'IndicadorController@financeiro' => 'plano',
    // os gráficos financeiros são o MESMO agregado da clínica que `financeiro`, só com
    // mais cortes (categoria, ano, vencimento): não há eixo por-profissional em dinheiro
    // da clínica, e a permissão é a mesma `fluxo_caixa.ver`
    'IndicadorController@graficosDoFinanceiro' => 'plano',
    // o drill-down herda o eixo do bloco de origem (T-not-13): itens da agenda no
    // eixo agenda; itens de atendimentos no eixo clínico (via relação-mãe)
    'IndicadorController@itensDaAgenda' => 'scoped',
    'IndicadorController@itensDeAtendimentos' => 'scoped',
    // os PAINÉIS (change indicadores-profissionais): cada um herda o eixo da vista de origem.
    // O dinheiro é agregado da clínica sem eixo (como `financeiro`); a agenda escopa no eixo agenda
    // (como `agenda`); a equipe pela INTERSEÇÃO (como `produtividade`); os pacientes são contagens
    // da clínica, mas os "pacotes no fim" vêm do bloco do sino, que escopa no eixo agenda — e o
    // painel aplica o MESMO escopo para os dois números serem um só
    'PainelDeIndicadoresController@dinheiro' => 'plano',
    'PainelDeIndicadoresController@agenda' => 'scoped',
    'PainelDeIndicadoresController@pacientes' => 'scoped',
    'PainelDeIndicadoresController@equipe' => 'scoped',
    // cada bloco passa pelo eixo do escopo de quem pede; `de(outro)`/`nenhum` omite o bloco (D3)
    'PainelDoProfissionalController@show' => 'scoped',
    // TermoConsentimentoController — lê `pacientes` (temAceite/aceitesTotal), mas NUNCA
    // devolve dado de paciente: só a CONTAGEM de aceites (design D8). Plano por natureza —
    // o termo é documento da CLÍNICA, não de uma criança, e escopá-lo por vínculo
    // profissional não protegeria nada. Entra na lista para que um método FUTURO
    // (um `@aceitantes`, por exemplo) reprove até ser classificado (parecer SEC-TR-09).
    'TermoConsentimentoController@index' => 'plano',
    'TermoConsentimentoController@store' => 'plano',
    'TermoConsentimentoController@show' => 'plano',
    'TermoConsentimentoController@update' => 'plano',
    'TermoConsentimentoController@destroy' => 'plano',
    'TermoConsentimentoController@vigente' => 'plano',
];

it('deve classificar TODA rota de controller sensível como scoped ou plano-intencional (SEC-VP-07)', function () {
    $naoClassificadas = [];
    foreach (Route::getRoutes() as $route) {
        $action = $route->getActionName(); // App\Http\Controllers\XController@metodo
        if (! str_contains($action, '@')) {
            continue;
        }
        [$classeFqn, $metodo] = explode('@', $action);
        $classe = class_basename($classeFqn);
        if (! in_array($classe, CONTROLLERS_SENSIVEIS, true)) {
            continue;
        }
        $chave = "{$classe}@{$metodo}";
        if (! array_key_exists($chave, CLASSIFICACAO_DE_ESCOPO)) {
            $naoClassificadas[] = $chave;
        }
    }

    expect($naoClassificadas)->toBe(
        [],
        'Rota(s) de controller sensível SEM classificação de escopo (D11/SEC-VP-07): '
        .implode(', ', $naoClassificadas)
        .'. Escopar (SCOPED, via EscopoDoProfissional) ou justificar (plano) em CLASSIFICACAO_DE_ESCOPO.',
    );
});

it('deve fazer todo controller com método SCOPED consumir a fonte única EscopoDoProfissional', function () {
    // um método classificado 'scoped' que não passa pela fonte única é escopo esquecido/erodido
    $comScoped = collect(CLASSIFICACAO_DE_ESCOPO)
        ->filter(fn (string $tipo) => $tipo === 'scoped')
        ->keys()
        ->map(fn (string $chave) => explode('@', $chave)[0])
        ->unique();

    $semFonte = [];
    foreach ($comScoped as $classe) {
        $arquivo = app_path("Http/Controllers/{$classe}.php");
        if (! is_file($arquivo) || ! str_contains((string) file_get_contents($arquivo), 'EscopoDoProfissional')) {
            $semFonte[] = $classe;
        }
    }

    expect($semFonte)->toBe(
        [],
        'Controller(s) com rota SCOPED que NÃO referenciam EscopoDoProfissional (escopo esquecido): '
        .implode(', ', $semFonte),
    );
});

it('deve manter CONTROLLERS_SENSIVEIS completa: controller novo que toca um model sensível reprova até ser listado (SEC-VP-07)', function () {
    // A 1ª asserção classifica por NOME de controller (lista fixa) — pega MÉTODO novo, mas um
    // CONTROLLER novo que passe a tocar agendamento/atendimento/evolução/anamnese nasceria fora da
    // varredura e escaparia PLANO em silêncio (o resíduo SEC-PD-04). Esta asserção fecha a durabilidade:
    // varre TODO controller e reprova quem importa um model sensível sem estar na lista.
    $modelsSensiveis = ['Agendamento', 'Atendimento', 'Evolucao', 'Anamnese'];
    $foraDaLista = [];
    foreach (glob(app_path('Http/Controllers/*.php')) as $arquivo) {
        $classe = basename($arquivo, '.php');
        if (in_array($classe, CONTROLLERS_SENSIVEIS, true)) {
            continue;
        }
        $fonte = (string) file_get_contents($arquivo);
        foreach ($modelsSensiveis as $model) {
            // import EXATO — não casa `AnamneseModelo` (que importa `App\Models\AnamneseModelo`, templates de config)
            if (str_contains($fonte, "use App\\Models\\{$model};")) {
                $foraDaLista[] = "{$classe} (importa {$model})";
                break;
            }
        }
    }

    expect($foraDaLista)->toBe(
        [],
        'Controller que toca um model sensível fora de CONTROLLERS_SENSIVEIS (nasceria PLANO em silêncio — SEC-VP-07): '
        .implode(', ', $foraDaLista).'. Adicionar à lista e classificar suas rotas em CLASSIFICACAO_DE_ESCOPO.',
    );
});
