<?php

namespace App\Support\Relatorios;

use App\Models\Agendamento;
use App\Models\Profissional;
use App\Support\Rbac\Escopo;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Query\JoinClause;
use Illuminate\Validation\Rule;

/**
 * Relatório `lista-de-presenca` (change `area-de-relatorios`, task 2.2): o papel que a
 * família assina. Por profissional e dia do período, os agendamentos MARCADOS em ordem de
 * horário — hora, criança, convênio, situação — e a coluna "Assinatura" em branco (a coluna
 * existe para o papel ter a linha vazia). Cobre, no ClinicaÁgil, a "Lista de Presença".
 *
 * Marcado é pelas FLAGS (`SituacaoDoAgendamento::marcados`): o status ocupa o horário ou
 * desconta a sessão; o desmarcado fica fora. Sai SEMPRE em `grupos` (um por profissional ×
 * dia, título "Nome — dd/mm/aaaa"); `linhas` do envelope vazias.
 *
 * É de CONFERÊNCIA (AP-09): sai com o nome da criança — só o nome. Sob `agenda.ver`, no
 * eixo AGENDA (D11): o escopado vê só a própria agenda; sem vínculo e sem `agenda.ver_todos`,
 * vazio (fail-closed pelo `Escopo`). O convênio vem do TRATAMENTO do agendamento; sem pacote
 * é "Sem convênio".
 */
final class ListaDePresenca implements Relatorio
{
    /** O corte das linhas é injetável (teste) e por padrão o teto comum do envelope. */
    public function __construct(private readonly int $limiteDeLinhas = Envelope::LIMITE_DE_LINHAS) {}

    public function slug(): string
    {
        return 'lista-de-presenca';
    }

    public function titulo(): string
    {
        return 'Lista de presença';
    }

    public function permissoes(): array
    {
        return ['agenda.ver'];
    }

    public function eixo(): ?string
    {
        return 'agenda';
    }

    public function expoeNomeDaCrianca(): bool
    {
        return true;
    }

    public function usaPeriodo(): bool
    {
        return true;
    }

    public function regras(): array
    {
        // id de filtro existe na base (id inexistente → 422)
        return [
            'profissional_id' => ['sometimes', 'integer', Rule::exists('profissionais', 'id')],
        ];
    }

    public function executar(array $parametros, Escopo $escopo): Envelope
    {
        $consulta = $escopo->aplicar(
            SituacaoDoAgendamento::marcados(
                Agendamento::query()
                    ->where('agendamentos.tipo', 'atendimento')
                    ->whereBetween('agendamentos.inicio', ["{$parametros['de']} 00:00:00", "{$parametros['ate']} 23:59:59"])
                    ->when($parametros['profissional_id'] ?? null, fn (Builder $q, $id) => $q->where('agendamentos.profissional_id', $id)),
            ),
            'agendamentos.profissional_id',
        );

        // ordem: profissional pelo NOME (daí o join; id como desempate para homônimos não se
        // misturarem), depois `inicio` — que já é dia e hora — e id estável.
        // `agendamentos.*` para o join não sobrescrever coluna do model.
        $brutas = (clone $consulta)
            ->join('profissionais', fn (JoinClause $join) => $join
                ->on('profissionais.id', '=', 'agendamentos.profissional_id'))
            ->select('agendamentos.*')
            ->with([
                'paciente:id,nome',
                'profissional:id,nome',
                'status:id,nome',
                'tratamento:id,convenio_id',
                'tratamento.convenio:id,nome',
            ])
            ->orderBy('profissionais.nome')
            ->orderBy('agendamentos.profissional_id')
            ->orderBy('agendamentos.inicio')
            ->orderBy('agendamentos.id')
            ->limit($this->limiteDeLinhas + 1)
            ->get();

        $truncado = $brutas->count() > $this->limiteDeLinhas;
        // com corte, o total é o do RECORTE inteiro (uma contagem a mais só nesse caso)
        $quantidade = $truncado ? (clone $consulta)->count() : $brutas->count();

        // um grupo por profissional × dia, na ordem em que as linhas já vieram do banco;
        // whitelist explícita no transform (lição WHITELIST-do-menor)
        $grupos = [];
        foreach ($brutas->take($this->limiteDeLinhas) as $a) {
            /** @var Agendamento $a */
            $chave = $a->profissional_id.'|'.$a->inicio->format('Y-m-d');
            $grupos[$chave] ??= [
                'titulo' => ($a->profissional?->nome ?? 'Sem profissional').' — '.$a->inicio->format('d/m/Y'),
                'linhas' => [],
                'totais' => ['quantidade' => 0],
            ];
            $grupos[$chave]['linhas'][] = [
                'hora' => $a->inicio->format('H:i'),
                'paciente' => $a->paciente?->nome,
                'convenio' => $a->tratamento?->convenio?->nome ?? 'Sem convênio',
                'situacao' => $a->status?->nome,
                'assinatura' => '',
            ];
            $grupos[$chave]['totais']['quantidade']++;
        }

        return new Envelope(
            slug: $this->slug(),
            titulo: $this->titulo(),
            periodo: ['de' => $parametros['de'], 'ate' => $parametros['ate']],
            filtrosAplicados: $this->filtrosAplicados($parametros),
            colunas: [
                ['chave' => 'hora', 'rotulo' => 'Hora', 'tipo' => 'hora'],
                ['chave' => 'paciente', 'rotulo' => 'Paciente', 'tipo' => 'texto'],
                ['chave' => 'convenio', 'rotulo' => 'Convênio', 'tipo' => 'texto'],
                ['chave' => 'situacao', 'rotulo' => 'Situação', 'tipo' => 'texto'],
                ['chave' => 'assinatura', 'rotulo' => 'Assinatura', 'tipo' => 'texto'],
            ],
            linhas: [],
            grupos: array_values($grupos),
            totais: ['quantidade' => $quantidade],
            truncado: $truncado,
        );
    }

    /**
     * O filtro usado, com o NOME legível — o cabeçalho impresso. O id já passou por `exists`.
     *
     * @param  array<string, mixed>  $parametros
     * @return list<array{rotulo: string, valor: string}>
     */
    private function filtrosAplicados(array $parametros): array
    {
        if (! isset($parametros['profissional_id'])) {
            return [];
        }

        return [['rotulo' => 'Profissional', 'valor' => (string) Profissional::whereKey($parametros['profissional_id'])->value('nome')]];
    }
}
