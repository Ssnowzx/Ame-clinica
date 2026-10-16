<?php

namespace App\Console\Commands;

use App\Models\EnvioDeCadastro;
use App\Support\Configuracoes\ConfiguracaoService;
use Illuminate\Console\Command;

/**
 * Expurgo da retenção do auto-cadastro público (change `cadastro-online-do-paciente`).
 *
 * Apaga o CONTEÚDO do envio que ninguém conferiu além de `cadastro_online.retencao_dias`,
 * PRESERVANDO a linha: sabe-se que houve um envio e que ele venceu, sem os dados da criança.
 * Sem essa preservação a fila mentiria sobre o próprio histórico — pareceria que nunca chegou
 * nada, quando na verdade chegou e ninguém olhou.
 *
 * **Por que ele existe ANTES da rota que coleta** (parecer pré-código, condição 12): porta que
 * coleta sem expurgo é acúmulo de dado de MENOR desde o primeiro dia. E ele roda **sozinho**, na
 * rotina agendada — um comando que depende de alguém lembrar de chamá-lo não é retenção, é
 * intenção.
 *
 * O **IP morre junto com o conteúdo**: ele é o fio forense contra abuso enquanto o envio existe,
 * e dado pessoal sem finalidade depois que ele some (parecer §4-g).
 *
 * **O aceito é o caso de exceção, e ele tem DOIS ramos.** Aceito COM ficha ligada virou
 * prontuário, que tem retenção própria (anos): o conteúdo fica, e só o **IP** vai embora — IP não
 * é prontuário, é dado pessoal que já cumpriu a finalidade dele.
 *
 * Aceito SEM ficha é o buraco que o gate achou (SEC-CO-34 / CO-05): a recepção clicou em aceitar,
 * o envio saiu da fila, e o formulário nunca foi salvo — interrupção no balcão basta. Antes, esse
 * envio guardava payload e IP de MENOR **para sempre**, invisível e fora do expurgo. Ele agora é
 * minimizado como qualquer outro que ninguém quis.
 *
 * Descartado guarda o motivo, que é registro de decisão da clínica, não dado da família: o
 * conteúdo dele também vai embora, porque a decisão já foi tomada e o dado não serve mais a nada.
 */
class ExpurgarEnviosDeCadastro extends Command
{
    protected $signature = 'cadastro-online:expurgar';

    protected $description = 'Apaga o conteúdo dos envios de auto-cadastro além da retenção configurada';

    public function handle(ConfiguracaoService $configuracoes): int
    {
        $total = 0;

        $corte = now()->subDays((int) $configuracoes->get('cadastro_online.retencao_dias'));

        // 1) o que ninguém aproveitou: conteúdo E ip vão embora
        EnvioDeCadastro::query()
            ->whereNull('expurgado_em')
            ->where('enviado_em', '<', $corte)
            // aceito COM ficha é o único que escapa daqui: o conteúdo dele virou prontuário.
            // Aceito SEM ficha entra: a recepção clicou em aceitar e nunca salvou
            ->where(function ($consulta): void {
                $consulta->where('situacao', '!=', 'aceito')->orWhereNull('paciente_id');
            })
            ->chunkById(500, function ($envios) use (&$total): void {
                foreach ($envios as $envio) {
                    $envio->forceFill([
                        'payload' => null,
                        'ip' => null,
                        'expurgado_em' => now(),
                    ])->save();

                    $total++;
                }
            });

        // 2) o que virou prontuário: o conteúdo fica, o IP não. Sem `expurgado_em`, porque o
        // envio não foi minimizado — ele continua íntegro do lado da ficha
        EnvioDeCadastro::query()
            ->whereNull('expurgado_em')
            ->where('enviado_em', '<', $corte)
            ->where('situacao', 'aceito')
            ->whereNotNull('paciente_id')
            ->whereNotNull('ip')
            ->chunkById(500, function ($envios): void {
                foreach ($envios as $envio) {
                    $envio->forceFill(['ip' => null])->save();
                }
            });

        $this->info("Expurgo do cadastro pelo link: {$total} envio(s) minimizado(s).");

        return self::SUCCESS;
    }
}
