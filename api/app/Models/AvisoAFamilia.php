<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * A marca da confirmação do primeiro agendamento que saiu para a família — o que impede a
 * confirmação de sair duas vezes para a mesma criança (change `avisos-do-agendamento-por-whatsapp`).
 * Ver a migration.
 *
 * Não é auditável de propósito, como `LembreteEnviado`: a trilha do que foi dito está na própria
 * `Mensagem` (com autor), e isto é só a marca de idempotência.
 */
class AvisoAFamilia extends Model
{
    /**
     * Uma marca da confirmação sem mensagem é um envio EM ANDAMENTO (outra requisição entre a marca e
     * o envio) — só depois deste prazo ela passa a ser tratada como envio que morreu (rodada 3,
     * CR3-05/SEC-AV-18). Prazo técnico da requisição, não regra da clínica.
     */
    public const MARCA_SEM_MENSAGEM_MINUTOS = 10;

    /** A marca da confirmação do primeiro agendamento — o único aviso que tem marca hoje. */
    public const TIPO_CONFIRMACAO = 'confirmacao';

    protected $table = 'avisos_a_familia';

    protected $fillable = ['tipo', 'chave', 'paciente_id', 'agendamento_id', 'inicio_confirmado', 'mensagem_id'];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['inicio_confirmado' => 'datetime'];
    }

    /**
     * A confirmação falou DESTA sessão como ela está: mesma criança e mesmo horário. É o que deixa a
     * confirmação dispensar o lembrete (change `repescagem-do-lembrete`). Marca sem horário gravado
     * (anterior à coluna) falha FECHADA — o lembrete sai.
     */
    public function anunciou(Agendamento $agendamento): bool
    {
        return $this->paciente_id !== null
            && (int) $this->paciente_id === (int) $agendamento->paciente_id
            && $this->inicio_confirmado !== null
            && $agendamento->inicio !== null
            && $this->inicio_confirmado->format('Y-m-d H:i:s') === $agendamento->inicio->format('Y-m-d H:i:s');
    }

    /**
     * A confirmação desta marca não chegou: a mensagem voltou como falha, ou a marca ficou sem
     * mensagem além do prazo de um envio em andamento. Marca que falhou não vale — nem para barrar
     * uma nova confirmação, nem para dispensar o lembrete do dia (change `repescagem-do-lembrete`).
     * Uma regra só, lida pelos dois: duas cópias divergem na primeira correção feita em uma delas.
     */
    public function falhou(): bool
    {
        if ($this->mensagem_id === null) {
            return $this->created_at === null
                || $this->created_at->lt(now()->subMinutes(self::MARCA_SEM_MENSAGEM_MINUTOS));
        }

        return Mensagem::query()->whereKey($this->mensagem_id)->value('status') === 'falhou';
    }
}
