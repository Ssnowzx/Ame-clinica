<?php

namespace App\Http\Requests;

use App\Models\Paciente;
use App\Support\CamposCadastro\CatalogoCamposCadastro;
use App\Support\CamposCadastro\FormaDoCampo as Forma;
use App\Support\CamposCadastro\ReguaDoCadastro;
use Carbon\Carbon;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class PacienteRequest extends FormRequest
{
    /*
     * As listas fechadas e as whitelists moram em `FormaDoCampo` desde a change
     * `cadastro-online-do-paciente`: elas passaram a valer em DOIS boundaries (este e o formulário
     * público), e uma segunda cópia divergiria sem produzir erro — apareceria como uma família
     * conseguindo enviar um valor que a recepção não consegue salvar.
     *
     * Os apelidos ficam para não quebrar quem já os importa.
     */
    public const SEXOS = Forma::SEXOS;

    public const NECESSIDADES = Forma::NECESSIDADES;

    /**
     * O cliente manda SÓ o responsável que aceitou (change aceite-do-regulamento).
     *
     * Instante, termo, versão, forma e autor do registro são do SERVIDOR: a régua da
     * prova não vem de quem está sendo provado (SEC-01 · FA-08).
     */
    private const CHAVES_CONSENTIMENTO = ['responsavel'];

    public function authorize(): bool
    {
        return true; // autorização é do middleware permission: das rotas
    }

    /**
     * A RÉGUA governa a PRESENÇA; o código governa o FORMATO.
     *
     * Obrigatoriedade e visibilidade de cada campo são dado da clínica (§13 — capability
     * `campos-do-cadastro`): quem decide se `sexo` é exigido é a clínica, não este arquivo.
     * O que continua aqui é o que NÃO é preferência de clínica — o formato (data no
     * padrão, CPF com dígito válido, sexo dentro da lista), a unicidade e a estrutura dos
     * JSONs.
     *
     * Sem nenhum override, `presenca()` devolve exatamente os arrays que estavam escritos
     * à mão até esta change — é essa igualdade que faz a suíte de pacientes seguir verde
     * sem uma linha alterada.
     *
     * @param  list<mixed>  $formato  as regras que não são da clínica
     * @return list<mixed>
     */
    private function presenca(string $campo, array $formato = []): array
    {
        $regua = app(ReguaDoCadastro::class);

        // Campo que a clínica escondeu não é aceito nem pela API: esconder na tela e
        // aceitar no payload seria meia guarda, contornável por qualquer cliente.
        //
        // `missing`, NÃO `prohibited` — o design D4 dizia `prohibited`, e a guarda de
        // idioma desta base (ContratoDeBoundaryTest) o reprovou com razão: `prohibited` no
        // Laravel 12 é "ausente OU VAZIO", então a chave presente-e-NULA passaria e o
        // `validated()` a carregaria adiante. Um campo escondido continuaria gravável
        // mandando `null`. `missing` decide por PRESENÇA da chave, com qualquer valor.
        if ($regua->desabilitado($campo)) {
            return ['missing'];
        }

        return $regua->obrigatorio($campo)
            ? ['required', ...$formato]
            : ['sometimes', 'nullable', ...$formato];
    }

    /**
     * Presença de campo-LISTA. `present` é ESTRUTURAL e não sai: o `PUT` é o cadastro
     * inteiro, e sem a chave o Eloquent deixaria a coluna intocada — o que faria "remover
     * todos os responsáveis" virar silêncio. Obrigatório aqui significa "ao menos um".
     *
     * @param  list<mixed>  $estrutura
     * @return list<mixed>
     */
    private function presencaDeLista(string $campo, array $estrutura): array
    {
        $regua = app(ReguaDoCadastro::class);

        if ($regua->desabilitado($campo)) {
            return ['missing'];
        }

        if (! $regua->obrigatorio($campo)) {
            return $estrutura;
        }

        /*
         * `sometimes` SAI quando a lista é obrigatória (parecer SEC-RC-02).
         *
         * `sometimes` desliga TODAS as regras quando a chave está ausente — inclusive o
         * `min:1`. O cliente que simplesmente omitisse `contatos_json` criava paciente sem
         * contato nenhum numa clínica que declarou contato obrigatório, e a listagem então o
         * acusava de incompleto: o sistema aceitava e, na linha seguinte, reclamava do que
         * aceitou. `responsaveis_json` escapava por acaso, porque a estrutura dele já
         * começa com `present`.
         */
        return ['present', ...array_values(array_diff($estrutura, ['sometimes', 'present'])), 'min:1'];
    }

    public function rules(): array
    {
        return [
            'nome' => $this->presenca('nome', Forma::regras('nome')),
            'nome_social' => $this->presenca('nome_social', Forma::regras('nome_social')),
            'nascimento' => $this->presenca('nascimento', Forma::regras('nascimento')),
            'sexo' => $this->presenca('sexo', Forma::regras('sexo')),
            // FORMA da fonte única + a UNICIDADE, que é contexto e mora aqui: ela consulta o
            // banco, e a resposta dela MUST NOT sair pela porta pública — lá, recusar por CPF
            // repetido seria um verificador de clientela aberto na internet
            'cpf' => $this->presenca('cpf', [
                ...Forma::regras('cpf'),
                Rule::unique('pacientes', 'cpf')
                    ->ignore($this->route('id')),
            ]),
            /*
             * Convênio VIGENTE da criança (change convenio-no-cadastro-do-paciente).
             *
             * `exists`, e a recusa é 422 — nunca 404 (D6).
             *
             * Os quatro passam pela régua como os demais: a clínica que só atende
             * particular esconde a seção inteira, e a que exige carteirinha liga na régua
             * — nada de obrigatoriedade chumbada aqui (§13).
             */
            'convenio_id' => $this->presenca('convenio_id', [
                ...Forma::regras('convenio_id'),
                Rule::exists('convenios', 'id'),
            ]),
            'plano' => $this->presenca('plano', Forma::regras('plano')),
            'carteirinha' => $this->presenca('carteirinha', Forma::regras('carteirinha')),
            'carteirinha_validade' => $this->presenca('carteirinha_validade', Forma::regras('carteirinha_validade')),

            'indicacao' => $this->presenca('indicacao', Forma::regras('indicacao')),
            'necessidade' => $this->presenca('necessidade', Forma::regras('necessidade')),
            'estado_civil' => $this->presenca('estado_civil', Forma::regras('estado_civil')),
            'profissao' => $this->presenca('profissao', Forma::regras('profissao')),
            'obs' => $this->presenca('obs', Forma::regras('obs')),
            'ativo' => ['sometimes', 'boolean'], // situação não é campo de cadastro

            'responsaveis_json' => $this->presencaDeLista('responsaveis_json', ['present', 'array', 'max:5']),
            'responsaveis_json.*.nome' => Forma::itensDe('responsaveis_json')['nome'],
            'responsaveis_json.*.parentesco' => Forma::itensDe('responsaveis_json')['parentesco'],
            'responsaveis_json.*.telefone' => Forma::itensDe('responsaveis_json')['telefone'],
            'responsaveis_json.*.email' => Forma::itensDe('responsaveis_json')['email'],

            'contatos_json' => $this->presencaDeLista('contatos_json', ['sometimes', 'array', 'max:10']),
            // formato dos ITENS: quem manda um contato manda um contato inteiro,
            // independentemente de a clínica exigir contato ou não
            'contatos_json.*.tipo' => Forma::itensDe('contatos_json')['tipo'],
            'contatos_json.*.valor' => Forma::itensDe('contatos_json')['valor'],
            'contatos_json.*.obs' => Forma::itensDe('contatos_json')['obs'],

            'endereco_json' => ['sometimes', 'nullable', 'array'],
            'endereco_json.cep' => $this->presenca('endereco_cep', Forma::regras('endereco_cep')),
            'endereco_json.logradouro' => $this->presenca('endereco_logradouro', Forma::regras('endereco_logradouro')),
            'endereco_json.numero' => $this->presenca('endereco_numero', Forma::regras('endereco_numero')),
            'endereco_json.complemento' => $this->presenca('endereco_complemento', Forma::regras('endereco_complemento')),
            'endereco_json.bairro' => $this->presenca('endereco_bairro', Forma::regras('endereco_bairro')),
            'endereco_json.cidade' => $this->presenca('endereco_cidade', Forma::regras('endereco_cidade')),
            'endereco_json.uf' => $this->presenca('endereco_uf', Forma::regras('endereco_uf')),

            // Consentimentos são os NOVOS aceites desta requisição (gate
            // cadastros-pessoas, SEC-01/SEC-02/SEC-10): o servidor CARIMBA o
            // instante e ANEXA aos existentes — nunca substitui a lista.
            //
            // Antes, `aceito_em` vinha do cliente: (a) o relógio do balcão
            // carimbava a prova legal do aceite de um MENOR, (b) o `PUT` do
            // cadastro inteiro, montado sobre cache velho, APAGAVA em silêncio o
            // consentimento que outra aba tinha acabado de registrar.
            //
            // O TERMO deixou de ser texto livre (change aceite-do-regulamento, FA-08):
            // o aceite aponta para a VERSÃO VIGENTE do termo da clínica, e é o servidor
            // que a escolhe. Texto digitado no balcão não prova nada (ninguém consegue
            // exibir depois o que foi aceito) e dois balcões digitando produzem duas
            // réguas. Por isso `termo`, `termo_id`, `versao`, `forma` e `registrado_por`
            // são recusados aqui — como `aceito_em` já era.
            /*
             * A ORIGEM do cadastro, quando ele veio do link público (change
             * `cadastro-online-do-paciente`).
             *
             * Sem isto a coluna `pacientes.envio_de_cadastro_id` era schema morto: nada a
             * escrevia, a ficha não sabia de onde veio, e — pior — apagar o paciente não
             * alcançava a cópia do dado guardada no envio. O caminho de exclusão da LGPD para
             * toda criança vinda pelo link ficava quebrado (SEC-CO-34 / CO-04).
             *
             * Só na CRIAÇÃO: a origem de uma ficha não muda depois. E o `exists` exige envio já
             * CONFERIDO e ainda não vinculado — assim ninguém carimba origem falsa numa ficha
             * nem rouba o vínculo de outra.
             */
            'envio_de_cadastro_id' => $this->route('id') === null
                ? ['sometimes', 'nullable', 'integer', Rule::exists('envios_de_cadastro', 'id')
                    ->where('situacao', 'aceito')
                    ->whereNull('paciente_id')]
                : ['missing'],

            'consentimentos_json' => ['sometimes', 'array', 'max:20'],
            'consentimentos_json.*.responsavel' => ['required', 'string', 'max:255'],
            'consentimentos_json.*.aceito_em' => ['missing'],
            'consentimentos_json.*.termo' => ['missing'],
            'consentimentos_json.*.termo_id' => ['missing'],
            'consentimentos_json.*.versao' => ['missing'],
            'consentimentos_json.*.forma' => ['missing'],
            'consentimentos_json.*.registrado_por' => ['missing'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator): void {
            $this->validarWhitelist($validator, 'responsaveis_json', Forma::CHAVES_RESPONSAVEL);
            $this->validarWhitelist($validator, 'contatos_json', Forma::CHAVES_CONTATO);
            $this->validarWhitelist($validator, 'consentimentos_json', self::CHAVES_CONSENTIMENTO);

            $endereco = $this->input('endereco_json');
            if (is_array($endereco)) {
                $extras = array_diff(array_keys($endereco), Forma::CHAVES_ENDERECO);
                if ($extras !== []) {
                    $validator->errors()->add(
                        'endereco_json',
                        'Chaves não permitidas no endereço: '.implode(', ', $extras).'.'
                    );
                }
            }

            /*
             * MENOR DE IDADE EXIGE RESPONSÁVEL (design D7 — idade calculada).
             *
             * A idade sai do payload OU do registro já gravado (parecer SEC-RC-01). Ler só o
             * corpo da requisição deixava a guarda desligável pela régua: `nascimento` opcional
             * (ou escondido) + `PUT` sem a chave e a guarda nunca era avaliada — o Eloquent não
             * toca a coluna ausente, então a criança seguia com 8 anos no banco e a lista de
             * responsáveis ia a zero, com 200.
             *
             * `nascimento` também virou campo TRAVADO no catálogo, o que fecha a porta pela
             * frente. Esta leitura fecha por baixo: régua é preferência de clínica, menoridade
             * é fato do registro, e nenhuma chave futura da cadeia (changes 2/3/4) volta a
             * alcançar a guarda por um eixo que ninguém previu.
             */
            $nascimento = $this->input('nascimento') ?? $this->nascimentoGravado();
            $responsaveis = (array) $this->input('responsaveis_json', []);
            if (is_string($nascimento)
                && Carbon::hasFormat($nascimento, 'Y-m-d')
                && Carbon::createFromFormat('Y-m-d', $nascimento)->age < 18
                && $responsaveis === []) {
                $validator->errors()->add(
                    'responsaveis_json',
                    'Paciente menor de idade exige pelo menos um responsável.'
                );
            }
        });
    }

    /**
     * O `nascimento` que está NO BANCO para o paciente desta rota (edição), ou `null` na
     * criação.
     */
    private function nascimentoGravado(): ?string
    {
        $id = $this->route('id');

        if ($id === null) {
            return null; // criação: não há registro anterior
        }

        return Paciente::query()->whereKey($id)->value('nascimento')?->format('Y-m-d');
    }

    /** @param  list<string>  $chavesPermitidas */
    private function validarWhitelist(Validator $validator, string $campo, array $chavesPermitidas): void
    {
        foreach ((array) $this->input($campo, []) as $indice => $item) {
            if (! is_array($item)) {
                continue; // já rejeitado pelas rules
            }
            $extras = array_diff(array_keys($item), $chavesPermitidas);
            if ($extras !== []) {
                $validator->errors()->add(
                    "{$campo}.{$indice}",
                    'Chaves não permitidas: '.implode(', ', $extras).'.'
                );
            }
        }
    }

    /**
     * A recusa de campo escondido diz o NOME que a clínica dá ao campo, não o slug.
     *
     * A mensagem genérica de `missing` ("O campo endereco_json.complemento não pode estar
     * presente") joga identificador de máquina na tela — o defeito que a change
     * `texto-de-maquina-fora-da-tela` corrigiu em produção. O rótulo vem do catálogo.
     *
     * @return array<string, string>
     */
    private function mensagensDosCamposEscondidos(): array
    {
        $regua = app(ReguaDoCadastro::class);
        $mensagens = [];

        foreach ($regua->desabilitados() as $campo) {
            $definicao = CatalogoCamposCadastro::definicao($campo);
            $mensagens[$definicao['caminho'].'.missing'] =
                "A clínica não usa o campo \"{$definicao['rotulo']}\" no cadastro.";
        }

        return $mensagens;
    }

    /**
     * A recusa do campo-LISTA obrigatório, na língua da clínica.
     *
     * `min:1` num array cai na mensagem padrão do Laravel e chegava à tela como
     * **"O campo responsáveis deve ter ao menos 1 itens."** — plural errado, e sem dizer
     * de que item se trata. O `attributes()` não alcança isso: ele traduz o NOME do campo,
     * e o defeito está no CORPO da frase.
     *
     * Vem do catálogo pelo mesmo motivo do `attributes()`: campo-lista novo nasce
     * traduzido, em vez de depender de alguém lembrar de acrescentar uma linha aqui.
     *
     * @return array<string, string>
     */
    private function mensagensDeListaObrigatoria(): array
    {
        $mensagens = [];

        foreach (CatalogoCamposCadastro::todos() as $definicao) {
            if (! ($definicao['lista'] ?? false)) {
                continue;
            }

            $mensagens[$definicao['caminho'].'.min'] =
                "Informe pelo menos {$definicao['rotulo_item']}.";
        }

        return $mensagens;
    }

    /**
     * O NOME que a clínica dá a cada campo, para TODA recusa — não só a do campo escondido.
     *
     * Sem isto, o caminho oposto vazava identificador de máquina: tornar `cidade` obrigatória
     * (que é como a clínica de referência opera, e o que o `DemoSeeder` grava) produzia
     * **"O campo endereco json.cidade é obrigatório."** na tela e no toast. É exatamente o
     * defeito que a change `texto-de-maquina-fora-da-tela` corrigiu em produção, voltando
     * pela porta nova (pareceres CR-B5 e SEC-RC-05).
     *
     * Vem do catálogo, então campo novo nasce traduzido — nunca de uma lista à mão, que foi
     * o que deixou `required_unless` passar da última vez.
     *
     * @return array<string, string>
     */
    public function attributes(): array
    {
        $rotulos = [];

        foreach (CatalogoCamposCadastro::todos() as $definicao) {
            $rotulos[$definicao['caminho']] = mb_strtolower($definicao['rotulo']);
        }

        /*
         * Os SUBITENS das listas não estão no catálogo (ele descreve o campo, não a forma
         * interna dele), e por isso escapavam: "O campo responsaveis_json.0.nome é
         * obrigatório." e "O valor escolhido em contatos_json.0.tipo é inválido." chegavam
         * à tela com o slug (parecer SEC-RC-08). O Laravel resolve curinga, então uma
         * entrada por chave cobre todos os índices.
         */
        return [
            ...$rotulos,
            'responsaveis_json.*.nome' => 'nome do responsável',
            'responsaveis_json.*.parentesco' => 'parentesco',
            'responsaveis_json.*.telefone' => 'telefone do responsável',
            'responsaveis_json.*.email' => 'e-mail do responsável',
            'contatos_json.*.tipo' => 'tipo do contato',
            'contatos_json.*.valor' => 'contato',
            'contatos_json.*.obs' => 'observação do contato',
        ];
    }

    public function messages(): array
    {
        return [
            ...$this->mensagensDosCamposEscondidos(),
            ...$this->mensagensDeListaObrigatoria(),
            'cpf.unique' => 'Já existe um paciente com este CPF.',
            'consentimentos_json.*.aceito_em.missing' => 'O instante do aceite é registrado pelo servidor.',
            'consentimentos_json.*.termo.missing' => 'O termo aceito é a versão vigente, definida pelo servidor.',
            'consentimentos_json.*.termo_id.missing' => 'O termo aceito é a versão vigente, definida pelo servidor.',
            'consentimentos_json.*.versao.missing' => 'A versão aceita é definida pelo servidor.',
            'consentimentos_json.*.forma.missing' => 'A forma do aceite é registrada pelo servidor.',
            'consentimentos_json.*.registrado_por.missing' => 'O autor do registro é identificado pelo servidor.',
        ];
    }
}
