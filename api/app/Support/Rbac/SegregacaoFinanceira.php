<?php

namespace App\Support\Rbac;

use App\Models\NivelPermissao;
use App\Support\Configuracoes\ConfiguracaoService;
use Illuminate\Validation\ValidationException;

/**
 * Segregação de deveres permissões × financeiro (AP-13 · SEC-SD-05/06).
 *
 * Invariante do NÍVEL, não checagem de runtime: com `seguranca.segregacao_financeira`
 * ligada, um nível não pode combinar a âncora de CONTROLE DE ACESSO (editar/criar/
 * excluir níveis — "controlar permissões" na palavra da clínica inclui mintar e
 * excluir papéis) com escrita dos módulos que MOVEM dinheiro. Leitura (`*.ver`, e as
 * ações de `ACOES_DE_LEITURA`) é sempre livre.
 *
 * A CLASSIFICACAO cobre TODO módulo do catálogo — a guarda de completude
 * (SegregacaoFinanceiraTest) reprova módulo novo sem classificação, e reprova
 * entrada fantasma que não exista no catálogo (lição SEC-SD-05: `faturamento` e
 * `subcategorias` NÃO são prefixos de permissão — faturamento vive sob
 * `lancamentos.criar`, subcategoria sob `categorias.*`).
 */
class SegregacaoFinanceira
{
    public const ANCORAS = [
        'niveis_permissao.editar',
        'niveis_permissao.criar',
        'niveis_permissao.excluir',
    ];

    /**
     * Todo módulo do catálogo, classificado: 'financeiro' move dinheiro; 'fora' não.
     * `fornecedores`/`funcionarios` são FORA por decisão registrada (cadastro de
     * apoio não move caixa; o `lancamentos.criar` que paga a folha está na lista) —
     * pergunta aberta à clínica: "folha conta como financeiro?" (SEC-SD-06).
     *
     * @var array<string, 'financeiro'|'fora'>
     */
    public const CLASSIFICACAO = [
        'agenda' => 'fora',
        'anamnese_modelos' => 'fora',
        // conferir o auto-cadastro é decidir se um dado que veio de fora entra na base: é
        // cadastro, não dinheiro (change cadastro-online-do-paciente)
        'cadastro_online' => 'fora',
        'anamneses' => 'fora',
        'anexos' => 'fora',
        'atendimentos' => 'fora',
        'auditoria' => 'fora',
        'cartoes' => 'financeiro',
        'categorias' => 'financeiro',
        // ciclo de faturamento (fechamento-de-ciclo): FINANCEIRO, e não por mover
        // dinheiro — por ser a alavanca sobre ele. `ciclos.reabrir` DESTRAVA a edição
        // dos lançamentos de um período já enviado à operadora; somada à âncora de
        // controle de acesso, ela deixaria a mesma pessoa mintar o próprio nível e
        // reabrir a produção que ela mesma vai editar. Nenhuma ação é `.ver`, então a
        // classificação vale para as duas.
        'ciclos' => 'financeiro',
        'clinico' => 'fora',
        'configuracoes' => 'fora',
        'contas' => 'financeiro',
        'convenios' => 'fora',
        'equipamentos' => 'fora',
        'especialidades' => 'fora',
        'evolucoes' => 'fora',
        'feriados' => 'fora',
        // agregados do caixa (totais-do-caixa): hoje só `.ver` (leitura sempre livre
        // na segregação); classificado FINANCEIRO fail-closed — uma escrita futura
        // no módulo cairia sob a âncora sem depender de alguém lembrar desta lista
        'fluxo_caixa' => 'financeiro',
        'repasse' => 'financeiro', // recebido por profissional (2026-09-24): dinheiro que cada um recebeu
        'fornecedores' => 'fora',
        'funcionarios' => 'fora',
        'informativos' => 'fora',
        'lancamentos' => 'financeiro',
        'lista_espera' => 'fora',
        'medicos' => 'fora',
        // canal de WhatsApp (mensageria-whatsapp): FORA. A conversa não move caixa —
        // nenhum lançamento nasce dela. Ela CUSTA (a Meta cobra por conversa iniciada),
        // e o custo é contido onde ele acontece: o teto mensal de `whatsapp.limite_mensal`.
        // Confundir "gera despesa" com "move dinheiro" poria metade do sistema aqui.
        'mensagens' => 'fora',
        'niveis_permissao' => 'fora',
        'pacientes' => 'fora',
        'profissionais' => 'fora',
        'salas' => 'fora',
        'servicos' => 'fora',
        'status_agendamento' => 'fora',
        // mural interno da equipe (kanban-da-equipe): não move caixa — como
        // fornecedores/funcionarios, cadastro de apoio operacional
        'tarefas' => 'fora',
        // termo de consentimento (FA-08): governa o TEXTO do contrato terapêutico —
        // documento clínico-administrativo, nenhum dinheiro atravessa
        'termos_consentimento' => 'fora',
        'tipos_pagamento' => 'financeiro',
        'transferencias' => 'financeiro',
        'tratamentos' => 'fora',
        'usuarios' => 'fora',
    ];

