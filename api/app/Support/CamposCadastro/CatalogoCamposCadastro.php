<?php

namespace App\Support\CamposCadastro;

use App\Support\Validacao\TamanhoMaximo;
use InvalidArgumentException;

/**
 * Catálogo dos campos configuráveis do cadastro (design D1/D3): campo → rótulo,
 * seção, caminho no payload, coluna de origem, padrão de cada chave e travas.
 *
 * O catálogo é METADADO e vive em código; o VALOR é dado (override da clínica em
 * `campos_cadastro`). É a régua que a §13 exige: o que a clínica exige de uma família
 * não pode estar chumbado em `PacienteRequest`.
 *
 * Duas coisas que este catálogo NÃO governa, de propósito:
 *
 * - **A guarda de menor-exige-responsável** (design D5). É regra legal (LGPD — dado de
 *   menor), não preferência de clínica: vira `withValidator`, nunca linha configurável.
 * - **A estrutura dos JSONs** (whitelist de chaves, tipo de contato, UF). Isso é
 *   contrato de dado, não régua de preenchimento.
 */
class CatalogoCamposCadastro
{
    public const FORMULARIO_PACIENTE = 'paciente';

    /** @var list<string> */
    public const FORMULARIOS = [self::FORMULARIO_PACIENTE];

    /**
     * As QUATRO chaves da régua. `rapido` e `online` são declaradas desde já e ainda
     * NÃO têm efeito — são das changes 3 e 4 da cadeia. O catálogo as declara para que o
     * schema não precise mudar quando elas chegarem (design D2).
     *
     * @var list<string>
     */
    public const CHAVES = ['obrigatorio', 'desabilitado', 'rapido', 'online'];

    /**
     * As chaves que o produto de fato aplica. A escrita aceita só estas: oferecer uma chave
     * antes de ela existir seria gravar configuração que não faz nada.
     *
     * `online` entrou com a change `cadastro-online-do-paciente` — ela é quem decide o que a
     * família vê no formulário público. `rapido` segue declarada e inerte (change 3 da cadeia).
     *
     * @var list<string>
     */
    public const CHAVES_ATIVAS = ['obrigatorio', 'desabilitado', 'online'];

    /** @var array<string, string> */
    public const SECOES = [
        'identificacao' => 'Identificação',
        // O convênio VIGENTE da criança (change convenio-no-cadastro-do-paciente). Vem
        // logo depois da identificação porque é o que a recepção precisa para atender
        // ANTES de existir qualquer tratamento aberto.
        'convenio' => 'Convênio',
        'responsaveis' => 'Responsáveis',
        'contatos' => 'Contatos',
        'endereco' => 'Endereço',
        'outros' => 'Outros',
    ];

