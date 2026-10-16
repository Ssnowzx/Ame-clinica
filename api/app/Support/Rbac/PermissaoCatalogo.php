<?php

namespace App\Support\Rbac;

use Spatie\Permission\Models\Permission;
use Spatie\Permission\PermissionRegistrar;

/**
 * Catálogo GLOBAL de permissões no formato "modulo.acao" (design D3).
 *
 * Permissões nunca são criadas/editadas via API (parecer T-rbac-04) — cada change
 * adiciona as suas aqui e garante via seeder idempotente. Roles (níveis) é que são
 * pela clínica e configuráveis pelo cliente.
 */
class PermissaoCatalogo
{
    public const PERMISSOES = [
        // fundações
        'usuarios.ver',
        'usuarios.criar',
        'usuarios.editar',
        'usuarios.excluir',
        'niveis_permissao.ver',
        'niveis_permissao.criar',
        'niveis_permissao.editar',
        'niveis_permissao.excluir',
        'configuracoes.ver',
        'configuracoes.editar',
        'auditoria.ver',
        // cadastros base
        'especialidades.ver',
        'especialidades.criar',
        'especialidades.editar',
        'especialidades.excluir',
        'convenios.ver',
        'convenios.criar',
        'convenios.editar',
        'convenios.excluir',
        'servicos.ver',
        'servicos.criar',
        'servicos.editar',
        'servicos.excluir',
        'salas.ver',
        'salas.criar',
        'salas.editar',
        'salas.excluir',
        'equipamentos.ver',
        'equipamentos.criar',
        'equipamentos.editar',
        'equipamentos.excluir',
        'medicos.ver',
        'medicos.criar',
        'medicos.editar',
        'medicos.excluir',
        'anamnese_modelos.ver',
        'anamnese_modelos.criar',
        'anamnese_modelos.editar',
        'anamnese_modelos.excluir',
        'status_agendamento.ver',
        'status_agendamento.criar',
        'status_agendamento.editar',
        'status_agendamento.excluir',
        // profissionais & pacientes
        'profissionais.ver',
        'profissionais.criar',
        'profissionais.editar',
        'profissionais.excluir',
        'pacientes.ver',
        'pacientes.criar',
        'pacientes.editar',
        // sem pacientes.excluir: exclusão física não existe no v1 (LGPD, design D5)
        // tratamentos
        'tratamentos.ver',
        'tratamentos.criar',
        'tratamentos.editar',
        'tratamentos.excluir',
        // agenda
        'agenda.ver',
        'agenda.criar',
        'agenda.editar',
        'agenda.excluir',
        'feriados.ver',
        'feriados.criar',
        'feriados.editar',
        'feriados.excluir',
        'lista_espera.ver',
        'lista_espera.criar',
        'lista_espera.editar',
        'lista_espera.excluir',
        // atendimento & prontuário (etapa 6) — dado clínico tem módulo PRÓPRIO:
        // leitura nunca herdada de agenda.*/pacientes.* (parecer §4)
        'atendimentos.ver',
        'atendimentos.criar',
        'atendimentos.editar',
        'atendimentos.excluir',
        'evolucoes.ver',
        'evolucoes.criar',
        'evolucoes.editar',
        // exceção de autoria (FA-04 · SEC-AE): assinar evolução EM NOME DE OUTRO
        // profissional — por padrão, só o Administrador de referência a recebe
        'evolucoes.assinar_por_outro',
        // sem evolucoes.excluir: prontuário não tem DELETE no v1 (T-ate-08)
        'anamneses.ver',
        'anamneses.criar',
        'anamneses.editar',
        // sem anamneses.excluir: idem (T-ate-11)
        // financeiro (etapa 7) — dinheiro tem módulos PRÓPRIOS: nada herdado de
        // agenda.*/pacientes.*/atendimentos.* (parecer §3)
        'contas.ver',
        'contas.criar',
        'contas.editar',
        'contas.excluir',
        'cartoes.ver',
        'cartoes.criar',
        'cartoes.editar',
        'cartoes.excluir',
        'tipos_pagamento.ver',
        'tipos_pagamento.criar',
        'tipos_pagamento.editar',
        'tipos_pagamento.excluir',
        'categorias.ver',
        'categorias.criar',
        'categorias.editar',
        'categorias.excluir',
        'fornecedores.ver',
        'fornecedores.criar',
        'fornecedores.editar',
        'fornecedores.excluir',
        'funcionarios.ver',
        'funcionarios.criar',
        'funcionarios.editar',
        'funcionarios.excluir',
        'lancamentos.ver',
        'lancamentos.criar', // inclui o faturamento — NUNCA agenda.editar (parecer §3)
        'lancamentos.editar',
        'lancamentos.excluir', // só de NÃO-pago; pago não tem célula (T-fin-09)
        'lancamentos.pagar', // pagar E estornar pagamento — permissão própria (T-fin-07)
        // agregados financeiros da CLÍNICA (change totais-do-caixa, D1 — decisão da
        // clínica 2026-07-19, perguntas 9-10): extrato com totais, série financeira
        // dos indicadores e relatório financeiro por período. DISTINTA de
        // lancamentos.ver — quem opera lançamento a lançamento não vê o total.
        'fluxo_caixa.ver',
        // repasse ao profissional (change recebido-por-profissional, 2026-09-24): o que CADA
        // profissional recebeu — o fechamento que a faturista monta e passa ao administrador
        // (decisão da clínica 2026-07-19, perguntas 9-10). Sem `fluxo_caixa.ver`, um
        // profissional por vez: o total da clínica continua só de quem vê o fluxo de caixa.
        // É o primeiro pedaço do módulo de repasse (Fase 2), não uma permissão de relatório.
        'repasse.ver',
        // o PRÓPRIO recebido (change painel-do-profissional, D4): quem está VINCULADO a um
        // profissional vê, na ficha dele, o que entrou no caixa pelos atendimentos DELE — e de
        // mais ninguém. Não é recorte do `Escopo` (que `agenda.ver_todos` alarga para a clínica
        // inteira): é IGUALDADE com o vínculo, decidida no servidor; sem vínculo, não abre nada.
        // Não abre o relatório "Recebido por profissional" nem a lista de lançamentos — esses
        // continuam sob `repasse.ver` + `lancamentos.ver`. É LEITURA: a segregação financeira a
        // trata como `ver` (`SegregacaoFinanceira::ACOES_DE_LEITURA`).
        'repasse.ver_proprio',
        // ciclo de faturamento por convênio (change fechamento-de-ciclo): fechar o
        // período e listar os fechamentos. Quem fecha é o faturamento.
        'ciclos.fechar',
        // exceção (SEC-FC-01 · molde `evolucoes.assinar_por_outro`): REABRIR um período
        // fechado destrava produção que já foi enviada à operadora — por padrão, só o
        // Administrador de referência a recebe, e o gate vive no authorize() do
        // FormRequest para o 403 vencer o 422
        'ciclos.reabrir',
        'transferencias.ver',
        'transferencias.criar',
        'transferencias.editar',
        'transferencias.excluir',
        // notificações & relatórios (etapa 8) — o centro e os relatórios são
        // VISTAS: herdam a permissão do módulo dono, nunca criam acesso novo
        // (T-not-01/13); só informativos têm módulo próprio
        'informativos.ver',
        'informativos.criar',
        'informativos.editar',
        'informativos.excluir',
        // anexos do paciente (change anexos-do-paciente) — documento de MENOR,
        // potencialmente laudo: `anexos.ver` é grant de art. 11 em massa
        // (SEC-AX-03/11 — 1º read de art. 11 sem escopo clínico; inventário ENUM);
        // sem `anexos.editar`: anexo se substitui, não se edita
        'anexos.ver',
        'anexos.criar',
        'anexos.excluir',
        // escopo por vínculo profissional (D11, parecer SEC-VP-01) — flags ADITIVAS: o papel que
        // as TEM enxerga/muta a agenda/clínica inteira; o papel que NÃO as tem (com usuário
        // vinculado) fica ESCOPADO ao próprio profissional. Aditivas (não restrição) porque o
        // Administrador nasce com Permission::all() e ficaria restrito com uma flag de restrição.
        'agenda.ver_todos',
        'clinico.ver_todos',
        // termo de consentimento versionado (change aceite-do-regulamento, FA-08) — módulo
        // ADMINISTRATIVO: governa o TEXTO do contrato, nunca o aceite de um paciente.
        // Registrar aceite continua sob `pacientes.editar`, e o catálogo não diz QUEM
        // aceitou (design D8 — só a contagem), para não criar superfície nova de nomes
        // de menores sob permissão de administração (inventário ENUM).
        'termos_consentimento.ver',
        'termos_consentimento.criar',
        'termos_consentimento.editar',
        'termos_consentimento.excluir',
        // mural de tarefas da equipe (change kanban-da-equipe) — módulo INTERNO,
        // sem dado de paciente (LGPD: tarefa não vincula paciente no v1).
        // `tarefas.excluir` também modera comentário de terceiro (excluir, nunca
        // editar — spec tarefas); "assumir" exige só `tarefas.ver`.
        'tarefas.ver',
        'tarefas.criar',
        'tarefas.editar',
        'tarefas.excluir',
        // canal de WhatsApp (change mensageria-whatsapp) — módulo PRÓPRIO: a recepção
        // responde a família sem por isso ler prontuário, e ninguém ganha o canal de
        // brinde junto com `pacientes.ver`/`agenda.ver`.
        'mensagens.ver',
        'mensagens.responder',
        // `conectar` é gesto de ADMINISTRADOR: quem a tem passa a poder falar com as
        // famílias em nome da clínica, e guarda a credencial da Meta. DELIBERADAMENTE
        // separada de `configuracoes.editar` — o catálogo de parametrização não carrega
        // segredo de canal (spec rbac).
        'mensagens.conectar',
        /*
         * AUTO-CADASTRO PÚBLICO (change cadastro-online-do-paciente) — módulo PRÓPRIO, e a
         * separação é o ponto: conferir é decidir se um dado que veio DE FORA entra na base, e
         * quem faz isso não é necessariamente quem cadastra no balcão.
         *
         * `conferir` NÃO é implicada por `pacientes.ver`/`pacientes.criar`, e a recíproca também
         * vale — ela não implica ver nem criar paciente. A fila mostra, lado a lado, o envio e os
         * pacientes PARECIDOS que já existem; ler esse bloco é ler nome de criança que já é
         * paciente, e por isso ele exige `pacientes.ver` JUNTO. Sem essa exigência, bastaria
         * enviar pelo formulário público o CPF de quem se suspeita ser paciente e abrir a fila
         * para ler o nome — o oráculo que a resposta cega fecha por fora, reaberto por dentro
         * (parecer pré-código, ameaça A4).
         */
        'cadastro_online.conferir',
    ];

    /** Idempotente: garante que todo o catálogo existe (uso em seeder e observer). */
    public static function garantir(): void
    {
        foreach (self::PERMISSOES as $nome) {
            Permission::findOrCreate($nome, 'web');
        }

        app(PermissionRegistrar::class)->forgetCachedPermissions();
    }
}
