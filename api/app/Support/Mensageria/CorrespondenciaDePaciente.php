<?php

namespace App\Support\Mensageria;

use App\Models\ContatoNormalizado;
use App\Models\Paciente;

/**
 * De um telefone que chegou pelo WhatsApp para o paciente — quando dá para ter certeza
 * (change mensageria-whatsapp, D6).
 *
 * A regra é "vincula só quando a correspondência é ÚNICA", e o desempate por ATIVO existe
 * pela realidade da clínica: irmãos dividem o telefone da mãe. Se um deles teve alta e o
 * outro está em terapia, tratar os dois como empate deixaria essa família SEMPRE não
 * vinculada — e a recepção vincularia à mão toda semana, para a mesma pessoa.
 *
 * A ordem é: entre os ATIVOS, um só? vincula. Nenhum ativo e um só inativo? vincula (a
 * família de uma criança que teve alta continua escrevendo, e a conversa é dela). Qualquer
 * outra combinação — dois ativos, dois inativos, nenhum — fica NÃO VINCULADA, para uma
 * pessoa decidir.
 *
 * O que NUNCA acontece: escolher por ordem de cadastro, alfabética ou "o mais recente".
 * Errar aqui é mostrar a conversa de uma criança no prontuário de outra.
 */
class CorrespondenciaDePaciente
{
    /** O cadastro não tem nenhum contato telefônico preenchido. */
    public const SEM_TELEFONE = 'sem_telefone';

    /** O cadastro tem telefone, e nenhum produz forma canônica: foi digitado errado. */
    public const TELEFONE_INVALIDO = 'telefone_invalido';

    /**
     * Como o "não enviado" do lembrete e o "não avisado" do desmarque dizem cada falta. A tela mostra
     * o texto como veio — é ele que manda a recepção ao campo vazio ou ao número errado.
     */
    public const FRASES = [
        self::SEM_TELEFONE => 'sem telefone no cadastro',
        self::TELEFONE_INVALIDO => 'telefone inválido no cadastro',
    ];

    /**
     * @return int|null id do paciente, ou null quando não há certeza
     */
    public static function paraTelefone(?string $telefone): ?int
    {
        $variantes = TelefoneE164::variantes($telefone);

        if ($variantes === []) {
            return null;
        }

        // o join busca `ativo` junto: sem ele seriam duas idas ao banco por mensagem recebida
        $candidatos = ContatoNormalizado::query()
            ->whereIn('contatos_normalizados.e164', $variantes)
            ->join('pacientes', 'pacientes.id', '=', 'contatos_normalizados.paciente_id')
            ->distinct()
            ->pluck('pacientes.ativo', 'pacientes.id');

        $ativos = $candidatos->filter()->keys();

        if ($ativos->count() === 1) {
            return (int) $ativos->first();
        }

        // nenhum ativo: um inativo sozinho ainda é uma correspondência sem ambiguidade
        if ($ativos->isEmpty() && $candidatos->count() === 1) {
            return (int) $candidatos->keys()->first();
        }

        return null;
    }

    /**
     * Os telefones canônicos de um paciente — o caminho inverso, usado pelo disparo de
     * lembrete para saber para onde mandar.
     *
     * @return list<string>
     */
    public static function telefonesDoPaciente(Paciente|int $paciente): array
    {
        $id = $paciente instanceof Paciente ? $paciente->getKey() : $paciente;

        return self::preferidosDe([$id])[$id] ?? [];
    }

    /**
     * O telefone preferido de VÁRIOS pacientes, numa consulta só.
     *
     * Existe porque o disparo de lembrete percorre os agendamentos do dia: com ~400
     * pacientes ativos, perguntar um a um é uma consulta por agendamento — o N+1 clássico,
     * numa rotina que roda sem ninguém olhando.
     *
     * @param  list<int>  $pacienteIds
     * @return array<int, list<string>> paciente_id => telefones, celular/whatsapp na frente
     */
    public static function preferidosDe(array $pacienteIds): array
    {
        if ($pacienteIds === []) {
            return [];
        }

        return ContatoNormalizado::query()
            ->whereIn('paciente_id', $pacienteIds)
            // celular e whatsapp antes de fixo: lembrete em telefone fixo não chega a lugar nenhum
            ->orderByRaw("FIELD(tipo, 'whatsapp', 'celular', 'telefone')")
            ->get(['paciente_id', 'e164'])
            ->groupBy('paciente_id')
            ->map(fn ($linhas) => $linhas->pluck('e164')->all())
            ->all();
    }

    /**
     * Por que estes pacientes não têm telefone para o WhatsApp (change telefone-que-chega-no-whatsapp,
     * D3): nenhum contato telefônico preenchido, ou telefone digitado de um jeito que não chega.
     *
     * Em 02/10 o lembrete dizia "sem telefone cadastrado" para seis crianças que TINHAM telefone —
     * com DDI na frente e um dígito a menos. A recepção procurava um campo vazio que não existia.
     *
     * Uma consulta para o lote inteiro, como `preferidosDe()`. Paciente com algum telefone válido
     * não entra no resultado: ele não está sem telefone, e quem perguntou errou de lista.
     *
     * @param  list<int>  $pacienteIds
     * @return array<int, self::SEM_TELEFONE|self::TELEFONE_INVALIDO>
     */
    public static function faltaDeTelefone(array $pacienteIds): array
    {
        if ($pacienteIds === []) {
            return [];
        }

        $falta = [];

        foreach (Paciente::query()->whereKey($pacienteIds)->get(['id', 'contatos_json']) as $paciente) {
            $telefones = collect((array) ($paciente->contatos_json ?? []))
                ->filter(fn ($contato): bool => is_array($contato) && in_array($contato['tipo'] ?? null, ContatoNormalizado::TIPOS_TELEFONICOS, true))
                ->map(fn (array $contato): string => trim((string) ($contato['valor'] ?? '')))
                ->reject(fn (string $valor): bool => $valor === '');

            if ($telefones->contains(fn (string $valor): bool => TelefoneE164::normalizar($valor) !== null)) {
                continue;
            }

            $falta[(int) $paciente->id] = $telefones->isEmpty() ? self::SEM_TELEFONE : self::TELEFONE_INVALIDO;
        }

        return $falta;
    }
}
