<?php

namespace Database\Seeders\Apresentacao;

use App\Models\Clinica;
use App\Models\NivelPermissao;
use App\Models\Usuario;
use App\Support\Configuracoes\ConfiguracaoService;
use Illuminate\Support\Facades\DB;
use Spatie\Permission\Models\Permission;

/**
 * Os cadastros que a clínica configura uma vez: identidade, especialidades, profissionais
 * com horário, convênios com preço e ciclo, salas, equipamentos, médicos, feriados,
 * equipe administrativa, fornecedores e o plano de contas com as linhas do DRE.
 */
final class Catalogos
{
    /**
     * Cada profissional com a sala e a semana dela. Horário em blocos de 40 min (a
     * granularidade padrão da grade): manhã 08:00–12:00 = 6 sessões; tarde 13:20–18:40 = 8.
     *
     * @var list<array{nome: string, especialidade: string, conselho: string, cbos: string|null, sala: string, turnos: array<int, list<string>>}>
     */
    private const PROFISSIONAIS = [
        ['nome' => 'Mariana Lopes Andrade', 'especialidade' => 'Fonoaudiologia', 'conselho' => 'CRFa', 'cbos' => '223810', 'sala' => 'Sala 1 · Fono',
            'turnos' => [1 => ['manha', 'tarde'], 2 => ['manha', 'tarde'], 3 => ['manha'], 4 => ['manha', 'tarde'], 5 => ['manha']]],
        ['nome' => 'Rafael Teixeira Moura', 'especialidade' => 'Fonoaudiologia', 'conselho' => 'CRFa', 'cbos' => '223810', 'sala' => 'Sala 1 · Fono',
            'turnos' => [3 => ['tarde'], 5 => ['tarde'], 2 => ['noite']]],
        ['nome' => 'Juliana Freitas Barros', 'especialidade' => 'Psicologia', 'conselho' => 'CRP', 'cbos' => '251510', 'sala' => 'Sala 2 · Psicologia',
            'turnos' => [1 => ['tarde'], 2 => ['tarde'], 3 => ['manha', 'tarde'], 4 => ['tarde'], 5 => ['manha']]],
        ['nome' => 'Thiago Ramos Cardoso', 'especialidade' => 'Psicologia', 'conselho' => 'CRP', 'cbos' => '251510', 'sala' => 'Sala 3 · Psicologia',
            'turnos' => [1 => ['manha'], 2 => ['manha'], 4 => ['manha'], 5 => ['tarde']]],
        ['nome' => 'Camila Duarte Pires', 'especialidade' => 'Terapia Ocupacional', 'conselho' => 'CREFITO', 'cbos' => '223905', 'sala' => 'Sala de Integração Sensorial',
            'turnos' => [1 => ['manha', 'tarde'], 2 => ['manha', 'tarde'], 3 => ['manha', 'tarde'], 4 => ['manha'], 5 => ['manha', 'tarde']]],
        ['nome' => 'Patrícia Gomes Siqueira', 'especialidade' => 'Psicopedagogia', 'conselho' => 'ABPp', 'cbos' => null, 'sala' => 'Sala 4 · Aprendizagem',
            'turnos' => [1 => ['tarde'], 3 => ['tarde'], 4 => ['tarde'], 5 => ['tarde']]],
        ['nome' => 'Lucas Monteiro Farias', 'especialidade' => 'Fisioterapia', 'conselho' => 'CREFITO', 'cbos' => '223605', 'sala' => 'Ginásio',
            'turnos' => [1 => ['manha'], 2 => ['tarde'], 3 => ['manha'], 4 => ['tarde'], 5 => ['manha']]],
        ['nome' => 'Fernanda Rocha Vieira', 'especialidade' => 'Neuropsicologia', 'conselho' => 'CRP', 'cbos' => '251510', 'sala' => 'Sala 3 · Psicologia',
            'turnos' => [3 => ['manha'], 4 => ['tarde']]],
        ['nome' => 'Bianca Nogueira Prado', 'especialidade' => 'Musicoterapia', 'conselho' => 'UBAM', 'cbos' => null, 'sala' => 'Sala de Música',
            'turnos' => [2 => ['manha'], 4 => ['manha']]],
    ];

    private const TURNOS = [
        'manha' => ['08:00', '12:00'],
        'tarde' => ['13:20', '18:40'],
        'noite' => ['18:40', '20:40'],
    ];

