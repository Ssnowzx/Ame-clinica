<?php

namespace Database\Seeders\Apresentacao;

use App\Models\Paciente;
use App\Models\TermoConsentimento;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * As crianças e o "quem faz o quê": cada criança entra numa data, faz de uma a três
 * terapias, ganha horário FIXO na semana com um profissional da especialidade — e quem
 * não coube na grade vai para a fila de espera, como acontece na clínica de verdade.
 *
 * Metade já era paciente quando o histórico começa; a outra metade entra ao longo do ano,
 * e é isso que faz a ocupação e os "novos pacientes" crescerem nos gráficos.
 */
final class Pacientes
{
    private const QUANTIDADE = 230;

    private const PESO_ESPECIALIDADE = ['Fonoaudiologia' => 30, 'Psicologia' => 22, 'Terapia Ocupacional' => 20,
        'Psicopedagogia' => 10, 'Fisioterapia' => 8, 'Neuropsicologia' => 6, 'Musicoterapia' => 6];

    private const PESO_CONVENIO = ['Particular' => 38, 'Vida Plena Saúde' => 28, 'Sempre Bem Assistência' => 20, 'Cuidar+ Saúde' => 14];

    private const INDICACOES = ['Pediatra' => 30, 'Escola' => 22, 'Neurologista' => 14, 'Instagram' => 12, 'Google' => 8, 'Indicação de outra família' => 14];

    /** @var array<int, array<string, CarbonImmutable>> profissional → "dia|hora" → livre a partir de */
    private array $grade = [];

    /** @var list<array{paciente: int, especialidade: string, profissional: int|null, entrada: CarbonImmutable}> */
    private array $semVaga = [];

    public function __construct(private readonly Contexto $ctx, private readonly Elenco $elenco) {}

    public function semear(): void
    {
        $termo = $this->termo();
        $this->montarGrade();
        for ($i = 0; $i < self::QUANTIDADE; $i++) {
            $this->crianca($termo);
        }
        usort($this->ctx->planos, fn (array $a, array $b) => $a['entrada'] <=> $b['entrada']);
        $alocados = [];
        foreach ($this->ctx->planos as $plano) {
            if ($this->alocar($plano)) {
                $alocados[] = $plano;
            }
        }
        $this->ctx->planos = $alocados;
        $this->reservarHorarios();
        $this->filaDeEspera();
    }

    private function termo(): TermoConsentimento
    {
        $termo = new TermoConsentimento;
        $termo->fill([
            'titulo' => 'Contrato terapêutico e regulamento dos atendimentos',
            'texto' => "1. As sessões acontecem nos dias e horários combinados no plano terapêutico.\n"
                ."2. Há tolerância de 10 minutos de atraso; depois disso a sessão é encurtada.\n"
                ."3. Desmarcações com menos de 24 horas de antecedência são cobradas.\n"
                ."4. Três faltas seguidas sem aviso encerram o acompanhamento e liberam o horário.\n"
                .'5. A evolução de cada sessão fica disponível para a família na devolutiva trimestral.',
        ]);
        $termo->versao = 1;
        $termo->vigente = true;
        $termo->save();

        return $termo;
    }

    /** Todos os horários de 40 min de cada profissional, livres desde sempre. */
    private function montarGrade(): void
    {
        foreach ($this->ctx->profissionais as $indice => $profissional) {
            foreach ($profissional['horarios'] as $dia => $intervalos) {
                foreach ($intervalos as [$inicio, $fim]) {
                    for ($t = CarbonImmutable::parse("2000-01-01 {$inicio}"); $t->addMinutes(40) <= CarbonImmutable::parse("2000-01-01 {$fim}"); $t = $t->addMinutes(40)) {
                        $this->grade[$indice]["{$dia}|{$t->format('H:i')}"] = CarbonImmutable::create(1990);
                    }
                }
            }
        }
    }