    /**
     * O padrão de cada campo reproduz EXATAMENTE a obrigatoriedade que valia antes desta
     * change (`nome`, `nascimento`, `sexo`, `necessidade` obrigatórios) — clínica sem
     * override não muda de comportamento.
     *
     * `lista` marca campo que é coleção: obrigatório ali significa "ao menos um item".
     * Campo-lista declara TAMBÉM `rotulo_item`, o nome do item no singular e já com
     * artigo ("um responsável"), que é o que a recusa fala. Sem ele, o Laravel devolve o
     * plural do `min` em array — "deve ter ao menos 1 itens" — com a concordância errada
     * e sem dizer de que item se trata.
     *
     * @var array<string, array{
     *     rotulo: string, secao: string, caminho: string, coluna: string,
     *     lista?: bool, rotulo_item?: string, padrao: array<string, bool>,
     *     travas?: list<string>, motivo?: string
     * }>
     */
    private const BASE = [
        'nome' => [
            'rotulo' => 'Nome',
            'secao' => 'identificacao',
            'caminho' => 'nome',
            'coluna' => 'nome',
            'padrao' => ['obrigatorio' => true, 'desabilitado' => false, 'rapido' => true, 'online' => true],
            // `online` travado junto (parecer pré-código do auto-cadastro, condição 1): um
            // formulário público sem nome não coleta cadastro nenhum.
            'travas' => ['obrigatorio', 'desabilitado', 'online'],
            'motivo' => 'Um cadastro sem nome não é um cadastro, e o aviso de nome repetido deixa de funcionar sem ele — nem no formulário da clínica, nem no público.',
        ],
        'nome_social' => [
            'rotulo' => 'Nome social',
            'secao' => 'identificacao',
            'caminho' => 'nome_social',
            'coluna' => 'nome_social',
            'padrao' => ['obrigatorio' => false, 'desabilitado' => false, 'rapido' => false, 'online' => false],
        ],
        'nascimento' => [
            'rotulo' => 'Nascimento',
            'secao' => 'identificacao',
            'caminho' => 'nascimento',
            'coluna' => 'nascimento',
            'padrao' => ['obrigatorio' => true, 'desabilitado' => false, 'rapido' => false, 'online' => true],
            // TRAVADO por segurança (parecer SEC-RC-01): é a data de nascimento que diz se o
            // paciente é MENOR, e a exigência legal de responsável (LGPD art. 14) se avalia a
            // partir dela. Afrouxar ou esconder `nascimento` fazia a guarda deixar de rodar —
            // o `PUT` sem a chave apagava os responsáveis de uma criança já cadastrada, com 200.
            // A régua governa preferência de clínica; menoridade é fato do registro.
            //
            // `online` ENTROU NA TRAVA na change `cadastro-online-do-paciente` (parecer
            // pré-código, condição 1 / ameaça A1), e é o buraco que ninguém tinha visto: a trava
            // é POR CHAVE, e dizer que o campo é travado sem dizer em quais chaves deixa aberta
            // justamente a que ninguém olhou. Com `online` livre, desmarcá-la tirava a data do
            // formulário público; o envio chegava sem nascimento, `PacienteRequest` lia `null`
            // (não há registro gravado de onde ler, é criação), a idade ficava desconhecida e
            // NENHUM responsável era exigido. A guarda do art. 14 virava uma caixa de seleção
            // na tela de configurações — pelo eixo que o comentário acima jurava ter fechado.
            'travas' => ['obrigatorio', 'desabilitado', 'online'],
            'motivo' => 'É a data de nascimento que diz se o paciente é menor de idade — e é por ela que o sistema sabe quando exigir um responsável. Sem ela, essa proteção deixa de valer, inclusive no formulário público.',
        ],
        'sexo' => [
            'rotulo' => 'Sexo',
            'secao' => 'identificacao',
            'caminho' => 'sexo',
            'coluna' => 'sexo',
            'padrao' => ['obrigatorio' => true, 'desabilitado' => false, 'rapido' => true, 'online' => true],
        ],
        'cpf' => [
            'rotulo' => 'CPF',
            'secao' => 'identificacao',
            'caminho' => 'cpf',
            'coluna' => 'cpf',
            'padrao' => ['obrigatorio' => false, 'desabilitado' => false, 'rapido' => true, 'online' => true],
            'travas' => ['desabilitado'],
            'motivo' => 'O CPF pode ser exigido ou não, mas não pode sumir da tela: é ele que impede cadastrar a mesma criança duas vezes, e a recusa por CPF repetido precisa ter onde aparecer.',
        ],
        /*
         * Convênio vigente (change convenio-no-cadastro-do-paciente, D7).
         *
         * Padrão CONSERVADOR nas quatro chaves: nenhum obrigatório — a clínica que só
         * atende particular não pode ser forçada a preencher, e a que quiser exigir liga
         * na régua. Nenhum no cadastro RÁPIDO: o rápido existe para pôr a criança na
         * agenda hoje, e convênio se resolve depois.
         *
         * Sem TRAVAS, de propósito: os quatro podem ser escondidos, e a seção inteira
         * some sem virar cabeçalho vazio. Travar aqui obrigaria toda clínica particular a
         * conviver com um bloco que não usa.
         */
        'convenio_id' => [
            'rotulo' => 'Convênio',
            'secao' => 'convenio',
            'caminho' => 'convenio_id',
            'coluna' => 'convenio_id',
            'padrao' => ['obrigatorio' => false, 'desabilitado' => false, 'rapido' => false, 'online' => false],
            'travas' => ['online'],
            'motivo' => 'Convênio, plano e carteirinha ficam fora do formulário público: oferecê-los exigiria mostrar a lista de convênios da clínica a quem abre o link, e essa página não entrega nenhum dado da clínica além da marca.',
        ],
        'plano' => [
            'rotulo' => 'Plano',
            'secao' => 'convenio',
            'caminho' => 'plano',
            'coluna' => 'plano',
            'padrao' => ['obrigatorio' => false, 'desabilitado' => false, 'rapido' => false, 'online' => false],
            'travas' => ['online'],
            'motivo' => 'Convênio, plano e carteirinha ficam fora do formulário público: oferecê-los exigiria mostrar a lista de convênios da clínica a quem abre o link, e essa página não entrega nenhum dado da clínica além da marca.',
        ],
        'carteirinha' => [
            'rotulo' => 'Carteirinha',
            'secao' => 'convenio',
            'caminho' => 'carteirinha',
            'coluna' => 'carteirinha',
            'padrao' => ['obrigatorio' => false, 'desabilitado' => false, 'rapido' => false, 'online' => false],
            'travas' => ['online'],
            'motivo' => 'Convênio, plano e carteirinha ficam fora do formulário público: oferecê-los exigiria mostrar a lista de convênios da clínica a quem abre o link, e essa página não entrega nenhum dado da clínica além da marca.',
        ],
        'carteirinha_validade' => [
            'rotulo' => 'Validade da carteirinha',
            'secao' => 'convenio',
            'caminho' => 'carteirinha_validade',
            'coluna' => 'carteirinha_validade',
            'padrao' => ['obrigatorio' => false, 'desabilitado' => false, 'rapido' => false, 'online' => false],
            'travas' => ['online'],
            'motivo' => 'Convênio, plano e carteirinha ficam fora do formulário público: oferecê-los exigiria mostrar a lista de convênios da clínica a quem abre o link, e essa página não entrega nenhum dado da clínica além da marca.',
        ],
        'necessidade' => [
            'rotulo' => 'Necessidade',
            'secao' => 'identificacao',
            'caminho' => 'necessidade',
            'coluna' => 'necessidade',
            'padrao' => ['obrigatorio' => true, 'desabilitado' => false, 'rapido' => false, 'online' => false],
        ],
        'indicacao' => [
            'rotulo' => 'Indicação',
            'secao' => 'identificacao',
            'caminho' => 'indicacao',
            'coluna' => 'indicacao',
            'padrao' => ['obrigatorio' => false, 'desabilitado' => false, 'rapido' => true, 'online' => true],
        ],
        'responsaveis_json' => [
            'rotulo' => 'Responsáveis',
            'secao' => 'responsaveis',
            'caminho' => 'responsaveis_json',
            'coluna' => 'responsaveis_json',
            'lista' => true,
            'rotulo_item' => 'um responsável',
            'padrao' => ['obrigatorio' => false, 'desabilitado' => false, 'rapido' => true, 'online' => true],
            // `online` travado pelo mesmo motivo do `nascimento` (parecer pré-código, condição 1):
            // exigir um responsável num formulário que não tem onde informá-lo é recusar a
            // família sem saída — a guarda dispararia e não haveria campo para atendê-la.
            'travas' => ['desabilitado', 'online'],
            'motivo' => 'A lei exige responsável para paciente menor de idade, então o campo não pode sumir do formulário — nem do da clínica, nem do público. Exigi-lo também para adultos é escolha da clínica.',
        ],
        'contatos_json' => [
            'rotulo' => 'Contatos',
            'secao' => 'contatos',
            'caminho' => 'contatos_json',
            'coluna' => 'contatos_json',
            'lista' => true,
            'rotulo_item' => 'um contato',
            'padrao' => ['obrigatorio' => false, 'desabilitado' => false, 'rapido' => true, 'online' => true],
        ],
        'endereco_cep' => [
            'rotulo' => 'CEP',
            'secao' => 'endereco',
            'caminho' => 'endereco_json.cep',
            'coluna' => 'endereco_json',
            'padrao' => ['obrigatorio' => false, 'desabilitado' => false, 'rapido' => true, 'online' => true],
        ],
        'endereco_logradouro' => [
            'rotulo' => 'Logradouro',
            'secao' => 'endereco',
            'caminho' => 'endereco_json.logradouro',
            'coluna' => 'endereco_json',
            'padrao' => ['obrigatorio' => false, 'desabilitado' => false, 'rapido' => true, 'online' => true],
        ],
        'endereco_numero' => [
            'rotulo' => 'Número',
            'secao' => 'endereco',
            'caminho' => 'endereco_json.numero',
            'coluna' => 'endereco_json',
            'padrao' => ['obrigatorio' => false, 'desabilitado' => false, 'rapido' => false, 'online' => false],
        ],
        'endereco_complemento' => [
            'rotulo' => 'Complemento',
            'secao' => 'endereco',
            'caminho' => 'endereco_json.complemento',
            'coluna' => 'endereco_json',
            'padrao' => ['obrigatorio' => false, 'desabilitado' => false, 'rapido' => false, 'online' => false],
        ],
        'endereco_bairro' => [
            'rotulo' => 'Bairro',
            'secao' => 'endereco',
            'caminho' => 'endereco_json.bairro',
            'coluna' => 'endereco_json',
            'padrao' => ['obrigatorio' => false, 'desabilitado' => false, 'rapido' => false, 'online' => false],
        ],
        'endereco_cidade' => [
            'rotulo' => 'Cidade',
            'secao' => 'endereco',
            'caminho' => 'endereco_json.cidade',
            'coluna' => 'endereco_json',
            'padrao' => ['obrigatorio' => false, 'desabilitado' => false, 'rapido' => false, 'online' => false],
        ],
        'endereco_uf' => [
            'rotulo' => 'UF',
            'secao' => 'endereco',
            'caminho' => 'endereco_json.uf',
            'coluna' => 'endereco_json',
            'padrao' => ['obrigatorio' => false, 'desabilitado' => false, 'rapido' => false, 'online' => false],
        ],
        'estado_civil' => [
            'rotulo' => 'Estado civil',
            'secao' => 'outros',
            'caminho' => 'estado_civil',
            'coluna' => 'estado_civil',
            'padrao' => ['obrigatorio' => false, 'desabilitado' => false, 'rapido' => false, 'online' => false],
        ],
        'profissao' => [
            'rotulo' => 'Profissão',
            'secao' => 'outros',
            'caminho' => 'profissao',
            'coluna' => 'profissao',
            'padrao' => ['obrigatorio' => false, 'desabilitado' => false, 'rapido' => false, 'online' => true],
        ],
        'obs' => [
            'rotulo' => 'Observação',
            'secao' => 'outros',
            'caminho' => 'obs',
            'coluna' => 'obs',
            'padrao' => ['obrigatorio' => false, 'desabilitado' => false, 'rapido' => true, 'online' => true],
        ],
    ];

