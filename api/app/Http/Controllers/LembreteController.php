<?php

namespace App\Http\Controllers;

use App\Models\LembreteEnviado;
use App\Support\Clinica\ResumoDoPaciente;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * O que o disparo automático fez — consultável (change mensageria-whatsapp).
 *
 * Sem esta leitura, o resultado existia só no stdout do cron: seis famílias ficavam sem
 * aviso por falta de telefone e ninguém na clínica tinha como saber quem. A spec de
 * lembretes exige o resultado consultável a quem tem `mensagens.ver`, e era a única parte
 * dela sem porta (achado do gate de code review).
 *
 * Da criança sai só o whitelist mínimo, pela fonte única.
 */
class LembreteController extends Controller
{
    private const POR_PAGINA = 50;

    public function index(Request $request): JsonResponse
    {
        $dados = $request->validate([
            'de' => ['sometimes', 'date_format:Y-m-d'],
            'ate' => ['sometimes', 'date_format:Y-m-d', 'after_or_equal:de'],
            'status' => ['sometimes', 'in:enviado,nao_enviado'],
        ]);

        // sem filtro, a janela é a semana à frente: é o que a recepção olha para saber
        // quem ainda vai ser avisado e quem ficou de fora
        $de = $dados['de'] ?? now()->toDateString();
        $ate = $dados['ate'] ?? now()->addWeek()->toDateString();

        $lembretes = LembreteEnviado::query()
            ->whereBetween('competencia', [$de, $ate])
            ->when($dados['status'] ?? null, fn ($q, $status) => $q->where('status', $status))
            ->with(['agendamento' => fn ($q) => $q->select(['id', 'paciente_id', 'inicio'])
                ->with(ResumoDoPaciente::relacao())])
            ->orderByDesc('competencia')
            ->orderBy('id')
            ->paginate(self::POR_PAGINA);

        return response()->json([
            'itens' => $lembretes->getCollection()->map(fn (LembreteEnviado $lembrete) => [
                'id' => $lembrete->id,
                'competencia' => $lembrete->competencia->format('Y-m-d'),
                'status' => $lembrete->status,
                'motivo' => $lembrete->motivo,
                'enviado' => $lembrete->status === LembreteEnviado::ENVIADO,
                'paciente' => ResumoDoPaciente::deOuNulo($lembrete->agendamento?->paciente),
                'horario' => $lembrete->agendamento?->inicio?->format('Y-m-d H:i'),
            ]),
            'pagina' => $lembretes->currentPage(),
            'ultima_pagina' => $lembretes->lastPage(),
            'total' => $lembretes->total(),
        ]);
    }
}
