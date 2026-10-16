<?php

namespace App\Support\Agenda;

/**
 * Ícones que um status de agendamento pode exibir na grade (§2.3 do design
 * system). `status_agendamento.tipo` guarda um destes slugs — é DADO editável
 * pela clínica (§13), e a tela NUNCA deriva o ícone do NOME do status.
 *
 * Ampliar esta lista exige o ícone correspondente no design system (o front
 * resolve por mapa literal; slug desconhecido cai no ícone neutro).
 */
class CatalogoIconesStatus
{
    /** @var list<string> */
    public const ICONES = [
        'circle-dot',       // neutro (fallback)
        'circle-dashed',
        'clock',
        'check',
        'clipboard-check',
        'user-x',
        'file-check',
        'calendar-x',
        'bookmark',
        'stethoscope',
        'rotate-ccw',
        'ban',
        'coffee',
        'users',
    ];

    public static function existe(string $slug): bool
    {
        return in_array($slug, self::ICONES, true);
    }
}
