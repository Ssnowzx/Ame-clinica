<?php

namespace Database\Seeders;

use App\Models\Agendamento;
use App\Models\CampoCadastro;
use App\Models\Convenio;
use App\Models\Especialidade;
use App\Models\ListaEspera;
use App\Models\Paciente;
use App\Models\Profissional;
use App\Models\Servico;
use App\Models\StatusAgendamento;
use App\Models\Tarefa;
use App\Models\TarefaComentario;
use App\Models\TermoConsentimento;
use App\Models\Tratamento;
use App\Models\Usuario;
use App\Support\CamposCadastro\ReguaDoCadastro;
use App\Support\Configuracoes\ConfiguracaoService;
use Carbon\CarbonImmutable;
use Illuminate\Database\Seeder;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * A clínica de demonstração — **100% fictícia** (LGPD: nunca dado real de MENOR).
 *
 * Existe porque a demo NÃO existia como código: os profissionais, as crianças e a agenda
 * tinham sido criados à mão numa sessão, viviam só no banco local, e **um `migrate:fresh`
 * os levou embora sem volta**. Demo que não é reproduzível não é demo — é um bibelô.
 *
 * Semeia uma janela ANCORADA EM HOJE (a agenda vazia não demonstra nada): passado com sessões
 * finalizadas e faltas — que consomem saldo de verdade —, hoje e futuro em aberto.
 *
 * Idempotente: rodar duas vezes não duplica nada.
 *
 *     php artisan db:seed --class=DemoSeeder
 */
class DemoSeeder extends Seeder
{
    private ConfiguracaoService $configuracoes;

    /**
     * HOJE — na PAREDE DA CLÍNICA, não no relógio da máquina.
     *
     * `config('app.timezone')` é **UTC**. Usá-lo semeava a agenda em 12/07 enquanto a clínica
     * (America/Sao_Paulo) ainda estava em 11/07: a tela abre no dia corrente e **não achava
     * nada**. É a mesma regra que o produto inteiro obedece (§13) — o fuso é DADO da clínica, e
     * o relógio da máquina não é o da clínica.
     */
    private function hojeNaClinica(): CarbonImmutable
    {
        return CarbonImmutable::now($this->configuracoes->get('clinica.timezone'))->startOfDay();
    }

