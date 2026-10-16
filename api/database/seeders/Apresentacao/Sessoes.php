<?php

namespace Database\Seeders\Apresentacao;

use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;

/**
 * A agenda de um ano inteiro, a partir dos horários fixos de cada plano: o passado com
 * desfecho (realizada, falta, desmarque), hoje em andamento e três semanas de futuro.
 *
 * Os pacotes (tratamentos) se renovam quando o saldo acaba; a sessão realizada ganha
 * `atendimento` (a régua canônica T-not-15) e quase sempre uma evolução — as que faltam
 * alimentam "evoluções em aberto" e "atrasadas".
 */
final class Sessoes
{
    /** Mês → peso extra de falta/desmarque (férias escolares e fim de ano). */
    private const SAZONALIDADE = [1 => 1.8, 2 => 1.2, 7 => 1.6, 12 => 1.7];

    /** Dia da semana → peso extra de falta (segunda e sexta faltam mais). */
    private const FALTA_POR_DIA = [1 => 1.35, 2 => 0.9, 3 => 0.85, 4 => 0.95, 5 => 1.5];

    private const EVOLUCOES = [
        'Fonoaudiologia' => ['Trabalhada consciência fonológica com jogos de rima; boa adesão.', 'Treino de praxias orofaciais com espelho; melhora na precisão do /r/.',
            'Ampliação de vocabulário com cartões temáticos; usou 6 palavras novas espontaneamente.', 'Narrativa com sequência de 4 cenas, organizou início, meio e fim com apoio.'],
        'Psicologia' => ['Sessão lúdica com foco em nomear emoções; identificou raiva e frustração.', 'Trabalhado manejo de ansiedade antes da escola com técnica de respiração.',
            'Jogo de regras para tolerância à frustração; aceitou perder duas vezes sem desorganizar.', 'Orientação aos responsáveis sobre rotina de sono e combinados em casa.'],
        'Terapia Ocupacional' => ['Circuito de integração sensorial com balanço e pula-pula; boa regulação ao final.', 'Coordenação motora fina com pinça e massinha; preensão mais madura.',
            'Treino de AVD: abotoar e calçar o tênis com mínima ajuda.', 'Planejamento motor em circuito de 5 etapas, concluiu com uma pista verbal.'],
        'Psicopedagogia' => ['Leitura de sílabas complexas com jogo de trilha; boa evolução.', 'Raciocínio lógico-matemático com material dourado, compreendeu a dezena.',
            'Organização do material escolar e agenda da semana com a família.', 'Produção de texto curto com apoio de imagens; ortografia em evolução.'],
        'Fisioterapia' => ['Fortalecimento de core e equilíbrio em prancha; manteve postura por 20 s.', 'Treino de marcha em rampa e escada alternando os pés.',
            'Alongamento de cadeia posterior e exercícios de propriocepção.', 'Circuito de saltos e corrida; coordenação bilateral em evolução.'],
        'Neuropsicologia' => ['Aplicação de bateria de atenção sustentada; cooperou durante toda a sessão.', 'Avaliação de funções executivas (planejamento e flexibilidade).',
            'Entrevista de anamnese com os responsáveis para a avaliação.', 'Aplicação de escala de inteligência — subtestes verbais.'],
        'Musicoterapia' => ['Improvisação musical em dupla; manteve turnos de interação por 10 min.', 'Canções com gestos para ampliar a atenção compartilhada.',
            'Exploração de instrumentos de percussão com regulação de intensidade.', 'Composição de canção sobre a rotina; boa expressão verbal.'],
    ];

    /** @var list<array<string, mixed>> */
    private array $agendamentos = [];

    /** @var list<array{plano: int, pacote: int, inicio: CarbonImmutable, fim: CarbonImmutable, status: string}> */
    private array $roteiro = [];

    public function __construct(private readonly Contexto $ctx) {}

    public function semear(): void
    {
        $this->bloqueios();
        foreach ($this->ctx->planos as $indice => $plano) {
            $this->roteiroDo($indice, $plano);
        }
        $this->gravarAgendamentos();
        $this->atendimentosEEvolucoes();
        $this->inativarQuemTeveAlta();
    }

