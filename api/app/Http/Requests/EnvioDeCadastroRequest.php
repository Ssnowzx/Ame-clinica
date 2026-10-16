<?php

namespace App\Http\Requests;

use App\Support\CadastroOnline\FormularioPublico;
use App\Support\CamposCadastro\CatalogoCamposCadastro as Catalogo;
use App\Support\CamposCadastro\FormaDoCampo as Forma;
use Carbon\Carbon;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Validator;

/**
 * O boundary do envio público (change `cadastro-online-do-paciente`).
 *
 * É a primeira validação do produto que roda **sem sessão**, e por isso ela é escrita ao contrário
 * das outras em dois pontos:
 *
 * 1. **Ela não consulta o banco de pacientes.** Nada de unicidade de CPF, nada de homônimo. No
 *    cadastro interno, recusar por CPF repetido é serviço à recepção; aqui seria um verificador de
 *    clientela aberto na internet — com uma lista de CPFs qualquer um descobriria quais crianças
 *    se tratam nesta clínica, que é dado de saúde por inferência.
 * 2. **Ela recusa o que não pediu, em vez de descartar em silêncio.** `validated()` já jogaria fora
 *    a chave desconhecida, mas descartar não é recusar quando o payload inteiro vai ser gravado e
 *    lido por um humano na fila.
 *
 * O que ela mantém igual ao cadastro interno é o que não pertence à clínica: a **forma** dos campos
 * (fonte única `FormaDoCampo`) e a **guarda do menor** — que é regra legal (art. 14), não
 * preferência, e por isso não é alcançável por nenhuma chave da régua.
 */
class EnvioDeCadastroRequest extends FormRequest
{
    /**
     * Teto do corpo inteiro, em bytes (parecer pré-código, §4-a / ameaça A10).
     *
     * Os tetos por campo já existem, e não bastam: cem campos no teto de cada um somam um corpo
     * que ninguém dimensionou. 64 KB é folgado para um cadastro com cinco responsáveis e uma
     * observação longa, e apertado para quem está tentando entupir a fila.
     */
    private const TETO_DO_CORPO = 65536;

    /** Teto de chaves de topo — o dobro do catálogo inteiro, e ele tem 23 campos. */
    private const TETO_DE_CHAVES = 50;

    public function authorize(): bool
    {
        return true; // a rota é pública por definição; quem a protege é o balde e a fila
    }

