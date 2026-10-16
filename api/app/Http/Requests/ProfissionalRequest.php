<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class ProfissionalRequest extends FormRequest
{
    private const UFS = [
        'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT',
        'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO',
    ];

    /** Dias ISO válidos (1=segunda…7=domingo). */
    private const DIAS = [1, 2, 3, 4, 5, 6, 7];

    /** Teto razoável de intervalos por dia (turno partido raramente passa de 3–4). */
    private const MAX_INTERVALOS_DIA = 10;

    /**
     * Teto do sistema para o atendimento em grupo (change atendimento-em-grupo). A clínica usa
     * 4; o teto existe para que um engano de digitação não vire fail-open silencioso.
     */
    public const SIMULTANEOS_MAXIMO = 10;

    public function authorize(): bool
    {
        return true; // autorização é do middleware permission: das rotas
    }

    /**
     * `boolean` aceita "0"/"1"/0/1 e o cast do model não age na gravação: sem isto a trilha de
     * auditoria guardava `true → "0"` (SEC-MA-01, change mensagens-automaticas-por-profissional).
     * Só normaliza o que já é booleano válido; o resto segue cru para a regra recusar com 422.
     */
    protected function prepareForValidation(): void
    {
        $valor = $this->input('mensagens_automaticas');
        if (in_array($valor, [0, 1, '0', '1'], true)) {
            $this->merge(['mensagens_automaticas' => (bool) (int) $valor]);
        }
    }

    public function rules(): array
    {

        return [
            'nome' => ['required', 'string', 'max:255'],
            // conselho é opcional (D1), mas o trio vem junto quando informado
            'conselho' => ['sometimes', 'nullable', 'string', 'max:20', 'required_with:num_conselho,uf_conselho'],
            'uf_conselho' => ['sometimes', 'nullable', Rule::in(self::UFS), 'required_with:conselho'],
            'num_conselho' => [
                'sometimes', 'nullable', 'string', 'max:20', 'required_with:conselho',
                Rule::unique('profissionais', 'num_conselho')
                    ->where('conselho', $this->input('conselho'))
                    ->where('uf_conselho', $this->input('uf_conselho'))
                    ->ignore($this->route('id')),
            ],
            'cbos_id' => ['sometimes', 'nullable', 'integer', Rule::exists('cbos', 'id')],
            'obs' => ['sometimes', 'nullable', 'string', 'max:2000'],
            // quantos atendimentos sustenta no MESMO intervalo (change atendimento-em-grupo).
            // O teto existe para que a proteção não seja desligada por engano de digitação: um
            // `40` onde se queria `4` transformaria a guarda do eixo profissional em decoração.
            'atendimentos_simultaneos' => ['sometimes', 'integer', 'min:1', 'max:'.self::SIMULTANEOS_MAXIMO],
            // lembrete e confirmação automáticos às famílias (change mensagens-automaticas-por-profissional)
            'mensagens_automaticas' => ['sometimes', 'boolean'],
            'ativo' => ['sometimes', 'boolean'],
            // Horários de atendimento por dia (ISO 1..7) → lista de intervalos {inicio, fim}.
            // Ausente/`{}` ⇒ atende todos os dias na janela padrão (retrocompat de "sem escala =
            // janela cheia"). Cada dia presente exige ≥1 intervalo; início<fim e sem sobreposição
            // são validados em `withValidator` (comparação em minutos, chave INDEXADA por dia).
            'horarios' => ['sometimes', 'nullable', 'array', 'max:7'],
            'horarios.*' => ['array', 'min:1', 'max:'.self::MAX_INTERVALOS_DIA],
            'horarios.*.*' => ['array'],
            'horarios.*.*.inicio' => ['required', 'date_format:H:i'],
            'horarios.*.*.fim' => ['required', 'date_format:H:i'],
            // FK inexistente → 422 (padrão T-fk-01)
            'especialidades' => ['sometimes', 'array', 'max:20'],
            'especialidades.*' => [
                'integer', 'distinct',
                Rule::exists('especialidades', 'id'),
            ],
        ];
    }

    /**
     * O que as regras de wildcard não pegam: a chave de dia em [1..7] e a coerência dos
     * intervalos de um mesmo dia (início<fim, sem sobreposição). Feito em minutos, com a
     * mensagem pousando na CHAVE indexada (`horarios.2.1.fim`) — a tela ancora no campo certo.
     */
    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator): void {
            $horarios = $this->input('horarios');
            if (! is_array($horarios)) {
                return;
            }

            foreach ($horarios as $dia => $intervalos) {
                if (! in_array((int) $dia, self::DIAS, true) || (string) (int) $dia !== (string) $dia) {
                    $validator->errors()->add("horarios.{$dia}", 'Dia de atendimento inválido.');

                    continue;
                }
                if (! is_array($intervalos)) {
                    continue; // já reprovado pelas rules
                }

                $ordenados = [];
                foreach ($intervalos as $indice => $intervalo) {
                    if (! is_array($intervalo) || ! isset($intervalo['inicio'], $intervalo['fim'])) {
                        continue; // já reprovado pelas rules
                    }
                    $inicio = $this->emMinutos($intervalo['inicio']);
                    $fim = $this->emMinutos($intervalo['fim']);
                    if ($inicio === null || $fim === null) {
                        continue; // date_format já reprova
                    }
                    if ($inicio >= $fim) {
                        $validator->errors()->add("horarios.{$dia}.{$indice}.fim", 'O fim do intervalo deve ser depois do início.');

                        continue;
                    }
                    $ordenados[] = ['inicio' => $inicio, 'fim' => $fim, 'indice' => $indice];
                }

                usort($ordenados, fn ($a, $b) => $a['inicio'] <=> $b['inicio']);
                for ($k = 1; $k < count($ordenados); $k++) {
                    if ($ordenados[$k]['inicio'] < $ordenados[$k - 1]['fim']) {
                        $validator->errors()->add(
                            "horarios.{$dia}.{$ordenados[$k]['indice']}.inicio",
                            'Os intervalos de um mesmo dia não podem se sobrepor.'
                        );
                    }
                }
            }
        });
    }

    /** "HH:MM" → minutos do dia, ou null se malformado (a regra `date_format` reprova o resto). */
    private function emMinutos(mixed $hora): ?int
    {
        if (! is_string($hora) || ! preg_match('/^(\d{2}):(\d{2})$/', $hora, $m)) {
            return null;
        }

        return ((int) $m[1]) * 60 + (int) $m[2];
    }

    public function messages(): array
    {
        return [
            'atendimentos_simultaneos.min' => 'O profissional precisa atender ao menos um por vez.',
            'atendimentos_simultaneos.max' => 'O número de atendimentos ao mesmo tempo vai de 1 a '.self::SIMULTANEOS_MAXIMO.'.',
            'mensagens_automaticas.boolean' => 'Escolha se o profissional recebe as mensagens automáticas: sim ou não.',
            'num_conselho.unique' => 'Já existe um profissional com este registro de conselho.',
            'especialidades.*.exists' => 'Especialidade inválida.',
            'horarios.*.min' => 'Cada dia de atendimento precisa de ao menos um intervalo.',
            'horarios.*.*.inicio.required' => 'Informe o início do intervalo.',
            'horarios.*.*.fim.required' => 'Informe o fim do intervalo.',
            'horarios.*.*.inicio.date_format' => 'Horário inválido (use HH:MM).',
            'horarios.*.*.fim.date_format' => 'Horário inválido (use HH:MM).',
        ];
    }
}
