<?php

namespace App\Support\Rbac;

use App\Http\Requests\NivelPermissaoRequest;
use App\Models\AprovacaoDeAcesso;
use App\Models\NivelPermissao;
use App\Models\Usuario;
use App\Support\Configuracoes\CatalogoConfiguracoes;
use App\Support\Configuracoes\ConfiguracaoService;
use Carbon\Carbon;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;
use LogicException;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Throwable;

/**
 * Maker-checker das mutações de acesso (AP-13 · SEC-SD-02/03/07/09).
 *
 * Com `seguranca.aprovacao_dupla` ligada, os boundaries NÃO aplicam: validam
 * normalmente, ABREM uma pendência (payload whitelist FECHADA por tipo) e
 * respondem 202 — o único chamador de `MutacoesDeAcesso` no mundo ligado é a
 * APROVAÇÃO daqui. A decisão segue a ordem fixa: pendência re-travada → status
 * compare-and-set (409) → decisor ≠ solicitante (422) → revalidação INTEGRAL
 * contra o estado ATUAL (payload é entrada NÃO-confiável) → aplicação pela fonte
 * única → flip. Decidir pendência EXISTENTE independe do valor atual da flag
 * (o gate é da criação — senão desligar a flag, que é pendência, trava tudo).
 */
class AprovacoesDeAcesso
{
    public const TETO_ATIVAS = 50;

    /** Whitelist FECHADA do payload por tipo (SEC-SD-09) — nada além entra. */
    private const PAYLOAD_POR_TIPO = [
        'editar_nivel' => ['nome', 'permissoes', 'base_versao'],
        'atribuir_nivel' => ['nivel_permissao_id'],
        'configurar_seguranca' => ['chave', 'valor'],
    ];

    private const PENDENCIA_JA_DECIDIDA = 'Esta pendência já foi decidida.';

    public function __construct(
        private readonly AncoraDaClinica $ancora,
        private readonly MutacoesDeAcesso $mutacoes,
        private readonly ConfiguracaoService $configuracoes,
        private readonly SemEscalada $semEscalada,
    ) {}

    public function duplaLigada(): bool
    {
        return (bool) $this->configuracoes->get('seguranca.aprovacao_dupla');
    }

    /**
     * Predicado EXATO da interceptação de configuração (SEC-SD-08): chave
     * `seguranca.*` booleana em transição true→false, com a dupla ligada.
     * Ligar e escrita idempotente seguem diretos (com as pré-condições de ligar).
     */
    public function configuracaoExigeAprovacao(string $chave, mixed $valor): bool
    {
        if (! str_starts_with($chave, 'seguranca.') || ! $this->duplaLigada()) {
            return false;
        }

        if (CatalogoConfiguracoes::tipo($chave) !== 'bool') {
            return false;
        }

        return (bool) $this->configuracoes->get($chave) === true && $valor === false;
    }

    /**
     * Abre a pendência (202 no boundary). O `ativa_uk` gerado garante UMA ativa por
     * alvo mesmo em corrida (SEC-SD-07: 1062 → 422, nunca duas); o teto
     * limita acúmulo.
     *
     * @param  array<string, mixed>  $payload
     */
    public function abrir(string $tipo, int $alvoId, ?string $alvoChave, array $payload, Usuario $solicitante): AprovacaoDeAcesso
    {
        if (! in_array($tipo, AprovacaoDeAcesso::TIPOS, true)
            || array_diff(array_keys($payload), self::PAYLOAD_POR_TIPO[$tipo]) !== []) {
            // whitelist é contrato de CÓDIGO (boundary montou payload errado), não 422
            throw new LogicException("Payload fora da whitelist do tipo {$tipo}.");
        }

        return $this->ancora->serializado(function () use ($tipo, $alvoId, $alvoChave, $payload, $solicitante): AprovacaoDeAcesso {
            $ativas = AprovacaoDeAcesso::where('status', 'pendente')->count();
            if ($ativas >= self::TETO_ATIVAS) {
                throw ValidationException::withMessages([
                    'aprovacao' => 'A clínica atingiu o teto de pendências de aprovação abertas. '
                        .'Decida ou cancele pendências antes de abrir novas.',
                ]);
            }

            $aprovacao = new AprovacaoDeAcesso;
            $aprovacao->tipo = $tipo;
            $aprovacao->alvo_id = $alvoId;
            $aprovacao->alvo_chave = $alvoChave;
            $aprovacao->payload_json = $payload;
            $aprovacao->solicitante_id = $solicitante->id;
            $aprovacao->status = 'pendente';

            try {
                $aprovacao->save();
            } catch (QueryException $excecao) {
                if ((int) ($excecao->errorInfo[1] ?? 0) === 1062) {
                    throw ValidationException::withMessages([
                        'aprovacao' => 'Já existe uma pendência de aprovação ativa para este alvo. '
                            .'Decida ou cancele a pendência existente antes de propor outra mudança.',
                    ]);
                }
                throw $excecao;
            }

            return $aprovacao;
        });
    }