    /**
     * As regras saem da RÉGUA da clínica, no instante do envio.
     *
     * "No instante do envio" é requisito, não detalhe de implementação: um formulário aberto há uma
     * hora pode ser recusado porque a régua é a decisão vigente da clínica, e a recusa precisa
     * dizer isso em português (ver `messages`), nunca devolver o nome de uma coluna.
     */
    public function rules(): array
    {
        $formulario = app(FormularioPublico::class);
        $aceitos = $formulario->camposAceitos();
        $exigidos = $formulario->camposExigidos();

        $regras = [];

        foreach (Catalogo::todos() as $campo => $definicao) {
            $caminho = $definicao['caminho'];
            $noFormulario = in_array($campo, $aceitos, true);

            if (! $noFormulario) {
                // RECUSA, não descarte: a chave que a clínica tirou do formulário público não pode
                // chegar em silêncio e ficar guardada no envio esperando alguém olhar
                $regras[$caminho] = ['missing'];

                continue;
            }

            $obrigatorio = in_array($campo, $exigidos, true);

            if (Catalogo::eLista($campo)) {
                $regras[$caminho] = $obrigatorio
                    ? ['present', ...Forma::regras($campo), 'min:1']
                    : ['sometimes', ...Forma::regras($campo)];

                foreach (Forma::itensDe($campo) as $chave => $regrasDoItem) {
                    $regras[$caminho.'.*.'.$chave] = $regrasDoItem;
                }

                continue;
            }

            $regras[$caminho] = $obrigatorio
                ? ['required', ...Forma::regras($campo)]
                : ['sometimes', 'nullable', ...Forma::regras($campo)];
        }

        /*
         * O que NUNCA vem de fora, e por que cada um (parecer pré-código, condição 11):
         *
         * - `consentimentos_json`: a clínica assina o termo NA RECEPÇÃO (resposta da clínica, Q2).
         *   Consentimento de menor forjado por texto vindo da internet seria prova legal fabricada.
         * - `ativo`: situação do cadastro é decisão da clínica, e o envio nem é cadastro ainda.
         * - `id`: a linha é criada pelo servidor, nunca escolhida pelo corpo.
         */
        $regras['consentimentos_json'] = ['missing'];
        $regras['ativo'] = ['missing'];
        $regras['id'] = ['missing'];
        $regras['endereco_json'] = ['sometimes', 'nullable', 'array'];

        return $regras;
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator): void {
            $this->recusarCorpoGrande($validator);
            $this->recusarChaveDesconhecida($validator);
            $this->recusarTextoHostil($validator);
            $this->exigirResponsavelDeMenor($validator);
        });
    }

    /**
     * A GUARDA DO MENOR, e ela vale igual sem sessão.
     *
     * É a mesma regra do cadastro interno (`SEC-RC-01`), e pelo mesmo motivo: a exigência de
     * responsável para quem tem menos de 18 anos é **lei** (LGPD art. 14), não preferência de
     * clínica. Nenhuma chave da régua a alcança — e para garantir isso, `nascimento` e
     * `responsaveis_json` são travados também em `online` no catálogo: sem a data no formulário, a
     * idade seria desconhecida e a guarda simplesmente não rodaria.
     *
     * Diferença em relação ao interno: lá a idade pode vir do registro gravado (é edição); aqui só
     * existe o que a família digitou — não há paciente ainda.
     */
    private function exigirResponsavelDeMenor(Validator $validator): void
    {
        $nascimento = $this->input('nascimento');
        $responsaveis = (array) $this->input('responsaveis_json', []);

        if (
            is_string($nascimento)
            && Carbon::hasFormat($nascimento, 'Y-m-d')
            && Carbon::createFromFormat('Y-m-d', $nascimento)->age < 18
            && $responsaveis === []
        ) {
            $validator->errors()->add(
                'responsaveis_json',
                'Para menor de idade, informe pelo menos um responsável.'
            );
        }
    }

    /**
     * Texto que engana quem confere (parecer pré-código, ameaça A9).
     *
     * Um nome com inversão de escrita mostra ao humano da fila uma coisa e grava outra — e quem
     * clica "aceitar" aceita o que não leu. Caracteres de controle no meio de um nome não têm uso
     * legítimo num formulário de cadastro, e a normalização que a casa já tem remove invisível mas
     * **não** dobra inversão de direção nem letra de outro alfabeto que se parece com a nossa.
     */
    private function recusarTextoHostil(Validator $validator): void
    {
        foreach ($this->all() as $chave => $valor) {
            foreach ($this->textosDe($valor) as $texto) {
                // categoria Cc (controle) e Cf (formatação, onde vivem os `RLO`/`LRO` da inversão),
                // menos os que um texto normal usa (tabulação, quebra de linha)
                if (preg_match('/[\p{Cc}\p{Cf}]/u', str_replace(["\n", "\r", "\t"], '', $texto)) === 1) {
                    $validator->errors()->add(
                        is_string($chave) ? $chave : 'dados',
                        'Este texto tem caracteres que não podemos aceitar. Digite usando apenas letras, números e pontuação.'
                    );

                    return;
                }
            }
        }
    }

    /** @return list<string> */
    private function textosDe(mixed $valor): array
    {
        if (is_string($valor)) {
            return [$valor];
        }

        if (! is_array($valor)) {
            return [];
        }

        $textos = [];
        foreach ($valor as $item) {
            $textos = [...$textos, ...$this->textosDe($item)];
        }

        return $textos;
    }

    /**
     * Sub-chave desconhecida dentro das listas é RECUSADA, não descartada.
     *
     * O boundary interno (`PacienteRequest::validarWhitelist`) já fazia isso; este não fazia, e o
     * docblock desta classe afirmava que fazia. Nada persistia — só o `validated()` é gravado —
     * mas dois boundaries com regras diferentes para o mesmo dado é exatamente a divergência que
     * a extração de `FormaDoCampo` existe para impedir (gate, CO-11/SEC-CO-42).
     *
     * A recusa é a postura certa para uma porta pública: descartar em silêncio esconde de quem
     * mantém o sistema que alguém está mandando o que o formulário não pede.
     */
    private function recusarChaveDesconhecida(Validator $validator): void
    {
        $listas = [
            'responsaveis_json' => Forma::CHAVES_RESPONSAVEL,
            'contatos_json' => Forma::CHAVES_CONTATO,
        ];

        foreach ($listas as $campo => $permitidas) {
            foreach ((array) $this->input($campo, []) as $indice => $item) {
                if (! is_array($item)) {
                    continue; // já recusado pelas rules
                }

                if (array_diff(array_keys($item), $permitidas) !== []) {
                    $validator->errors()->add("{$campo}.{$indice}", 'O formulário mudou desde que você o abriu. Atualize a página e confira os campos antes de enviar.');
                }
            }
        }

        $endereco = $this->input('endereco_json');

        if (is_array($endereco) && array_diff(array_keys($endereco), Forma::CHAVES_ENDERECO) !== []) {
            $validator->errors()->add('endereco_json', 'O formulário mudou desde que você o abriu. Atualize a página e confira os campos antes de enviar.');
        }
    }

    /**
     * Teto do corpo inteiro e do número de chaves.
     *
     * Os tetos por campo não somam: cem campos no máximo de cada um produzem um corpo que ninguém
     * dimensionou, e ele seria gravado cifrado numa fila que um humano vai abrir.
     */
    private function recusarCorpoGrande(Validator $validator): void
    {
        if (strlen((string) $this->getContent()) > self::TETO_DO_CORPO) {
            $validator->errors()->add('dados', 'O formulário enviado é grande demais. Reveja os campos de texto longo.');
        }

        if (count($this->all()) > self::TETO_DE_CHAVES) {
            $validator->errors()->add('dados', 'O formulário enviado tem campos demais.');
        }
    }

    /** @return array<string, string> */
    public function messages(): array
    {
        return [
            // A recusa por campo fora do formulário é o caso "a régua mudou entre carregar e
            // enviar", e quem está do outro lado é uma família, não um integrador: a mensagem diz
            // o que fazer, e não o nome da coluna que sobrou.
            '*.missing' => 'O formulário mudou desde que você o abriu. Atualize a página e confira os campos antes de enviar.',
            'missing' => 'O formulário mudou desde que você o abriu. Atualize a página e confira os campos antes de enviar.',
        ];
    }

    /** @return array<string, string> */
    public function attributes(): array
    {
        $rotulos = [];

        foreach (Catalogo::todos() as $campo => $definicao) {
            $rotulos[$definicao['caminho']] = mb_strtolower($definicao['rotulo']);
        }

        $rotulos['responsaveis_json'] = 'responsáveis';
        $rotulos['responsaveis_json.*.nome'] = 'nome do responsável';
        $rotulos['responsaveis_json.*.parentesco'] = 'parentesco';
        $rotulos['contatos_json'] = 'contatos';
        $rotulos['contatos_json.*.valor'] = 'contato';

        return $rotulos;
    }
}
