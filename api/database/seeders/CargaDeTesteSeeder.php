<?php

namespace Database\Seeders;

use App\Models\Agendamento;
use App\Models\Convenio;
use App\Models\Especialidade;
use App\Models\ListaEspera;
use App\Models\Paciente;
use App\Models\Profissional;
use App\Models\StatusAgendamento;
use App\Models\Tratamento;
use App\Support\Configuracoes\ConfiguracaoService;
use Carbon\CarbonImmutable;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

/**
 * A carga do PISO DE PERFORMANCE — 100% fictícia (LGPD: nunca dado real de MENOR).
 *
 * O `CLAUDE.md` fixa o piso em "grade da agenda fluida com **20 profissionais × dia inteiro**",
 * e até aqui esse número só existia como frase. O `DemoSeeder` mostra o produto (5
 * profissionais, buracos de propósito, passado com desfecho); este mostra o produto **no pior
 * dia**: 20 colunas, a janela inteira ocupada, sem um vão para a vista descansar, e a fila de
 * espera cheia.
 *
 * Os dois convivem: o Demo é para DEMONSTRAR, este é para MEDIR. Não rode este antes de uma
 * apresentação — uma agenda sem horário livre não parece clínica, parece planilha.
 *
 *     php artisan db:seed --class=CargaDeTesteSeeder
 *
 * Idempotente: os profissionais desta carga têm nome próprio (`Carga NN`) e cada agendamento é
 * conferido pelo par (profissional, início) antes de nascer. Rodar duas vezes não duplica.
 */
class CargaDeTesteSeeder extends Seeder
{
    /** O piso da §2 do CLAUDE.md, e a razão deste arquivo existir. */
    private const PROFISSIONAIS = 20;

    /** Dias ÚTEIS semeados a partir de hoje — a grade se navega, não se olha só uma vez. */
    private const DIAS = 5;

    /** Fila de espera "lotada": o painel lateral e a tela cheia, com prioridades misturadas. */
    private const NA_FILA = 60;

    /**
     * Crianças no elenco. Precisa ser MAIOR que os agendamentos de um dia
     * (20 × ~16 slots = ~320) porque cada dia gasta uma criança por card: assim nenhuma
     * aparece em duas salas ao mesmo tempo sem eu ter de cruzar horários.
     */
    private const CRIANCAS = 420;

    private ConfiguracaoService $configuracoes;

    /** Tratamentos já criados nesta rodada, por `paciente:especialidade`. */
    private array $tratamentos = [];

    public function run(): void
    {
        // dado fictício não entra em banco de clínica real (SEC-R2-02). Falha ALTO, nunca
        // sucesso silencioso — e esta carga é MUITO pior que a demo se escapar: 1600 cards
        if (app()->isProduction()) {
            throw new \RuntimeException('CargaDeTesteSeeder não roda em produção.');
        }

        $this->configuracoes = app(ConfiguracaoService::class);

        $especialidades = $this->especialidades();
        $convenio = Convenio::firstOrCreate(['nome' => 'Unimed Fictícia'], ['ativo' => true]);
        $profissionais = $this->semearProfissionais($especialidades);
        $criancas = $this->semearCriancas();

        $cards = $this->semearAgenda($profissionais, $criancas, $convenio);
        $fila = $this->semearFila($especialidades, $profissionais, $criancas);

        $this->command?->info(sprintf(
            'Carga pronta: %d profissionais · %d agendamentos em %d dias úteis · %d na fila de espera.',
            count($profissionais), $cards, self::DIAS, $fila,
        ));
    }

    /** As especialidades da casa — reaproveitadas do Demo quando ele já rodou. */
    private function especialidades(): array
    {
        $catalogo = [
            ['nome' => 'Fonoaudiologia', 'cor' => '#A85550', 'slots' => 1],
            ['nome' => 'Psicologia', 'cor' => '#4A6FA5', 'slots' => 1],
            ['nome' => 'Terapia Ocupacional', 'cor' => '#3E8E7E', 'slots' => 1],
            ['nome' => 'Psicopedagogia', 'cor' => '#B7793B', 'slots' => 1],
            // a sessão LONGA: dois slots. Entra de propósito, porque a grade cheia com
            // card de 80 min ao lado de card de 40 é o arranjo que mais custa a desenhar
            ['nome' => 'Musicoterapia', 'cor' => '#7A5BA8', 'slots' => 2],
        ];

        $passo = $this->passo();

        return collect($catalogo)->map(fn (array $dados) => Especialidade::firstOrCreate(
            ['nome' => $dados['nome']],
            ['cor' => $dados['cor'], 'tempo_sessao' => $dados['slots'] * $passo, 'exige_termo' => true],
        ))->all();
    }

