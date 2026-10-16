<?php

namespace Database\Seeders\Apresentacao;

use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Illuminate\Support\Facades\DB;

/**
 * Estado compartilhado entre as etapas da base de apresentação: o relógio da
 * clínica, o sorteio determinístico e os ids que uma etapa produz e a seguinte consome.
 *
 * O sorteio tem SEMENTE FIXA: rodar duas vezes dá a mesma clínica — a apresentação de
 * terça mostra os mesmos números que o ensaio de segunda.
 */
final class Contexto
{
    /** Primeiro dia do histórico (início do mês, `meses` atrás). */
    public readonly CarbonImmutable $inicio;

    /** Hoje, à meia-noite, na parede da clínica. */
    public readonly CarbonImmutable $hoje;

    /** Agora, na parede da clínica — separa passado de futuro no dia de hoje. */
    public readonly CarbonImmutable $agora;

    /** Último dia com agenda semeada (o futuro em aberto). */
    public readonly CarbonImmutable $fimDaAgenda;

    /** @var array<string, int> nome do status → id */
    public array $status = [];

    /** @var array<string, int> nome da especialidade → id */
    public array $especialidades = [];

    /** @var array<string, int> nome da especialidade → tempo de sessão em minutos */
    public array $duracoes = [];

    /**
     * @var list<array{id: int, nome: string, especialidade: string, sala_id: int|null,
     *     horarios: array<int, list<array{0: string, 1: string}>>, usuario_id: int|null}>
     */
    public array $profissionais = [];

    /** @var array<string, array{id: int, particular: bool, precos: array<string, array{servico_id: int, valor: float}>}> */
    public array $convenios = [];

    /** @var array<string, int> chave lógica → id (contas, categorias, tipos de pagamento, usuários...) */
    public array $ids = [];

    /** @var array<string, true> datas Y-m-d em que a clínica não atende */
    public array $feriados = [];

    /** @var list<int> usuários da recepção — quem dá baixa e quem marca */
    public array $recepcao = [];

    /** @var list<int> funcionários (CLT) — interessados da folha */
    public array $funcionarios = [];

    /** @var array<string, int> nome → id dos fornecedores */
    public array $fornecedores = [];

    /**
     * @var list<array{id: int, nome: string, sexo: string, convenio: string, entrada: CarbonImmutable,
     *     responsaveis: list<array{nome: string, parentesco: string, telefone: string}>, ativo: bool, saida: CarbonImmutable|null}>
     */
    public array $pacientes = [];

    /**
     * O "quem faz o quê": cada linha é uma criança numa especialidade, com profissional e
     * horários fixos na semana — é assim que a agenda de uma clínica de terapias se forma.
     *
     * @var list<array{paciente: int, especialidade: string, convenio: string, frequencia: int, entrada: CarbonImmutable,
     *     fim: CarbonImmutable|null, alta: bool, profissional: int, slots: list<array{0: int, 1: string}>}>
     */
    public array $planos = [];

    /**
     * As sessões já gravadas, para o financeiro, os lembretes e a trilha.
     *
     * @var list<array{id: int, plano: int, tratamento_id: int, inicio: CarbonImmutable, fim: CarbonImmutable, status: string}>
     */
    public array $sessoes = [];

    /** @var array<int, list<string>> profissional (índice) → datas Y-m-d bloqueadas */
    public array $bloqueios = [];

    public function __construct(
        public readonly int $adminId,
        string $timezone,
        int $meses,
    ) {
        $this->agora = CarbonImmutable::now($timezone);
        $this->hoje = $this->agora->startOfDay();
        $this->inicio = $this->hoje->subMonthsNoOverflow($meses)->startOfMonth();
        $this->fimDaAgenda = $this->hoje->addWeeks(3)->endOfWeek(CarbonInterface::SUNDAY);
        mt_srand(20261016);
    }

    public function chance(float $probabilidade): bool
    {
        return mt_rand() / mt_getrandmax() < $probabilidade;
    }

    public function entre(int $minimo, int $maximo): int
    {
        return mt_rand($minimo, $maximo);
    }

    /**
     * @template T
     *
     * @param  list<T>  $opcoes
     * @return T
     */
    public function um(array $opcoes): mixed
    {
        return $opcoes[mt_rand(0, count($opcoes) - 1)];
    }

    /**
     * Sorteio com peso: `['PIX' => 45, 'Dinheiro' => 10]`.
     *
     * @param  array<string, int>  $pesos
     */
    public function pesado(array $pesos): string
    {
        $alvo = mt_rand(1, array_sum($pesos));
        foreach ($pesos as $opcao => $peso) {
            $alvo -= $peso;
            if ($alvo <= 0) {
                return (string) $opcao;
            }
        }

        return (string) array_key_last($pesos);
    }

    public function ehDiaDeAtendimento(CarbonImmutable $dia): bool
    {
        return ! $dia->isWeekend() && ! isset($this->feriados[$dia->toDateString()]);
    }

    /** Instante de parede da clínica → UTC, que é como `created_at` mora no banco. */
    public function utc(CarbonImmutable $parede): string
    {
        return $parede->utc()->format('Y-m-d H:i:s');
    }

    /**
     * Insere em lotes, com carimbos. `DB::table` não passa pela trilha de
     * auditoria — a trilha da apresentação é escrita à parte, com datas de verdade.
     *
     * @param  list<array<string, mixed>>  $linhas
     */
    public function inserirEmLote(string $tabela, array $linhas, bool $carimbos = true): void
    {
        $agoraUtc = $this->utc($this->agora);
        foreach (array_chunk($linhas, 500) as $lote) {
            DB::table($tabela)->insert(array_map(function (array $linha) use ($agoraUtc, $carimbos): array {
                if ($carimbos) {
                    $linha['created_at'] ??= $agoraUtc;
                    $linha['updated_at'] ??= $linha['created_at'];
                }

                return $linha;
            }, $lote));
        }
    }

    /** @param  array<string, mixed>  $linha */
    public function inserir(string $tabela, array $linha, bool $carimbos = true): int
    {
        if ($carimbos) {
            $linha['created_at'] ??= $this->utc($this->agora);
            $linha['updated_at'] ??= $linha['created_at'];
        }

        return (int) DB::table($tabela)->insertGetId($linha);
    }
}