    /** Nome → [cor, preço particular, preço de tabela dos convênios]. */
    private const ESPECIALIDADES = [
        'Fonoaudiologia' => ['#A85550', 220, 98],
        'Psicologia' => ['#4A6FA5', 200, 92],
        'Terapia Ocupacional' => ['#3E8E7E', 230, 105],
        'Psicopedagogia' => ['#B7793B', 180, 85],
        'Fisioterapia' => ['#5C8A3A', 190, 88],
        'Neuropsicologia' => ['#7A5BA8', 380, 160],
        'Musicoterapia' => ['#C2577F', 200, 90],
    ];

    /** Convênios INVENTADOS — nome, registro ANS fictício, tipo de corte, dia, fator sobre a tabela. */
    private const CONVENIOS = [
        ['Particular', null, null, null, 1.0, true],
        ['Vida Plena Saúde', '412345', 'ultimo_dia', null, 1.0, false],
        ['Sempre Bem Assistência', '398761', 'dia_fixo', 20, 0.92, false],
        ['Cuidar+ Saúde', '421908', 'ultimo_dia', null, 1.08, false],
    ];

    public function __construct(private readonly Contexto $ctx) {}

    public function semear(): void
    {
        $this->identidade();
        $this->status();
        $this->salasEEquipamentos();
        $this->especialidades();
        $this->profissionais();
        $this->convenios();
        $this->medicosEFeriados();
        $this->equipe();
        (new PlanoDeContas($this->ctx))->semear();
    }

    private function identidade(): void
    {
        Clinica::atual()->update(['nome' => Elenco::CLINICA]);
        $configuracoes = app(ConfiguracaoService::class);
        $configuracoes->set('clinica.nome', Elenco::CLINICA);
        $configuracoes->set('clinica.identidade', 'nome');
        $configuracoes->set('clinica.fonte_do_nome', 'serifada');
    }

    private function status(): void
    {
        $this->ctx->status = DB::table('status_agendamento')->pluck('id', 'nome')
            ->map(fn ($id) => (int) $id)->all();
    }

    private function salasEEquipamentos(): void
    {
        $salas = ['Sala 1 · Fono', 'Sala 2 · Psicologia', 'Sala 3 · Psicologia', 'Sala de Integração Sensorial',
            'Sala 4 · Aprendizagem', 'Ginásio', 'Sala de Música', 'Sala de Avaliação'];
        foreach ($salas as $sala) {
            $this->ctx->ids["sala:{$sala}"] = $this->ctx->inserir('salas', [
                'nome' => $sala, 'capacidade' => $sala === 'Ginásio' ? 2 : 1, 'ativo' => true,
            ]);
        }
        foreach ([['Balanço de integração sensorial', 2], ['Kit de avaliação ADOS-2', 1], ['Teclado musical', 1], ['Esteira infantil', 1]] as [$nome, $qtd]) {
            $this->ctx->inserir('equipamentos', ['nome' => $nome, 'quantidade_total' => $qtd]);
        }
    }

    private function especialidades(): void
    {
        foreach (self::ESPECIALIDADES as $nome => [$cor]) {
            $this->ctx->especialidades[$nome] = $this->ctx->inserir('especialidades', [
                'nome' => $nome, 'cor' => $cor, 'tempo_sessao' => 40, 'exige_termo' => true,
                'oculta_agendamento_online' => $nome === 'Neuropsicologia',
            ]);
            $this->ctx->duracoes[$nome] = 40;
        }
    }

    private function profissionais(): void
    {
        $cbos = DB::table('cbos')->pluck('id', 'codigo');
        foreach (self::PROFISSIONAIS as $indice => $dados) {
            $id = $this->ctx->inserir('profissionais', [
                'nome' => $dados['nome'], 'conselho' => $dados['conselho'], 'uf_conselho' => 'SP',
                'num_conselho' => (string) (10000 + $indice * 3791 % 89999),
                'cbos_id' => $dados['cbos'] !== null ? ($cbos[$dados['cbos']] ?? null) : null,
                'atendimentos_simultaneos' => 1, 'mensagens_automaticas' => true, 'ativo' => true,
            ]);
            DB::table('profissional_especialidade')->insert([
                'profissional_id' => $id,
                'especialidade_id' => $this->ctx->especialidades[$dados['especialidade']],
            ]);
            $horarios = [];
            foreach ($dados['turnos'] as $dia => $turnos) {
                foreach ($turnos as $turno) {
                    [$inicio, $fim] = self::TURNOS[$turno];
                    $horarios[$dia][] = [$inicio, $fim];
                    $this->ctx->inserir('profissional_horarios', ['profissional_id' => $id, 'dia_semana' => $dia, 'inicio' => $inicio, 'fim' => $fim]);
                }
            }
            $this->ctx->profissionais[] = [
                'id' => $id, 'nome' => $dados['nome'], 'especialidade' => $dados['especialidade'],
                'sala_id' => $this->ctx->ids["sala:{$dados['sala']}"], 'horarios' => $horarios, 'usuario_id' => null,
            ];
        }
    }

