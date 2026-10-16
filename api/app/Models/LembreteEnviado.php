<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * O que o disparo automático fez com um agendamento (change mensageria-whatsapp, D3).
 *
 * A linha existe TAMBÉM para o NÃO enviado, com motivo (sem telefone, teto do mês, opt-out):
 * a recepção precisa saber quem ficou sem aviso. Silêncio aqui é alguém achando que a família
 * foi avisada.
 *
 * SEM `Auditavel`: é registro de execução de rotina, não alteração de entidade por uma pessoa
 * — e ele já É a evidência que a trilha buscaria. A mensagem gerada, essa sim, é auditada.
 *
 * `competencia` é o DIA A QUE O LEMBRETE SE REFERE, não o dia do envio: é o que faz "segunda
 * avisada na sexta" conviver com o unique sem que a segunda receba de novo no domingo.
 */
class LembreteEnviado extends Model
{
    public const TIPO_AGENDAMENTO = 'lembrete_agendamento';

    public const ENVIADO = 'enviado';

    public const NAO_ENVIADO = 'nao_enviado';

    /** A família tocou em "Confirmo" (change `lembrete-com-botoes-de-resposta`). */
    public const CONFIRMOU = 'confirmou';

    /** A família tocou em "Preciso desmarcar". */
    public const PEDIU_DESMARQUE = 'pediu_desmarque';

    /** O não enviado do opt-out: a família pediu, e a conversa está marcada sem lembretes. */
    public const MOTIVO_OPT_OUT = 'família pediu para não receber lembretes';

    /**
     * O não enviado da dispensa: a família recebeu a confirmação do primeiro agendamento no dia
     * (change `repescagem-do-lembrete`, D4). É CHAVE, não só texto: a volta de outro dia reconhece a
     * dispensa por ele (CR-RP2-03). Reescrever a frase exige migrar as linhas que a carregam.
     */
    public const MOTIVO_JA_CONFIRMADO = 'a família já recebeu a confirmação deste agendamento';

    /**
     * Os não enviados que são DECISÃO, não falha: o card não os mostra (change
     * telefone-que-chega-no-whatsapp, D4). É lista de EXCLUSÃO de propósito — um motivo de falha novo
     * (teto, modelo recusado, o que vier) aparece por padrão. Esquecer de cadastrar uma falha a
     * deixaria invisível, que é o defeito que esta lista corrige.
     */
    public const MOTIVOS_DE_DECISAO = [self::MOTIVO_OPT_OUT, self::MOTIVO_JA_CONFIRMADO];

    /**
     * A linha sem resposta nenhuma — o que a volta do disparo grava quando a linha passa a falar de
     * OUTRA sessão (change `confirmacao-pela-clinica`, D4): a resposta, da família ou da clínica, era
     * do horário antigo, e herdá-la diria "confirmado" de um horário que a família nunca ouviu.
     */
    public const SEM_RESPOSTA = [
        'resposta' => null,
        'respondido_em' => null,
        'ultimo_toque_em' => null,
        'resposta_mensagem_id' => null,
        'confirmado_por' => null,
    ];

    protected $table = 'lembretes_enviados';

    protected $fillable = ['agendamento_id', 'paciente_id', 'inicio_lembrado', 'tipo', 'competencia', 'mensagem_id', 'status', 'motivo'];

    protected function casts(): array
    {
        return ['competencia' => 'date:Y-m-d', 'respondido_em' => 'datetime', 'ultimo_toque_em' => 'datetime', 'inicio_lembrado' => 'datetime', 'confirmado_por' => 'integer'];
    }

    /** Quem da clínica confirmou (change `confirmacao-pela-clinica`); nulo = a família, pelo botão. */
    public function confirmadoPor(): BelongsTo
    {
        return $this->belongsTo(Usuario::class, 'confirmado_por');
    }

    public function agendamento(): BelongsTo
    {
        return $this->belongsTo(Agendamento::class);
    }

    public function mensagem(): BelongsTo
    {
        return $this->belongsTo(Mensagem::class);
    }

