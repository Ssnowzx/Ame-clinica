<?php

namespace App\Support\CamposCadastro;

use App\Models\CampoCadastro;
use Illuminate\Database\Eloquent\Model;

/**
 * A régua efetiva do cadastro da clínica: catálogo + overrides, memoizada por
 * requisição (design D7 — instância scoped, sem cache persistente no v1).
 *
 * Sem a memoização, `PacienteRequest`, o controller e a listagem consultariam a mesma
 * tabela três vezes na mesma chamada.
 */
class ReguaDoCadastro
{
    /** @var array<string, array<string, array<string, bool>>> formulário → campo → chave → valor */
    private array $memo = [];

    /**
     * A régua de um campo, já coerente.
     *
     * `desabilitado` VENCE `obrigatorio` E `online` na leitura, mesmo que o banco traga os
     * dois ligados: a escrita recusa a primeira combinação, mas quem lê não pode depender disso —
     * um dado torto vindo de migração ou de console produziria um cadastro impossível
     * de salvar, e o defeito apareceria como 422 sem campo culpado.
     *
     * @return array<string, bool>
     */
    public function doCampo(string $campo, string $formulario = CatalogoCamposCadastro::FORMULARIO_PACIENTE): array
    {
        return $this->todos($formulario)[$campo]
            ?? throw new \InvalidArgumentException("Campo fora do catálogo: {$campo}");
    }

    public function obrigatorio(string $campo, string $formulario = CatalogoCamposCadastro::FORMULARIO_PACIENTE): bool
    {
        return $this->doCampo($campo, $formulario)['obrigatorio'];
    }

    public function desabilitado(string $campo, string $formulario = CatalogoCamposCadastro::FORMULARIO_PACIENTE): bool
    {
        return $this->doCampo($campo, $formulario)['desabilitado'];
    }

    /** Campos que a clínica exige (já sem os escondidos). @return list<string> */
    public function obrigatorios(string $formulario = CatalogoCamposCadastro::FORMULARIO_PACIENTE): array
    {
        return array_keys(array_filter(
            $this->todos($formulario),
            fn (array $regua): bool => $regua['obrigatorio'],
        ));
    }

    /** Campos que a clínica escondeu. @return list<string> */
    public function desabilitados(string $formulario = CatalogoCamposCadastro::FORMULARIO_PACIENTE): array
    {
        return array_keys(array_filter(
            $this->todos($formulario),
            fn (array $regua): bool => $regua['desabilitado'],
        ));
    }

    /**
     * A régua inteira do formulário: campo → chave → valor efetivo.
     *
     * @return array<string, array<string, bool>>
     */
    public function todos(string $formulario = CatalogoCamposCadastro::FORMULARIO_PACIENTE): array
    {
        $chaveMemo = $formulario;

        if (array_key_exists($chaveMemo, $this->memo)) {
            return $this->memo[$chaveMemo];
        }

        $overrides = CampoCadastro::query()
            ->where('formulario', $formulario)
            ->get()
            ->keyBy('campo');

        $regua = [];

        foreach (CatalogoCamposCadastro::todos($formulario) as $campo => $definicao) {
            $override = $overrides->get($campo);
            $valores = [];

            foreach (CatalogoCamposCadastro::CHAVES as $chave) {
                // CHAVE TRAVADA ignora o override, sempre (parecer SEC-RC-07). A validação
                // de trava mora na FormRequest, mas `gravar()` é caminho de persistência
                // SEM ela — o `DemoSeeder` já o chama direto, e um seeder ou migration das
                // changes seguintes reabriria a porta em silêncio. Aqui a leitura grampeia:
                // dado torto no banco deixa de virar comportamento torto na aplicação.
                if (CatalogoCamposCadastro::estaTravado($campo, $chave, $formulario)) {
                    $valores[$chave] = CatalogoCamposCadastro::padrao($campo, $chave, $formulario);

                    continue;
                }

                $daClinica = $override?->getAttribute($chave);
                $valores[$chave] = $daClinica ?? CatalogoCamposCadastro::padrao($campo, $chave, $formulario);
            }

            if ($valores['desabilitado']) {
                $valores['obrigatorio'] = false;
                // `desabilitado` VENCE `online` também (change `cadastro-online-do-paciente`):
                // esconder o campo é decisão mais forte que oferecê-lo lá fora, e a combinação
                // contrária seria a clínica pedindo pela porta de fora o que fechou pela de
                // dentro. A escrita não recusa a combinação — ela é coerente como intenção
                // ("some do meu formulário, mas colete no público" é pedido legítimo de se
                // fazer e ruim de atender); quem a resolve é esta leitura, num lugar só.
                $valores['online'] = false;
            }

            $regua[$campo] = $valores;
        }

        return $this->memo[$chaveMemo] = $regua;
    }

