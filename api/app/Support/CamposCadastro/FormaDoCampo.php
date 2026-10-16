<?php

namespace App\Support\CamposCadastro;

use App\Support\Validacao\DocumentoFiscal;
use App\Support\Validacao\TamanhoMaximo;
use Closure;
use Illuminate\Validation\Rule;

/**
 * A FORMA de cada campo do cadastro do paciente — fonte única, consumida pelos dois boundaries
 * (change `cadastro-online-do-paciente`).
 *
 * "Forma" é o que o campo aceita: tipo, tamanho, formato de data, lista fechada de opções. Não é
 * **presença** (isso vem da régua da clínica, e cada boundary lê a chave dela) e não é **contexto**
 * (unicidade de CPF, existência de convênio — isso mora em quem valida com sessão).
 *
 * Ela nasceu porque a change abriu o SEGUNDO boundary do mesmo cadastro. Com as regras de forma
 * escritas duas vezes, a divergência não apareceria como erro: apareceria como uma família
 * digitando um nome de 300 caracteres que o formulário público aceita e a recepção não consegue
 * salvar — meses depois, sem ninguém ligar uma coisa à outra.
 *
 * O que MUST NOT entrar aqui é tão importante quanto o que entra: **nada que consulte o banco**.
 * A rota pública não pode perguntar se um CPF já existe (seria um verificador de clientela aberto
 * na internet), e uma regra de unicidade escondida aqui chegaria lá de carona.
 */
class FormaDoCampo
{
    /** @var list<string> */
    public const SEXOS = ['feminino', 'masculino', 'outro', 'nao_informado'];

    /** @var list<string> */
    public const NECESSIDADES = ['sem', 'necessidades_especiais', 'outros'];

    /** @var list<string> */
    public const TIPOS_CONTATO = ['telefone', 'celular', 'whatsapp', 'email'];

    /** @var list<string> */
    public const UFS = [
        'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT',
        'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO',
    ];

    /** Whitelists de chaves dos JSONs (design D6 — chave extra → 422). */
    public const CHAVES_RESPONSAVEL = ['nome', 'parentesco', 'telefone', 'email'];

    public const CHAVES_CONTATO = ['tipo', 'valor', 'obs'];

    public const CHAVES_ENDERECO = ['cep', 'logradouro', 'numero', 'complemento', 'bairro', 'cidade', 'uf'];

    /**
     * As regras de FORMA de um campo do catálogo, sem presença e sem consulta ao banco.
     *
     * @return list<mixed>
     */
    public static function regras(string $campo): array
    {
        return match ($campo) {
            'nome', 'nome_social', 'indicacao', 'profissao' => ['string', new TamanhoMaximo(255)],
            'nascimento' => [
                'date_format:Y-m-d',
                'before_or_equal:today',
                'after_or_equal:1900-01-01', // piso de sanidade (parecer, abuse 13)
            ],
            'sexo' => [Rule::in(self::SEXOS)],
            'cpf' => ['digits:11', self::cpfValido()],
            'convenio_id' => ['integer'],
            'plano' => ['string', new TamanhoMaximo(255)],
            'carteirinha' => ['string', new TamanhoMaximo(60)],
            'carteirinha_validade' => ['date_format:Y-m-d', 'after_or_equal:1900-01-01'],
            'necessidade' => [Rule::in(self::NECESSIDADES)],
            'estado_civil' => ['string', new TamanhoMaximo(20)],
            'obs' => ['string', new TamanhoMaximo(2000)],
            'endereco_cep' => ['string', new TamanhoMaximo(9)],
            /*
             * Os tetos do ENDEREÇO são escolha de produto, não restrição de schema:
             * `pacientes.endereco_json` é coluna `json` e o banco não impõe tamanho nenhum.
             * Onde o número não protege nada, ele não pode ser o que impede um cadastro —
             * e em 04/09/2026 foi: a recepção perdeu a ficha inteira no salvar por causa
             * deste `max` (change `tetos-do-cadastro-na-tela`).
             *
             * A régua das medidas, em caracteres: maior nome de rua do mundo 85; endereço
             * rural por descrição (rodovia + km + estrada geral) 81; complemento real com
             * condomínio, portaria e ponto de referência 94 — este ENCOSTAVA nos 100.
             */
            'endereco_logradouro' => ['string', new TamanhoMaximo(500)],
            'endereco_numero' => ['string', new TamanhoMaximo(20)],
            'endereco_complemento' => ['string', new TamanhoMaximo(255)],
            'endereco_bairro', 'endereco_cidade' => ['string', new TamanhoMaximo(150)],
            'endereco_uf' => [Rule::in(self::UFS)],
            /*
             * O `max` destas DUAS continua STRING de propósito: ele conta ITENS, não
             * caracteres. Trocá-lo por `TamanhoMaximo` mandaria "limite de 5 caracteres" para
             * o campo de responsáveis — é a armadilha que `Catalogo::tamanho()` tem teste
             * próprio para não cair.
             */
            // as listas têm forma própria (estrutura + itens): ver `estruturaDeLista` e `itensDe`
            'responsaveis_json' => ['array', 'max:5'],
            'contatos_json' => ['array', 'max:10'],
            default => throw new \InvalidArgumentException("Campo sem forma declarada: {$campo}"),
        };
    }