    /** Férias, congresso e supervisão — a agenda também mostra quando NÃO há atendimento. */
    private function bloqueios(): void
    {
        $semanaDeFerias = $this->ctx->inicio->addMonths(4)->startOfWeek(CarbonInterface::MONDAY);
        $eventos = [
            [1, $semanaDeFerias, 10, '08:00', '20:40', 'Férias'],
            [2, $this->ctx->hoje->subMonths(2)->startOfWeek(CarbonInterface::MONDAY)->addDays(2), 1, '08:00', '18:40', 'Congresso de Psicologia Infantil'],
            [4, $this->ctx->hoje->addWeek()->startOfWeek(CarbonInterface::MONDAY)->addDays(4), 1, '13:20', '18:40', 'Supervisão clínica da equipe'],
            [0, $this->ctx->hoje->addWeeks(2)->startOfWeek(CarbonInterface::MONDAY)->addDay(), 1, '08:00', '12:00', 'Curso de atualização'],
        ];
        foreach ($eventos as [$profissional, $primeiro, $dias, $de, $ate, $motivo]) {
            for ($d = 0; $d < $dias; $d++) {
                $dia = $primeiro->addDays($d);
                if ($dia->isWeekend()) {
                    continue;
                }
                $this->ctx->bloqueios[$profissional][] = $dia->toDateString();
                $this->agendamentos[] = ['tipo' => 'bloqueio', 'profissional_id' => $this->ctx->profissionais[$profissional]['id'],
                    'inicio' => "{$dia->toDateString()} {$de}:00", 'fim' => "{$dia->toDateString()} {$ate}:00", 'obs' => $motivo, 'origem' => 'manual', 'lembrete_whatsapp' => false];
            }
        }
    }

    /** @param  array<string, mixed>  $plano */
    private function roteiroDo(int $indice, array $plano): void
    {
        $primeiro = $plano['entrada']->max($this->ctx->inicio);
        $ultimo = ($plano['fim'] ?? $this->ctx->fimDaAgenda)->min($this->ctx->fimDaAgenda);
        $bloqueados = $this->ctx->bloqueios[$plano['profissional']] ?? [];
        foreach ($plano['slots'] as [$diaDaSemana, $hora]) {
            $dia = $primeiro->startOfWeek(CarbonInterface::MONDAY)->addDays($diaDaSemana - 1);
            for (; $dia <= $ultimo; $dia = $dia->addWeek()) {
                if ($dia < $primeiro || ! $this->ctx->ehDiaDeAtendimento($dia) || in_array($dia->toDateString(), $bloqueados, true)) {
                    continue;
                }
                $inicio = CarbonImmutable::parse("{$dia->toDateString()} {$hora}", $this->ctx->agora->timezone);
                $fim = $inicio->addMinutes($this->ctx->duracoes[$plano['especialidade']]);
                $this->roteiro[] = ['plano' => $indice, 'pacote' => 0, 'inicio' => $inicio, 'fim' => $fim, 'status' => $this->desfecho($inicio, $fim)];
            }
        }
    }

    private function desfecho(CarbonImmutable $inicio, CarbonImmutable $fim): string
    {
        if ($inicio >= $this->ctx->agora) {
            return $this->ctx->chance(0.03) ? 'Desmarcado pelo Paciente' : 'Em Aberto';
        }
        if ($fim > $this->ctx->agora) {
            return 'Aguardando Atendimento';
        }
        if ($inicio >= $this->ctx->hoje->subDays(3) && $this->ctx->chance(0.06)) {
            return 'Em Aberto'; // sem baixa: a recepção ainda não fechou o dia
        }
        $peso = (self::SAZONALIDADE[$inicio->month] ?? 1.0) * (self::FALTA_POR_DIA[$inicio->dayOfWeekIso] ?? 1.0);

        return $this->ctx->pesado([
            'Finalizado' => 80,
            'Não Compareceu' => (int) round(6 * $peso),
            'Falta Justificada' => (int) round(4 * $peso),
            'Desmarcado pelo Paciente' => (int) round(5 * $peso),
            'Desmarcado pelo Profissional' => 2,
        ]);
    }

    /**
     * Agrupa as sessões de cada plano em pacotes: convênio libera guias de 10 sessões,
     * particular fecha pacotes de 20. Saldo acabou → pacote finalizado, abre o próximo.
     */
    private function gravarAgendamentos(): void
    {
        usort($this->roteiro, fn (array $a, array $b) => [$a['plano'], $a['inicio']] <=> [$b['plano'], $b['inicio']]);
        $porPlano = [];
        foreach ($this->roteiro as $posicao => $sessao) {
            $porPlano[$sessao['plano']][] = $posicao;
        }
        foreach ($porPlano as $plano => $posicoes) {
            $this->pacotesDo($plano, $posicoes);
        }

        // o INSERT em lote exige as mesmas colunas em toda linha (o bloqueio não tem paciente)
        $colunas = ['tipo', 'paciente_id', 'profissional_id', 'especialidade_id', 'tratamento_id', 'sala_id', 'status_id',
            'inicio', 'fim', 'origem', 'sessao_consumida_em', 'lembrete_whatsapp', 'obs', 'created_at'];
        $this->ctx->inserirEmLote('agendamentos', array_map(
            fn (array $linha) => array_merge(array_fill_keys($colunas, null), array_intersect_key($linha, array_flip($colunas))),
            $this->agendamentos,
        ));
        $ids = DB::table('agendamentos')->where('tipo', 'atendimento')
            ->get(['id', 'profissional_id', 'inicio'])
            ->mapWithKeys(fn (object $a) => ["{$a->profissional_id}|{$a->inicio}" => (int) $a->id]);
        foreach ($this->agendamentos as $linha) {
            if ($linha['tipo'] !== 'atendimento') {
                continue;
            }
            $this->ctx->sessoes[] = ['id' => $ids["{$linha['profissional_id']}|{$linha['inicio']}"], 'plano' => $linha['_plano'],
                'tratamento_id' => $linha['tratamento_id'], 'inicio' => $linha['_inicio'], 'fim' => $linha['_fim'], 'status' => $linha['_status']];
        }
        $this->roteiro = [];
        $this->agendamentos = [];
    }

