<?php

/*
 * Política de origem cruzada (change `cadastro-online-do-paciente`, parecer pré-código condição 3).
 *
 * **Este arquivo não existia**, e sem ele valia o default do framework: `allowed_origins => ['*']`.
 * Enquanto toda escrita passava por sessão, o CSRF do Sanctum segurava o abuso. A rota pública
 * humana não tem sessão — logo não tem CSRF — e com origem aberta um site hostil faria os próprios
 * visitantes enviarem para a fila da clínica, contornando o teto por IP por distribuição.
 *
 * Em PRODUÇÃO o SPA é servido do mesmo host da API, então nada aqui é usado: origem cruzada
 * simplesmente não acontece. A lista existe para o desenvolvimento (SPA no Vite, porta 5173) e
 * para qualquer front que a clínica venha a hospedar separado — e é por isso que ela é explícita.
 */

return [

    'paths' => ['api/*', 'sanctum/csrf-cookie'],

    'allowed_methods' => ['*'],

    /*
     * NUNCA `*`. Vem do ambiente para o deploy poder declarar a origem real sem edição de código;
     * o default cobre o desenvolvimento local, e uma origem de desenvolvimento não é alcançável
     * pelo navegador de ninguém em produção (o cabeçalho `Origin` é posto pelo navegador, não pela
     * página).
     */
    'allowed_origins' => array_values(array_filter(array_map(
        'trim',
        explode(',', (string) env('CORS_ORIGENS', 'http://localhost:5173,http://127.0.0.1:5173'))
    ))),

    'allowed_origins_patterns' => [],

    'allowed_headers' => ['*'],

    /*
     * `X-Pacientes-Inativos`: o marcador de cadastro inativo da seleção da agenda (change
     * `paciente-inativo-com-saida`). Em produção o SPA é servido da MESMA origem e o CORS nem
     * entra na conversa; expor aqui é o que impede o recurso de morrer em silêncio no dia em que
     * o front for hospedado à parte — expor não é autorizar: o portão (`pacientes.ver`) continua
     * no servidor (parecer SEC-PIS-07).
     */
    'exposed_headers' => ['X-Pacientes-Inativos'],

    'max_age' => 0,

    /*
     * A sessão do SPA depende disto no desenvolvimento (cookie de origem cruzada). A rota pública
     * humana não usa credencial nenhuma — e não pode: aceitar cookie ali criaria dois
     * comportamentos para o mesmo endereço.
     */
    'supports_credentials' => true,

];