    /**
     * As regras dos ITENS de um campo-lista.
     *
     * Quem manda um item manda o item inteiro, independentemente de a clínica exigir a lista ou
     * não: a obrigatoriedade governa "quantos", nunca "quão completo".
     *
     * @return array<string, list<mixed>>
     */
    public static function itensDe(string $campo): array
    {
        return match ($campo) {
            'responsaveis_json' => [
                'nome' => ['required', 'string', new TamanhoMaximo(255)],
                'parentesco' => ['required', 'string', new TamanhoMaximo(60)],
                'telefone' => ['sometimes', 'nullable', 'string', new TamanhoMaximo(20)],
                // `string` é EXPLÍCITO ao lado de `email`: o valor sempre foi texto, mas o teto só viaja
                // para a tela quando a forma o declara (design D2) — e o gate pegou este campo
                // ficando de fora por isso
                // `bail` porque `string` e `email` reclamam do MESMO defeito quando o valor não é
                // texto — duas mensagens sobre uma coisa só é o ruído que `TamanhoMaximo` evita
                // três arquivos ao lado (achado MENOR 3 da rodada 2)
                'email' => ['sometimes', 'nullable', 'bail', 'string', 'email', new TamanhoMaximo(255)],
            ],
            'contatos_json' => [
                'tipo' => ['required', Rule::in(self::TIPOS_CONTATO)],
                'valor' => ['required', 'string', new TamanhoMaximo(255)],
                'obs' => ['sometimes', 'nullable', 'string', new TamanhoMaximo(255)],
            ],
            default => throw new \InvalidArgumentException("Campo-lista sem itens declarados: {$campo}"),
        };
    }

    /**
     * O CPF é um número válido? — forma, não unicidade.
     *
     * A distinção é a razão de esta classe existir: `digits:11` e o dígito verificador dizem se o
     * número **pode** ser um CPF, e isso vale nos dois boundaries. Se aquele CPF já é de alguém
     * nesta clínica é outra pergunta, ela consulta o banco, e a resposta dela MUST NOT sair pela
     * porta pública.
     */
    private static function cpfValido(): Closure
    {
        return function (string $attribute, mixed $value, Closure $fail): void {
            // CPF exigido e ausente já falhou em `required` — sem esta saída, quem preenche leria
            // "CPF inválido" para um campo que deixou VAZIO
            if ($value === null || $value === '') {
                return;
            }

            if (! DocumentoFiscal::cpfValido((string) $value)) {
                $fail('CPF inválido.');
            }
        };
    }
}