    /**
     * Vinte profissionais, todos de segunda a sexta na janela INTEIRA da grade.
     *
     * Sem turno partido e sem meio-período de propósito: o piso é a grade densa, e almoço
     * vazio no meio de todo mundo aliviaria justamente a faixa que se quer medir.
     */
    private function semearProfissionais(array $especialidades): array
    {
        [$inicio, $fim] = $this->janela();
        $lista = [];

        for ($i = 0; $i < self::PROFISSIONAIS; $i++) {
            $especialidade = $especialidades[$i % count($especialidades)];
            $profissional = Profissional::firstOrCreate(
                ['nome' => sprintf('Profissional Fictício Carga %02d', $i + 1)],
                ['obs' => 'Carga de teste — '.$especialidade->nome, 'ativo' => true],
            );

            if ($profissional->horarios()->doesntExist()) {
                foreach ([1, 2, 3, 4, 5] as $dia) {
                    $profissional->horarios()->create(['dia_semana' => $dia, 'inicio' => $inicio, 'fim' => $fim]);
                }
            }

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

            $lista[] = ['modelo' => $profissional, 'especialidade' => $especialidade];
        }

        return $lista;
    }

    /**
     * O elenco de crianças.
     *
     * Nome numerado em vez de `fake()->unique()->firstName()`: o pool do Faker acaba muito
     * antes de 420 e o `unique()` estoura com `OverflowException` no meio da carga.
     */
    private function semearCriancas(): array
    {
        $existentes = Paciente::query()
            ->where('nome', 'like', 'Paciente Fictício Carga %')
            ->orderBy('id')
            ->get()
            ->keyBy('nome');

        $criancas = [];
        for ($i = 0; $i < self::CRIANCAS; $i++) {
            $nome = sprintf('Paciente Fictício Carga %03d', $i + 1);
            $criancas[] = $existentes[$nome] ?? Paciente::create([
                'nome' => $nome,
                // idade espalhada pela faixa que a clínica atende, sem tocar em data real
                'nascimento' => CarbonImmutable::create(2014 + ($i % 9), 1 + ($i % 12), 1 + ($i % 28))->toDateString(),
                'sexo' => $i % 2 === 0 ? 'feminino' : 'masculino',
                'necessidade' => 'sem',
                'responsaveis_json' => [['nome' => 'Responsável Fictício '.($i + 1), 'parentesco' => 'mãe']],
                'contatos_json' => [],
                'ativo' => true,
            ]);
        }

        return $criancas;
    }

    /**
     * A grade cheia: para cada dia útil, cada profissional, cada slot da sua janela.
     *
     * O passo é o `tempo_sessao` da especialidade — não a granularidade —, então a coluna da
     * Musicoterapia fecha em blocos de dois slots e as outras em blocos de um. É assim que a
     * clínica de verdade se parece, e é o caso caro de desenhar.
     */
    private function semearAgenda(array $profissionais, array $criancas, Convenio $convenio): int
    {
        $emAberto = StatusAgendamento::where('nome', 'Em Aberto')->firstOrFail();
        [$inicio, $fim] = $this->janela();
        [$hi, $mi] = array_map('intval', explode(':', $inicio));
        [$hf, $mf] = array_map('intval', explode(':', $fim));
        $inicioMin = $hi * 60 + $mi;
        $fimMin = $hf * 60 + $mf;

        $criados = 0;
        $dia = $this->hojeNaClinica();

        for ($d = 0; $d < self::DIAS; $d++) {
            // fim de semana não entra: a grade nem o mostra por padrão
            while ($dia->isWeekend()) {
                $dia = $dia->addDay();
            }

            // uma criança por card DENTRO DO DIA — garante que ninguém apareça em duas salas
            // no mesmo instante sem eu ter de cruzar horário com horário
            $vez = 0;

            foreach ($profissionais as $profissional) {
                $duracao = (int) $profissional['especialidade']->tempo_sessao;

                for ($minuto = $inicioMin; $minuto + $duracao <= $fimMin; $minuto += $duracao) {
                    $comeco = $dia->addMinutes($minuto);

                    $jaExiste = Agendamento::where('profissional_id', $profissional['modelo']->id)
                        ->where('inicio', $comeco->format('Y-m-d H:i:s'))
                        ->exists();
                    if ($jaExiste) {
                        $vez++;

                        continue;
                    }

                    $crianca = $criancas[$vez % count($criancas)];
                    $vez++;

                    $tratamento = $this->tratamentoDe($crianca, $profissional, $convenio, $criados);

                    Agendamento::create([
                        'tipo' => 'atendimento',
                        'paciente_id' => $crianca->id,
                        'profissional_id' => $profissional['modelo']->id,
                        'especialidade_id' => $profissional['especialidade']->id,
                        'tratamento_id' => $tratamento?->id,
                        'status_id' => $emAberto->id,
                        'inicio' => $comeco->format('Y-m-d H:i:s'),
                        'fim' => $comeco->addMinutes($duracao)->format('Y-m-d H:i:s'),
                    ]);
                    $criados++;
                }
            }

            $dia = $dia->addDay();
        }

        return $criados;
    }

