<?php

use App\Http\Controllers\AgendamentoController;
use App\Http\Controllers\AgendamentosDoPacienteController;
use App\Http\Controllers\AgendaSelecaoController;
use App\Http\Controllers\AnamneseController;
use App\Http\Controllers\AnamneseModeloController;
use App\Http\Controllers\AnexoController;
use App\Http\Controllers\AprovacaoDeAcessoController;
use App\Http\Controllers\AtendimentoController;
use App\Http\Controllers\AtribuicaoNivelController;
use App\Http\Controllers\AuditoriaController;
use App\Http\Controllers\AuthController;
use App\Http\Controllers\AvatarUsuarioController;
use App\Http\Controllers\BaixaEmLoteController;
use App\Http\Controllers\CamposCadastroController;
use App\Http\Controllers\CartaoController;
use App\Http\Controllers\CategoriaController;
use App\Http\Controllers\CbosController;
use App\Http\Controllers\ClinicaLogoController;
use App\Http\Controllers\ComparecimentoRecenteController;
use App\Http\Controllers\ConfiguracaoController;
use App\Http\Controllers\ConfirmacaoDoLembreteController;
use App\Http\Controllers\ContaController;
use App\Http\Controllers\ConvenioController;
use App\Http\Controllers\ConversaController;
use App\Http\Controllers\ConversaDaSessaoController;
use App\Http\Controllers\DesmarqueEmLoteController;
use App\Http\Controllers\DreController;
use App\Http\Controllers\EquipamentoController;
use App\Http\Controllers\EspecialidadeController;
use App\Http\Controllers\EvolucaoController;
use App\Http\Controllers\FaturamentoController;
use App\Http\Controllers\FechamentoCicloController;
use App\Http\Controllers\FeriadoController;
use App\Http\Controllers\FilaDeCadastroController;
use App\Http\Controllers\FluxoCaixaController;
use App\Http\Controllers\FornecedorController;
use App\Http\Controllers\FotoProfissionalController;
use App\Http\Controllers\FuncionarioController;
use App\Http\Controllers\IndicadorController;
use App\Http\Controllers\InformativoController;
use App\Http\Controllers\LancamentoAnexoController;
use App\Http\Controllers\LancamentoCaixaController;
use App\Http\Controllers\LancamentoCobrancaController;
use App\Http\Controllers\LancamentoVinculoController;
use App\Http\Controllers\LembreteController;
use App\Http\Controllers\LinkDeCadastroController;
use App\Http\Controllers\ListaEsperaController;
use App\Http\Controllers\MedicoController;
use App\Http\Controllers\MensagemController;
use App\Http\Controllers\MensagemTemplateController;
use App\Http\Controllers\NivelPermissaoController;
use App\Http\Controllers\NotificacaoController;
use App\Http\Controllers\PacienteController;
use App\Http\Controllers\PainelDeIndicadoresController;
use App\Http\Controllers\PainelDoProfissionalController;
use App\Http\Controllers\PendenciaDeRetornoController;
use App\Http\Controllers\PermissaoCatalogoController;
use App\Http\Controllers\PresencaDoPacienteController;
use App\Http\Controllers\ProfissionalController;
use App\Http\Controllers\RegraLimiteConvenioController;
use App\Http\Controllers\RelatorioController;
use App\Http\Controllers\SalaController;
use App\Http\Controllers\ServicoController;
use App\Http\Controllers\StatusAgendamentoController;
use App\Http\Controllers\TarefaComentarioController;
use App\Http\Controllers\TarefaController;
use App\Http\Controllers\TelefoneEmUsoController;
use App\Http\Controllers\TermoConsentimentoController;
use App\Http\Controllers\TipoPagamentoController;
use App\Http\Controllers\TransferenciaController;
use App\Http\Controllers\TratamentoController;
use App\Http\Controllers\UsuarioController;
use App\Http\Controllers\WhatsappConexaoController;
use App\Http\Controllers\WhatsappWebhookController;
use App\Http\Middleware\AssinaturaDoWebhook;
use App\Support\CamposCadastro\CatalogoCamposCadastro;
use Illuminate\Support\Facades\Route;

Route::get('/health', fn () => response()->json(['status' => 'ok']));

// rate limit por email+IP contra brute force (parecer T-auth-01) — ver AppServiceProvider
Route::post('/login', [AuthController::class, 'login'])->middleware('throttle:login');

/*
 * WEBHOOK DA META (change mensageria-whatsapp) — a ÚNICA rota de domínio fora do
 * `auth:sanctum`. Quem chama é a Meta, não um usuário: a credencial dela é a ASSINATURA
 * HMAC do corpo (middleware `AssinaturaDoWebhook`), conferida contra o App Secret da conexão.
 *
 * Balde de throttle PRÓPRIO (`throttle:webhook`), separado dos baldes de leitura/escrita das
 * rotas autenticadas (FA-07): uma enxurrada aqui não pode esfomear quem está trabalhando no
 * sistema, e o inverso também vale.
 *
 * O `GET` (handshake) não tem assinatura — a Meta chama antes de existir o que assinar —,
 * então ele se autentica pelo `verify_token` e é o próprio controller quem confere.
 */
Route::get('/webhooks/whatsapp', [WhatsappWebhookController::class, 'verificar'])
    ->middleware('throttle:webhook');
Route::post('/webhooks/whatsapp', [WhatsappWebhookController::class, 'receber'])
    ->middleware(['throttle:webhook', AssinaturaDoWebhook::class]);

