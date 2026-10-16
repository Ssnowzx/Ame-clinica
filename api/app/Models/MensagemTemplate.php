<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * Espelho local de um template aprovado na Meta (change mensageria-whatsapp).
 *
 * SEM `Auditavel`: a linha é cópia de um cadastro que vive no Business Manager e é
 * reescrita a cada sincronização. Auditar a cópia registraria o movimento da máquina,
 * não a decisão de uma pessoa — a decisão (aprovar o texto) aconteceu na Meta.
 *
 * `status_meta` é espelho, não verdade: um template pode ser reprovado DEPOIS de
 * sincronizado. Por isso o envio confere o estado no momento de enviar.
 */
class MensagemTemplate extends Model
{
    public const APROVADO = 'APPROVED';

    protected $table = 'mensagem_templates';

    /**
     * `sincronizado_em` entra aqui porque a rotina de sincronização o grava junto, num
     * `updateOrCreate` — fora do `$fillable` ele era descartado EM SILÊNCIO, ficava nulo, e
     * a limpeza seguinte aposentava o template que acabara de ser sincronizado. Não há
     * payload de cliente que alcance este model: quem escreve aqui é só o sincronizador.
     */
    protected $fillable = ['nome', 'idioma', 'categoria', 'corpo_previa', 'variaveis_json', 'botoes_json', 'status_meta', 'sincronizado_em'];

    protected function casts(): array
    {
        return [
            'variaveis_json' => 'array',
            'botoes_json' => 'array',
            'sincronizado_em' => 'datetime',
        ];
    }

    public function estaAprovado(): bool
    {
        return $this->status_meta === self::APROVADO;
    }

    /** Prefixo do payload de cada botão de resposta rápida: o índice vem depois dos dois-pontos. */
    public const PREFIXO_DO_BOTAO = 'botao:';

    /**
     * O payload de cada botão de resposta rápida, pela POSIÇÃO no modelo (`botao:0`, `botao:1`…).
     * Genérico de propósito: o significado ("confirmar", "desmarcar") é decidido na chegada, só
     * quando a mensagem respondida é um lembrete — nenhum outro modelo herda um significado errado.
     *
     * @return array<int, string>
     */
    public function payloadsDosBotoes(): array
    {
        $payloads = [];
        foreach (array_values((array) $this->botoes_json) as $indice => $botao) {
            if (is_array($botao) && ($botao['tipo'] ?? null) === 'QUICK_REPLY') {
                $payloads[$indice] = self::PREFIXO_DO_BOTAO.$indice;
            }
        }

        return $payloads;
    }

    /**
     * O modelo tem os DOIS botões de resposta rápida que o lembrete entende (change
     * `lembrete-com-botoes-de-resposta`, D2): a ordem é o significado — 1º confirmar, 2º desmarcar.
     * Um só botão, ou botões de outro tipo, não serve: o toque não teria significado certo.
     */
    public function temBotoesDeResposta(): bool
    {
        $rapidos = array_values(array_filter(
            (array) $this->botoes_json,
            fn ($botao): bool => is_array($botao) && ($botao['tipo'] ?? null) === 'QUICK_REPLY',
        ));

        return count($rapidos) === 2 && count((array) $this->botoes_json) === 2;
    }
}
