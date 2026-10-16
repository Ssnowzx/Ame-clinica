<?php

/**
 * O endereço do cadastro pelo link chega a quem CADASTRA e a quem CONFERE (change
 * link-do-cadastro-na-recepcao) — gerar e trocar continuam com quem administra.
 */
it('deve deixar quem cadastra crianças LER o endereço, sem poder trocá-lo', function () {
    $admin = admin();
    $recepcao = usuarioCom(['pacientes.criar'], 'Recepção Fictícia');
    $conferente = usuarioCom(['cadastro_online.conferir'], 'Conferente Fictício');
    // os negativos são permissões ADJACENTES (SEC-LR-01): um `|pacientes.ver` a mais na rota
    // tem que derrubar a suíte — `agenda.ver` sozinho não pegaria
    $vizinhos = [
        usuarioCom(['pacientes.ver'], 'Só Vê Pacientes Fictício'),
        usuarioCom(['pacientes.editar'], 'Só Edita Pacientes Fictício'),
        usuarioCom(['configuracoes.ver'], 'Só Vê Configurações Fictício'),
        usuarioCom(['agenda.ver'], 'Só Agenda Fictício'),
    ];
    $slug = $this->actingAs($admin)->postJson('/api/cadastro-online/link/rotacionar')->assertOk()->json('slug');

    foreach ([$recepcao, $conferente] as $quemLe) {
        $this->flushSession();
        $this->app['auth']->forgetGuards();
        // o slug lido é o ATUAL da clínica (SEC-LR-03), não um qualquer
        $this->actingAs($quemLe)->getJson('/api/cadastro-online/link')
            ->assertOk()
            ->assertJsonPath('slug', $slug)
            ->assertJsonStructure(['slug', 'ativo', 'url']);
        $this->actingAs($quemLe)->postJson('/api/cadastro-online/link/rotacionar')->assertForbidden();
    }

    foreach ($vizinhos as $vizinho) {
        $this->flushSession();
        $this->app['auth']->forgetGuards();
        $this->actingAs($vizinho)->getJson('/api/cadastro-online/link')->assertForbidden();
    }
});
