<?php

namespace App\Models;

use App\Observers\PacienteObserver;
use App\Support\Auditoria\Auditavel;
use Database\Factories\PacienteFactory;
use Illuminate\Database\Eloquent\Attributes\ObservedBy;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * Paciente — dados de MENOR (LGPD): sem exclusão física; CPF nunca em claro
 * no diff de auditoria (design D5 — lista revisada pelo parecer da change).
 */
#[ObservedBy(PacienteObserver::class)]
class Paciente extends Model
{
    /** @use HasFactory<PacienteFactory> */
    use Auditavel, HasFactory;

    protected $table = 'pacientes';

    /**
     * Campos mascarados no diff de auditoria. CPF + blobs com dados de terceiros/texto
     * livre; `necessidade` (dado de saúde de MENOR, LGPD art. 11) e `nascimento` (data de
     * nascimento de menor, minimização) — lista REVISADA pelo parecer SEC-APS-01, que
     * reclassificou `necessidade` para art. 11 (antes saía em claro no diff). Uma guarda
     * mecânica reprova se a trilha de pacientes voltar a expor esses dois campos.
     * consentimentos_json fica EM CLARO de propósito — é a prova imutável do aceite
     * (compensação do não-append-only, T-pac-04).
     *
     * @var list<string>
     */
    protected array $auditExclude = [
        'cpf',
        // Identificador do MENOR junto à operadora — mesma classe do CPF, e a mesma
        // política que `Tratamento` já aplica a `matricula` desde o parecer T-trat-06.
        // O dado mudou de casa na change convenio-no-cadastro-do-paciente; a proteção
        // veio junto (D5).
        'carteirinha',
        'responsaveis_json',
        'contatos_json',
        'endereco_json',
        'obs',
        'necessidade',
        'nascimento',
    ];

    protected $fillable = [
        'nome',
        'nome_social',
        'nascimento',
        'sexo',
        'cpf',
        // Convênio VIGENTE da criança (change convenio-no-cadastro-do-paciente, D1). O que
        // valia quando cada pacote foi vendido continua no tratamento — divergir é o
        // registro funcionando, não defeito.
        'convenio_id',
        'plano',
        'carteirinha',
        'carteirinha_validade',
        'responsaveis_json',
        'endereco_json',
        'contatos_json',
        'indicacao',
        'necessidade',
        'estado_civil',
        'profissao',
        'obs',
        'consentimentos_json',
        'ativo',
        // A ORIGEM externa da ficha (change cadastro-online-do-paciente): aponta para o envio
        // do link público que a gerou. Nula no cadastro de balcão, que é o caso comum. O
        // boundary só a aceita na CRIAÇÃO, e só apontando para envio já conferido e sem ficha.
        'envio_de_cadastro_id',
    ];

    protected function casts(): array
    {
        return [
            'nascimento' => 'date:Y-m-d',
            'carteirinha_validade' => 'date:Y-m-d',
            'responsaveis_json' => 'array',
            'endereco_json' => 'array',
            'contatos_json' => 'array',
            'consentimentos_json' => 'array',
            'ativo' => 'boolean',
        ];
    }

    /**
     * O convênio VIGENTE — o de hoje. Não é o do tratamento: cada pacote guarda o que
     * valia quando foi vendido, e os dois podem divergir sem que nenhum esteja errado
     * (change convenio-no-cadastro-do-paciente, D2).
     */
    public function convenio(): BelongsTo
    {
        return $this->belongsTo(Convenio::class);
    }

    public function tratamentos(): HasMany
    {
        return $this->hasMany(Tratamento::class);
    }

    /**
     * Agendamentos do paciente — existe para a pendência de retorno perguntar
     * "este menor tem próxima sessão?" sem subconsulta crua no controller.
     */
    public function agendamentos(): HasMany
    {
        return $this->hasMany(Agendamento::class);
    }
}