    public function run(): void
    {
        // dado fictício não entra em banco de clínica real (SEC-R2-02): em produção a base
        // é a clínica de verdade. Falha ALTO
        // (exit ≠ 0), nunca sucesso silencioso — deploy automatizado precisa perceber
        if (app()->isProduction()) {
            throw new \RuntimeException('DemoSeeder não roda em produção.');
        }

        $this->configuracoes = app(ConfiguracaoService::class);

        // A GRADE tem uma granularidade (40 min por padrão). Sessão que NÃO é múltiplo dela
        // ocupa `ceil(duração / granularidade)` slots — uma sessão de 50 min numa grade de 40
        // vira um card de 80 min, com um vão em branco embaixo. Isso está CERTO (senão o slot
        // seguinte pareceria livre com a criança ainda na sala), mas é dado de demo ruim:
        // numa clínica de verdade as durações batem com a grade. Por isso todas as sessões
        // daqui são múltiplos da granularidade.
        $passo = max(5, (int) $this->configuracoes->get('agenda.granularidade_min'));

        $convenio = Convenio::firstOrCreate(['nome' => 'Unimed Fictícia'], ['ativo' => true]);
        Convenio::firstOrCreate(['nome' => 'Particular Fictício'], ['particular' => true, 'ativo' => true]);

        $especialidades = collect([
            ['nome' => 'Fonoaudiologia', 'cor' => '#A85550', 'slots' => 1],
            ['nome' => 'Psicologia', 'cor' => '#4A6FA5', 'slots' => 1],
            ['nome' => 'Terapia Ocupacional', 'cor' => '#3E8E7E', 'slots' => 1],
            ['nome' => 'Psicopedagogia', 'cor' => '#B7793B', 'slots' => 1],
            // a sessão LONGA da clínica — dois slots, para a demo mostrar que a grade sabe
            // ocupar mais de uma faixa sem deixar a seguinte parecer livre
            ['nome' => 'Musicoterapia', 'cor' => '#7A5BA8', 'slots' => 2],
        ])->mapWithKeys(fn (array $dados) => [
            $dados['nome'] => Especialidade::firstOrCreate(
                ['nome' => $dados['nome']],
                [
                    'cor' => $dados['cor'],
                    'tempo_sessao' => $dados['slots'] * $passo,
                    // FA-08: a clínica decidiu contrato terapêutico para TODOS, antes de
                    // iniciar — o gatilho fica ligado em toda especialidade (no go-live é
                    // dado, aqui é a demo mostrando a fila de termos pendentes funcionando)
                    'exige_termo' => true,
                ],
            ),
        ]);

        // `firstOrCreate` só aplica o 2º array na CRIAÇÃO: numa demo já semeada, o
        // `exige_termo` continuaria desligado e o fluxo da change não apareceria (achado
        // do gate). A demo LIGA sempre — é o estado que o FA-08 define para o go-live.
        Especialidade::query()->update(['exige_termo' => true]);

        // O TERMO da demo — texto FICTÍCIO e curto. O Regulamento REAL da clínica é dado de
        // go-live: a administradora o publica em `/termos`, e ele nunca entra em código
        // versionado (é documento dela, não do repositório).
        //
        // Nenhum aceite semeado, de propósito: a fila de "termos pendentes" existe para
        // mostrar quem falta assinar, e uma demo com todo mundo em dia esconderia o fluxo.
        if (TermoConsentimento::query()->count() === 0) {
            $termo = new TermoConsentimento;
            $termo->fill([
                'titulo' => 'Regulamento dos Atendimentos (exemplo)',
                'texto' => "Texto fictício de demonstração.\n\n"
                    ."1. As sessões acontecem 1 a 2 vezes por semana, conforme o plano terapêutico.\n"
                    ."2. Há tolerância de 10 minutos de atraso.\n"
                    ."3. Desmarcações com menos de 24 horas de antecedência são cobradas.\n"
                    .'4. Três faltas consecutivas sem aviso encerram o acompanhamento.',
            ]);
            $termo->versao = 1;
            $termo->vigente = true;
            $termo->save();
        }

        // `janela_inicio`/`janela_fim` aqui servem SÓ para posicionar os agendamentos da demo
        // (janela contígua de placement). A disponibilidade REAL é `horarios` (por dia, com turno
        // partido no Bruno) — as linhas de `profissional_horarios`. Para o Bruno, o placement fica
        // na TARDE, deixando a manhã disponível-vazia e o almoço (12–14) indisponível na grade.
        $profissionais = collect([
            ['nome' => 'Ana Fictícia Souza', 'especialidade' => 'Fonoaudiologia', 'janela_inicio' => '08:00', 'janela_fim' => '12:00', 'obs' => 'Atende só pela manhã',
                'horarios' => [1 => [['08:00', '12:00']], 2 => [['08:00', '12:00']], 3 => [['08:00', '12:00']], 4 => [['08:00', '12:00']], 5 => [['08:00', '12:00']]]],
            ['nome' => 'Bruno Fictício Lima', 'especialidade' => 'Psicologia', 'janela_inicio' => '14:00', 'janela_fim' => '18:00', 'obs' => 'Manhã e tarde, almoço 12–14',
                'horarios' => [1 => [['08:00', '12:00'], ['14:00', '18:00']], 2 => [['08:00', '12:00'], ['14:00', '18:00']], 3 => [['08:00', '12:00'], ['14:00', '18:00']], 4 => [['08:00', '12:00'], ['14:00', '18:00']], 5 => [['08:00', '12:00'], ['14:00', '18:00']]]],
            ['nome' => 'Carla Fictícia Nunes', 'especialidade' => 'Terapia Ocupacional', 'janela_inicio' => '09:00', 'janela_fim' => '19:00', 'obs' => 'Supervisão às sextas',
                'horarios' => [1 => [['09:00', '19:00']], 2 => [['09:00', '19:00']], 3 => [['09:00', '19:00']], 4 => [['09:00', '19:00']], 5 => [['09:00', '19:00']]]],
            ['nome' => 'Diego Fictício Alves', 'especialidade' => 'Psicopedagogia', 'janela_inicio' => '13:00', 'janela_fim' => '19:00', 'obs' => 'Tarde',
                'horarios' => [1 => [['13:00', '19:00']], 2 => [['13:00', '19:00']], 3 => [['13:00', '19:00']], 4 => [['13:00', '19:00']], 5 => [['13:00', '19:00']]]],
            ['nome' => 'Elisa Fictícia Prado', 'especialidade' => 'Musicoterapia', 'janela_inicio' => '08:00', 'janela_fim' => '17:00', 'obs' => null,
                'horarios' => [1 => [['08:00', '17:00']], 2 => [['08:00', '17:00']], 3 => [['08:00', '17:00']], 4 => [['08:00', '17:00']], 5 => [['08:00', '17:00']]]],
        ])->map(function (array $dados) use ($especialidades) {
            $profissional = Profissional::firstOrCreate(['nome' => $dados['nome']], [
                'obs' => $dados['obs'],
                'ativo' => true,
            ]);
            if ($profissional->horarios()->doesntExist()) {
                foreach ($dados['horarios'] as $dia => $intervalos) {
                    foreach ($intervalos as [$inicio, $fim]) {
                        $profissional->horarios()->create(['dia_semana' => $dia, 'inicio' => $inicio, 'fim' => $fim]);
                    }
                }
            }
            $especialidade = $especialidades[$dados['especialidade']];
            $vinculado = DB::table('profissional_especialidade')
                ->where('profissional_id', $profissional->id)
                ->where('especialidade_id', $especialidade->id)
                ->exists();
            if (! $vinculado) {
                DB::table('profissional_especialidade')->insert([
                    'profissional_id' => $profissional->id,
                    'especialidade_id' => $especialidade->id,
                ]);
            }

            // o spread vem PRIMEIRO: depois dele, `especialidade` voltaria a ser a string
            return [...$dados, 'modelo' => $profissional, 'especialidade' => $especialidade];
        });

        foreach ($especialidades as $especialidade) {
            $existe = Servico::where('convenio_id', $convenio->id)
                ->where('procedimento', "Sessão de {$especialidade->nome}")
                ->exists();
            if (! $existe) {
                $servico = new Servico(['procedimento' => "Sessão de {$especialidade->nome}", 'valor' => 150]);
                $servico->convenio_id = $convenio->id;
                $servico->save();
            }
        }

        // As CRIANÇAS — nomes e nascimentos fictícios. Duas por especialidade, mais duas que
        // fazem DUAS terapias (o caso real: a criança que vem duas vezes por semana).
        $nomes = [
            ['Paciente Fictício Ivana', '2018-03-14', 'feminino'],
            ['Paciente Fictício Giovana', '2017-09-02', 'feminino'],
            ['Paciente Fictício Késia', '2019-01-27', 'feminino'],
            ['Paciente Fictício Heitor', '2016-11-08', 'masculino'],
            ['Paciente Fictício Noah', '2020-06-19', 'masculino'],
            ['Paciente Fictício Lorena', '2018-08-30', 'feminino'],
            ['Paciente Fictício Bento', '2019-05-11', 'masculino'],
            ['Paciente Fictício Alice', '2017-02-23', 'feminino'],
            ['Paciente Fictício Théo', '2020-10-05', 'masculino'],
            ['Paciente Fictício Manuela', '2016-07-17', 'feminino'],
            ['Paciente Fictício Arthur', '2019-12-01', 'masculino'],
            ['Paciente Fictício Cecília', '2018-04-26', 'feminino'],
        ];

        $criancas = collect($nomes)->map(fn (array $dados) => Paciente::firstWhere('nome', $dados[0])
            // a FACTORY conhece os campos obrigatórios (responsáveis, contatos, endereço) e os
            // preenche com Faker — nada aqui é dado real de criança nenhuma
            ?? Paciente::factory()->create([
                'nome' => $dados[0],
                'nascimento' => $dados[1],
                'sexo' => $dados[2],
                'ativo' => true,
            ]));

        // Um TRATAMENTO por criança em cada especialidade que ela faz. A lista abaixo é o
        // "quem faz o quê" da clínica fictícia — as duas últimas fazem duas terapias.
        $agendaDaSemana = [
            // [índice da criança, nome da especialidade]
            [0, 'Fonoaudiologia'], [1, 'Fonoaudiologia'],
            [2, 'Psicologia'], [3, 'Psicologia'],
            [4, 'Terapia Ocupacional'], [5, 'Terapia Ocupacional'],
            [6, 'Psicopedagogia'], [7, 'Psicopedagogia'],
            [8, 'Musicoterapia'], [9, 'Musicoterapia'],
            [10, 'Fonoaudiologia'], [10, 'Psicologia'],
            [11, 'Terapia Ocupacional'], [11, 'Psicopedagogia'],
        ];

        $porEspecialidade = $profissionais->keyBy(fn (array $p) => $p['especialidade']->nome);

        $tratamentos = collect($agendaDaSemana)->map(function (array $par) use ($criancas, $especialidades, $porEspecialidade, $convenio) {
            [$indice, $nomeDaEspecialidade] = $par;
            $crianca = $criancas[$indice];
            $especialidade = $especialidades[$nomeDaEspecialidade];
            $profissional = $porEspecialidade[$nomeDaEspecialidade]['modelo'];
            $servico = Servico::where('convenio_id', $convenio->id)
                ->where('procedimento', "Sessão de {$especialidade->nome}")
                ->first();

            $tratamento = Tratamento::firstOrCreate(
                ['paciente_id' => $crianca->id, 'especialidade_id' => $especialidade->id],
                [
                    'convenio_id' => $convenio->id,
                    'profissional_id' => $profissional->id,
                    'servico_id' => $servico?->id,
                    'sessoes_total' => 20,
                    'data_inicio' => $this->hojeNaClinica()->subMonth()->toDateString(),
                    'validade_dias' => 180,
                    'status' => 'andamento',
                ]
            );

            return [
                'tratamento' => $tratamento,
                'paciente' => $crianca,
                'especialidade' => $especialidade,
                'profissional' => $profissional,
            ];
        });

        $criados = $this->semearAgenda($tratamentos, $profissionais, $passo);
        // ANTES da cura, de propósito: a sessão passada da criança esquecida também é uma
        // sessão finalizada, e a régua canônica da produção (T-not-15) exige `atendimentos`
        // para todas elas. Semear depois deixava a demo violando a própria invariante — e a
        // `SeedTest` pegou. O relato ao usuário sai lá embaixo, junto do resto.
        $pendentes = $this->semearPendenciaDeRetorno($especialidades, $porEspecialidade, $convenio);
        $curados = $this->curarProducaoPassada();
        $tarefas = $this->semearMural();
        $naFila = $this->semearFilaDeEspera($especialidades, $porEspecialidade, $criancas);
        $naRegua = $this->semearReguaDoCadastro();

        $this->command?->info("Demo fictícia pronta na parede da clínica ({$this->hojeNaClinica()->toDateString()}):");
        $this->command?->info("  {$criancas->count()} crianças · {$profissionais->count()} profissionais · {$tratamentos->count()} tratamentos");
        $this->command?->info("  {$criados} agendamentos (passado consumido, HOJE e futuro em aberto)");
        $this->command?->info("  {$curados} atendimentos criados para sessões finalizadas sem registro");
        $this->command?->info("  {$pendentes} criança em pendência de retorno (45 dias sem agendamento)");
        $this->command?->info("  {$tarefas} tarefas no mural da equipe (demanda aberta, menção não lida, atrasada e arquivada)");
        $this->command?->info("  {$naFila} na fila de espera (urgente sem profissional, alta e normal — para demonstrar o encaixe)");
        $this->command?->info("  {$naRegua} campos com régua própria (sexo opcional, cidade obrigatória — como a clínica opera hoje)");
    }