    private function crianca(TermoConsentimento $termo): void
    {
        $pessoa = $this->elenco->crianca();
        $responsaveis = $this->elenco->responsaveis($pessoa['sobrenome']);
        $convenio = $this->ctx->pesado(self::PESO_CONVENIO);
        $jaEra = $this->ctx->chance(0.5);
        $entrada = $jaEra
            ? $this->ctx->inicio->subDays($this->ctx->entre(20, 240))
            : $this->ctx->inicio->addDays($this->ctx->entre(0, (int) $this->ctx->inicio->diffInDays($this->ctx->hoje->addDays(7))));
        $nascimento = $this->ctx->hoje->subYears($this->ctx->entre(2, 13))->subDays($this->ctx->entre(0, 364));

        $paciente = new Paciente([
            'nome' => $pessoa['nome'], 'nascimento' => $nascimento->toDateString(), 'sexo' => $pessoa['sexo'],
            'convenio_id' => $this->ctx->convenios[$convenio]['id'],
            'plano' => $convenio === 'Particular' ? null : $this->ctx->um(['Enfermaria', 'Apartamento', 'Executivo']),
            'carteirinha' => $convenio === 'Particular' ? null : (string) $this->ctx->entre(100000000, 999999999).$this->ctx->entre(1000, 9999),
            'carteirinha_validade' => $convenio === 'Particular' ? null : $this->ctx->hoje->addMonths($this->ctx->entre(2, 20))->endOfMonth()->toDateString(),
            'responsaveis_json' => $responsaveis,
            'contatos_json' => [['tipo' => 'whatsapp', 'valor' => $responsaveis[0]['telefone'], 'obs' => $responsaveis[0]['nome']]],
            'endereco_json' => $this->elenco->endereco(),
            'indicacao' => $this->ctx->pesado(self::INDICACOES),
            'necessidade' => $this->ctx->chance(0.14) ? 'necessidades_especiais' : 'sem',
            'consentimentos_json' => $this->ctx->chance(0.86) ? [[
                'termo_id' => $termo->id, 'versao' => 1, 'termo' => $termo->titulo, 'responsavel' => $responsaveis[0]['nome'],
                'forma' => 'papel', 'registrado_por' => $this->ctx->um($this->ctx->recepcao), 'aceito_em' => $entrada->setTime(9, 15)->toIso8601String(),
            ]] : [],
            'ativo' => true,
        ]);
        $paciente->save();
        DB::table('pacientes')->where('id', $paciente->id)->update(['created_at' => $this->ctx->utc($entrada->subDays($this->ctx->entre(1, 6))->setTime(10, 30))]);

        $indice = count($this->ctx->pacientes);
        $this->ctx->pacientes[] = ['id' => (int) $paciente->id, 'nome' => $pessoa['nome'], 'sexo' => $pessoa['sexo'], 'convenio' => $convenio,
            'entrada' => $entrada, 'responsaveis' => $responsaveis, 'ativo' => true, 'saida' => null];
        $this->planosDa($indice, $convenio, $entrada);
    }

    private function planosDa(int $paciente, string $convenio, CarbonImmutable $entrada): void
    {
        $quantas = (int) $this->ctx->pesado(['1' => 60, '2' => 32, '3' => 8]);
        $escolhidas = [];
        while (count($escolhidas) < $quantas) {
            $escolhidas[$this->ctx->pesado(self::PESO_ESPECIALIDADE)] = true;
        }
        foreach (array_keys($escolhidas) as $ordem => $especialidade) {
            $inicio = $entrada->addWeeks($ordem * $this->ctx->entre(0, 6));
            $avaliacao = $especialidade === 'Neuropsicologia';
            $fim = null;
            $alta = false;
            if ($avaliacao) {
                $fim = $inicio->addWeeks(10);
                $alta = true;
            } elseif ($this->ctx->chance(0.24)) {
                $fim = $inicio->addDays($this->ctx->entre(120, 330));
                $alta = true;
            } elseif ($this->ctx->chance(0.035)) {
                // a criança que SUMIU: parou de vir sem alta — a fila de pendências existe para ela
                $fim = $this->ctx->hoje->subDays($this->ctx->entre(34, 70));
            }
            $doisPorSemana = in_array($especialidade, ['Fonoaudiologia', 'Terapia Ocupacional'], true) && $this->ctx->chance(0.25);
            $this->ctx->planos[] = ['paciente' => $paciente, 'especialidade' => $especialidade, 'convenio' => $convenio,
                'frequencia' => $doisPorSemana ? 2 : 1, 'entrada' => $inicio, 'fim' => $fim !== null && $fim > $inicio ? $fim : null,
                'alta' => $alta, 'profissional' => -1];
        }
    }

