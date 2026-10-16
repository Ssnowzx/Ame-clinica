<?php

namespace App\Models;

use App\Support\Auditoria\Auditavel;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Um envio do formulário público de auto-cadastro (change `cadastro-online-do-paciente`).
 *
 * **É o ENVIO, não um paciente pela metade.** Ele registra o que a família mandou e não se
 * edita: quem se corrige é o cadastro criado no aceite, que nasce sob todas as guardas do
 * cadastro interno. Enquanto pendente, ele não é paciente para efeito nenhum — não aparece em
 * busca, não se agenda, não conta em indicador.
 *
 * O `payload` é CIFRADO em repouso (parecer pré-código, condição 4), no piso que a anamnese já
 * estabeleceu nesta casa: a simples existência de um envio diz que aquela criança busca
 * tratamento nesta clínica, e isso é dado referente à saúde por inferência (art. 11).
 *
 * E ele sai **mascarado da trilha** (`auditExclude`): a auditoria prova o ciclo de vida — houve
 * envio, foi aceito por fulano, quando —, sem repetir o dado do menor. Aqui a regra é mais
 * estrita que a de `pacientes`, e é por escolha: o que chega pela porta pública não passou por
 * ninguém.
 */
class EnvioDeCadastro extends Model
{
    use Auditavel;

    /** @var list<string> */
    public const SITUACOES = ['pendente', 'aceito', 'descartado'];

    protected $table = 'envios_de_cadastro';

    /** O `ip` sai daqui de propósito: quem o grava é a rota, do request, nunca o payload. */
    protected $fillable = ['payload', 'enviado_em'];

    /** @var list<string> */
    protected array $auditExclude = ['payload', 'ip'];

    protected function casts(): array
    {
        return [
            'payload' => 'encrypted:array',
            'enviado_em' => 'datetime',
            'conferido_em' => 'datetime',
            'expurgado_em' => 'datetime',
        ];
    }

    public function paciente(): BelongsTo
    {
        return $this->belongsTo(Paciente::class);
    }

    public function conferidoPor(): BelongsTo
    {
        return $this->belongsTo(Usuario::class, 'conferido_por');
    }

    /** Já foi conferido? Conferido não volta para a fila, e não se confere de novo. */
    public function conferido(): bool
    {
        return $this->situacao !== 'pendente';
    }

    /** O conteúdo já foi apagado pela retenção? A linha sobrevive; o dado, não. */
    public function expurgado(): bool
    {
        return $this->expurgado_em !== null;
    }
}