    /** @var array<string, array<string, mixed>> extensões de teste */
    private static array $extras = [];

    /** @return array<string, array<string, mixed>> */
    public static function todos(string $formulario = self::FORMULARIO_PACIENTE): array
    {
        self::exigirFormulario($formulario);

        return array_merge(self::BASE, self::$extras);
    }

    public static function existe(string $campo, string $formulario = self::FORMULARIO_PACIENTE): bool
    {
        return array_key_exists($campo, self::todos($formulario));
    }

    /** @return array<string, mixed> */
    public static function definicao(string $campo, string $formulario = self::FORMULARIO_PACIENTE): array
    {
        $todos = self::todos($formulario);

        if (! array_key_exists($campo, $todos)) {
            throw new InvalidArgumentException("Campo desconhecido no catálogo: {$campo}");
        }

        return $todos[$campo];
    }

    public static function padrao(string $campo, string $chave, string $formulario = self::FORMULARIO_PACIENTE): bool
    {
        return self::definicao($campo, $formulario)['padrao'][$chave] ?? false;
    }

    /** Chaves que a clínica NÃO pode mexer neste campo. @return list<string> */
    public static function travas(string $campo, string $formulario = self::FORMULARIO_PACIENTE): array
    {
        return self::definicao($campo, $formulario)['travas'] ?? [];
    }