    /**
     * Acha o profissional da especialidade com horário livre na data de entrada. Quem não
     * coube e entrou há pouco vira fila de espera; o resto some (desistiu de esperar).
     *
     * @param  array<string, mixed>  $plano
     */
    private function alocar(array &$plano): bool
    {
        $candidatos = array_keys(array_filter($this->ctx->profissionais, fn (array $p) => $p['especialidade'] === $plano['especialidade']));
        shuffle($candidatos);
        foreach ($candidatos as $profissional) {
            $livres = array_keys(array_filter($this->grade[$profissional], fn (CarbonImmutable $livreEm) => $livreEm <= $plano['entrada']));
            $porDia = [];
            foreach ($livres as $chave) {
                $porDia[(int) explode('|', $chave)[0]] ??= $chave;
            }
            if (count($porDia) < $plano['frequencia']) {
                continue;
            }
            $escolhidos = array_slice($this->embaralhado(array_values($porDia)), 0, $plano['frequencia']);
            foreach ($escolhidos as $chave) {
                $this->grade[$profissional][$chave] = $plano['fim'] ?? CarbonImmutable::create(2999);
            }
            $plano['profissional'] = $profissional;
            $plano['slots_escolhidos'] = $escolhidos;

            return true;
        }
        if ($plano['entrada'] >= $this->ctx->hoje->subDays(75)) {
            $this->semVaga[] = ['paciente' => $plano['paciente'], 'especialidade' => $plano['especialidade'],
                'profissional' => $this->ctx->chance(0.4) ? $candidatos[0] : null, 'entrada' => $plano['entrada']];
        }

        return false;
    }

    /**
     * @param  list<string>  $itens
     * @return list<string>
     */
    private function embaralhado(array $itens): array
    {
        shuffle($itens);

        return $itens;
    }

    private function reservarHorarios(): void
    {
        foreach ($this->ctx->planos as $indice => $plano) {
            $this->ctx->planos[$indice]['slots'] = array_map(function (string $chave): array {
                [$dia, $hora] = explode('|', $chave);

                return [(int) $dia, $hora];
            }, $plano['slots_escolhidos']);
            unset($this->ctx->planos[$indice]['slots_escolhidos']);
        }
    }

    private function filaDeEspera(): void
    {
        $observacoes = ['Encaminhamento do pediatra. Prefere manhã.', 'Só terça e quinta à tarde — quem traz é a avó.',
            'Aceita encaixe de última hora, mora perto.', 'Escola pediu avaliação com urgência.', 'Prefere depois das 16h por causa da escola.',
            'Irmão já é atendido aqui; quer o mesmo dia.', null];
        foreach ($this->semVaga as $espera) {
            $this->ctx->inserir('lista_espera', [
                'paciente_id' => $this->ctx->pacientes[$espera['paciente']]['id'],
                'especialidade_id' => $this->ctx->especialidades[$espera['especialidade']],
                'profissional_id' => $espera['profissional'] !== null ? $this->ctx->profissionais[$espera['profissional']]['id'] : null,
                'prioridade' => (int) $this->ctx->pesado(['0' => 60, '5' => 28, '10' => 12]),
                'obs' => $this->ctx->um($observacoes),
                'created_at' => $this->ctx->utc($espera['entrada']->min($this->ctx->hoje)->setTime(9, 40)),
            ]);
        }
    }
}