    public function aprovar(AprovacaoDeAcesso $aprovacao, Usuario $decisor): AprovacaoDeAcesso
    {
        return $this->decidir($aprovacao, $decisor, 'aprovada', aplicar: true);
    }

    public function recusar(AprovacaoDeAcesso $aprovacao, Usuario $decisor): AprovacaoDeAcesso
    {
        return $this->decidir($aprovacao, $decisor, 'recusada', aplicar: false);
    }

    /** Cancelar é do SOLICITANTE (não é decisão: nada aplica). */
    public function cancelar(AprovacaoDeAcesso $aprovacao, Usuario $usuario): AprovacaoDeAcesso
    {
        if ($aprovacao->solicitante_id !== $usuario->id) {
            throw ValidationException::withMessages([
                'aprovacao' => 'Só quem abriu a pendência pode cancelá-la.',
            ]);
        }

        return $this->ancora->serializado(function () use ($aprovacao, $usuario): AprovacaoDeAcesso {
            $travada = $this->travarPendente($aprovacao->id);
            $travada->status = 'cancelada';
            $travada->decidido_por_id = $usuario->id;
            $travada->decidido_em = $this->agoraNaClinica();
            $travada->save();

            return $travada;
        });
    }

    /**
     * A ordem fixa da decisão (SEC-SD-03): âncora → pendência re-travada + CAS de
     * status (409) → decisor ≠ solicitante (422) → [aplicação revalidada] → flip.
     */
    private function decidir(AprovacaoDeAcesso $aprovacao, Usuario $decisor, string $statusFinal, bool $aplicar): AprovacaoDeAcesso
    {
        return $this->ancora->serializado(function () use ($aprovacao, $decisor, $statusFinal, $aplicar): AprovacaoDeAcesso {
            // ordem da spec (SD-N2): o CAS de status (409) decide ANTES do
            // maker≠checker — pendência já decidida responde 409 até para o solicitante
            $travada = $this->travarPendente($aprovacao->id);

            if ($travada->solicitante_id === $decisor->id) {
                throw ValidationException::withMessages([
                    'aprovacao' => 'A aprovação exige OUTRO administrador — quem pediu não decide.',
                ]);
            }

            if ($aplicar) {
                $this->assegurarDecisor($travada, $decisor);
                $this->aplicarRevalidando($travada, $decisor);
            }

            $travada->status = $statusFinal;
            $travada->decidido_por_id = $decisor->id;
            $travada->decidido_em = $this->agoraNaClinica();
            $travada->save();

            return $travada;
        });
    }

    /**
     * A MESMA régua do decisor, sem lançar: a tela só oferece "Aprovar" a quem passaria nela (gate r1,
     * CR-TRV-06 — o 403 de quem não tem o acesso chegava como "sem acesso a este recurso").
     */
    public function decisorCabe(AprovacaoDeAcesso $aprovacao, Usuario $decisor): bool
    {
        try {
            $this->assegurarDecisor($aprovacao, $decisor);
        } catch (HttpException $recusa) {
            if ($recusa->getStatusCode() !== 403) {
                throw $recusa;
            }

            return false;
        }

        return true;
    }

