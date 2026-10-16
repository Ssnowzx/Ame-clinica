<?php

// Canal de WhatsApp pela Cloud API oficial (change mensageria-whatsapp).
// Aqui moram os valores de INFRAESTRUTURA (endpoint, timeout, tetos técnicos).
// A regra de NEGÓCIO configurável pela clínica — automático on/off, teto mensal,
// antecedência, lote, retenção — é DADO da clínica (§13), e mora em `configuracoes`.
// Misturar as duas coisas aqui congelaria em deploy o que a §13 manda deixar na mão
// da clínica.
return [

    /*
    | Versão da Graph API. Fica em config porque a Meta aposenta versões com data
    | marcada: subir de versão é trocar UM valor, não caçar string em cinco arquivos.
    */
    'versao_graph' => env('WHATSAPP_VERSAO_GRAPH', 'v21.0'),

    'base_url' => env('WHATSAPP_BASE_URL', 'https://graph.facebook.com'),

    /*
    | Timeout CURTO de propósito: o envio roda em Job, e um HTTP pendurado por 30s
    | segura um worker que tem lembrete para entregar. Falhar rápido e retentar com
    | backoff entrega mais que esperar muito uma vez.
    */
    'timeout' => (int) env('WHATSAPP_TIMEOUT', 10) ?: 10,

    /*
    | Job de envio: tentativas e espera crescente (segundos) entre elas.
    | A retentativa é do Job, NUNCA do cliente HTTP — retentar nas duas camadas
    | multiplica as tentativas e some com o controle do teto.
    */
    'tentativas' => (int) env('WHATSAPP_TENTATIVAS', 5) ?: 5,
    'backoff' => [10, 60, 300, 900],

    /*
    | Teto de tamanho da mídia recebida (bytes). A Meta já limita na origem; este é o
    | nosso piso independente — o disco é da clínica.
    */
    'midia_max_bytes' => (int) env('WHATSAPP_MIDIA_MAX_BYTES', 16 * 1024 * 1024) ?: 16 * 1024 * 1024,

    /*
    | Disco onde a mídia da conversa é guardada. `local` = fora do alcance público
    | (mesmo tratamento dos anexos do paciente: é documento de MENOR).
    */
    'disco_midia' => env('WHATSAPP_DISCO_MIDIA', 'local'),

    /*
    | Rate limit da rota PÚBLICA de webhook — balde próprio, independente dos baldes
    | de leitura/escrita das rotas autenticadas (FA-07). Uma enxurrada aqui não pode
    | esfomear quem está trabalhando no sistema, e o inverso também vale.
    */
    'throttle_webhook' => (int) env('WHATSAPP_THROTTLE_WEBHOOK', 300) ?: 300,

    /*
    | Retenção do rastro de eventos do webhook (dias). É diagnóstico, não histórico:
    | o que importa a longo prazo são as mensagens.
    */
    'retencao_eventos_dias' => (int) env('WHATSAPP_RETENCAO_EVENTOS_DIAS', 30) ?: 30,

];