    /**
     * Grava a régua de um campo. Pré-condição: campo e chaves já validados, travas já
     * conferidas (a validação mora na FormRequest — aqui é persistência).
     *
     * @param  array<string, bool>  $chaves
     */
    public function gravar(string $campo, array $chaves, string $formulario = CatalogoCamposCadastro::FORMULARIO_PACIENTE): void
    {
        CampoCadastro::updateOrCreate(
            ['formulario' => $formulario, 'campo' => $campo],
            $chaves,
        );

        unset($this->memo[$formulario]);
    }

    /**
     * Falta, neste paciente, algum campo que a régua declara obrigatório?
     *
     * Vive AQUI, e não em cada controller, porque DOIS consumidores fazem a mesma conta: a
     * listagem (que devolve `cadastro_incompleto` por linha) e a prévia da tela de
     * configuração (que diz quantas fichas ficariam incompletas com a régua proposta).
     * Duas cópias divergiriam, e a divergência apareceria como a tela prometendo um número
     * e a lista mostrando outro.
     *
     * Campo ESCONDIDO nunca chega aqui: `obrigatorios()` já o exclui.
     *
     * @param  list<string>  $obrigatorios
     */
    public function faltaAlgum(Model $paciente, array $obrigatorios, string $formulario = CatalogoCamposCadastro::FORMULARIO_PACIENTE): bool
    {
        foreach ($obrigatorios as $campo) {
            $definicao = CatalogoCamposCadastro::definicao($campo, $formulario);
            $valor = data_get($paciente, $definicao['caminho']);

            // lista vazia é ausência: "exige contato" com `contatos_json = []` não está
            // atendido, e um `empty()` cru também engoliria o inteiro 0 e a string "0"
            $ausente = CatalogoCamposCadastro::eLista($campo, $formulario)
                ? ! is_array($valor) || $valor === []
                : $valor === null || $valor === '';

            if ($ausente) {
                return true;
            }
        }

        return false;
    }

    /**
     * Os obrigatórios que RESULTARIAM de uma proposta ainda não gravada — o que a prévia
     * da tela precisa para contar o impacto antes de salvar.
     *
     * @param  array<string, array<string, bool|null>>  $proposta
     * @return list<string>
     */
    public function obrigatoriosCom(array $proposta, string $formulario = CatalogoCamposCadastro::FORMULARIO_PACIENTE): array
    {
        $obrigatorios = [];

        foreach ($this->todos($formulario) as $campo => $efetivo) {
            $chaves = $proposta[$campo] ?? [];

            // `array_key_exists`, nunca `??`: `false` é uma OPINIÃO ("não é obrigatório"),
            // e um `??` a confundiria com "não opinou". `null` explícito, esse sim, volta
            // ao padrão do catálogo.
            $resolver = fn (string $chave): bool => array_key_exists($chave, $chaves)
                ? ($chaves[$chave] ?? CatalogoCamposCadastro::padrao($campo, $chave, $formulario))
                : $efetivo[$chave];

            if ($resolver('obrigatorio') && ! $resolver('desabilitado')) {
                $obrigatorios[] = $campo;
            }
        }

        return $obrigatorios;
    }

    /** Esquece o memo — para teste, e para quem grava fora do `gravar()`. */
    public function esquecer(): void
    {
        $this->memo = [];
    }
}