    /**
     * `decisorCabe` para uma LISTA, com as leituras da régua lembradas no lote (gate r2, CR-TRV-18): a
     * listagem perguntava por linha e relia as mesmas permissões, ~13 consultas por pendência. Só as
     * pendentes — a decidida não se aprova mais.
     *
     * @param  iterable<AprovacaoDeAcesso>  $pendencias
     * @return array<int, bool> por id da pendência
     */
    public function quaisODecisorAprova(iterable $pendencias, Usuario $decisor): array
    {
        return $this->semEscalada->emLote(fn (): array => collect($pendencias)
            ->filter(fn (AprovacaoDeAcesso $pendencia): bool => $pendencia->status === 'pendente')
            ->mapWithKeys(fn (AprovacaoDeAcesso $pendencia): array => [$pendencia->id => $this->decisorCabe($pendencia, $decisor)])
            ->all());
    }

    /**
     * Quem APROVA tem de ter o acesso em jogo, contra o estado ATUAL (change
     * `trava-de-usuarios-e-niveis`, D4): sem isto, "outro administrador" era só "outra pessoa com
     * `niveis_permissao.editar`", e duas recepcionistas aprovavam uma à outra. O 403 desfaz a transação
     * e a pendência continua pendente — outro administrador ainda pode decidir. Entidade sumida passa
     * daqui sem efeito: a revalidação recusa com a razão. `configurar_seguranca` já exige, pela rota,
     * quem administra acesso.
     */
    private function assegurarDecisor(AprovacaoDeAcesso $aprovacao, Usuario $decisor): void
    {
        $payload = $aprovacao->payload_json;

        if ($aprovacao->tipo === 'editar_nivel') {
            $this->semEscalada->assegurarNivel(
                $decisor,
                SemEscalada::propostas($payload['permissoes'] ?? null),
                NivelPermissao::query()->find($aprovacao->alvo_id),
            );
        }

        if ($aprovacao->tipo === 'atribuir_nivel') {
            $usuario = Usuario::query()->find($aprovacao->alvo_id);
            $nivel = NivelPermissao::query()->find($payload['nivel_permissao_id'] ?? 0);
            if ($usuario !== null && $nivel !== null) {
                $this->semEscalada->assegurarAtribuicao($decisor, $usuario, $nivel);
            }
        }
    }

    /** Instante na parede da CLÍNICA (fuso da clínica, §13) — nunca o do servidor. */
    private function agoraNaClinica(): string
    {
        return now($this->configuracoes->get('clinica.timezone'))->format('Y-m-d H:i');
    }

    /** Re-trava a pendência DENTRO da âncora; decidida no meio → 409 (double-approve). */
    private function travarPendente(int $id): AprovacaoDeAcesso
    {
        $travada = AprovacaoDeAcesso::query()->lockForUpdate()->find($id);

        if ($travada === null || $travada->status !== 'pendente') {
            abort(409, self::PENDENCIA_JA_DECIDIDA);
        }

        return $travada;
    }

    /**
     * Revalidação INTEGRAL contra o estado ATUAL (SEC-SD-03a): o payload é entrada
     * NÃO-confiável — regras completas do FormRequest, existência, OCC da
     * pendência (SEC-SD-02) e guardas de domínio (dentro da fonte única, já sob a
     * âncora). Recusa aqui responde 422 e a pendência PERMANECE pendente (rollback).
     */
    private function aplicarRevalidando(AprovacaoDeAcesso $aprovacao, Usuario $decisor): void
    {
        $origem = [
            'pendencia_id' => $aprovacao->id,
            'solicitante_id' => $aprovacao->solicitante_id,
            'decidido_por_id' => $decisor->id,
        ];
        $payload = $aprovacao->payload_json;

        match ($aprovacao->tipo) {
            'editar_nivel' => $this->aplicarEdicaoDeNivel($aprovacao, $payload, $origem),
            'atribuir_nivel' => $this->aplicarAtribuicao($aprovacao, $payload, $origem),
            'configurar_seguranca' => $this->aplicarConfiguracao($payload, $origem),
            default => throw new LogicException("Tipo de pendência desconhecido: {$aprovacao->tipo}."),
        };
    }

