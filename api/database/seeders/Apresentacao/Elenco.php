<?php

namespace Database\Seeders\Apresentacao;

/**
 * Os nomes da clínica de apresentação — INVENTADOS, combinados por sorteio (LGPD: nenhum
 * dado de paciente real; a combinação de prenome e dois sobrenomes comuns não aponta para
 * ninguém). Realistas de propósito: a apresentação é para outra clínica, e "Paciente
 * Fictício Ivana" na tela tira a atenção do produto.
 */
final class Elenco
{
    public const CLINICA = 'Ame Clínica';

    public const CIDADE = ['cidade' => 'Campinas', 'uf' => 'SP', 'ddd' => '19'];

    /** @var list<string> */
    private const MENINAS = [
        'Alice', 'Helena', 'Laura', 'Valentina', 'Heloísa', 'Manuela', 'Sophia', 'Isabela',
        'Lívia', 'Cecília', 'Lorena', 'Beatriz', 'Antonella', 'Maitê', 'Clara', 'Luísa',
        'Marina', 'Esther', 'Olívia', 'Mariana', 'Melissa', 'Yasmin', 'Rafaela', 'Agatha',
        'Liz', 'Isis', 'Elisa', 'Vitória', 'Sarah', 'Catarina', 'Júlia', 'Lara',
    ];

    /** @var list<string> */
    private const MENINOS = [
        'Miguel', 'Arthur', 'Gael', 'Heitor', 'Théo', 'Davi', 'Bernardo', 'Gabriel',
        'Ravi', 'Noah', 'Samuel', 'Pedro', 'Benjamin', 'Lorenzo', 'Matheus', 'Lucas',
        'Joaquim', 'Nicolas', 'Henrique', 'Rafael', 'Isaac', 'Benício', 'Bento', 'Murilo',
        'Gustavo', 'Enzo', 'Vicente', 'Lucca', 'Antônio', 'Felipe', 'Caio', 'Otávio',
    ];

    /** @var list<string> */
    private const MAES = [
        'Ana Paula', 'Juliana', 'Fernanda', 'Patrícia', 'Aline', 'Camila', 'Renata', 'Tatiane',
        'Vanessa', 'Priscila', 'Daniela', 'Carolina', 'Bruna', 'Letícia', 'Natália', 'Gabriela',
    ];

    /** @var list<string> */
    private const PAIS = [
        'Rodrigo', 'Marcelo', 'Fábio', 'André', 'Leandro', 'Diego', 'Thiago', 'Eduardo',
    ];

    /** @var list<string> */
    private const SOBRENOMES = [
        'Silva', 'Santos', 'Oliveira', 'Souza', 'Rodrigues', 'Ferreira', 'Alves', 'Pereira',
        'Lima', 'Gomes', 'Costa', 'Ribeiro', 'Martins', 'Carvalho', 'Almeida', 'Lopes',
        'Soares', 'Fernandes', 'Vieira', 'Barbosa', 'Rocha', 'Dias', 'Nascimento', 'Andrade',
        'Moreira', 'Nunes', 'Marques', 'Machado', 'Mendes', 'Freitas', 'Cardoso', 'Ramos',
        'Teixeira', 'Correia', 'Cavalcanti', 'Monteiro', 'Pinto', 'Batista', 'Campos', 'Moraes',
    ];

    /** @var list<string> */
    private const RUAS = [
        'Rua das Acácias', 'Rua Ipê Amarelo', 'Avenida das Palmeiras', 'Rua dos Girassóis',
        'Rua Primavera', 'Rua Jasmim', 'Avenida Horizonte', 'Rua das Hortênsias',
        'Rua Bem-te-vi', 'Rua Sabiá', 'Alameda dos Pinheiros', 'Rua das Orquídeas',
    ];

    /** @var list<string> */
    private const BAIRROS = [
        'Jardim das Flores', 'Vila Nova', 'Parque Alvorada', 'Jardim Primavera', 'Centro',
        'Vila Esperança', 'Jardim Botânico', 'Parque dos Ipês',
    ];

    /** @var array<string, true> */
    private array $usados = [];

    public function __construct(private readonly Contexto $ctx) {}

    /** @return array{nome: string, sexo: string, sobrenome: string} */
    public function crianca(): array
    {
        do {
            $sexo = $this->ctx->chance(0.42) ? 'feminino' : 'masculino';
            $prenome = $this->ctx->um($sexo === 'feminino' ? self::MENINAS : self::MENINOS);
            $meio = $this->ctx->um(self::SOBRENOMES);
            $fim = $this->ctx->um(self::SOBRENOMES);
            $nome = "{$prenome} {$meio} {$fim}";
        } while ($meio === $fim || isset($this->usados[$nome]));

        $this->usados[$nome] = true;

        return ['nome' => $nome, 'sexo' => $sexo, 'sobrenome' => $fim];
    }

    /** @return list<array{nome: string, parentesco: string, telefone: string}> */
    public function responsaveis(string $sobrenome): array
    {
        $mae = [
            'nome' => $this->ctx->um(self::MAES).' '.$this->ctx->um(self::SOBRENOMES).' '.$sobrenome,
            'parentesco' => 'mãe',
            'telefone' => $this->celular(),
        ];
        if ($this->ctx->chance(0.55)) {
            return [$mae];
        }

        return [$mae, [
            'nome' => $this->ctx->um(self::PAIS).' '.$sobrenome,
            'parentesco' => 'pai',
            'telefone' => $this->celular(),
        ]];
    }

    public function celular(): string
    {
        return sprintf('(%s) 9%04d-%04d', self::CIDADE['ddd'], $this->ctx->entre(8100, 9899), $this->ctx->entre(0, 9999));
    }

    /** @return array<string, string> */
    public function endereco(): array
    {
        return [
            'cep' => sprintf('130%02d-%03d', $this->ctx->entre(10, 99), $this->ctx->entre(0, 999)),
            'logradouro' => $this->ctx->um(self::RUAS),
            'numero' => (string) $this->ctx->entre(12, 1980),
            'complemento' => $this->ctx->chance(0.3) ? 'Apto '.$this->ctx->entre(11, 184) : '',
            'bairro' => $this->ctx->um(self::BAIRROS),
            'cidade' => self::CIDADE['cidade'],
            'uf' => self::CIDADE['uf'],
        ];
    }

    public function sobrenome(): string
    {
        return $this->ctx->um(self::SOBRENOMES);
    }
}