    /** @param  list<int>  $posicoes */
    private function pacotesDo(int $indicePlano, array $posicoes): void
    {
        $plano = $this->ctx->planos[$indicePlano];
        $convenio = $this->ctx->convenios[$plano['convenio']];
        $tamanho = $plano['especialidade'] === 'Neuropsicologia' ? 10 : ($convenio['particular'] ? 20 : 10);
        $realizadas = $plano['entrada'] < $this->ctx->inicio ? $this->ctx->entre(0, $tamanho - 4) : 0;
        $pacote = $this->abrirPacote($plano, $tamanho, $plano['entrada']);
        $ultimoDoPlano = $posicoes[array_key_last($posicoes)];

        foreach ($posicoes as $posicao) {
            $sessao = $this->roteiro[$posicao];
            if ($realizadas >= $tamanho) {
                $this->fecharPacote($pacote, $realizadas, 'finalizado');
                $pacote = $this->abrirPacote($plano, $tamanho, $sessao['inicio']);
                $realizadas = 0;
            }
            $consome = in_array($sessao['status'], ['Finalizado', 'Não Compareceu'], true);
            $realizadas += $consome ? 1 : 0;
            $this->agendamentos[] = $this->linhaDeAgendamento($plano, $indicePlano, $pacote, $sessao, $consome);
            if ($posicao === $ultimoDoPlano) {
                $encerrado = $plano['alta'] && $plano['fim'] !== null && $plano['fim'] < $this->ctx->hoje;
                $this->fecharPacote($pacote, $realizadas, $encerrado ? 'finalizado' : 'andamento');
            }
        }
    }

    /** @param  array<string, mixed>  $plano */
    private function abrirPacote(array $plano, int $tamanho, CarbonImmutable $inicio): int
    {
        $convenio = $this->ctx->convenios[$plano['convenio']];
        $preco = $convenio['precos'][$plano['especialidade']];

        return $this->ctx->inserir('tratamentos', [
            'paciente_id' => $this->ctx->pacientes[$plano['paciente']]['id'],
            'convenio_id' => $convenio['id'],
            'especialidade_id' => $this->ctx->especialidades[$plano['especialidade']],
            'profissional_id' => $this->ctx->profissionais[$plano['profissional']]['id'],
            'servico_id' => $preco['servico_id'],
            'tipo' => 'pacote',
            'guia' => $convenio['particular'] ? null : (string) $this->ctx->entre(10000000, 99999999),
            'matricula' => null,
            'sessoes_total' => $tamanho,
            'sessoes_realizadas' => 0,
            'data_inicio' => $inicio->toDateString(),
            'validade_dias' => $convenio['particular'] ? 180 : 120,
            'pedido_emitido_em' => $convenio['particular'] ? null : $inicio->subDays($this->ctx->entre(5, 20))->toDateString(),
            'pedido_sessoes_por_semana' => $convenio['particular'] ? null : $plano['frequencia'],
            'status' => 'andamento',
            'created_at' => $this->ctx->utc($inicio->subDays(2)->setTime(11, 0)),
        ]);
    }

    private function fecharPacote(int $pacote, int $realizadas, string $status): void
    {
        DB::table('tratamentos')->where('id', $pacote)->update(['sessoes_realizadas' => $realizadas, 'status' => $status]);
    }

