<?php

namespace App\Support\Clinica;

use App\Models\Paciente;

/**
 * As ÚNICAS colunas de um MENOR que uma tela de OUTRA entidade pode ver.
 *
 * A agenda, a fila, o tratamento — todas precisam dizer DE QUEM é o registro, e nenhuma
 * precisa do cadastro da criança para isso. Exigir `pacientes.ver` para exibir um nome
 * entregaria nascimento, CPF e necessidade (dado de saúde, LGPD art. 11) a quem só
 * precisa saber que o pacote é da Ana.
 *
 * A proteção tem DUAS camadas, e cada uma guarda uma fronteira diferente:
 *
 * 1. **BANCO → app** (`->with(['paciente' => fn ($q) => $q->select(ResumoDoPaciente::CAMPOS)])`):
 *    o cadastro da criança nunca entra na memória do processo — de onde vazaria para um
 *    log, um dump ou um payload de exceção.
 * 2. **app → HTTP** (`ResumoDoPaciente::de()`): mesmo com o model inteiro em mãos,
 *    só três chaves atravessam a resposta.
 *
 * Uma NÃO substitui a outra, e é por isso que esta classe existe: enquanto o whitelist
 * era uma lista literal repetida em cada controller, o teste só conseguia assertar no
 * JSON — o PRODUTO das duas camadas — e ficava verde com qualquer UMA delas de pé
 * (SEC-TR-18). Fonte única, camada testável separadamente.
 */
final class ResumoDoPaciente
{
    /** @var list<string> */
    public const CAMPOS = ['id', 'nome', 'nome_social'];

    /**
     * A camada 1 na forma que o `with()` de string aceita (`'paciente:id,nome,nome_social'`).
     *
     * Existe para que essa string NÃO seja escrita à mão em controller nenhum: era ela a
     * cópia literal que sobrevivia nos três (`ListaEspera`, `Agendamento`, `AgendaSelecao`),
     * cada uma podendo erodir sozinha e em silêncio.
     */
    public static function relacao(string $relacao = 'paciente'): string
    {
        return $relacao.':'.implode(',', self::CAMPOS);
    }

    /** @return array{id: int, nome: string, nome_social: string|null} */
    public static function de(Paciente $paciente): array
    {
        return [
            'id' => $paciente->id,
            'nome' => $paciente->nome,
            'nome_social' => $paciente->nome_social,
        ];
    }

    /** O caso nulo (bloqueio de agenda não tem criança) sem espalhar ternário pelos controllers. */
    public static function deOuNulo(?Paciente $paciente): ?array
    {
        return $paciente === null ? null : self::de($paciente);
    }
}
