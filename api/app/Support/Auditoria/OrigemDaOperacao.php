<?php

namespace App\Support\Auditoria;

/**
 * De onde veio a operação que a trilha vai registrar (change `cadastro-online-do-paciente`).
 *
 * A trilha tinha duas origens implícitas: **usuário** (há sessão) e **sistema** (não há
 * requisição — console, job agendado). A change abre a terceira, e ela não cabe em nenhuma das
 * duas: alguém que não é usuário do sistema, agindo por uma requisição real — a família que
 * preenche o auto-cadastro público.
 *
 * A marca é **explícita e por requisição**, nunca inferida da ausência de sessão. Inferir seria
 * frágil dos dois lados: uma rota autenticada que perdesse a sessão viraria "externa", e — o caso
 * que o parecer pré-código mediu (ameaça A5) — o envio feito no navegador da recepcionista, com a
 * sessão dela ativa, seria carimbado como ato DELA. Quem marca é o middleware do grupo público,
 * não o controller: assim nenhuma rota nova pode esquecer.
 *
 * Escopo de requisição (registrado como `scoped`): a marca morre com a resposta.
 */
final class OrigemDaOperacao
{
    /** Um usuário do sistema, autenticado. */
    public const USUARIO = 'usuario';

    /** Nenhuma requisição: console, job, rotina agendada. */
    public const SISTEMA = 'sistema';

    /** Uma pessoa sem sessão, por uma porta pública. */
    public const EXTERNA = 'externa';

    /**
     * A família, pelo toque num botão do lembrete do WhatsApp (change
     * `lembrete-com-botoes-de-resposta`, rodada 1 do gate, CRB-04/SEC-BT-03): se ela disser "não
     * desmarquei", a clínica precisa achar o fato no canal certo — não em "Formulário público".
     */
    public const WHATSAPP = 'whatsapp';

    private bool $externa = false;

    private bool $whatsapp = false;

    /** Chamado pelo middleware do grupo público, uma vez por requisição. */
    public function marcarExterna(): void
    {
        $this->externa = true;
    }

    public function ehExterna(): bool
    {
        return $this->externa;
    }

    /**
     * Executa como a família pelo WhatsApp e DESFAZ ao sair (no molde do `ContextoDoLote::executar`):
     * a marca é por requisição, e sem o `finally` tudo o que o mesmo webhook gravasse depois — a
     * resposta automática, outro toque — sairia com a origem da família.
     *
     * @template T
     *
     * @param  callable(): T  $operacao
     * @return T
     */
    public function executarPeloWhatsapp(callable $operacao): mixed
    {
        $anterior = $this->whatsapp;
        $this->whatsapp = true;

        try {
            return $operacao();
        } finally {
            $this->whatsapp = $anterior;
        }
    }

    public function ehPeloWhatsapp(): bool
    {
        return $this->whatsapp;
    }

    /** O nome do autor na trilha e nos relatórios — a fonte única dos três lugares que o mostram. */
    public static function rotulo(?string $autorTipo, ?string $nomeDoUsuario): string
    {
        return match ($autorTipo) {
            self::WHATSAPP => 'Família, pelo WhatsApp',
            self::EXTERNA => 'Formulário público',
            self::USUARIO => $nomeDoUsuario ?? 'Usuário removido',
            default => 'Sistema',
        };
    }
}
