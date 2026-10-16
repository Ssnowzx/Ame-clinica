<?php

namespace App\Rules;

use App\Models\Paciente;
use App\Support\Rbac\EscopoDoProfissional;
use Closure;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Log;

/**
 * A trava de vínculo prévio (`SEC-CP-04`) NO BOUNDARY — e a razão de ela existir aqui, além do
 * serviço, é uma só: **fechar o oráculo COMPOSTO** (`SEC-VP-13`, achado ALTO do gate).
 *
 * A trava do `AgendamentoService` recusa com a mesma mensagem do `Rule::exists`, mas as duas
 * recusas nasciam em pontos DIFERENTES do pipeline — a da inexistência na validação, a do vínculo
 * depois dela. Quando o payload tinha um segundo erro, elas se separavam sozinhas:
 *
 *     criança alheia    + `inicio` inválido  →  errors: ["inicio"]
 *     id inexistente    + `inicio` inválido  →  errors: ["inicio", "paciente_id"]
 *
 * Enumeração perfeita da base, sem escrever nada — e sem registro no canal `seguranca`, porque a
 * trava do serviço nem chegava a rodar. Rodando as duas no MESMO passe de validação, o conjunto
 * de erros passa a ser idêntico nos dois casos.
 *
 * **Isto NÃO substitui a trava do serviço.** O serviço é o funil inescapável (a guarda de
 * arquitetura o fiscaliza) e cobre quem chama sem passar por esta FormRequest — o encaixe da fila,
 * por exemplo, monta o payload no controller. As duas convivem: esta existe pela forma da recusa,
 * aquela pela garantia de alcance.
 */
class PacienteVinculadoAoEscopo implements ValidationRule
{
    public function __construct(
        /** O paciente já gravado, quando editando: só a TROCA exige vínculo (remarcar não concede). */
        private readonly ?int $pacienteAtual = null,
    ) {}

    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        if ($value === null || $value === '') {
            return; // ausência é assunto de `required`/`prohibited_if`, não desta regra
        }

        $pacienteId = (int) $value;

        if ($this->pacienteAtual !== null && $this->pacienteAtual === $pacienteId) {
            return;
        }

        if (app(EscopoDoProfissional::class)->podeVincularPaciente(Auth::user(), $pacienteId)) {
            return;
        }

        // O REGISTRO MORA NA REGRA, não em `failedValidation`: lá a mensagem já é idêntica à da
        // inexistência e não haveria como separar sondagem de typo. Sem ele, o vetor composto do
        // `SEC-VP-13` funcionaria sem rastro, que era metade daquele achado.
        //
        // MAS "aqui sabemos o motivo" era FALSO até a rodada 2, e o code-review mediu: `Rule::exists`
        // não é implícita e não corta a cadeia, então esta regra também roda para id INEXISTENTE — e
        // para um escopado ela devolvia `false` e logava. O canal passava a acusar quem só errou um
        // dígito, e o par de controle não pegava porque usava usuário PLANO, para quem a regra
        // retorna antes de qualquer log: prova na condição errada, de novo.
        //
        // A consulta abaixo é o que torna a frase verdadeira. Ela roda SÓ no caminho de recusa, e
        // MUST NOT mudar a resposta: id inexistente sai por aqui em silêncio e a mensagem continua
        // vindo do `Rule::exists` — idêntica. O que muda é só o log.
        if (! Paciente::whereKey($pacienteId)->exists()) {
            return;
        }

        // O id da criança não entra no log (precedente da GuardaProfissionalDesligado).
        Log::channel('seguranca')->warning('vinculo_previo.bloqueado', [
            'usuario_id' => Auth::id(),
            'profissional_do_escopo_id' => app(EscopoDoProfissional::class)
                ->agenda(Auth::user())->profissionalId(),
            'motivo' => 'paciente sem vínculo prévio com o profissional do escopo (boundary)',
            'ip' => request()->ip(),
        ]);

        // A MENSAGEM É A DA INEXISTÊNCIA, literalmente a mesma que `Rule::exists` produz: para
        // quem é escopado, criança fora do seu vínculo não existe — e essa já era a verdade na
        // leitura dela. Qualquer texto próprio aqui reabriria o oráculo pela mensagem.
        $fail(trans('validation.exists', [
            'attribute' => trans('validation.attributes.'.$attribute),
        ]));
    }
}