    public static function estaTravado(string $campo, string $chave, string $formulario = self::FORMULARIO_PACIENTE): bool
    {
        return in_array($chave, self::travas($campo, $formulario), true);
    }

    public static function eLista(string $campo, string $formulario = self::FORMULARIO_PACIENTE): bool
    {
        return self::definicao($campo, $formulario)['lista'] ?? false;
    }

    /**
     * O TETO DE TEXTO do campo — **derivado da forma, nunca redigitado aqui**.
     *
     * Este acessor existe para que o formulário possa impedir o excesso ANTES do salvar, e o
     * número que ele entrega é literalmente o objeto que o servidor usa para recusar. Escrever
     * o teto uma segunda vez no catálogo seria a divergência que `FormaDoCampo` nasceu para
     * impedir: ela não apareceria como erro, apareceria como uma família digitando o que a tela
     * aceita e o servidor recusa, meses depois, sem ninguém ligar uma coisa à outra.
     *
     * Devolve `null` para campo sem teto de TEXTO — data, lista fechada, número. E o caso que
     * pede atenção: `responsaveis_json` e `contatos_json` têm `max:5`/`max:10`, que contam
     * **itens**. Como só os campos de texto carregam `TamanhoMaximo`, eles caem no `null`
     * sozinhos — mas isso tem teste, porque uma derivação ingênua ("ache um `max` e devolva o
     * número") mandaria à tela um limite de 5 caracteres para a lista de responsáveis.
     */
    public static function tamanho(string $campo, string $formulario = self::FORMULARIO_PACIENTE): ?int
    {
        self::definicao($campo, $formulario); // campo fora do catálogo continua sendo erro

        return self::tamanhoEm(FormaDoCampo::regras($campo));
    }

