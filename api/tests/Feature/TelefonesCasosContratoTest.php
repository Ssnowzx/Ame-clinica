<?php

use Illuminate\Support\Facades\Artisan;

/*
 * GUARDA DE CONTRATO, o lado do SERVIDOR (gate r1 da change telefone-que-chega-no-whatsapp,
 * CR-TEL-03): o campo de telefone da tela classifica pela fixture `telefones-da-api.json`, e o teste
 * do web confere a cópia TS contra ela. Faltava quem conferisse a FIXTURE contra o servidor — mudar
 * `TelefoneE164::normalizar()` sem regerá-la deixava as duas suítes verdes e a tela prometendo um
 * número que o lembrete recusa.
 */
it('deve manter a fixture do web igual à saída atual de telefones:casos', function () {
    // ARRANGE
    $fixture = base_path('../web/src/test/telefones-da-api.json');

    // ACT
    Artisan::call('telefones:casos', ['--json' => true]);

    // ASSERT — se cair: `cd api && php artisan telefones:casos --json > ../web/src/test/telefones-da-api.json`
    expect(json_decode(Artisan::output(), true))->toBe(json_decode((string) file_get_contents($fixture), true));
});