    /**
     * O pacote da criança naquela especialidade — criado sob demanda, no máximo um por par.
     *
     * Os saldos são distribuídos de propósito para que a grade cheia mostre **os três estados
     * do fim de pacote** espalhados, e não só cards saudáveis: é o que a change
     * `alerta-de-fim-de-pacote` precisa ver em escala. Um em cada dez fica sem saldo
     * (vermelho), dois no limiar (âmbar) e um é sessão única (que NÃO realça).
     */
    private function tratamentoDe(Paciente $crianca, array $profissional, Convenio $convenio, int $ordem): ?Tratamento
    {
        $chave = $crianca->id.':'.$profissional['especialidade']->id;

        if (array_key_exists($chave, $this->tratamentos)) {
            return $this->tratamentos[$chave];
        }

        // uma parte dos cards fica AVULSA de propósito: a grade real tem bloqueio e encaixe
        // sem pacote, e o realce precisa provar que ignora quem não tem tratamento
        if ($ordem % 4 === 3) {
            return $this->tratamentos[$chave] = null;
        }

        [$total, $realizadas] = match ($ordem % 10) {
            0 => [10, 10],  // saldo 0  → VERMELHO
            1 => [10, 9],   // saldo 1  → ÂMBAR
            2 => [10, 8],   // saldo 2  → ÂMBAR (no limiar padrão)
            4 => [1, 0],    // sessão única → sem realce nenhum
            default => [20, $ordem % 12],
        };

        return $this->tratamentos[$chave] = Tratamento::create([
            'paciente_id' => $crianca->id,
            'convenio_id' => $convenio->id,
            'especialidade_id' => $profissional['especialidade']->id,
            'profissional_id' => $profissional['modelo']->id,
            'tipo' => 'pacote',
            'sessoes_total' => $total,
            'sessoes_realizadas' => $realizadas,
            'data_inicio' => $this->hojeNaClinica()->subDays(30)->toDateString(),
            'status' => 'andamento',
        ]);
    }

    /**
     * A fila de espera lotada.
     *
     * Metade sem profissional (cabe em qualquer coluna da especialidade) e metade com nome
     * (só entra onde a família escolheu) — são os dois formatos de desejo que o encaixe trata
     * de modo diferente, e uma fila só de um deles esconde metade da tela.
     *
     * `created_at` recuado: o contador "há N dias" é o argumento da fila, e uma fila inteira
     * entrada hoje não mostra nada.
     */
    private function semearFila(array $especialidades, array $profissionais, array $criancas): int
    {
        $jaNaFila = ListaEspera::query()->count();
        if ($jaNaFila >= self::NA_FILA) {
            return $jaNaFila; // idempotente: fila já lotada
        }

        $prioridades = [10, 5, 0, 0, 5]; // urgente · alta · normal — misturadas
        $criados = 0;

        for ($i = $jaNaFila; $i < self::NA_FILA; $i++) {
            // as crianças da fila vêm do FIM do elenco: quem espera ainda não tem agenda,
            // e as primeiras do elenco são justamente as que a grade já ocupou
            $crianca = $criancas[count($criancas) - 1 - ($i % 120)];
            $especialidade = $especialidades[$i % count($especialidades)];
            $comProfissional = $i % 2 === 0;

            $entrada = new ListaEspera([
                'paciente_id' => $crianca->id,
                'especialidade_id' => $especialidade->id,
                'profissional_id' => $comProfissional ? $profissionais[$i % count($profissionais)]['modelo']->id : null,
                'prioridade' => $prioridades[$i % count($prioridades)],
                // obs OPERACIONAL, nunca clínica — a própria tela diz isso em letras
                'obs' => $comProfissional
                    ? 'Só aceita com este profissional. Traz a avó, tarde.'
                    : 'Qualquer profissional serve. Disponível de manhã.',
            ]);
            $entrada->created_at = $this->hojeNaClinica()->subDays(1 + ($i * 3) % 90)->setTime(9, 30);
            $entrada->save();
            $criados++;
        }

        return $jaNaFila + $criados;
    }

    /** A janela padrão da grade (§13: é dado da clínica, não constante daqui). */
    private function janela(): array
    {
        return [
            substr((string) $this->configuracoes->get('agenda.janela_padrao_inicio'), 0, 5),
            substr((string) $this->configuracoes->get('agenda.janela_padrao_fim'), 0, 5),
        ];
    }

    private function passo(): int
    {
        return max(5, (int) $this->configuracoes->get('agenda.granularidade_min'));
    }

    /**
     * HOJE — na PAREDE DA CLÍNICA, não no relógio da máquina.
     *
     * `config('app.timezone')` é UTC; usá-lo semeia a agenda no dia seguinte enquanto a
     * clínica ainda está no anterior, e a tela abre no dia corrente sem achar nada. Mesma
     * lição do `DemoSeeder`.
     */
    private function hojeNaClinica(): CarbonImmutable
    {
        return CarbonImmutable::now($this->configuracoes->get('clinica.timezone'))->startOfDay();
    }
}
