<?php

namespace App\Observers;

use App\Models\ContatoNormalizado;
use App\Models\Paciente;
use App\Support\Mensageria\ReaberturaDoLembrete;
use App\Support\Mensageria\TelefoneE164;

/**
 * Mantém `contatos_normalizados` em dia com `pacientes.contatos_json`
 * (change mensageria-whatsapp, D6).
 *
 * A projeção é RECONSTRUÍDA a cada gravação, nunca remendada: comparar o JSON velho com o
 * novo para descobrir qual telefone entrou e qual saiu é um diff que erra em silêncio, e o
 * erro dele é uma conversa que deixa de encontrar o paciente. São no máximo 10 contatos por
 * paciente (teto do FormRequest) — apagar e reinserir custa menos que a lógica de acertar.
 *
 * Roda só no `saved`: paciente NÃO tem exclusão física no v1 (decisão LGPD — não existe
 * `pacientes.excluir` nem soft delete), então um observer de `deleted`/`restored` seria
 * código que nunca roda.
 */
class PacienteObserver
{
    public function saved(Paciente $paciente): void
    {
        // sem toque em contatos, a projeção continua válida — e regravar a cada edição de
        // nome seria escrita inútil na rota mais quente do cadastro
        if (! $paciente->wasChanged('contatos_json') && ! $paciente->wasRecentlyCreated) {
            return;
        }

        $this->reconstruir($paciente);

        // o lembrete que saiu para um número que acabou de sair do cadastro volta a pendente, e a
        // repescagem o leva ao número novo (change telefone-que-chega-no-whatsapp, D5). Paciente
        // recém-criado não tem lembrete
        if (! $paciente->wasRecentlyCreated) {
            app(ReaberturaDoLembrete::class)->reabrir($paciente);
        }
    }

    private function reconstruir(Paciente $paciente): void
    {
        ContatoNormalizado::query()->where('paciente_id', $paciente->getKey())->delete();

        $linhas = [];

        foreach ((array) ($paciente->contatos_json ?? []) as $contato) {
            $tipo = is_array($contato) ? ($contato['tipo'] ?? null) : null;

            if (! in_array($tipo, ContatoNormalizado::TIPOS_TELEFONICOS, true)) {
                continue;
            }

            $e164 = TelefoneE164::normalizar($contato['valor'] ?? null);

            // telefone antigo pela metade não trava o cadastro: fica só fora do índice
            if ($e164 === null) {
                continue;
            }

            // o mesmo número em dois contatos do paciente (celular e whatsapp) vira uma linha
            $linhas[$e164] ??= ['paciente_id' => $paciente->getKey(), 'e164' => $e164, 'tipo' => $tipo];
        }

        foreach ($linhas as $linha) {
            ContatoNormalizado::create($linha);
        }
    }
}