    /**
     * A RÉGUA DO CADASTRO da demo (change campos-do-cadastro-configuraveis).
     *
     * Com a régua toda no padrão, a tela de configuração abre mostrando dezenove campos
     * idênticos e o cadastro fica igual ao de antes — a feature não demonstra nada.
     *
     * Os dois overrides são os que a clínica de fato tem hoje no sistema antigo (leitura da
     * tela `/pacientes/novo/configurar` em 2026-08-25): `sexo` OPCIONAL e `cidade`
     * OBRIGATÓRIA. É exatamente o par invertido em relação ao que o xiax exigia antes desta
     * change, então a demo mostra a régua fazendo diferença nos dois sentidos — um campo
     * que deixou de ser cobrado e um que passou a ser.
     *
     * Nenhum dado de paciente aqui: régua é regra da clínica.
     */
    private function semearReguaDoCadastro(): int
    {
        if (CampoCadastro::query()->exists()) {
            return CampoCadastro::query()->count(); // idempotente: régua já semeada
        }

        $regua = app(ReguaDoCadastro::class);
        $regua->gravar('sexo', ['obrigatorio' => false]);
        $regua->gravar('endereco_cidade', ['obrigatorio' => true]);

        return 2;
    }

    /**
     * O mural de tarefas da equipe (change kanban-da-equipe) — TODO fictício e
     * SEM paciente por construção (a tarefa não vincula paciente; LGPD por
     * minimização). Cobre o que a demo precisa mostrar: as quatro colunas, uma
     * demanda ABERTA (o botão Assumir), uma ATRASADA em Aguardando, uma menção
     * NÃO LIDA (bloco do centro) e uma arquivada (a porta do Desarquivar).
     */
    private function semearMural(): int
    {
        if (Tarefa::query()->exists()) {
            return Tarefa::query()->count(); // idempotente: mural já semeado
        }

        $admin = Usuario::where('email', 'admin@clinica-exemplo.com.br')->first()
            ?? Usuario::query()->firstOrFail();

        $recepcao = Usuario::firstOrCreate(
            ['email' => 'recepcao@clinica-exemplo.com.br'],
            ['nome' => 'Recepção Fictícia', 'senha_hash' => 'senha-de-dev-123', 'ativo' => true],
        );

        $hoje = $this->hojeNaClinica();
        $cartoes = [
            ['titulo' => 'Comprar papel A4 para a recepção', 'coluna' => 'a_fazer', 'posicao' => 0,
                'prioridade' => 'media', 'etiquetas' => 'compras', 'responsaveis' => []],
            ['titulo' => 'Ligar para o fornecedor de brinquedos sensoriais', 'coluna' => 'a_fazer',
                'posicao' => 1, 'prioridade' => 'alta', 'prazo' => $hoje->addDays(3)->toDateString(),
                'etiquetas' => 'compras, fornecedor', 'responsaveis' => [$admin->id]],
            ['titulo' => 'Organizar a sala de espera para agosto', 'coluna' => 'em_andamento',
                'posicao' => 0, 'prioridade' => 'media', 'etiquetas' => 'recepção',
                'responsaveis' => [$recepcao->id]],
            ['titulo' => 'Aguardando retorno da Unimed Fictícia sobre o reajuste',
                'coluna' => 'aguardando', 'posicao' => 0, 'prioridade' => 'urgente',
                'prazo' => $hoje->subDays(2)->toDateString(), 'etiquetas' => 'convênio',
                'responsaveis' => [$admin->id]],
            ['titulo' => 'Testar a campainha da sala 2', 'coluna' => 'concluida', 'posicao' => 0,
                'prioridade' => 'baixa', 'responsaveis' => [$recepcao->id], 'concluida' => true],
            ['titulo' => 'Imprimir os crachás novos', 'coluna' => 'concluida', 'posicao' => 1,
                'prioridade' => 'baixa', 'responsaveis' => [], 'concluida' => true,
                'arquivada' => true],
        ];

        foreach ($cartoes as $dados) {
            $tarefa = new Tarefa([
                'titulo' => $dados['titulo'],
                'coluna' => $dados['coluna'],
                'prioridade' => $dados['prioridade'],
                'prazo' => $dados['prazo'] ?? null,
                'etiquetas' => $dados['etiquetas'] ?? null,
            ]);
            $tarefa->posicao = $dados['posicao'];
            $tarefa->criado_por = $admin->id;
            if ($dados['concluida'] ?? false) {
                $tarefa->concluida_em = $hoje->subDay()->setTime(17, 0);
            }
            if ($dados['arquivada'] ?? false) {
                $tarefa->arquivada_em = $hoje->setTime(8, 0);
            }
            $tarefa->save();

            $tarefa->responsaveis()->sync($dados['responsaveis']);

            // a conversa com MENÇÃO não lida: alimenta o bloco do centro na demo
            if ($dados['coluna'] === 'em_andamento') {
                $comentario = new TarefaComentario([
                    'corpo' => "Combinei com a @{$recepcao->nome} de adiantar isso antes da virada.",
                ]);
                $comentario->tarefa_id = $tarefa->id;
                $comentario->autor_id = $admin->id;
                $comentario->save();
                $comentario->mencionados()->sync([$recepcao->id]);
            }
        }

        return count($cartoes);
    }