    /**
     * Os tetos dos SUBCAMPOS de um campo-lista (nome do responsável, valor do contato).
     *
     * Sem eles, os únicos campos de texto do cadastro que continuariam reclamando só no salvar
     * seriam justamente os das listas — e a próxima ligação da clínica seria sobre eles.
     *
     * @return array<string, int>
     */
    public static function tamanhosDosItens(string $campo, string $formulario = self::FORMULARIO_PACIENTE): array
    {
        if (! self::eLista($campo, $formulario)) {
            return [];
        }

        $tamanhos = [];
        foreach (FormaDoCampo::itensDe($campo) as $chave => $regras) {
            $teto = self::tamanhoEm($regras);
            if ($teto !== null) {
                $tamanhos[$chave] = $teto;
            }
        }

        return $tamanhos;
    }

    /**
     * O teto de uma lista de regras.
     *
     * **Público** para que a invariante do D2 tenha teste próprio, sem depender de existir hoje
     * um campo que a viole — testar uma guarda só através de um defeito real significa não
     * poder testá-la enquanto o defeito não existe.
     *
     * Devolve o PRIMEIRO teto encontrado. Duas regras `TamanhoMaximo` na mesma lista fariam a
     * tela mostrar uma e o servidor aplicar a menor, em silêncio; não acontece hoje (cada campo
     * declara uma, num `match` escrito à mão), mas se um dia forem compostas este método precisa
     * devolver o MENOR.
     *
     * @internal público só para o teste da invariante — não é API de consumo
     *
     * @param  list<mixed>  $regras
     */
    public static function tamanhoEm(array $regras): ?int
    {
        /*
         * A COMPANHIA DA REGRA `string` é condição, não decoração (design D2, e o code review
         * apontou que o código não a exigia).
         *
         * Hoje só campo de texto carrega `TamanhoMaximo`, então a guarda parece redundante —
         * mas o design promete "tamanho SOMENTE quando `string` acompanha o teto", e um campo
         * futuro que usasse `TamanhoMaximo` sobre outra coisa mandaria à tela um limite de
         * caracteres que o servidor não aplica a caracteres. Ou o código cumpre o que o design
         * diz, ou o design descreve outra invariante; escolhi a primeira.
         */
        if (! in_array('string', $regras, true)) {
            return null;
        }

        foreach ($regras as $regra) {
            if ($regra instanceof TamanhoMaximo) {
                return $regra->limite;
            }
        }

        return null;
    }

    /** Colunas de `pacientes` necessárias para avaliar os campos dados (design D6). @param list<string> $campos @return list<string> */
    public static function colunasDe(array $campos, string $formulario = self::FORMULARIO_PACIENTE): array
    {
        $colunas = [];

        foreach ($campos as $campo) {
            $colunas[] = self::definicao($campo, $formulario)['coluna'];
        }

        return array_values(array_unique($colunas));
    }

    /** Extensão só para teste — nunca chamada em produção. @param array<string, mixed> $definicao */
    public static function registrarExtra(string $campo, array $definicao): void
    {
        self::$extras[$campo] = $definicao;
    }

    public static function limparExtras(): void
    {
        self::$extras = [];
    }

    private static function exigirFormulario(string $formulario): void
    {
        if (! in_array($formulario, self::FORMULARIOS, true)) {
            throw new InvalidArgumentException("Formulário desconhecido: {$formulario}");
        }
    }
}