    /**
     * De quem e de que horário o lembrete falou — gravado no disparo (rodada 1 do gate, SEC-BT-01).
     *
     * @return array{paciente_id: int|null, inicio_lembrado: string|null}
     */
    public static function doQueFoiLembrado(Agendamento $agendamento): array
    {
        return [
            'paciente_id' => $agendamento->paciente_id,
            'inicio_lembrado' => $agendamento->inicio?->format('Y-m-d H:i:s'),
        ];
    }

    /**
     * A resposta a ESTE lembrete ainda fala da sessão como ela está: o lembrete saiu, é do tipo do
     * lembrete, e a sessão tem a MESMA criança, o MESMO horário e ainda está marcada. É a regra única
     * do card (`EstadoDaConfirmacao`), do toque (`RespostaAoLembrete`) e — em SQL — do sino
     * (`scopeDaSessaoComoFoiLembrada`): as três discordavam nas bordas antes (rodada 1, CRB-10).
     * Linha sem criança ou sem horário gravados falha FECHADA.
     */
    public function valeParaASessao(Agendamento $agendamento): bool
    {
        return $this->tipo === self::TIPO_AGENDAMENTO
            && $this->status === self::ENVIADO
            && $this->falaDaSessao($agendamento);
    }

    /**
     * Esta linha fala da sessão COMO ELA ESTÁ: mesma criança, mesmo horário (até o segundo) e ainda
     * marcada — sem olhar se o lembrete saiu. É a metade de `valeParaASessao` que o "sem lembrete" do
     * card também usa (change telefone-que-chega-no-whatsapp, D4): remarcar ou trocar a criança apaga
     * o alerta do horário antigo, como apaga a resposta. Linha sem criança ou sem horário falha FECHADA.
     */
    public function falaDaSessao(Agendamento $agendamento): bool
    {
        return $this->paciente_id !== null
            && (int) $this->paciente_id === (int) $agendamento->paciente_id
            && $this->inicio_lembrado !== null
            && $agendamento->inicio !== null
            // até o SEGUNDO, como a igualdade do SQL (`scopeDaSessaoComoFoiLembrada`) — N2-01
            && $this->inicio_lembrado->format('Y-m-d H:i:s') === $agendamento->inicio->format('Y-m-d H:i:s')
            && $agendamento->status instanceof StatusAgendamento
            && $agendamento->status->ehSessaoMarcada();
    }

    /**
     * As linhas que NÃO falam da sessão como ela está agora (`doQueFoiLembrado`): outra criança, outro
     * horário, ou sem um dos dois gravado (falha FECHADA, como `falaDaSessao`). É a metade SQL da regra
     * que a volta do disparo usa para não herdar resposta (change `confirmacao-pela-clinica`, D4).
     *
     * @param  array{paciente_id: int|null, inicio_lembrado: string|null}  $lembrado
     */
    public function scopeDeOutraSessao(Builder $lembretes, array $lembrado): Builder
    {
        return $lembretes->where(fn (Builder $linha): Builder => $linha
            ->whereNull('paciente_id')
            ->orWhereNull('inicio_lembrado')
            ->orWhere('paciente_id', '!=', $lembrado['paciente_id'])
            ->orWhere('inicio_lembrado', '!=', $lembrado['inicio_lembrado']));
    }

    /**
     * A mesma regra de `valeParaASessao`, para uma subconsulta sobre `agendamentos` (o `whereHas` do
     * sino): tipo, enviado, mesma criança e mesmo horário. A sessão marcada fica com quem consulta
     * (`StatusAgendamento::scopeDeSessaoMarcada`).
     */
    public function scopeDaSessaoComoFoiLembrada(Builder $lembretes): Builder
    {
        return $lembretes
            ->where('lembretes_enviados.tipo', self::TIPO_AGENDAMENTO)
            ->where('lembretes_enviados.status', self::ENVIADO)
            ->whereColumn('lembretes_enviados.paciente_id', 'agendamentos.paciente_id')
            ->whereColumn('lembretes_enviados.inicio_lembrado', 'agendamentos.inicio');
    }
}