    /**
     * A semana inteira: segunda a sexta, cada profissional preenchendo a própria janela.
     *
     * O passado ganha status que CONSOME sessão (e o consumo é escrito à mão, com o marcador
     * `sessao_consumida_em` e o saldo do tratamento — a reconciliação real mora no serviço da
     * agenda, e o seeder não passa por ele).
     *
     * @param  Collection<int, array{tratamento: Tratamento, paciente: Paciente, especialidade: Especialidade, profissional: Profissional}>  $tratamentos
     * @param  Collection<int, array{modelo: Profissional, especialidade: Especialidade, janela_inicio: string, janela_fim: string, horarios: array<int, list<array{0: string, 1: string}>>}>  $profissionais
     */
    private function semearAgenda($tratamentos, $profissionais, int $passo): int
    {
        $emAberto = StatusAgendamento::where('nome', 'Em Aberto')->firstOrFail();
        $finalizado = StatusAgendamento::where('nome', 'Finalizado')->firstOrFail();
        $naoCompareceu = StatusAgendamento::where('nome', 'Não Compareceu')->firstOrFail();
        $desmarcado = StatusAgendamento::where('nome', 'Desmarcado pelo Profissional')->firstOrFail();

        $hoje = $this->hojeNaClinica();
        $criados = 0;

        // A janela é ANCORADA EM HOJE, não na segunda-feira: a agenda abre no dia corrente,
        // e semear "a semana útil" deixava a tela VAZIA quando hoje caía num fim de semana
        // (aconteceu — era sábado). **Hoje entra sempre**, dia útil ou não; os demais dias
        // só entram se forem úteis, que é quando a clínica de fato atende.
        foreach (range(-4, 7) as $deslocamento) {
            $dia = $hoje->addDays($deslocamento);
            $ehHoje = $deslocamento === 0;

            if (! $ehHoje && $dia->isWeekend()) {
                continue;
            }

            $passado = $dia->lt($hoje);

            foreach ($profissionais as $profissional) {
                $doProfissional = $tratamentos
                    ->filter(fn (array $t) => $t['profissional']->id === $profissional['modelo']->id)
                    ->values();

                if ($doProfissional->isEmpty()) {
                    continue;
                }

                $duracao = (int) $profissional['especialidade']->tempo_sessao;
                [$hi, $mi] = array_map('intval', explode(':', substr($profissional['janela_inicio'], 0, 5)));
                [$hf, $mf] = array_map('intval', explode(':', substr($profissional['janela_fim'], 0, 5)));
                $inicioMin = $hi * 60 + $mi;
                $fimMin = $hf * 60 + $mf;

                $indice = 0;
                for ($minuto = $inicioMin; $minuto + $duracao <= $fimMin; $minuto += $duracao) {
                    // buraco de propósito: agenda cheia demais não parece clínica, parece
                    // planilha — e a recepção precisa de horário livre para marcar na demo
                    if (($minuto / $passo) % 3 === 2) {
                        continue;
                    }

                    $item = $doProfissional[$indice % $doProfissional->count()];
                    $indice++;

                    $inicio = $dia->addMinutes($minuto);
                    $fim = $inicio->addMinutes($duracao);

                    $jaExiste = Agendamento::where('profissional_id', $profissional['modelo']->id)
                        ->where('inicio', $inicio->format('Y-m-d H:i:s'))
                        ->exists();
                    if ($jaExiste) {
                        continue;
                    }

                    // o passado tem desfecho; hoje e o futuro estão em aberto
                    $status = $emAberto;
                    if ($passado) {
                        $status = match ($indice % 5) {
                            0 => $naoCompareceu,   // falta que DESCONTA (regra da clínica)
                            4 => $desmarcado,      // não ocupa horário, não desconta
                            default => $finalizado,
                        };
                    }

                    $agendamento = new Agendamento([
                        'tipo' => 'atendimento',
                        'paciente_id' => $item['paciente']->id,
                        'profissional_id' => $profissional['modelo']->id,
                        'especialidade_id' => $item['especialidade']->id,
                        'tratamento_id' => $item['tratamento']->id,
                        'status_id' => $status->id,
                        'inicio' => $inicio->format('Y-m-d H:i:s'),
                        'fim' => $fim->format('Y-m-d H:i:s'),
                    ]);
                    $agendamento->save();
                    $criados++;

                    // CONSUMO à mão: o seeder não passa pelo AgendamentoService, então o
                    // marcador e o saldo do tratamento seriam mentira se ficassem sem escrita
                    if ($status->desconta_sessao) {
                        $agendamento->forceFill(['sessao_consumida_em' => $inicio->format('Y-m-d H:i:s')])->save();
                        $tratamento = $item['tratamento'];
                        if ($tratamento->sessoes_realizadas < $tratamento->sessoes_total) {
                            $tratamento->forceFill([
                                'sessoes_realizadas' => $tratamento->sessoes_realizadas + 1,
                            ])->save();
                        }
                    }
                }
            }
        }

        return $criados;
    }

