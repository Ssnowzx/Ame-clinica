<?php

/**
 * Mensagens de validação em pt-BR.
 *
 * Este arquivo existe porque a validação do framework chegava ao usuário final EM INGLÊS:
 * a tela do Financeiro exibia, em vermelho, "The de field must match the format Y-m-d." —
 * texto de máquina, em outro idioma, para a recepção de uma clínica (achado da validação em
 * produção, 2026-08-21). A regra de fronteira do projeto é clara: se a string aparece na
 * tela de alguém, é português.
 *
 * Só as regras que o produto USA estão aqui (levantadas por varredura dos Requests e
 * controllers) — um arquivo com as 100 regras do framework seria peso morto que ninguém
 * revisa. Regra nova sem tradução volta a sair em inglês: acrescente aqui junto com ela.
 */
return [
    'accepted' => 'O campo :attribute precisa ser aceito.',
    'after' => 'O campo :attribute deve ser uma data posterior a :date.',
    'after_or_equal' => 'O campo :attribute deve ser uma data igual ou posterior a :date.',
    'alpha_dash' => 'O campo :attribute só pode conter letras, números, hífens e sublinhados.',
    'array' => 'O campo :attribute deve ser uma lista.',
    'before' => 'O campo :attribute deve ser uma data anterior a :date.',
    'before_or_equal' => 'O campo :attribute deve ser uma data igual ou anterior a :date.',
    'between' => [
        'array' => 'O campo :attribute deve ter entre :min e :max itens.',
        'file' => 'O arquivo :attribute deve ter entre :min e :max kilobytes.',
        'numeric' => 'O campo :attribute deve estar entre :min e :max.',
        'string' => 'O campo :attribute deve ter entre :min e :max caracteres.',
    ],
    'boolean' => 'O campo :attribute deve ser verdadeiro ou falso.',
    'confirmed' => 'A confirmação do campo :attribute não confere.',
    'date' => 'O campo :attribute não é uma data válida.',
    'date_format' => 'O campo :attribute não está no formato esperado.',
    'different' => 'Os campos :attribute e :other devem ser diferentes.',
    'digits' => 'O campo :attribute deve ter :digits dígitos.',
    'digits_between' => 'O campo :attribute deve ter entre :min e :max dígitos.',
    'email' => 'O campo :attribute deve ser um e-mail válido.',
    'exists' => 'O valor escolhido em :attribute não existe.',
    'filled' => 'O campo :attribute não pode ficar vazio.',
    'gt' => [
        'numeric' => 'O campo :attribute deve ser maior que :value.',
        'string' => 'O campo :attribute deve ter mais de :value caracteres.',
    ],
    'gte' => [
        'numeric' => 'O campo :attribute deve ser maior ou igual a :value.',
        'string' => 'O campo :attribute deve ter :value caracteres ou mais.',
    ],
    'image' => 'O campo :attribute deve ser uma imagem.',
    'in' => 'O valor escolhido em :attribute é inválido.',
    'integer' => 'O campo :attribute deve ser um número inteiro.',
    'json' => 'O campo :attribute deve ser um JSON válido.',
    'lt' => [
        'numeric' => 'O campo :attribute deve ser menor que :value.',
        'string' => 'O campo :attribute deve ter menos de :value caracteres.',
    ],
    'lte' => [
        'numeric' => 'O campo :attribute deve ser menor ou igual a :value.',
        'string' => 'O campo :attribute deve ter :value caracteres ou menos.',
    ],
    'max' => [
        'array' => 'O campo :attribute não pode ter mais de :max itens.',
        'file' => 'O arquivo :attribute não pode passar de :max kilobytes.',
        'numeric' => 'O campo :attribute não pode ser maior que :max.',
        'string' => 'O campo :attribute não pode ter mais de :max caracteres.',
    ],
    /*
     * O teto que DIZ O TAMANHO (change `tetos-do-cadastro-na-tela`).
     *
     * A mensagem nativa de `max.string` diz o limite e cala sobre o tamanho recebido. Num campo
     * de linha única o excesso está fora da vista — o `input` desenha o valor a partir do
     * começo —, então "não pode ter mais de 255" não diz se sobram três caracteres ou
     * trezentos. Quem chega a esta recusa veio pela API, por dado gravado antes do limite
     * valer, ou por um caminho que a trava do campo não cobre: precisa do número para agir.
     */
    'tamanho_maximo' => 'O campo :attribute tem :tamanho caracteres; o limite é :max.',
    'mimes' => 'O campo :attribute deve ser um arquivo do tipo: :values.',
    'min' => [
        'array' => 'O campo :attribute deve ter ao menos :min itens.',
        'file' => 'O arquivo :attribute deve ter ao menos :min kilobytes.',
        'numeric' => 'O campo :attribute deve ser no mínimo :min.',
        'string' => 'O campo :attribute deve ter ao menos :min caracteres.',
    ],
    'not_in' => 'O valor escolhido em :attribute é inválido.',
    'numeric' => 'O campo :attribute deve ser um número.',
    'prohibited' => 'O campo :attribute não é permitido nesta chamada.',
    'prohibits' => 'O campo :attribute não pode ser usado junto com :other.',
    'prohibited_if' => 'O campo :attribute não é permitido quando :other é :value.',
    'prohibited_unless' => 'O campo :attribute não é permitido, a menos que :other seja :values.',
    'regex' => 'O formato do campo :attribute é inválido.',
    'required' => 'O campo :attribute é obrigatório.',
    'required_if' => 'O campo :attribute é obrigatório quando :other é :value.',
    'required_with' => 'O campo :attribute é obrigatório quando :values está presente.',
    'required_with_all' => 'O campo :attribute é obrigatório quando :values estão presentes.',
    'required_without' => 'O campo :attribute é obrigatório quando :values não está presente.',
    'required_without_all' => 'O campo :attribute é obrigatório quando nenhum de :values está presente.',
    'required_unless' => 'O campo :attribute é obrigatório, a menos que :other seja :values.',
    'required_array_keys' => 'O campo :attribute precisa conter as chaves: :values.',
    'present' => 'O campo :attribute precisa estar presente.',
    'missing' => 'O campo :attribute não pode estar presente.',
    'decimal' => 'O campo :attribute deve ter :decimal casas decimais.',
    'distinct' => 'O campo :attribute tem um valor repetido.',
    'file' => 'O campo :attribute deve ser um arquivo.',
    'mimetypes' => 'O campo :attribute deve ser um arquivo do tipo: :values.',
    'dimensions' => 'As dimensões da imagem em :attribute são inválidas.',
    'enum' => 'O valor escolhido em :attribute é inválido.',
    'not_regex' => 'O formato do campo :attribute é inválido.',
    'starts_with' => 'O campo :attribute deve começar com: :values.',
    'ends_with' => 'O campo :attribute deve terminar com: :values.',
    'multiple_of' => 'O campo :attribute deve ser múltiplo de :value.',
    'lowercase' => 'O campo :attribute deve estar em minúsculas.',
    'uppercase' => 'O campo :attribute deve estar em maiúsculas.',
    'ip' => 'O campo :attribute deve ser um endereço IP válido.',
    'declined' => 'O campo :attribute precisa ser recusado.',
    'same' => 'Os campos :attribute e :other devem ser iguais.',
    'size' => [
        'array' => 'O campo :attribute deve conter :size itens.',
        'file' => 'O arquivo :attribute deve ter :size kilobytes.',
        'numeric' => 'O campo :attribute deve ser :size.',
        'string' => 'O campo :attribute deve ter :size caracteres.',
    ],
    'string' => 'O campo :attribute deve ser um texto.',
    'timezone' => 'O campo :attribute deve ser um fuso horário válido.',
    'unique' => 'Este :attribute já está em uso.',
    'url' => 'O campo :attribute deve ser uma URL válida.',
    'uuid' => 'O campo :attribute deve ser um UUID válido.',

    /**
     * Nomes de campo como a CLÍNICA os chama — sem isto, a mensagem sai com o nome da
     * coluna ("O campo paciente_id é obrigatório").
     */
    'attributes' => [
        'de' => 'data inicial',
        'ate' => 'data final',
        'busca' => 'busca',
        'pagina' => 'página',
        'nome' => 'nome',
        'nome_social' => 'nome social',
        'email' => 'e-mail',
        'senha' => 'senha',
        'cpf' => 'CPF',
        'nascimento' => 'data de nascimento',
        'paciente_id' => 'paciente',
        'profissional_id' => 'profissional',
        'especialidade_id' => 'especialidade',
        'tratamento_id' => 'tratamento',
        'convenio_id' => 'convênio',
        'sala_id' => 'sala',
        'equipamento_id' => 'equipamento',
        'medico_id' => 'médico solicitante',
        'status_id' => 'status',
        'conta_id' => 'conta',
        'categoria_id' => 'categoria',
        'inicio' => 'início',
        'fim' => 'fim',
        'duracao' => 'duração',
        'valor' => 'valor',
        'vencimento' => 'vencimento',
        'observacao' => 'observação',
        'obs' => 'observação',
        'prioridade' => 'prioridade',
        'horarios' => 'horários',
        'conselho' => 'conselho',
        'uf_conselho' => 'UF do conselho',
        'num_conselho' => 'número do conselho',
        'telefone' => 'telefone',
        'tipo' => 'tipo',
    ],
];