    private function convenios(): void
    {
        foreach (self::CONVENIOS as [$nome, $ans, $corte, $dia, $fator, $particular]) {
            $id = $this->ctx->inserir('convenios', [
                'nome' => $nome, 'registro_ans' => $ans, 'particular' => $particular, 'ativo' => true,
                'ciclo_tipo_corte' => $corte, 'ciclo_dia_corte' => $dia,
                'pedido_validade_meses' => $particular ? null : 6, 'alerta_agend_mesmo_dia' => ! $particular,
            ]);
            $precos = [];
            foreach (self::ESPECIALIDADES as $especialidade => [, $particularPreco, $tabela]) {
                $valor = $particular ? $particularPreco : round($tabela * $fator, 2);
                $servico = $this->ctx->inserir('servicos', [
                    'convenio_id' => $id, 'procedimento' => "Sessão de {$especialidade}", 'valor' => $valor,
                    'codigo_procedimento' => $particular ? null : (string) (50000000 + crc32($especialidade) % 999999),
                ]);
                $precos[$especialidade] = ['servico_id' => $servico, 'valor' => (float) $valor];
            }
            $this->ctx->convenios[$nome] = ['id' => $id, 'particular' => $particular, 'precos' => $precos];
        }
        $this->regrasDeLimite();
    }

    private function regrasDeLimite(): void
    {
        $vida = $this->ctx->convenios['Vida Plena Saúde']['id'];
        $sempre = $this->ctx->convenios['Sempre Bem Assistência']['id'];
        foreach ([
            [$vida, 'Psicologia', 'semana', 2, 'avisar'],
            [$vida, 'Fonoaudiologia', 'mes', 8, 'bloquear'],
            [$sempre, null, 'dia', 1, 'bloquear'],
        ] as [$convenio, $especialidade, $periodo, $limite, $acao]) {
            $especialidadeId = $especialidade !== null ? $this->ctx->especialidades[$especialidade] : null;
            $this->ctx->inserir('regras_limite_convenio', [
                'convenio_id' => $convenio, 'especialidade_id' => $especialidadeId, 'periodo' => $periodo,
                'limite' => $limite, 'acao' => $acao,
            ]);
        }
    }

    private function medicosEFeriados(): void
    {
        $cbos = DB::table('cbos')->pluck('id', 'codigo');
        foreach ([['Dra. Renata Campos Lima', '225124'], ['Dr. Eduardo Martins Rocha', '225112'], ['Dra. Sílvia Batista Moraes', '225124'],
            ['Dr. Henrique Cavalcanti Dias', '225112'], ['Dra. Paula Correia Nunes', '225124']] as $indice => [$nome, $codigo]) {
            $this->ctx->inserir('medicos', ['nome' => $nome, 'conselho' => 'CRM', 'uf_conselho' => 'SP',
                'num_conselho' => (string) (98000 + $indice * 1373), 'cbos_id' => $cbos[$codigo] ?? null]);
        }

        $fixos = ['01-01' => 'Confraternização Universal', '04-21' => 'Tiradentes', '05-01' => 'Dia do Trabalho',
            '09-07' => 'Independência do Brasil', '10-12' => 'Nossa Senhora Aparecida', '11-02' => 'Finados',
            '11-15' => 'Proclamação da República', '11-20' => 'Dia da Consciência Negra', '12-25' => 'Natal',
            '12-08' => 'Nossa Senhora da Conceição (municipal)'];
        foreach ($fixos as $mesDia => $nome) {
            $this->ctx->inserir('feriados', ['nome' => $nome, 'data' => "2025-{$mesDia}", 'recorrente' => true, 'ativo' => true]);
        }
        $moveis = ['2025-03-03' => 'Carnaval', '2025-03-04' => 'Carnaval', '2025-04-18' => 'Sexta-feira Santa', '2025-06-19' => 'Corpus Christi',
            '2026-02-16' => 'Carnaval', '2026-02-17' => 'Carnaval', '2026-04-03' => 'Sexta-feira Santa', '2026-06-04' => 'Corpus Christi',
            '2026-12-24' => 'Véspera de Natal (recesso)', '2026-12-31' => 'Véspera de Ano-Novo (recesso)'];
        foreach ($moveis as $data => $nome) {
            $this->ctx->inserir('feriados', ['nome' => $nome, 'data' => $data, 'recorrente' => false, 'ativo' => true]);
        }

        for ($ano = $this->ctx->inicio->year; $ano <= $this->ctx->fimDaAgenda->year; $ano++) {
            foreach (array_keys($fixos) as $mesDia) {
                $this->ctx->feriados["{$ano}-{$mesDia}"] = true;
            }
        }
        foreach (array_keys($moveis) as $data) {
            $this->ctx->feriados[$data] = true;
        }
    }

