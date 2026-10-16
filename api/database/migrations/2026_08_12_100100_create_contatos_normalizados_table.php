<?php

use App\Support\Mensageria\TelefoneE164;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Índice pesquisável de telefone do paciente em forma canônica E.164
 * (change mensageria-whatsapp, D6).
 *
 * Projeção derivada de `pacientes.contatos_json`, mantida por Observer. Existe porque o
 * telefone é multivalorado dentro de um JSON sem índice: casar o número que chega no webhook
 * com um paciente custaria uma varredura da base A CADA MENSAGEM.
 *
 * Não é fonte da verdade — o cadastro é. Reconstruí-la é sempre seguro, e é o que o backfill
 * abaixo faz. Sem `timestamps` de propósito: linha derivada não tem história própria.
 *
 * `e164` guarda o número COMO ESTÁ no cadastro; a tolerância ao nono dígito vive na consulta
 * (`TelefoneE164::variantes()`), não no dado gravado — inventar dígito no cadastro de alguém
 * é criar um telefone que ninguém digitou.
 */
return new class extends Migration
{
    /** Tipos de contato que são telefone (o cadastro também guarda e-mail). */
    private const TIPOS_TELEFONICOS = ['telefone', 'celular', 'whatsapp'];

    public function up(): void
    {
        Schema::create('contatos_normalizados', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('paciente_id')->constrained('pacientes')->cascadeOnDelete();
            $table->string('e164', 20);
            $table->string('tipo', 20);

            // a busca do webhook: "quem tem este número?"
            $table->index(['e164']);
            // o mesmo número repetido em dois contatos do mesmo paciente vira uma linha só
            $table->unique(['paciente_id', 'e164'], 'contato_norm_unico');
        });

        $this->backfill();
    }

    public function down(): void
    {
        Schema::dropIfExists('contatos_normalizados');
    }

    /**
     * Converte os contatos já cadastrados. Em pedaços porque a base da virada traz a
     * clínica inteira, e um `get()` de tudo carregaria todo paciente na memória.
     */
    private function backfill(): void
    {
        DB::table('pacientes')
            ->select(['id', 'contatos_json'])
            ->whereNotNull('contatos_json')
            ->orderBy('id')
            ->chunk(500, function ($pacientes): void {
                $linhas = [];

                foreach ($pacientes as $paciente) {
                    $contatos = json_decode((string) $paciente->contatos_json, true);

                    if (! is_array($contatos)) {
                        continue;
                    }

                    foreach ($contatos as $contato) {
                        $tipo = is_array($contato) ? ($contato['tipo'] ?? null) : null;

                        if (! in_array($tipo, self::TIPOS_TELEFONICOS, true)) {
                            continue;
                        }

                        $e164 = TelefoneE164::normalizar($contato['valor'] ?? null);

                        // telefone antigo pela metade não trava nada: fica fora do índice
                        if ($e164 === null) {
                            continue;
                        }

                        $linhas["{$paciente->id}|{$e164}"] = [
                            'paciente_id' => $paciente->id,
                            'e164' => $e164,
                            'tipo' => $tipo,
                        ];
                    }
                }

                if ($linhas !== []) {
                    DB::table('contatos_normalizados')->insert(array_values($linhas));
                }
            });
    }
};
