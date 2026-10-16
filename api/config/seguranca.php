<?php

// Postura de endurecimento de rede (change endurecimento-de-rede — Fase 6).
// Cada valor derivado de env mora AQUI e é lido via config() no resto do app:
// dentro de closures de runtime (RateLimiter, middleware) `env()` cru devolve NULL
// sob `config:cache` — o único lugar seguro para `env()` é o arquivo de config.
return [

    /*
    | Rate limit das rotas AUTENTICADAS (por usuário/minuto). Buckets SEPARADOS
    | leitura×mutação no RateLimiter::for('api'): esgotar a leitura (enxurrada de
    | GET) NUNCA pode barrar um "Salvar". Tetos folgados para a parede cheia da
    | clínica (24 usuários) — cortam o laço automático, não o uso legítimo.
    | `?: default` blinda o caso var-definida-porém-VAZIA: `(int) '' === 0` viraria
    | teto 0/min = lockout de toda leitura autenticada (fail-closed). Piso = default.
    */
    'throttle_leitura' => (int) env('SECURITY_THROTTLE_LEITURA', 120) ?: 120,
    'throttle_mutacao' => (int) env('SECURITY_THROTTLE_MUTACAO', 60) ?: 60,

    /*
    | Rate limit da ROTA PÚBLICA HUMANA (change cadastro-online-do-paciente), em DOIS eixos:
    | por origem e por endereço público. O terceiro balde do produto, independente do autenticado e do
    | webhook — nenhum dos três pode esfomear os outros.
    |
    | O eixo por ENDEREÇO é a contrapartida de subir sem anti-bot: só por IP, a barreira se
    | contorna distribuindo. Os tetos são folgados para uma família que erra e recomeça o
    | formulário, e apertados para um laço: uma família preenche um cadastro em minutos, não
    | vinte por minuto.
    |
    | `?: default` blinda var-definida-porém-VAZIA — `(int) '' === 0` viraria teto 0/min, que
    | fecharia o formulário para todo mundo em silêncio.
    */
    'throttle_publico_ip' => (int) env('SECURITY_THROTTLE_PUBLICO_IP') ?: 20,
    'throttle_publico_link' => (int) env('SECURITY_THROTTLE_PUBLICO_LINK') ?: 60,

    /*
    | Rate limit do PAINEL DO PROFISSIONAL (change painel-do-profissional, SEC-PP-03), por usuário: a
    | rota agrega quatro painéis, a série e o financeiro (~50 consultas por chamada). A ficha faz UMA
    | chamada por mês escolhido; vinte por minuto cabem em quem navega mês a mês e cortam o laço.
    | Balde próprio, separado do de leitura geral: esgotá-lo não tira o resto do sistema de ninguém.
    */
    'throttle_painel_profissional' => (int) env('SECURITY_THROTTLE_PAINEL_PROFISSIONAL') ?: 20,

    /*
    | HSTS só faz sentido sob HTTPS. O middleware exige TRAVA DUPLA:
    | esta flag === true E $request->isSecure() — jamais em http://localhost.
    | Acoplamento de deploy: SECURITY_HSTS=true ⟺ SESSION_SECURE_COOKIE=true ⟺
    | APP_DEBUG=false (ver .env.example).
    */
    'hsts' => (bool) env('SECURITY_HSTS', false),

];