    /**
     * @param  array<string, mixed>  $plano
     * @param  array{inicio: CarbonImmutable, fim: CarbonImmutable, status: string}  $sessao
     * @return array<string, mixed>
     */
    private function linhaDeAgendamento(array $plano, int $indicePlano, int $pacote, array $sessao, bool $consome): array
    {
        $profissional = $this->ctx->profissionais[$plano['profissional']];
        $inicio = $sessao['inicio']->format('Y-m-d H:i:s');

        return [
            'tipo' => 'atendimento',
            'paciente_id' => $this->ctx->pacientes[$plano['paciente']]['id'],
            'profissional_id' => $profissional['id'],
            'especialidade_id' => $this->ctx->especialidades[$plano['especialidade']],
            'tratamento_id' => $pacote,
            'sala_id' => $profissional['sala_id'],
            'status_id' => $this->ctx->status[$sessao['status']],
            'inicio' => $inicio,
            'fim' => $sessao['fim']->format('Y-m-d H:i:s'),
            'origem' => 'manual',
            'sessao_consumida_em' => $consome ? $inicio : null,
            'lembrete_whatsapp' => true,
            'created_at' => $this->ctx->utc($sessao['inicio']->min($this->ctx->agora)->subDays($this->ctx->entre(3, 25))->setTime(10, 0)),
            '_plano' => $indicePlano, '_inicio' => $sessao['inicio'], '_fim' => $sessao['fim'], '_status' => $sessao['status'],
        ];
    }

    /**
     * Sessão que ACONTECEU tem atendimento; a evolução quase sempre está lá. Faltam as
     * mais recentes (em aberto) e um punhado antigo — as "atrasadas" do painel da equipe.
     */
    private function atendimentosEEvolucoes(): void
    {
        $atendimentos = [];
        foreach ($this->ctx->sessoes as $sessao) {
            if ($sessao['status'] !== 'Finalizado' || $sessao['fim'] > $this->ctx->agora) {
                continue;
            }
            $atendimentos[] = ['agendamento_id' => $sessao['id'], 'iniciado_em' => $sessao['inicio']->addMinutes($this->ctx->entre(0, 6))->format('Y-m-d H:i:s'),
                'finalizado_em' => $sessao['fim']->format('Y-m-d H:i:s'), 'created_at' => $this->ctx->utc($sessao['fim'])];
        }
        $this->ctx->inserirEmLote('atendimentos', $atendimentos);

        $porAgendamento = DB::table('atendimentos')->pluck('id', 'agendamento_id');
        $evolucoes = [];
        $comEvolucao = [];
        foreach ($this->ctx->sessoes as $sessao) {
            $atendimento = $porAgendamento[$sessao['id']] ?? null;
            if ($atendimento === null || ! $this->temEvolucao($sessao['fim'])) {
                continue;
            }
            $plano = $this->ctx->planos[$sessao['plano']];
            $evolucoes[] = ['atendimento_id' => $atendimento, 'profissional_id' => $this->ctx->profissionais[$plano['profissional']]['id'],
                'conteudo' => Crypt::encryptString($this->ctx->um(self::EVOLUCOES[$plano['especialidade']])),
                'preenchida_em' => $sessao['fim']->addMinutes($this->ctx->entre(10, 600))->min($this->ctx->agora)->format('Y-m-d H:i:s'),
                'created_at' => $this->ctx->utc($sessao['fim'])];
            if ($this->ctx->chance(0.5)) {
                $comEvolucao[] = $sessao['id'];
            }
            if (count($evolucoes) === 500) {
                $this->ctx->inserirEmLote('evolucoes', $evolucoes);
                $evolucoes = [];
            }
        }
        $this->ctx->inserirEmLote('evolucoes', $evolucoes);
        foreach (array_chunk($comEvolucao, 1000) as $lote) {
            DB::table('agendamentos')->whereIn('id', $lote)->update(['status_id' => $this->ctx->status['Finalizado com Evolução']]);
        }
    }

    private function temEvolucao(CarbonImmutable $fim): bool
    {
        $dias = (int) $fim->diffInDays($this->ctx->agora);

        return match (true) {
            $dias < 2 => $this->ctx->chance(0.35),
            $dias < 10 => $this->ctx->chance(0.9),
            $dias < 100 => $this->ctx->chance(0.993),
            default => $this->ctx->chance(0.996),
        };
    }

    /** Criança cujos planos todos tiveram alta deixa de ser paciente ativa. */
    private function inativarQuemTeveAlta(): void
    {
        $saidas = [];
        foreach ($this->ctx->planos as $plano) {
            $fim = $plano['alta'] && $plano['fim'] !== null && $plano['fim'] < $this->ctx->hoje->subDays(7) ? $plano['fim'] : null;
            $atual = $saidas[$plano['paciente']] ?? false;
            $saidas[$plano['paciente']] = ($atual === null || $fim === null) ? null : ($atual === false ? $fim : $atual->max($fim));
        }
        foreach ($saidas as $paciente => $saida) {
            if ($saida instanceof CarbonImmutable) {
                $this->ctx->pacientes[$paciente]['ativo'] = false;
                $this->ctx->pacientes[$paciente]['saida'] = $saida;
                DB::table('pacientes')->where('id', $this->ctx->pacientes[$paciente]['id'])->update(['ativo' => false]);
            }
        }
    }
}