    /**
     * A régua canônica da produção (T-not-15): sessão que ACONTECEU tem linha em
     * `atendimentos` — o indicador de atendimentos conta `finalizado_em`, nunca status.
     * "Aconteceu", pela §13, é FLAG e não nome: `desconta_sessao` sem `marca_falta`
     * (a falta desconta saldo por regra da clínica, mas não houve sessão). Sem este
     * passe o seeder marcava "Finalizado" e o dashboard respondia "nenhum atendimento
     * no mês" — status e produção contando histórias diferentes.
     *
     * É um PASSE sobre a base inteira, não parte do loop de semeadura: a janela é
     * ancorada em hoje, e o finalizado de runs antigos já saiu dela — dentro do loop,
     * a cura nunca o alcançaria. Idempotente como o resto: só cria o que falta.
     */
    private function curarProducaoPassada(): int
    {
        $statusDeSessao = StatusAgendamento::where('desconta_sessao', true)
            ->where('marca_falta', false)
            ->pluck('id');

        // futuro não finaliza (mesmo limite do POST real). Comparação de STRING de parede,
        // nunca de instante: `fim` é datetime naive da clínica — filtrar em SQL contra a
        // parede é o padrão da casa (EvolucoesEmAberto)
        $agora = CarbonImmutable::now($this->configuracoes->get('clinica.timezone'));

        $curados = 0;
        Agendamento::where('tipo', 'atendimento')
            ->whereIn('status_id', $statusDeSessao)
            ->where('fim', '<=', $agora->format('Y-m-d H:i:s'))
            ->whereDoesntHave('atendimento')
            ->each(function (Agendamento $agendamento) use (&$curados): void {
                $agendamento->atendimento()->create([
                    'iniciado_em' => $agendamento->inicio->format('Y-m-d H:i'),
                    'finalizado_em' => $agendamento->fim->format('Y-m-d H:i'),
                ]);
                $curados++;
            });

        return $curados;
    }