    /** @param array<string, mixed> $payload  @param array{pendencia_id: int, solicitante_id: int, decidido_por_id: int} $origem */
    private function aplicarEdicaoDeNivel(AprovacaoDeAcesso $aprovacao, array $payload, array $origem): void
    {
        $nivel = NivelPermissao::query()->lockForUpdate()->find($aprovacao->alvo_id);
        if ($nivel === null) {
            throw ValidationException::withMessages([
                'aprovacao' => 'O nível desta pendência não existe mais. Recuse ou cancele a pendência.',
            ]);
        }

        // OCC estendido ao vão assíncrono (SEC-SD-02): o nível mudou depois do pedido?
        // Aprovar o payload velho reverteria em silêncio a edição do intervalo.
        $base = is_string($payload['base_versao'] ?? null) ? $payload['base_versao'] : '';
        try {
            $baseInstante = Carbon::parse($base);
        } catch (Throwable) {
            $baseInstante = null;
        }
        if ($baseInstante === null || $nivel->updated_at === null || ! $nivel->updated_at->equalTo($baseInstante)) {
            throw ValidationException::withMessages([
                'aprovacao' => 'Esta pendência ficou obsoleta: o nível foi alterado depois do pedido. '
                    .'Recuse-a e refaça a mudança a partir do estado atual.',
            ]);
        }

        try {
            $dados = Validator::make(
                ['nome' => $payload['nome'] ?? null, 'permissoes' => $payload['permissoes'] ?? null],
                NivelPermissaoRequest::regras($nivel->id),
            )->validate();
        } catch (ValidationException) {
            // a chave de CAMPO do FormRequest não fala com quem está no painel de
            // aprovações (CR L2) — a recusa chega sob `aprovacao`, em pt-BR, com destino
            throw ValidationException::withMessages([
                'aprovacao' => 'A mudança proposta não é mais válida no estado atual '
                    .'(ex.: o nome já foi usado por outro nível). Recuse a pendência e refaça a partir do estado atual.',
            ]);
        }

        $this->mutacoes->aplicarEdicaoDeNivel($nivel, $dados, $origem);
    }

    /** @param array<string, mixed> $payload  @param array{pendencia_id: int, solicitante_id: int, decidido_por_id: int} $origem */
    private function aplicarAtribuicao(AprovacaoDeAcesso $aprovacao, array $payload, array $origem): void
    {
        $usuario = Usuario::query()
            ->lockForUpdate()
            ->find($aprovacao->alvo_id);
        $nivel = NivelPermissao::query()->find($payload['nivel_permissao_id'] ?? 0);

        if ($usuario === null || $nivel === null) {
            throw ValidationException::withMessages([
                'aprovacao' => 'O usuário ou o nível desta pendência não existe mais. Recuse ou cancele a pendência.',
            ]);
        }

        $this->mutacoes->aplicarAtribuicao($usuario, $nivel, $origem);
    }

    /** @param array<string, mixed> $payload  @param array{pendencia_id: int, solicitante_id: int, decidido_por_id: int} $origem */
    private function aplicarConfiguracao(array $payload, array $origem): void
    {
        $chave = is_string($payload['chave'] ?? null) ? $payload['chave'] : '';

        // nunca `set()` cego (SEC-SD-08): re-passa pela validação do catálogo e pelo
        // recorte que a pendência cobre (só `seguranca.*` booleana)
        if (! str_starts_with($chave, 'seguranca.')
            || ! CatalogoConfiguracoes::existe($chave)
            || CatalogoConfiguracoes::tipo($chave) !== 'bool'
            || ! CatalogoConfiguracoes::valorEValido($chave, $payload['valor'] ?? null)) {
            throw ValidationException::withMessages([
                'aprovacao' => 'A configuração desta pendência é inválida. Recuse ou cancele a pendência.',
            ]);
        }

        $this->mutacoes->aplicarConfiguracao($chave, (bool) $payload['valor'], $origem);
    }
}
