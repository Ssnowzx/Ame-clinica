<?php

namespace App\Support\CadastroOnline;

use App\Support\CamposCadastro\CatalogoCamposCadastro as Catalogo;
use App\Support\CamposCadastro\ReguaDoCadastro;

/**
 * O formulário público, montado a partir da régua da clínica (change
 * `cadastro-online-do-paciente`).
 *
 * **Um catálogo, dois boundaries.** O cadastro interno lê `obrigatorio`/`desabilitado`; o público
 * lê `online` em conjunção com eles. Não existe lista própria aqui: se existisse, ela divergiria
 * do catálogo na primeira vez que alguém acrescentasse um campo — e a divergência apareceria como
 * um campo que a família preenche e o servidor recusa.
 *
 * O que sai daqui é **campo, rótulo e seção**, e nada mais. Nenhuma contagem, nenhuma lista da
 * clínica, nenhuma chave de `configuracoes` — a página que estranhos abrem não entrega dado da
 * clínica além da marca.
 */
class FormularioPublico
{
    public function __construct(private readonly ReguaDoCadastro $regua) {}

    /**
     * Os campos que a família vê, na ordem das seções do catálogo.
     *
     * @return array{secoes: list<array{secao: string, rotulo: string}>, campos: list<array<string, mixed>>}
     */
    public function montar(): array
    {
        $regua = $this->regua->todos();
        $campos = [];

        foreach (Catalogo::SECOES as $secao => $rotuloDaSecao) {
            foreach (Catalogo::todos() as $campo => $definicao) {
                if ($definicao['secao'] !== $secao) {
                    continue;
                }

                // `desabilitado` já venceu `online` na leitura da régua — aqui basta perguntar
                if (! $regua[$campo]['online']) {
                    continue;
                }

                $campos[] = [
                    'campo' => $campo,
                    'rotulo' => $definicao['rotulo'],
                    'secao' => $secao,
                    'lista' => Catalogo::eLista($campo),
                    'obrigatorio' => $regua[$campo]['obrigatorio'],
                    // o TETO do campo, pela mesma razão do rótulo: para que a família também
                    // seja impedida de estourar o limite em vez de descobrir no envio — e sem
                    // que esta tela mantenha número nenhum por conta própria
                    'tamanho' => Catalogo::tamanho($campo),
                    'tamanhos_dos_itens' => (object) Catalogo::tamanhosDosItens($campo),
                ];
            }
        }

        // só as seções que sobraram com campo: seção vazia na tela é passo em branco no assistente
        $secoesUsadas = array_unique(array_column($campos, 'secao'));

        return [
            'secoes' => array_values(array_map(
                fn (string $secao): array => ['secao' => $secao, 'rotulo' => Catalogo::SECOES[$secao]],
                array_filter(array_keys(Catalogo::SECOES), fn (string $s): bool => in_array($s, $secoesUsadas, true)),
            )),
            'campos' => $campos,
        ];
    }

    /**
     * Os campos que o envio pode trazer — a mesma régua, vista do lado da escrita.
     *
     * @return list<string>
     */
    public function camposAceitos(): array
    {
        return array_column($this->montar()['campos'], 'campo');
    }

    /**
     * Os campos que o envio DEVE trazer.
     *
     * @return list<string>
     */
    public function camposExigidos(): array
    {
        return array_column(
            array_filter($this->montar()['campos'], fn (array $campo): bool => $campo['obrigatorio']),
            'campo',
        );
    }
}