    /** Níveis de acesso, os usuários da equipe e os profissionais que entram no sistema. */
    private function equipe(): void
    {
        $todas = Permission::query()->pluck('name')->all();
        $comPrefixo = fn (array $prefixos, array $sem = []) => array_values(array_filter($todas, fn (string $p) => ! in_array($p, $sem, true)
            && collect($prefixos)->contains(fn (string $prefixo) => str_starts_with($p, $prefixo))));

        $niveis = [
            'Recepção' => $comPrefixo(['agenda.', 'pacientes.', 'lista_espera.', 'tratamentos.', 'mensagens.', 'tarefas.', 'feriados.ver',
                'lancamentos.ver', 'lancamentos.criar', 'lancamentos.pagar', 'cadastro_online.', 'anexos.', 'informativos.ver', 'convenios.ver', 'servicos.ver']),
            'Profissional' => $comPrefixo(['agenda.ver', 'pacientes.ver', 'atendimentos.', 'evolucoes.', 'anamneses.', 'tratamentos.ver',
                'repasse.ver_proprio', 'tarefas.', 'informativos.ver', 'anexos.ver'], ['evolucoes.assinar_por_outro']),
            'Financeiro' => $comPrefixo(['lancamentos.', 'contas.', 'cartoes.', 'categorias.', 'fornecedores.', 'funcionarios.', 'transferencias.',
                'fluxo_caixa.', 'tipos_pagamento.', 'repasse.', 'ciclos.', 'convenios.ver', 'servicos.ver', 'tarefas.', 'pacientes.ver', 'tratamentos.ver']),
        ];
        foreach ($niveis as $nome => $permissoes) {
            $nivel = NivelPermissao::create(['name' => $nome, 'guard_name' => 'web']);
            $nivel->givePermissionTo($permissoes);
        }

        $this->ctx->recepcao[] = $this->usuario('Larissa Mendes Costa', 'recepcao@clinica-exemplo.com.br', 'Recepção');
        $this->ctx->recepcao[] = $this->usuario('Bruno Alves Pereira', 'recepcao2@clinica-exemplo.com.br', 'Recepção');
        $this->ctx->ids['usuario:financeiro'] = $this->usuario('Cláudia Ribeiro Santos', 'financeiro@clinica-exemplo.com.br', 'Financeiro');
        foreach ([0, 2, 4] as $indice) {
            $profissional = &$this->ctx->profissionais[$indice];
            $email = strtolower(explode(' ', $profissional['nome'])[0]).'@clinica-exemplo.com.br';
            $profissional['usuario_id'] = $this->usuario($profissional['nome'], $email, 'Profissional', $profissional['id']);
            unset($profissional);
        }
    }

    private function usuario(string $nome, string $email, string $nivel, ?int $profissionalId = null): int
    {
        $usuario = new Usuario(['nome' => $nome, 'email' => $email, 'senha_hash' => 'senha-de-dev-123', 'ativo' => true]);
        $usuario->profissional_id = $profissionalId;
        $usuario->save();
        $usuario->syncRoles([$nivel]);

        return (int) $usuario->id;
    }
}