    public function __construct(private readonly ConfiguracaoService $configuracoes) {}

    /**
     * As permissões financeiras de ESCRITA que conflitam com a âncora — vazio quando
     * o conjunto não tem âncora, ou não tem escrita financeira.
     *
     * @param  list<string>  $permissoes
     * @return list<string>
     */
    public static function violacoes(array $permissoes): array
    {
        if (array_intersect(self::ANCORAS, $permissoes) === []) {
            return [];
        }

        return array_values(array_filter($permissoes, self::ehEscritaFinanceira(...)));
    }

    /**
     * As AÇÕES que só leem. `ver` sempre foi a única; `ver_proprio` (change painel-do-profissional,
     * D4) é o `ver` do repasse estreitado ao profissional VINCULADO — lê o próprio recebido e não
     * move caixa nenhum.
     *
     * A diferença não é cosmética: tratada como escrita (o que a regra antiga, `!== 'ver'`, fazia
     * com ela), a permissão de LEITURA ficaria proibida a quem gere níveis com a segregação ligada
     * e, pior, sairia do acesso em jogo de `SemEscalada::assegurarDentro` — quem gere níveis a
     * concederia sem tê-la, furando "ninguém concede o que não tem".
     *
     * Lista FECHADA de propósito: ação nova de módulo financeiro nasce ESCRITA (fail-closed) até
     * alguém declarar aqui que ela só lê.
     *
     * @var list<string>
     */
    public const ACOES_DE_LEITURA = ['ver', 'ver_proprio'];

    /** Escrita (não leitura — `ACOES_DE_LEITURA`) de um módulo que MOVE dinheiro. */
    public static function ehEscritaFinanceira(string $permissao): bool
    {
        [$modulo, $acao] = explode('.', $permissao, 2) + [1 => ''];

        return (self::CLASSIFICACAO[$modulo] ?? 'fora') === 'financeiro'
            && ! in_array($acao, self::ACOES_DE_LEITURA, true);
    }

    /**
     * Boundary de criar/editar nível: com a flag ligada, combinação âncora+escrita
     * financeira recusa 422 nomeando o conflito (mensagem estática + a lista).
     *
     * @param  list<string>  $permissoes
     */
    public function garantirNivel(array $permissoes): void
    {
        if (! $this->ligada()) {
            return;
        }

        $violacoes = self::violacoes($permissoes);
        if ($violacoes !== []) {
            throw ValidationException::withMessages([
                'permissoes' => 'A segregação financeira está ligada: quem controla níveis de permissão '
                    .'não pode ter escrita financeira ('.implode(', ', $violacoes).').',
            ]);
        }
    }

    /**
     * Pré-condição de LIGAR a flag: nenhum nível existente pode violar —
     * o Administrador de fábrica viola por construção; a clínica reorganiza antes.
     *
     * @return list<string> nomes dos níveis violadores
     */
    public static function violadoresExistentes(): array
    {
        return NivelPermissao::query()
            ->with('permissions:id,name')
            ->get()
            ->filter(fn (NivelPermissao $nivel): bool => self::violacoes(
                $nivel->permissions->pluck('name')->all(),
            ) !== [])
            ->pluck('name')
            ->values()
            ->all();
    }

    public function ligada(): bool
    {
        return (bool) $this->configuracoes->get('seguranca.segregacao_financeira');
    }
}