    /**
     * A criança ESQUECIDA — o caso que a change `protocolo-de-pendencias` existe para tornar
     * visível: tratamento em andamento com saldo, a última sessão há 45 dias e NENHUM
     * agendamento futuro. Sem ela a demo mostraria a fila sempre vazia, que é justamente o
     * estado que a clínica acha que tem quando o problema está acontecendo.
     *
     * Fica FORA da agenda da semana de propósito (`semearAgenda` daria futuro a ela e a
     * pendência morreria). Idempotente como o resto. Dados 100% fictícios (LGPD).
     *
     * @param  Collection<string, Especialidade>  $especialidades
     * @param  Collection<string, array{modelo: Profissional, especialidade: Especialidade}>  $porEspecialidade
     */
    private function semearPendenciaDeRetorno($especialidades, $porEspecialidade, Convenio $convenio): int
    {
        $especialidade = $especialidades['Fonoaudiologia'];
        $profissional = $porEspecialidade['Fonoaudiologia']['modelo'];

        $crianca = Paciente::firstWhere('nome', 'Heitor Fictício Sumido')
            ?? Paciente::factory()->create([
                'nome' => 'Heitor Fictício Sumido',
                'nascimento' => $this->hojeNaClinica()->subYears(7)->toDateString(),
                'sexo' => 'masculino',
                'ativo' => true,
            ]);

        $tratamento = Tratamento::firstOrCreate(
            ['paciente_id' => $crianca->id, 'especialidade_id' => $especialidade->id],
            [
                'convenio_id' => $convenio->id,
                'profissional_id' => $profissional->id,
                'servico_id' => Servico::where('convenio_id', $convenio->id)
                    ->where('procedimento', "Sessão de {$especialidade->nome}")->value('id'),
                'sessoes_total' => 20,
                // validade folgada: pacote VENCIDO não é pendência de retorno, é outro problema
                'data_inicio' => $this->hojeNaClinica()->subMonths(3)->toDateString(),
                'validade_dias' => 365,
                'status' => 'andamento',
            ]
        );

        $ultimaSessao = $this->hojeNaClinica()->subDays(45);
        Agendamento::firstOrCreate(
            [
                'paciente_id' => $crianca->id,
                'inicio' => $ultimaSessao->setTime(10, 0)->format('Y-m-d H:i:s'),
            ],
            [
                'tipo' => 'atendimento',
                'profissional_id' => $profissional->id,
                'especialidade_id' => $especialidade->id,
                'tratamento_id' => $tratamento->id,
                'status_id' => StatusAgendamento::where('nome', 'Finalizado')->value('id'),
                'fim' => $ultimaSessao->setTime(10, 40)->format('Y-m-d H:i:s'),
                'origem' => 'demo',
            ]
        );

        return 1;
    }

