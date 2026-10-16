<?php

namespace App\Models;

use App\Support\Auditoria\Auditavel;
use Illuminate\Database\Eloquent\Model;

/**
 * Credencial do WhatsApp Cloud API da clínica (change mensageria-whatsapp, D1).
 *
 * Os três segredos têm cast `encrypted` e estão FORA do `$fillable`: são gravados
 * explicitamente pelo service, nunca por mass assignment. E estão no `$auditExclude`
 * porque `Auditavel` grava o valor cru no diff — foi essa mecânica que tirou a
 * credencial de `configuracoes`, e repeti-la aqui anularia a decisão inteira.
 *
 * `estado` NÃO é `$fillable` de propósito: quem o muda é o teste de conexão (fato
 * verificado contra a Meta), não o formulário. Um cliente que pudesse gravar
 * `conectado` faria o sistema tentar enviar com credencial que ninguém validou.
 *
 * LEITURA SEM SESSÃO: o webhook chega sem sessão e confere a conexão pelo
 * `phone_number_id`. Esse caminho — o único — vive em
 * `App\Support\Mensageria\ConexaoDoWebhook`, documentado lá.
 */
class WhatsappConexao extends Model
{
    use Auditavel;

    public const ESTADOS = ['nao_conectado', 'conectado', 'invalido'];

    protected $table = 'whatsapp_conexoes';

    /** Identificadores públicos da Meta; segredo e estado entram pelo service. */
    protected $fillable = ['phone_number_id', 'waba_id', 'numero_exibicao'];

    /**
     * Segredos nunca aparecem na trilha — nem parcialmente. A trilha registra que a
     * conexão mudou, quem mudou e quando (spec auditoria).
     *
     * @var list<string>
     */
    protected array $auditExclude = ['access_token', 'app_secret', 'verify_token'];

    protected function casts(): array
    {
        return [
            'access_token' => 'encrypted',
            'app_secret' => 'encrypted',
            'verify_token' => 'encrypted',
            'ultimo_teste_em' => 'datetime',
        ];
    }

    public function estaConectada(): bool
    {
        return $this->estado === 'conectado';
    }

    /**
     * Os 4 últimos caracteres do token — o suficiente para o operador confirmar QUAL
     * credencial está em uso, e insuficiente para reconstruí-la.
     */
    public function tokenFinal(): ?string
    {
        $token = (string) $this->access_token;

        return $token === '' ? null : mb_substr($token, -4);
    }
}