// pilha: sessão/stateful → auth → throttle:api → ativo → permission (design, armadilha 5).
// throttle DEPOIS do auth (chave por-usuário); ANTES de ativo (a rajada morre antes
// do downstream). Buckets r:/w: separados no RateLimiter::for('api') — ver AppServiceProvider.
Route::middleware(['auth:sanctum', 'throttle:api', 'ativo'])->group(function () {
    Route::post('/logout', [AuthController::class, 'logout']);
    Route::get('/me', [AuthController::class, 'me']);

    // foto de perfil do usuário (foto-de-perfil-do-usuario) — SEMPRE o próprio
    // autenticado (`/me/avatar`): sem permissão além do auth, é a própria identidade
    Route::get('/me/avatar', [AvatarUsuarioController::class, 'show']);
    Route::post('/me/avatar', [AvatarUsuarioController::class, 'store']);
    Route::delete('/me/avatar', [AvatarUsuarioController::class, 'destroy']);

    // RBAC — toda autorização é server-side (parecer T-rbac-05)
    Route::get('/permissoes', [PermissaoCatalogoController::class, 'index'])
        ->middleware('permission:niveis_permissao.ver');

    Route::get('/niveis-permissao', [NivelPermissaoController::class, 'index'])
        ->middleware('permission:niveis_permissao.ver');
    Route::post('/niveis-permissao', [NivelPermissaoController::class, 'store'])
        ->middleware('permission:niveis_permissao.criar');
    // whereNumber (SEC-TRV-01): a régua do FormRequest e o controller acham o MESMO registro — com
    // `/niveis-permissao/1abc`, a régua não achava nada e passava, e o controller editava o nível 1
    Route::get('/niveis-permissao/{id}', [NivelPermissaoController::class, 'show'])
        ->middleware('permission:niveis_permissao.ver')->whereNumber('id');
    Route::put('/niveis-permissao/{id}', [NivelPermissaoController::class, 'update'])
        ->middleware('permission:niveis_permissao.editar')->whereNumber('id');
    Route::delete('/niveis-permissao/{id}', [NivelPermissaoController::class, 'destroy'])
        ->middleware('permission:niveis_permissao.excluir')->whereNumber('id');

    Route::put('/usuarios/{usuario}/nivel-permissao', [AtribuicaoNivelController::class, 'atualizar'])
        ->middleware('permission:niveis_permissao.editar')->whereNumber('usuario');

    // maker-checker de acesso (AP-13/SEC-SD): aprovar/recusar exigem o módulo dono e
    // decisor ≠ solicitante (regra do servidor); cancelar é do solicitante
    Route::get('/aprovacoes-de-acesso', [AprovacaoDeAcessoController::class, 'index'])
        ->middleware('permission:niveis_permissao.ver');
    Route::post('/aprovacoes-de-acesso/{id}/aprovar', [AprovacaoDeAcessoController::class, 'aprovar'])
        ->middleware('permission:niveis_permissao.editar');
    Route::post('/aprovacoes-de-acesso/{id}/recusar', [AprovacaoDeAcessoController::class, 'recusar'])
        ->middleware('permission:niveis_permissao.editar');
    // cancelar é do solicitante (regra do serviço). Só `niveis_permissao.editar`: desde
    // `trava-de-usuarios-e-niveis`, pedir `seguranca.*` também a exige (o SD-N3, que aceitava
    // `configuracoes.editar` aqui, ficou sem caso — CR-TRV-11)
    Route::post('/aprovacoes-de-acesso/{id}/cancelar', [AprovacaoDeAcessoController::class, 'cancelar'])
        ->middleware('permission:niveis_permissao.editar');

    // auditoria é SOMENTE leitura via API — nunca criar rotas de escrita (T-aud-01)
    Route::get('/auditoria', [AuditoriaController::class, 'index'])
        ->middleware('permission:auditoria.ver');

    Route::get('/configuracoes', [ConfiguracaoController::class, 'index'])
        ->middleware('permission:configuracoes.ver');
    // leitura de exibição dos alvos do encadeamento (SEC-ADM-05, fecha CONFIG-SEM-FK) —
    // sob configuracoes.ver, não status_agendamento.ver (a tela de config valida na leitura)
    Route::get('/configuracoes/alvos-encadeamento', [ConfiguracaoController::class, 'alvosEncadeamento'])
        ->middleware('permission:configuracoes.ver');
    Route::put('/configuracoes', [ConfiguracaoController::class, 'update'])
        ->middleware('permission:configuracoes.editar');

    // RÉGUA DO CADASTRO (capability campos-do-cadastro): leitura LARGA, escrita ESTREITA.
    // Quem cadastra paciente precisa da régua para montar o formulário e quase nunca tem
    // `configuracoes.ver` — que dá o catálogo INTEIRO (financeiro, encadeamento,
    // mensageria). É o mesmo recorte do `/configuracoes/agenda` sob `agenda.ver`.
    Route::get('/campos-cadastro/{formulario}', [CamposCadastroController::class, 'index'])
        ->whereIn('formulario', CatalogoCamposCadastro::FORMULARIOS)
        ->middleware('permission:pacientes.ver|pacientes.criar|pacientes.editar|configuracoes.ver');
    Route::put('/campos-cadastro/{formulario}', [CamposCadastroController::class, 'update'])
        ->whereIn('formulario', CatalogoCamposCadastro::FORMULARIOS)
        ->middleware('permission:configuracoes.editar');
    // Prévia do impacto: quantas fichas ficariam incompletas com a régua PROPOSTA. É
    // leitura, mas recebe a régua no corpo (não cabe em query string sem virar ilegível).
    //
    // Exige `configuracoes.editar` E `pacientes.ver` (parecer SEC-RC-03): variando um campo
    // por vez, a resposta vira contagem por campo sobre a base — "quantas crianças estão sem
    // responsável cadastrado" é informação sobre menores. Níveis de permissão são DADO neste
    // produto, então nada impede a clínica criar um perfil que configure sem poder ver
    // paciente. No fluxo real o Administrador tem as duas, e o custo é zero.
    Route::post('/campos-cadastro/{formulario}/previa', [CamposCadastroController::class, 'previa'])
        ->whereIn('formulario', CatalogoCamposCadastro::FORMULARIOS)
        ->middleware(['permission:configuracoes.editar', 'permission:pacientes.ver']);

    /*
     * A FILA DE CONFERÊNCIA do auto-cadastro (change cadastro-online-do-paciente).
     *
     * `cadastro_online.conferir` é módulo próprio: conferir é decidir se um dado que veio de FORA
     * entra na base. ACEITAR exige também `pacientes.criar` — aceitar é o primeiro passo de criar
     * paciente, e sem essa exigência `conferir` viraria permissão de criação por porta lateral
     * (parecer pré-código, condição 10).
     */
    Route::get('/cadastro-online/fila', [FilaDeCadastroController::class, 'index'])
        ->middleware('permission:cadastro_online.conferir');
    Route::post('/cadastro-online/fila/{id}/aceitar', [FilaDeCadastroController::class, 'aceitar'])
        ->middleware(['permission:cadastro_online.conferir', 'permission:pacientes.criar'])
        ->whereNumber('id');
    Route::post('/cadastro-online/fila/{id}/descartar', [FilaDeCadastroController::class, 'descartar'])
        ->middleware('permission:cadastro_online.conferir')
        ->whereNumber('id');
    /*
     * RELER um envio já aceito que ainda não virou ficha.
     *
     * Aceitar consome o envio: ele sai da fila e o conteúdo vai para a tela abrir o formulário.
     * Sem esta rota, um F5 — ou fechar a aba sem querer — destruía o preenchimento da família
     * para sempre, e o dado só existia no banco (rodada dirigida, CR2-06). A alternativa era
     * guardar o cadastro da criança no armazenamento do navegador do balcão, que é máquina
     * compartilhada, e o contrato do design system proíbe com razão.
     *
     * As MESMAS permissões do aceitar: quem relê está no meio de criar o paciente.
     * Só alcança envio `aceito` e SEM ficha — conferido que já virou paciente se lê pela ficha.
     */
    Route::get('/cadastro-online/fila/{id}/rascunho', [FilaDeCadastroController::class, 'rascunho'])
        ->middleware(['permission:cadastro_online.conferir', 'permission:pacientes.criar'])
        ->whereNumber('id');

    /*
     * O ENDEREÇO PÚBLICO do auto-cadastro (change cadastro-online-do-paciente): parametrização da
     * clínica, não operação de cadastro — por isso `configuracoes.editar`, a mesma permissão que
     * liga e desliga o link. O endereço não passa pelo catálogo de configurações (design D5): a
     * trilha de `configuracoes` guarda o valor em claro, e ela é legível por quem audita.
     */
    // LER o endereço: quem cadastra criança, quem confere os envios e quem administra — é a
    // recepção que manda o link à família (change link-do-cadastro-na-recepcao). TROCAR continua
    // só com quem administra: trocar mata todo link já divulgado.
    Route::get('/cadastro-online/link', [LinkDeCadastroController::class, 'show'])
        ->middleware('permission:configuracoes.editar|pacientes.criar|cadastro_online.conferir');
    Route::post('/cadastro-online/link/rotacionar', [LinkDeCadastroController::class, 'rotacionar'])
        ->middleware('permission:configuracoes.editar');

    // logo da clínica (identidade-da-clinica): escrita sob configuracoes.editar;
    // LEITURA é de qualquer autenticado — o shell é de todos (spec)
    Route::get('/clinica/logo', [ClinicaLogoController::class, 'show']);
    Route::post('/clinica/logo', [ClinicaLogoController::class, 'store'])
        ->middleware('permission:configuracoes.editar');
    Route::delete('/clinica/logo', [ClinicaLogoController::class, 'destroy'])
        ->middleware('permission:configuracoes.editar');

    // ==== cadastros base ====

    // catálogo global (dado público): leitura livre a autenticados (design D2)
    Route::get('/cbos', [CbosController::class, 'index']);
    Route::post('/cbos', [CbosController::class, 'store'])
        ->middleware('permission:medicos.editar');

    Route::get('/especialidades', [EspecialidadeController::class, 'index'])
        ->middleware('permission:especialidades.ver');
    Route::post('/especialidades', [EspecialidadeController::class, 'store'])
        ->middleware('permission:especialidades.criar');
    Route::get('/especialidades/{id}', [EspecialidadeController::class, 'show'])
        ->middleware('permission:especialidades.ver');
    Route::put('/especialidades/{id}', [EspecialidadeController::class, 'update'])
        ->middleware('permission:especialidades.editar');
    Route::delete('/especialidades/{id}', [EspecialidadeController::class, 'destroy'])
        ->middleware('permission:especialidades.excluir');

    Route::get('/salas', [SalaController::class, 'index'])
        ->middleware('permission:salas.ver');
    Route::post('/salas', [SalaController::class, 'store'])
        ->middleware('permission:salas.criar');
    Route::get('/salas/{id}', [SalaController::class, 'show'])
        ->middleware('permission:salas.ver');
    Route::put('/salas/{id}', [SalaController::class, 'update'])
        ->middleware('permission:salas.editar');
    Route::delete('/salas/{id}', [SalaController::class, 'destroy'])
        ->middleware('permission:salas.excluir');

    Route::get('/equipamentos', [EquipamentoController::class, 'index'])
        ->middleware('permission:equipamentos.ver');
    Route::post('/equipamentos', [EquipamentoController::class, 'store'])
        ->middleware('permission:equipamentos.criar');
    Route::get('/equipamentos/{id}', [EquipamentoController::class, 'show'])
        ->middleware('permission:equipamentos.ver');
    Route::put('/equipamentos/{id}', [EquipamentoController::class, 'update'])
        ->middleware('permission:equipamentos.editar');
    Route::delete('/equipamentos/{id}', [EquipamentoController::class, 'destroy'])
        ->middleware('permission:equipamentos.excluir');

    Route::get('/convenios', [ConvenioController::class, 'index'])
        ->middleware('permission:convenios.ver');
    Route::post('/convenios', [ConvenioController::class, 'store'])
        ->middleware('permission:convenios.criar');
    Route::get('/convenios/{id}', [ConvenioController::class, 'show'])
        ->middleware('permission:convenios.ver');
    Route::put('/convenios/{id}', [ConvenioController::class, 'update'])
        ->middleware('permission:convenios.editar');
    Route::delete('/convenios/{id}', [ConvenioController::class, 'destroy'])
        ->middleware('permission:convenios.excluir');

    // regras de limite — agregado do convênio (limites-e-pedidos, D1): leitura sob
    // convenios.ver (SEC-LP-08); TODA escrita sob convenios.editar (spec convenios)
    Route::get('/convenios/{convenioId}/regras', [RegraLimiteConvenioController::class, 'index'])
        ->middleware('permission:convenios.ver');
    Route::post('/convenios/{convenioId}/regras', [RegraLimiteConvenioController::class, 'store'])
        ->middleware('permission:convenios.editar');
    Route::put('/convenios/{convenioId}/regras/{id}', [RegraLimiteConvenioController::class, 'update'])
        ->middleware('permission:convenios.editar');
    Route::delete('/convenios/{convenioId}/regras/{id}', [RegraLimiteConvenioController::class, 'destroy'])
        ->middleware('permission:convenios.editar');

    // ciclos de faturamento — agregado do convênio (fechamento-de-ciclo, D2): leitura E
    // fechamento sob `ciclos.fechar` (é o faturamento quem fecha, não quem edita
    // cadastro). A REABERTURA passa por aqui também, mas o gate da exceção
    // (`ciclos.reabrir`) vive no authorize() do ReaberturaDeCicloRequest — só ali o 403
    // vence o 422 e o 404 (SEC-FC-01).
    Route::get('/convenios/{convenioId}/ciclos', [FechamentoCicloController::class, 'index'])
        ->middleware('permission:ciclos.fechar');
    Route::get('/convenios/{convenioId}/ciclos/proximo', [FechamentoCicloController::class, 'proximo'])
        ->middleware('permission:ciclos.fechar');
    Route::post('/convenios/{convenioId}/ciclos', [FechamentoCicloController::class, 'store'])
        ->middleware('permission:ciclos.fechar');
    Route::post('/convenios/{convenioId}/ciclos/{id}/reabertura', [FechamentoCicloController::class, 'reabrir'])
        ->middleware('permission:ciclos.fechar');

    // tabela de serviços — agregado do convênio (design D4)
    Route::get('/convenios/{convenioId}/servicos', [ServicoController::class, 'index'])
        ->middleware('permission:servicos.ver');
    Route::post('/convenios/{convenioId}/servicos', [ServicoController::class, 'store'])
        ->middleware('permission:servicos.criar');
    Route::put('/convenios/{convenioId}/servicos/{id}', [ServicoController::class, 'update'])
        ->middleware('permission:servicos.editar');
    Route::delete('/convenios/{convenioId}/servicos/{id}', [ServicoController::class, 'destroy'])
        ->middleware('permission:servicos.excluir');

    Route::get('/medicos', [MedicoController::class, 'index'])
        ->middleware('permission:medicos.ver');
    Route::post('/medicos', [MedicoController::class, 'store'])
        ->middleware('permission:medicos.criar');
    Route::get('/medicos/{id}', [MedicoController::class, 'show'])
        ->middleware('permission:medicos.ver');
    Route::put('/medicos/{id}', [MedicoController::class, 'update'])
        ->middleware('permission:medicos.editar');
    Route::delete('/medicos/{id}', [MedicoController::class, 'destroy'])
        ->middleware('permission:medicos.excluir');

    Route::get('/anamnese-modelos', [AnamneseModeloController::class, 'index'])
        ->middleware('permission:anamnese_modelos.ver');
    Route::post('/anamnese-modelos', [AnamneseModeloController::class, 'store'])
        ->middleware('permission:anamnese_modelos.criar');
    Route::get('/anamnese-modelos/{id}', [AnamneseModeloController::class, 'show'])
        ->middleware('permission:anamnese_modelos.ver');
    Route::put('/anamnese-modelos/{id}', [AnamneseModeloController::class, 'update'])
        ->middleware('permission:anamnese_modelos.editar');
    Route::delete('/anamnese-modelos/{id}', [AnamneseModeloController::class, 'destroy'])
        ->middleware('permission:anamnese_modelos.excluir');

    // TERMO de consentimento (FA-08): o catálogo é ADMINISTRAÇÃO do texto do contrato.
    // A exceção é `/vigente`, que só NOMEIA a régua (id, título, versão — sem o texto):
    // quem registra o aceite é a recepção, que tem `pacientes.editar` e não administra
    // termo nenhum. Sem essa porta, o formulário do paciente não teria como saber o que
    // vai gravar — nem se existe termo publicado.
    Route::get('/termos-consentimento/vigente', [TermoConsentimentoController::class, 'vigente'])
        ->middleware('permission:termos_consentimento.ver|pacientes.ver|pacientes.editar');
    Route::get('/termos-consentimento', [TermoConsentimentoController::class, 'index'])
        ->middleware('permission:termos_consentimento.ver');
    Route::post('/termos-consentimento', [TermoConsentimentoController::class, 'store'])
        ->middleware('permission:termos_consentimento.criar');
    Route::get('/termos-consentimento/{id}', [TermoConsentimentoController::class, 'show'])
        ->middleware('permission:termos_consentimento.ver');
    Route::put('/termos-consentimento/{id}', [TermoConsentimentoController::class, 'update'])
        ->middleware('permission:termos_consentimento.editar');
    Route::delete('/termos-consentimento/{id}', [TermoConsentimentoController::class, 'destroy'])
        ->middleware('permission:termos_consentimento.excluir');

    Route::get('/status-agendamento', [StatusAgendamentoController::class, 'index'])
        ->middleware('permission:status_agendamento.ver');
    Route::post('/status-agendamento', [StatusAgendamentoController::class, 'store'])
        ->middleware('permission:status_agendamento.criar');
    Route::get('/status-agendamento/{id}', [StatusAgendamentoController::class, 'show'])
        ->middleware('permission:status_agendamento.ver');
    Route::put('/status-agendamento/{id}', [StatusAgendamentoController::class, 'update'])
        ->middleware('permission:status_agendamento.editar');
    Route::delete('/status-agendamento/{id}', [StatusAgendamentoController::class, 'destroy'])
        ->middleware('permission:status_agendamento.excluir');

    Route::get('/profissionais', [ProfissionalController::class, 'index'])
        ->middleware('permission:profissionais.ver');
    Route::post('/profissionais', [ProfissionalController::class, 'store'])
        ->middleware('permission:profissionais.criar');
    // SEM middleware de permissão: a autorização do show vive no controller — o DONO
    // (usuario.profissional_id === id) lê a própria ficha sem `profissionais.ver`.
    // whereNumber: alcançável por QUALQUER autenticado, id lixo viraria 500 (SEC-FPR-02)
    Route::get('/profissionais/{id}', [ProfissionalController::class, 'show'])->whereNumber('id');
    // o PAINEL do mês da ficha (change painel-do-profissional, D3): sem middleware de permissão
    // pela mesma razão do show — a porta (`profissionais.ver` OU o próprio) e cada bloco (módulo
    // dono + eixo do escopo) são decididos no controller, antes de validar o `mes` (403 antes de 422).
    // Balde PRÓPRIO por usuário (SEC-PP-03): cada chamada roda ~50 consultas, e o balde de leitura
    // geral (120/min) deixaria um laço custar 6 mil consultas por minuto
    Route::get('/profissionais/{id}/painel', [PainelDoProfissionalController::class, 'show'])
        ->whereNumber('id')
        ->middleware('throttle:painel-do-profissional');
    Route::put('/profissionais/{id}', [ProfissionalController::class, 'update'])
        ->middleware('permission:profissionais.editar');
    Route::delete('/profissionais/{id}', [ProfissionalController::class, 'destroy'])
        ->middleware('permission:profissionais.excluir');

    // foto do profissional (foto-do-profissional): LEITURA por quem já ENXERGA o profissional —
    // agenda, fila ou cadastro (SEC-FP-01: "todo autenticado" era mais frouxo que o nome, que a
    // recepção sem essas permissões não recebe); ESCRITA sob `profissionais.editar`.
    Route::get('/profissionais/{id}/foto', [FotoProfissionalController::class, 'show'])
        ->whereNumber('id')
        ->middleware('permission:agenda.ver|lista_espera.ver|profissionais.ver');
    Route::post('/profissionais/{id}/foto', [FotoProfissionalController::class, 'store'])
        ->whereNumber('id')
        ->middleware('permission:profissionais.editar');
    Route::delete('/profissionais/{id}/foto', [FotoProfissionalController::class, 'destroy'])
        ->whereNumber('id')
        ->middleware('permission:profissionais.editar');

    Route::get('/tratamentos', [TratamentoController::class, 'index'])
        ->middleware('permission:tratamentos.ver');
    Route::post('/tratamentos', [TratamentoController::class, 'store'])
        ->middleware('permission:tratamentos.criar');
    Route::get('/tratamentos/{id}', [TratamentoController::class, 'show'])
        ->middleware('permission:tratamentos.ver');
    Route::put('/tratamentos/{id}', [TratamentoController::class, 'update'])
        ->middleware('permission:tratamentos.editar');
    Route::delete('/tratamentos/{id}', [TratamentoController::class, 'destroy'])
        ->middleware('permission:tratamentos.excluir');

    // ==== agenda (§6 — núcleo) ====

    Route::get('/agenda', [AgendamentoController::class, 'periodo'])
        ->middleware('permission:agenda.ver');
    // configs de EXIBIÇÃO da grade sob agenda.ver — a tela não empurra
    // configuracoes.ver (catálogo inteiro) para a recepção (T-sag-02)
    Route::get('/agenda/configuracoes', [ConfiguracaoController::class, 'agenda'])
        ->middleware('permission:agenda.ver');

    // catálogos do FORMULÁRIO sob a permissão da agenda (T-aes-08): marcar não
    // pode exigir pacientes.ver, que entrega CPF/responsáveis/contatos de menor.
    // Quem administra a FILA também escolhe paciente (lista-de-espera, D5) — e a
    // alternativa para ele seria justamente pacientes.ver. Este endpoint é
    // whitelist de colunas: ampliar o acesso a ele é estritamente mais seguro. `repasse.ver`
    // (recebido-por-profissional): a faturista escolhe o profissional do fechamento e não tem
    // permissão de agenda nenhuma (matriz AP-10) — a alternativa seria `profissionais.ver`.
    Route::get('/agenda/selecao', [AgendaSelecaoController::class, 'index'])
        ->middleware('permission:agenda.ver|agenda.criar|lista_espera.criar|lista_espera.editar|repasse.ver');
    // busca por nome E leitura por id (`?id=`, exclusivo com `?busca=`): quem recebeu só o id de
    // uma criança — o modo retorno, vindo da fila de pendências — precisa NOMEÁ-LA sem exigir
    // `pacientes.ver`. Nome de MENOR não entra em query string (gatilho LOG); o id, sim, que é
    // referência pseudônima (o mesmo regime de `/pacientes/{id}`).
    Route::get('/agenda/selecao/pacientes', [AgendaSelecaoController::class, 'pacientes'])
        ->middleware('permission:agenda.ver|agenda.criar|lista_espera.criar|lista_espera.editar');
    Route::get('/agenda/selecao/tratamentos', [AgendaSelecaoController::class, 'tratamentos'])
        ->middleware('permission:agenda.ver|agenda.criar');
    // tamanho REAL da série: a tela não pode contar (T-aes-03)
    Route::get('/agendamentos/{id}/serie', [AgendamentoController::class, 'serie'])
        ->middleware('permission:agenda.ver');
    Route::post('/agendamentos', [AgendamentoController::class, 'store'])
        ->middleware('permission:agenda.criar');
    Route::get('/agendamentos/{id}', [AgendamentoController::class, 'show'])
        ->middleware('permission:agenda.ver');
    // comparecimento recente do paciente (painel — 90 dias): leitura da agenda de
    // um menor, minimizada, sob a MESMA permissão da grade (design D2 do painel)
    Route::get('/pacientes/{pacienteId}/comparecimento-recente', [ComparecimentoRecenteController::class, 'index'])
        ->middleware('permission:agenda.ver');
    // agendamentos do paciente para a FICHA (change agendamentos-na-ficha): próximos +
    // recentes numa leitura. Mesma classe/portão do comparecimento — por-id, minimizado,
    // sob a permissão da grade. O `comparecimento-recente` acima segue só-passado, de propósito
    Route::get('/pacientes/{pacienteId}/agendamentos', [AgendamentosDoPacienteController::class, 'index'])
        ->middleware('permission:agenda.ver');
    // assiduidade do paciente (seção Presença da ficha): mesma classe/portão do
    // comparecimento — contagens e faltas, classificadas por FLAG no servidor (§13)
    Route::get('/pacientes/{pacienteId}/presenca', [PresencaDoPacienteController::class, 'index'])
        ->middleware('permission:agenda.ver');
    // fila de RETORNOS (protocolo-de-pendencias): quem tem tratamento ativo e parou de ser
    // agendado. Sob `agenda.ver` porque a pendência é a AUSÊNCIA de horário (design D6);
    // escopo D11 aplicado na fonte única, pela coluna `tratamentos.profissional_id`.
    Route::get('/pendencias-de-retorno', [PendenciaDeRetornoController::class, 'index'])
        ->middleware('permission:agenda.ver');

    // anexos do paciente (documento de MENOR, potencialmente laudo — art. 11):
    // permissões PRÓPRIAS por ação; download auditado; soft-delete (SEC-AX)
    Route::get('/pacientes/{pacienteId}/anexos', [AnexoController::class, 'index'])
        ->middleware('permission:anexos.ver');
    Route::post('/pacientes/{pacienteId}/anexos', [AnexoController::class, 'store'])
        ->middleware('permission:anexos.criar');
    Route::get('/anexos/{id}/download', [AnexoController::class, 'download'])
        ->middleware('permission:anexos.ver');
    Route::delete('/anexos/{id}', [AnexoController::class, 'destroy'])
        ->middleware('permission:anexos.excluir');
    Route::put('/agendamentos/{id}', [AgendamentoController::class, 'update'])
        ->middleware('permission:agenda.editar');
    // a família tocou "Preciso desmarcar" por engano e confirmou por telefone
    // (lembrete-com-botoes-de-resposta, CRB-08) — a mesma permissão de mudar a sessão
    Route::post('/agendamentos/{id}/manter-sessao', [ConfirmacaoDoLembreteController::class, 'manter'])
        ->middleware('permission:agenda.editar')->where('id', '[0-9]{1,18}');
    // a família confirmou por telefone ou mensagem (confirmacao-pela-clinica) — a mesma permissão. O id
    // tem teto de dígitos (gate r2, SEC-CC-04): o `whereNumber` aceitava um número que estoura o `int`
    Route::post('/agendamentos/{id}/confirmar', [ConfirmacaoDoLembreteController::class, 'confirmar'])
        ->middleware('permission:agenda.editar')->where('id', '[0-9]{1,18}');
    // "Avisar no WhatsApp" (avisar-no-whatsapp-abre-a-conversa): acha ou cria a conversa da família.
    // As TRÊS valem juntas (gate r1, SEC-WA-01): ler a sessão (`agenda.ver`), ler a conversa que abre
    // (`mensagens.ver`) e falar com a família (`mensagens.responder`) — sem a da agenda, um papel só de
    // mensagens percorria ids de agendamento e chegava a nome e celular de crianças. A posse vem no
    // controller
    Route::post('/agendamentos/{id}/conversa', [ConversaDaSessaoController::class, 'abrir'])
        ->middleware(['permission:agenda.ver', 'permission:mensagens.ver', 'permission:mensagens.responder'])
        ->where('id', '[0-9]{1,18}');
    Route::delete('/agendamentos/{id}', [AgendamentoController::class, 'destroy'])
        ->middleware('permission:agenda.excluir');
    // baixa em massa da agenda de um profissional (change desmarque-do-profissional).
    // Sob `agenda.editar`, e não sob permissão própria (design D6): é o mesmo ato que a
    // recepcionista já pratica, repetido — o freio do volume é o TETO, no servidor.
    Route::post('/agendamentos/desmarque-em-lote/previa', [DesmarqueEmLoteController::class, 'previa'])
        ->middleware('permission:agenda.editar');
    Route::post('/agendamentos/desmarque-em-lote', [DesmarqueEmLoteController::class, 'executar'])
        ->middleware('permission:agenda.editar');
    // baixa em lote POR STATUS da agenda de um profissional (change baixa-em-lote-por-status).
    // Também sob `agenda.editar` (design D13): é o ato que o chip do card já permite, repetido;
    // o freio é teto + prévia + assinatura + trilha, no servidor. A prévia é escopada porque a
    // contagem da agenda do colega já é vazamento.
    Route::post('/agendamentos/baixa-em-lote/previa', [BaixaEmLoteController::class, 'previa'])
        ->middleware('permission:agenda.editar');
    Route::post('/agendamentos/baixa-em-lote', [BaixaEmLoteController::class, 'executar'])
        ->middleware('permission:agenda.editar');

    Route::get('/feriados', [FeriadoController::class, 'index'])
        ->middleware('permission:feriados.ver');
    Route::post('/feriados', [FeriadoController::class, 'store'])
        ->middleware('permission:feriados.criar');
    Route::get('/feriados/{id}', [FeriadoController::class, 'show'])
        ->middleware('permission:feriados.ver');
    Route::put('/feriados/{id}', [FeriadoController::class, 'update'])
        ->middleware('permission:feriados.editar');
    Route::delete('/feriados/{id}', [FeriadoController::class, 'destroy'])
        ->middleware('permission:feriados.excluir');

    Route::get('/lista-espera', [ListaEsperaController::class, 'index'])
        ->middleware('permission:lista_espera.ver');
    Route::post('/lista-espera', [ListaEsperaController::class, 'store'])
        ->middleware('permission:lista_espera.criar');
    Route::put('/lista-espera/{id}', [ListaEsperaController::class, 'update'])
        ->middleware('permission:lista_espera.editar');
    Route::delete('/lista-espera/{id}', [ListaEsperaController::class, 'destroy'])
        ->middleware('permission:lista_espera.excluir');
    // encaixe: escrita COMPOSTA (cria agendamento E consome a entrada) — as duas
    // permissões em AND, dois middlewares. O `|` do Spatie é OR e daria a operação
    // inteira a quem tem só uma das metades.
    Route::post('/lista-espera/{id}/encaixar', [ListaEsperaController::class, 'encaixar'])
        ->middleware(['permission:agenda.criar', 'permission:lista_espera.excluir']);

    // ==== atendimento & prontuário (etapa 6 — §7) ====

    Route::get('/atendimentos', [AtendimentoController::class, 'index'])
        ->middleware('permission:atendimentos.ver');
    Route::post('/agendamentos/{agendamentoId}/atendimento', [AtendimentoController::class, 'store'])
        ->middleware('permission:atendimentos.criar');
    Route::get('/atendimentos/{id}', [AtendimentoController::class, 'show'])
        ->middleware('permission:atendimentos.ver');
    Route::put('/atendimentos/{id}', [AtendimentoController::class, 'update'])
        ->middleware('permission:atendimentos.editar');
    Route::delete('/atendimentos/{id}', [AtendimentoController::class, 'destroy'])
        ->middleware('permission:atendimentos.excluir');

    // prontuário: SEM rotas DELETE (T-ate-08/T-ate-11); em-aberto ANTES de {id}
    Route::get('/evolucoes/em-aberto', [EvolucaoController::class, 'emAberto'])
        ->middleware('permission:evolucoes.ver');
    Route::post('/atendimentos/{atendimentoId}/evolucao', [EvolucaoController::class, 'store'])
        ->middleware('permission:evolucoes.criar');
    // a evolução escrita DIRETO DA SESSÃO (evolucao-finaliza-a-sessao, D1): registra o atendimento
    // que falta — por isso exige as DUAS permissões, conferidas antes da validação
    Route::post('/agendamentos/{agendamentoId}/evolucao', [EvolucaoController::class, 'storeDaSessao'])
        ->middleware(['permission:evolucoes.criar', 'permission:atendimentos.criar']);
    Route::get('/evolucoes/{id}', [EvolucaoController::class, 'show'])
        ->middleware('permission:evolucoes.ver');
    Route::put('/evolucoes/{id}', [EvolucaoController::class, 'update'])
        ->middleware('permission:evolucoes.editar');

    Route::get('/pacientes/{pacienteId}/anamneses', [AnamneseController::class, 'index'])
        ->middleware('permission:anamneses.ver');
    Route::post('/pacientes/{pacienteId}/anamneses', [AnamneseController::class, 'store'])
        ->middleware('permission:anamneses.criar');
    Route::get('/anamneses/{id}', [AnamneseController::class, 'show'])
        ->middleware('permission:anamneses.ver');
    Route::put('/anamneses/{id}', [AnamneseController::class, 'update'])
        ->middleware('permission:anamneses.editar');

    // ==== financeiro (etapa 7 — §9) — módulos PRÓPRIOS do dinheiro ====

    Route::get('/contas', [ContaController::class, 'index'])
        ->middleware('permission:contas.ver');
    // saldo é agregado do dinheiro da clínica (change `saldo-das-contas`): `fluxo_caixa.ver`,
    // não `contas.ver`. Antes de `/contas/{id}`, que casaria "saldos" como id
    Route::get('/contas/saldos', [ContaController::class, 'saldos'])
        ->middleware('permission:fluxo_caixa.ver');
    // E das duas (uma `permission:` por item — `a|b` do Spatie é OU)
    Route::put('/contas/{id}/saldo-de-abertura', [ContaController::class, 'definirAbertura'])
        ->middleware(['permission:contas.editar', 'permission:fluxo_caixa.ver'])->whereNumber('id');
    Route::post('/contas', [ContaController::class, 'store'])
        ->middleware('permission:contas.criar');
    Route::get('/contas/{id}', [ContaController::class, 'show'])
        ->middleware('permission:contas.ver');
    Route::put('/contas/{id}', [ContaController::class, 'update'])
        ->middleware('permission:contas.editar');
    Route::delete('/contas/{id}', [ContaController::class, 'destroy'])
        ->middleware('permission:contas.excluir');

    Route::get('/cartoes', [CartaoController::class, 'index'])
        ->middleware('permission:cartoes.ver');
    Route::post('/cartoes', [CartaoController::class, 'store'])
        ->middleware('permission:cartoes.criar');
    Route::get('/cartoes/{id}', [CartaoController::class, 'show'])
        ->middleware('permission:cartoes.ver');
    Route::put('/cartoes/{id}', [CartaoController::class, 'update'])
        ->middleware('permission:cartoes.editar');
    Route::delete('/cartoes/{id}', [CartaoController::class, 'destroy'])
        ->middleware('permission:cartoes.excluir');

    Route::get('/tipos-pagamento', [TipoPagamentoController::class, 'index'])
        ->middleware('permission:tipos_pagamento.ver');
    Route::post('/tipos-pagamento', [TipoPagamentoController::class, 'store'])
        ->middleware('permission:tipos_pagamento.criar');
    Route::put('/tipos-pagamento/{id}', [TipoPagamentoController::class, 'update'])
        ->middleware('permission:tipos_pagamento.editar');
    Route::delete('/tipos-pagamento/{id}', [TipoPagamentoController::class, 'destroy'])
        ->middleware('permission:tipos_pagamento.excluir');

    // subcategorias são agregado da categoria — mesmo módulo (parecer §3)
    Route::get('/categorias', [CategoriaController::class, 'index'])
        ->middleware('permission:categorias.ver');
    // o DRE (change `dre-gerencial`): ler é do caixa da clínica; trocar a linha é E das duas
    Route::get('/dre/linhas', [DreController::class, 'linhas'])
        ->middleware('permission:fluxo_caixa.ver');
    Route::put('/categorias/{id}/linha-dre', [DreController::class, 'definirDaCategoria'])
        ->middleware(['permission:categorias.editar', 'permission:fluxo_caixa.ver'])->whereNumber('id');
    Route::put('/subcategorias/{id}/linha-dre', [DreController::class, 'definirDaSubcategoria'])
        ->middleware(['permission:categorias.editar', 'permission:fluxo_caixa.ver'])->whereNumber('id');
    Route::post('/categorias', [CategoriaController::class, 'store'])
        ->middleware('permission:categorias.criar');
    Route::put('/categorias/{id}', [CategoriaController::class, 'update'])
        ->middleware('permission:categorias.editar');
    Route::delete('/categorias/{id}', [CategoriaController::class, 'destroy'])
        ->middleware('permission:categorias.excluir');
    Route::post('/categorias/{categoriaId}/subcategorias', [CategoriaController::class, 'storeSubcategoria'])
        ->middleware('permission:categorias.criar');
    Route::put('/subcategorias/{id}', [CategoriaController::class, 'updateSubcategoria'])
        ->middleware('permission:categorias.editar');
    Route::delete('/subcategorias/{id}', [CategoriaController::class, 'destroySubcategoria'])
        ->middleware('permission:categorias.excluir');

    Route::get('/fornecedores', [FornecedorController::class, 'index'])
        ->middleware('permission:fornecedores.ver');
    Route::post('/fornecedores', [FornecedorController::class, 'store'])
        ->middleware('permission:fornecedores.criar');
    Route::get('/fornecedores/{id}', [FornecedorController::class, 'show'])
        ->middleware('permission:fornecedores.ver')->whereNumber('id');
    Route::put('/fornecedores/{id}', [FornecedorController::class, 'update'])
        ->middleware('permission:fornecedores.editar')->whereNumber('id');
    Route::delete('/fornecedores/{id}', [FornecedorController::class, 'destroy'])
        ->middleware('permission:fornecedores.excluir')->whereNumber('id');

    Route::get('/funcionarios', [FuncionarioController::class, 'index'])
        ->middleware('permission:funcionarios.ver');
    Route::post('/funcionarios', [FuncionarioController::class, 'store'])
        ->middleware('permission:funcionarios.criar');
    Route::get('/funcionarios/{id}', [FuncionarioController::class, 'show'])
        ->middleware('permission:funcionarios.ver')->whereNumber('id');
    Route::put('/funcionarios/{id}', [FuncionarioController::class, 'update'])
        ->middleware('permission:funcionarios.editar')->whereNumber('id');
    Route::delete('/funcionarios/{id}', [FuncionarioController::class, 'destroy'])
        ->middleware('permission:funcionarios.excluir')->whereNumber('id');

    // fluxo de caixa é AGREGADO da clínica (totais-do-caixa, D1): permissão própria,
    // distinta de lancamentos.ver — quem lança não vê o total. Antes de {id}.
    Route::get('/fluxo-caixa', [FluxoCaixaController::class, 'index'])
        ->middleware('permission:fluxo_caixa.ver');

    // o vínculo pagamento → tratamento conduzido (change vincular-pagamentos-ao-tratamento):
    // a sugestão do formulário, a lista do que ficou sem tratamento e o lote. Permissões em E,
    // uma `permission:` por item (o `a|b` do Spatie é OU). Antes de `{id}`.
    Route::get('/lancamentos/sugestao-de-tratamento', [LancamentoVinculoController::class, 'sugestao'])
        ->middleware('permission:tratamentos.ver');
    Route::get('/lancamentos/sem-tratamento', [LancamentoVinculoController::class, 'semTratamento'])
        ->middleware(['permission:lancamentos.ver', 'permission:lancamentos.editar', 'permission:lancamentos.pagar', 'permission:tratamentos.ver']);
    // `lancamentos.ver` nas duas (SEC-VPT-02): a lista mostra criança e valor, que é o que a
    // lista de lançamentos mostra — sem ela, um nível "editar sem ver" lia o caixa por aqui
    Route::post('/lancamentos/vincular-tratamentos', [LancamentoVinculoController::class, 'vincular'])
        ->middleware(['permission:lancamentos.ver', 'permission:lancamentos.editar', 'permission:lancamentos.pagar']);

    Route::get('/lancamentos', [LancamentoCaixaController::class, 'index'])
        ->middleware('permission:lancamentos.ver');
    Route::post('/lancamentos', [LancamentoCaixaController::class, 'store'])
        ->middleware('permission:lancamentos.criar');
    // whereNumber (SEC-RPP-08): com `/lancamentos/N.5`, o `find` do `authorize()` não achava nada
    // e pulava a autorização do vínculo, e o `int $id` do controller truncava para N — a porta
    // inteira do vínculo contornada por um ponto. De quebra, `abc` deixa de ser 500.
    Route::get('/lancamentos/{id}', [LancamentoCaixaController::class, 'show'])
        ->middleware('permission:lancamentos.ver')->whereNumber('id');
    Route::put('/lancamentos/{id}', [LancamentoCaixaController::class, 'update'])
        ->middleware('permission:lancamentos.editar')->whereNumber('id');
    Route::delete('/lancamentos/{id}', [LancamentoCaixaController::class, 'destroy'])
        ->middleware('permission:lancamentos.excluir')->whereNumber('id');
    // pagar/estornar: permissão PRÓPRIA (T-fin-07) — recepção cria sem poder pagar
    // anexos do lançamento (change `anexo-no-lancamento`): comprovante, nota, recibo — anexar
    // e excluir com `lancamentos.editar`, ver e baixar com `lancamentos.ver`
    Route::get('/lancamentos/{id}/anexos', [LancamentoAnexoController::class, 'index'])
        ->middleware('permission:lancamentos.ver')->whereNumber('id');
    Route::post('/lancamentos/{id}/anexos', [LancamentoAnexoController::class, 'store'])
        ->middleware('permission:lancamentos.editar')->whereNumber('id');
    Route::get('/lancamentos/anexos/{anexoId}/download', [LancamentoAnexoController::class, 'download'])
        ->middleware('permission:lancamentos.ver')->whereNumber('anexoId');
    Route::delete('/lancamentos/anexos/{anexoId}', [LancamentoAnexoController::class, 'destroy'])
        ->middleware('permission:lancamentos.editar')->whereNumber('anexoId');
    // cobrar pelo WhatsApp (change `cobranca-pelo-whatsapp`): o telefone é contato do cadastro da
    // criança — `lancamentos.ver` E `pacientes.ver` (uma `permission:` por item: `a|b` é OU)
    Route::get('/lancamentos/{id}/cobranca', [LancamentoCobrancaController::class, 'mostrar'])
        ->middleware(['permission:lancamentos.ver', 'permission:pacientes.ver'])->whereNumber('id');
    Route::post('/lancamentos/{id}/cobranca', [LancamentoCobrancaController::class, 'registrar'])
        ->middleware(['permission:lancamentos.ver', 'permission:pacientes.ver'])->whereNumber('id');
    Route::post('/lancamentos/{id}/pagamento', [LancamentoCaixaController::class, 'pagar'])
        ->middleware('permission:lancamentos.pagar')->whereNumber('id');
    Route::delete('/lancamentos/{id}/pagamento', [LancamentoCaixaController::class, 'estornarPagamento'])
        ->middleware('permission:lancamentos.pagar')->whereNumber('id');

    // faturamento: rota no recurso da agenda, permissão do DINHEIRO (parecer §3)
    Route::post('/agendamentos/{agendamentoId}/faturamento', [FaturamentoController::class, 'store'])
        ->middleware('permission:lancamentos.criar');

    Route::get('/transferencias', [TransferenciaController::class, 'index'])
        ->middleware('permission:transferencias.ver');
    Route::post('/transferencias', [TransferenciaController::class, 'store'])
        ->middleware('permission:transferencias.criar');
    Route::get('/transferencias/{id}', [TransferenciaController::class, 'show'])
        ->middleware('permission:transferencias.ver')->whereNumber('id');
    Route::put('/transferencias/{id}', [TransferenciaController::class, 'update'])
        ->middleware('permission:transferencias.editar')->whereNumber('id');
    Route::delete('/transferencias/{id}', [TransferenciaController::class, 'destroy'])
        ->middleware('permission:transferencias.excluir')->whereNumber('id');

    // ==== notificações & relatórios (etapa 8 — §10/§11) ====

    // o centro agrega por permissão de ORIGEM (T-not-01) — autenticado entra,
    // cada bloco decide server-side
    Route::get('/notificacoes', [NotificacaoController::class, 'index']);

    Route::get('/informativos', [InformativoController::class, 'index'])
        ->middleware('permission:informativos.ver');
    Route::post('/informativos', [InformativoController::class, 'store'])
        ->middleware('permission:informativos.criar');
    Route::get('/informativos/{id}', [InformativoController::class, 'show'])
        ->middleware('permission:informativos.ver');
    Route::put('/informativos/{id}', [InformativoController::class, 'update'])
        ->middleware('permission:informativos.editar');
    Route::delete('/informativos/{id}', [InformativoController::class, 'destroy'])
        ->middleware('permission:informativos.excluir');

    // indicadores do dashboard (§11): SEM guarda-chuva (T-not-13) — cada vista sob o módulo DONO
    // drill-down das caixas: itens sob a MESMA permissão e escopo do bloco de origem
    Route::get('/indicadores/agenda/itens', [IndicadorController::class, 'itensDaAgenda'])
        ->middleware('permission:agenda.ver');
    Route::get('/indicadores/atendimentos', [IndicadorController::class, 'atendimentos'])
        ->middleware('permission:atendimentos.ver');
    Route::get('/indicadores/atendimentos/itens', [IndicadorController::class, 'itensDeAtendimentos'])
        ->middleware('permission:atendimentos.ver');
    Route::get('/indicadores/pacientes', [IndicadorController::class, 'pacientes'])
        ->middleware('permission:pacientes.ver');
    // a tela Gráficos Financeiros (§11): rota PRÓPRIA, não a série ampliada (D1 da
    // change) — o painel não paga 4 agregações por uma página que ninguém abriu
    Route::get('/indicadores/financeiro/graficos', [IndicadorController::class, 'graficosDoFinanceiro'])
        ->middleware('permission:fluxo_caixa.ver');
    // produtividade do profissional (change produtividade-do-profissional): capacidade e
    // marcações são dado da AGENDA, "realizado" é dado CLÍNICO — as DUAS permissões, encadeadas
    // (403 faltando qualquer uma). Dois `permission:` com argumentos distintos NÃO se
    // deduplicam: cada um roda, e o teste de 403 por eixo é a prova.
    Route::get('/indicadores/produtividade', [IndicadorController::class, 'produtividade'])
        ->middleware('permission:agenda.ver')
        ->middleware('permission:atendimentos.ver');
    // os PAINÉIS por frente (change indicadores-profissionais, D1): período comparado + números do
    // cartão, cada um sob o módulo DONO. A equipe exige as DUAS permissões da produtividade.
    Route::get('/indicadores/painel/dinheiro', [PainelDeIndicadoresController::class, 'dinheiro'])
        ->middleware('permission:fluxo_caixa.ver');
    Route::get('/indicadores/painel/agenda', [PainelDeIndicadoresController::class, 'agenda'])
        ->middleware('permission:agenda.ver');
    Route::get('/indicadores/painel/pacientes', [PainelDeIndicadoresController::class, 'pacientes'])
        ->middleware('permission:pacientes.ver');
    Route::get('/indicadores/painel/equipe', [PainelDeIndicadoresController::class, 'equipe'])
        ->middleware('permission:agenda.ver')
        ->middleware('permission:atendimentos.ver');

    // relatórios: SEM guarda-chuva (T-not-13) — cada um sob o módulo DONO
    Route::get('/relatorios/producao-por-profissional', [RelatorioController::class, 'producaoPorProfissional'])
        ->middleware('permission:atendimentos.ver');
    // consolidado por período é AGREGADO da clínica (totais-do-caixa, D1)
    Route::get('/relatorios/financeiro-por-periodo', [RelatorioController::class, 'financeiroPorPeriodo'])
        ->middleware('permission:fluxo_caixa.ver');
    Route::get('/relatorios/sessoes-vendidas-realizadas', [RelatorioController::class, 'sessoesVendidasRealizadas'])
        ->middleware('permission:tratamentos.ver');
    // a ÁREA de relatórios (change area-de-relatorios): o índice do catálogo é sob login, sem
    // permissão específica e SEM dado; o despacho por slug decide a permissão NO CONTROLLER —
    // cada relatório declara as suas (TODAS; `permission:a|b` do Spatie seria OU) e o escopo
    // D11 pelo eixo. Registradas DEPOIS das três rotas literais acima: `{slug}` não as engole.
    Route::get('/relatorios', [RelatorioController::class, 'indice']);
    // a planilha do MESMO relatório (change `relatorio-em-planilha`): mesma porta, mesmas regras
    Route::get('/relatorios/{slug}/planilha', [RelatorioController::class, 'planilha'])
        ->where('slug', '[a-z0-9-]+');
    Route::get('/relatorios/{slug}', [RelatorioController::class, 'executar'])
        ->where('slug', '[a-z0-9-]+');

    // pacientes (LGPD — menores) — SEM DELETE (design D5: direitos do titular é change futura)
    Route::get('/pacientes', [PacienteController::class, 'index'])
        ->middleware('permission:pacientes.ver');
    Route::post('/pacientes', [PacienteController::class, 'store'])
        ->middleware('permission:pacientes.criar');
    // pré-cadastro pelo balcão (pre-cadastro-de-paciente): só nome/sexo/telefone;
    // "incompleto" é derivado na listagem — o PUT completo cura
    Route::post('/pacientes/pre-cadastro', [PacienteController::class, 'preCadastro'])
        ->middleware('permission:pacientes.criar');
    // "este número também está no cadastro de…" (telefone-que-chega-no-whatsapp, D6): POST para o
    // número da família não ir para o log de acesso; sob `pacientes.ver`, que já lista a base
    Route::post('/pacientes/telefone/conferir', TelefoneEmUsoController::class)
        ->middleware('permission:pacientes.ver');
    Route::get('/pacientes/{id}', [PacienteController::class, 'show'])
        ->middleware('permission:pacientes.ver');
    // resumo agregado read-only p/ o Painel da ficha (sem coluna do menor fora da fonte única)
    Route::get('/pacientes/{id}/resumo', [PacienteController::class, 'resumo'])
        ->middleware('permission:pacientes.ver');
    Route::put('/pacientes/{id}', [PacienteController::class, 'update'])
        ->middleware('permission:pacientes.editar');
    // SITUAÇÃO fora do PUT-inteiro (faxina-de-gatilhos): desativar um PRÉ-CADASTRO errado pelo PUT
    // exigia `nascimento` e `necessidade` — a recepção teria de INVENTAR dado de saúde de um menor
    // para desfazer um erro de digitação. Payload de uma chave, `If-Match` como todo PATCH de
    // edição, gravação por model (a trilha depende dos eventos do Auditavel).
    Route::patch('/pacientes/{id}/situacao', [PacienteController::class, 'situacao'])
        ->whereNumber('id')
        ->middleware('permission:pacientes.editar');

    // mural de tarefas da equipe (change kanban-da-equipe) — módulo interno, SEM
    // dado de paciente (LGPD por minimização). Rotas literais ANTES de
    // `/tarefas/{id}` para `ordem` e `usuarios` não caírem no bind numérico.
    Route::get('/tarefas', [TarefaController::class, 'index'])
        ->middleware('permission:tarefas.ver');
    Route::get('/tarefas/usuarios', [TarefaController::class, 'usuarios'])
        ->middleware('permission:tarefas.ver');
    Route::post('/tarefas', [TarefaController::class, 'store'])
        ->middleware('permission:tarefas.criar');
    // lote de posições do arrasto — exceção If-Match por URI (ver
    // ConcorrenciaOtimistaPorPadraoTest): não há "registro lido" único a versionar
    Route::patch('/tarefas/ordem', [TarefaController::class, 'ordem'])
        ->middleware('permission:tarefas.editar');
    Route::get('/tarefas/{id}', [TarefaController::class, 'show'])
        ->whereNumber('id')
        ->middleware('permission:tarefas.ver');
    Route::patch('/tarefas/{id}', [TarefaController::class, 'update'])
        ->whereNumber('id')
        ->middleware('permission:tarefas.editar');
    Route::delete('/tarefas/{id}', [TarefaController::class, 'destroy'])
        ->whereNumber('id')
        ->middleware('permission:tarefas.excluir');
    // assumir demanda aberta exige só tarefas.ver: participar do mural não é
    // editar o quadro dos outros (spec tarefas)
    Route::post('/tarefas/{id}/assumir', [TarefaController::class, 'assumir'])
        ->whereNumber('id')
        ->middleware('permission:tarefas.ver');
    Route::post('/tarefas/{id}/arquivar', [TarefaController::class, 'arquivar'])
        ->whereNumber('id')
        ->middleware('permission:tarefas.editar');
    Route::post('/tarefas/{id}/desarquivar', [TarefaController::class, 'desarquivar'])
        ->whereNumber('id')
        ->middleware('permission:tarefas.editar');
    // eventos do mural (change alertas-do-mural): marcar lidos é participar do
    // mural = tarefas.ver; cada um só marca os PRÓPRIOS (controller)
    Route::post('/tarefas/eventos/ler-todos', [TarefaController::class, 'lerTodosEventos'])
        ->middleware('permission:tarefas.ver');
    Route::post('/tarefas/{id}/eventos/ler', [TarefaController::class, 'lerEventos'])
        ->whereNumber('id')
        ->middleware('permission:tarefas.ver');
    // comentários: participar do mural = tarefas.ver; autor/moderação no controller
    Route::get('/tarefas/{id}/comentarios', [TarefaComentarioController::class, 'index'])
        ->whereNumber('id')
        ->middleware('permission:tarefas.ver');
    Route::post('/tarefas/{id}/comentarios', [TarefaComentarioController::class, 'store'])
        ->whereNumber('id')
        ->middleware('permission:tarefas.ver');
    Route::patch('/tarefas/comentarios/{id}', [TarefaComentarioController::class, 'update'])
        ->whereNumber('id')
        ->middleware('permission:tarefas.ver');
    Route::delete('/tarefas/comentarios/{id}', [TarefaComentarioController::class, 'destroy'])
        ->whereNumber('id')
        ->middleware('permission:tarefas.ver');

    // caixa de entrada do WhatsApp (mensageria-whatsapp). `mensagens.ver` LÊ;
    // `mensagens.responder` fala com a família e organiza a caixa. Nenhuma delas é
    // derivada de `pacientes.*`/`agenda.*`: a recepção responde sem ler prontuário.
    Route::get('/mensagens/conversas', [ConversaController::class, 'index'])
        ->middleware('permission:mensagens.ver');
    Route::get('/mensagens/conversas/{id}', [ConversaController::class, 'show'])
        ->whereNumber('id')
        ->middleware('permission:mensagens.ver');
    Route::post('/mensagens/conversas/{id}/mensagens', [MensagemController::class, 'store'])
        ->whereNumber('id')
        ->middleware('permission:mensagens.responder');
    Route::post('/mensagens/conversas/{id}/vincular', [ConversaController::class, 'vincular'])
        ->whereNumber('id')
        ->middleware('permission:mensagens.responder');
    Route::post('/mensagens/conversas/{id}/arquivar', [ConversaController::class, 'arquivar'])
        ->whereNumber('id')
        ->middleware('permission:mensagens.responder');
    Route::post('/mensagens/conversas/{id}/desarquivar', [ConversaController::class, 'desarquivar'])
        ->whereNumber('id')
        ->middleware('permission:mensagens.responder');
    Route::post('/mensagens/conversas/{id}/lembretes', [ConversaController::class, 'lembretes'])
        ->whereNumber('id')
        ->middleware('permission:mensagens.responder');
    Route::post('/mensagens/{id}/reenviar', [MensagemController::class, 'reenviar'])
        ->whereNumber('id')
        ->middleware('permission:mensagens.responder');
    Route::get('/mensagens/midias/{id}', [MensagemController::class, 'midia'])
        ->whereNumber('id')
        ->middleware('permission:mensagens.ver');
    // o que o disparo automático fez — a spec de lembretes exige consultável (IMP-7)
    Route::get('/mensagens/lembretes', [LembreteController::class, 'index'])
        ->middleware('permission:mensagens.ver');
    Route::get('/mensagens/templates', [MensagemTemplateController::class, 'index'])
        ->middleware('permission:mensagens.ver');
    Route::post('/mensagens/templates/sincronizar', [MensagemTemplateController::class, 'sincronizar'])
        ->middleware('permission:mensagens.conectar');

    // conexão do WhatsApp (mensageria-whatsapp): permissão PRÓPRIA e de administração —
    // quem a tem passa a poder falar com as famílias em nome da clínica. Nunca sob
    // `configuracoes.editar`: o catálogo de parametrização não carrega segredo de canal.
    Route::get('/mensagens/conexao', [WhatsappConexaoController::class, 'show'])
        ->middleware('permission:mensagens.conectar');
    Route::put('/mensagens/conexao', [WhatsappConexaoController::class, 'update'])
        ->middleware('permission:mensagens.conectar');
    Route::post('/mensagens/conexao/testar', [WhatsappConexaoController::class, 'testar'])
        ->middleware('permission:mensagens.conectar');

    // gestão de usuários — SEM DELETE (design D6: desativação preserva auditoria)
    Route::get('/usuarios', [UsuarioController::class, 'index'])
        ->middleware('permission:usuarios.ver');
    Route::post('/usuarios', [UsuarioController::class, 'store'])
        ->middleware('permission:usuarios.criar');
    // whereNumber (SEC-TRV-01): a régua do FormRequest e o controller acham o MESMO usuário
    Route::get('/usuarios/{id}', [UsuarioController::class, 'show'])
        ->middleware('permission:usuarios.ver')->whereNumber('id');
    Route::put('/usuarios/{id}', [UsuarioController::class, 'update'])
        ->middleware('permission:usuarios.editar')->whereNumber('id');
});