    /**
     * A FILA DE ESPERA (§6) — quem ligou e ainda não tem horário.
     *
     * A demo precisa dela porque o gesto que a recepção mais repete não é "criar
     * agendamento do zero": é **encaixar quem esperava** quando um horário abre. Com a
     * fila vazia o botão "Encaixar" nunca aparece, e o fluxo some da apresentação.
     *
     * As três entradas cobrem os três degraus de prioridade (design D7) e os dois
     * formatos de desejo:
     *   - SEM profissional → cabe em qualquer horário daquela especialidade que abrir;
     *   - COM profissional → só entra na coluna de quem a família escolheu.
     *
     * `created_at` é recuado de propósito: o contador de espera ("há 9 dias") é o
     * argumento da fila, e uma fila inteira entrada "hoje" não mostra nada.
     *
     * A `obs` é OPERACIONAL, nunca clínica (a própria tela diz isso em letras).
     */
    private function semearFilaDeEspera(Collection $especialidades, Collection $porEspecialidade, Collection $criancas): int
    {
        if (ListaEspera::query()->exists()) {
            return ListaEspera::query()->count(); // idempotente: fila já semeada
        }

        // Duas crianças NOVAS — quem espera ainda não é paciente em tratamento. A terceira
        // entrada é a criança que JÁ vem à clínica e quer somar uma segunda terapia: o caso
        // que mais aparece no balcão, e o que o encaixe resolve melhor.
        $novas = [
            ['Paciente Fictício Rafael', '2019-04-09', 'masculino'],
            ['Paciente Fictício Isabela', '2017-11-22', 'feminino'],
        ];

        $esperando = collect($novas)->map(fn (array $dados) => Paciente::firstWhere('nome', $dados[0])
            ?? Paciente::factory()->create([
                'nome' => $dados[0],
                'nascimento' => $dados[1],
                'sexo' => $dados[2],
                'ativo' => true,
            ]));

        $entradas = [
            [
                'paciente' => $esperando[0],
                'especialidade' => $especialidades['Fonoaudiologia'],
                'profissional' => null, // qualquer fono serve — o encaixe mais fácil da fila
                'prioridade' => 10,     // Urgente
                'dias' => 2,
                'obs' => 'Encaminhamento do pediatra. Mãe pode trazer em qualquer dia de manhã.',
            ],
            [
                'paciente' => $esperando[1],
                'especialidade' => $especialidades['Terapia Ocupacional'],
                'profissional' => $porEspecialidade['Terapia Ocupacional']['modelo'],
                'prioridade' => 5,      // Alta
                'dias' => 9,
                'obs' => 'Só terça e quinta à tarde — quem traz é a avó.',
            ],
            [
                // já faz Fonoaudiologia na casa (índice 10 do elenco): quer somar Psicologia
                'paciente' => $criancas[10],
                'especialidade' => $especialidades['Psicologia'],
                'profissional' => $porEspecialidade['Psicologia']['modelo'],
                'prioridade' => 0,      // Normal — e mesmo assim o mais antigo da fila
                'dias' => 23,
                'obs' => 'Já faz fono aqui. Aceita encaixe de última hora, mora perto.',
            ],
        ];

        foreach ($entradas as $dados) {
            $entrada = new ListaEspera([
                'paciente_id' => $dados['paciente']->id,
                'especialidade_id' => $dados['especialidade']->id,
                'profissional_id' => $dados['profissional']?->id,
                'prioridade' => $dados['prioridade'],
                'obs' => $dados['obs'],
            ]);
            // atribuir CREATED_AT antes do save faz o Laravel respeitar o recuo
            $entrada->created_at = $this->hojeNaClinica()->subDays($dados['dias'])->setTime(9, 30);
            $entrada->save();
        }

        return count($entradas);
    }
}
