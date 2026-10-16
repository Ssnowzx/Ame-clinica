<?php

namespace App\Support\Rbac;

use App\Models\Configuracao;
use App\Models\NivelPermissao;
use App\Models\Usuario;
use App\Support\Auditoria\RegistroDeAuditoria;
use App\Support\Configuracoes\ConfiguracaoService;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Spatie\Permission\PermissionRegistrar;

/**
 * FONTE ÚNICA da aplicação das mutações de acesso (SEC-SD, decisão 3): o caminho
 * DIRETO (flags desligadas) e o handler de APROVAÇÃO chamam exatamente este
 * código — duplicar a aplicação divergiria no primeiro refactor (lição da fonte
 * única do escopo e da GuardaUltimoAdmin).
 *
 * Toda mutação que muda ACESSO EFETIVO roda serializada pela `AncoraDaClinica`
 * (SEC-SD-01) com as guardas DENTRO da transação. `$origem` (quando a aplicação
 * vem de uma pendência aprovada) entra no payload da trilha: a mudança efetiva é
 * do APROVADOR, e reconstruir a ação-de-2-pessoas exige pendência+solicitante
 * (SEC-SD-11).
 */
class MutacoesDeAcesso
{
    public function __construct(
        private readonly AncoraDaClinica $ancora,
        private readonly GuardaUltimoAdmin $guardaUltimoAdmin,
        private readonly SegregacaoFinanceira $segregacao,
        private readonly ConfiguracaoService $configuracoes,
    ) {}

    /**
     * Criar nível é INERTE (SEC-SD-04: acesso efetivo só muda em atribuir ∪ editar)
     * — sem âncora; a segregação vale desde o nascimento.
     *
     * @param  array{nome: string, permissoes: list<string>}  $dados
     */
    public function aplicarCriacaoDeNivel(array $dados): NivelPermissao
    {
        // ANCORADA também (CR A2): a validação da segregação sem serialização abriria
        // o TOCTOU criar-violador × ligar-a-flag concorrentes — a mesma classe de
        // corrida que esta change fecha nos outros boundaries
        return $this->ancora->serializado(function () use ($dados): NivelPermissao {
            $this->segregacao->garantirNivel($dados['permissoes']);

            $nivel = NivelPermissao::create(['name' => $dados['nome'], 'guard_name' => 'web']);
            $this->sincronizarPermissoesAuditando($nivel, $dados['permissoes'], null);
            $this->invalidarCacheDePermissoes();

            return $nivel;
        });
    }

    /**
     * @param  array{nome: string, permissoes: list<string>}  $dados
     * @param  array{pendencia_id: int, solicitante_id: int, decidido_por_id: int}|null  $origem
     */
    public function aplicarEdicaoDeNivel(NivelPermissao $nivel, array $dados, ?array $origem = null): NivelPermissao
    {
        return $this->ancora->serializado(function () use ($nivel, $dados, $origem): NivelPermissao {
            $this->segregacao->garantirNivel($dados['permissoes']);
            // remover a permissão de administrar não pode esvaziar a administração
            // (gatilho ADM, SEC-ADM-01) — contagem já serializada pela âncora
            $this->guardaUltimoAdmin->garantirEdicaoDeNivel($nivel, $dados['permissoes']);

            $nivel->update(['name' => $dados['nome']]);
            $this->sincronizarPermissoesAuditando($nivel, $dados['permissoes'], $origem);
            $this->invalidarCacheDePermissoes();

            return $nivel;
        });
    }

    /** @param array{pendencia_id: int, solicitante_id: int, decidido_por_id: int}|null $origem */
    public function aplicarAtribuicao(Usuario $usuario, NivelPermissao $nivel, ?array $origem = null): Usuario
    {
        return $this->ancora->serializado(function () use ($usuario, $nivel, $origem): Usuario {
            // não deixar a clínica sem administrador (gatilho ADM, SEC-ADM-01)
            $this->guardaUltimoAdmin->garantirAtribuicao($usuario->id, $nivel);

            $nivelAnterior = $usuario->roles->first()?->name;
            $usuario->syncRoles([$nivel]);
            $this->invalidarCacheDePermissoes();
            $usuario->unsetRelation('roles')->unsetRelation('permissions');

            // mudança de pivot não dispara evento de model — auditar aqui (T-rbac-01)
            RegistroDeAuditoria::registrar($usuario, 'atribuiu_nivel', array_filter([
                'antes' => ['nivel_permissao' => $nivelAnterior],
                'depois' => ['nivel_permissao' => $nivel->name],
                'aprovacao' => $origem,
            ]));

            return $usuario;
        });
    }

    /**
     * Escrita de configuração com as PRÉ-CONDIÇÕES (SEC-SD-08) — rodam no caminho direto
     * E na aprovação. Ligar tem as suas; desligar só uma: a dupla não sai com a segregação
     * ligada (`trava-de-usuarios-e-niveis`, CR-TRV-27). O resto do gate do desligar é a
     * própria pendência.
     *
     * @param  array{pendencia_id: int, solicitante_id: int, decidido_por_id: int}|null  $origem
     */
    public function aplicarConfiguracao(string $chave, mixed $valor, ?array $origem = null): void
    {
        // chaves fora de `seguranca.*` não têm pré-condição de acesso — seguem diretas
        if (! str_starts_with($chave, 'seguranca.')) {
            $this->configuracoes->set($chave, $valor);

            return;
        }

        // ANCORADA (CR A2): as pré-condições de LIGAR validam estado — sem a âncora,
        // ligar-a-dupla × desativar-o-2º-admin (ou ligar-segregação × criar-violador)
        // concorrentes recriariam o TOCTOU que esta change fecha
        $this->ancora->serializado(function () use ($chave, $valor, $origem): void {
            if ($chave === 'seguranca.aprovacao_dupla' && $valor === true
                && $this->guardaUltimoAdmin->contarAdministradoresAtivos() < 2) {
                throw ValidationException::withMessages([
                    'valor' => 'Ligar a aprovação dupla exige ao menos dois administradores ativos — '
                        .'com um só, nenhuma mudança de acesso poderia ser aprovada.',
                ]);
            }

            if ($chave === 'seguranca.segregacao_financeira' && $valor === true) {
                $violadores = SegregacaoFinanceira::violadoresExistentes();
                if ($violadores !== []) {
                    throw ValidationException::withMessages([
                        'valor' => 'Estes níveis combinam controle de permissões com escrita financeira: '
                            .implode(', ', $violadores).'. Reorganize-os antes de ligar a segregação.',
                    ]);
                }
                // com a segregação, quem gere o acesso monta o nível do financeiro sem ter o dinheiro (D11
                // de `trava-de-usuarios-e-niveis`) — sem um segundo aval, chegaria a ele sozinha, por um
                // "fantoche" (gate r4, CR-TRV-27). O gatilho virou trava
                if (! (bool) $this->configuracoes->atual('seguranca.aprovacao_dupla')) {
                    throw ValidationException::withMessages([
                        'valor' => 'Ligar a segregação financeira exige a aprovação dupla ligada: com a segregação, '
                            .'quem gere o acesso monta o nível do financeiro, e sem um segundo aval chegaria ao dinheiro sozinho.',
                    ]);
                }
            }

            if ($chave === 'seguranca.aprovacao_dupla' && $valor === false) {
                $this->assegurarQueADuplaPodeDesligar();
            }

            $this->configuracoes->set($chave, $valor);

            // Configuracao é Auditavel (a escrita entra na trilha sozinha); quando veio de
            // aprovação, o vínculo com a pendência precisa constar no ALVO (SEC-SD-11)
            if ($origem !== null) {
                $registro = Configuracao::where('chave', $chave)->first();
                if ($registro !== null) {
                    RegistroDeAuditoria::registrar($registro, 'aplicou_por_aprovacao', ['aprovacao' => $origem]);
                }
            }
        });
    }

    /**
     * A dupla não sai debaixo da segregação: desligá-la deixaria a exceção D11 de
     * `trava-de-usuarios-e-niveis` sem o segundo aval (CR-TRV-27). Lê o valor GRAVADO
     * (CR-TRV-29). Também na ABERTURA do pedido: um pedido que nunca poderia ser aprovado
     * não é "enviado para aprovação" (CR-TRV-30).
     */
    public function assegurarQueADuplaPodeDesligar(): void
    {
        if ((bool) $this->configuracoes->atual('seguranca.segregacao_financeira')) {
            throw ValidationException::withMessages([
                'valor' => 'Desligue a segregação financeira antes de desligar a aprovação dupla.',
            ]);
        }
    }

    /**
     * syncPermissions muda pivot (sem eventos de model) — auditar explicitamente
     * (parecer T-rbac-01: toda mutação de nível auditada).
     *
     * @param  list<string>  $permissoes
     * @param  array{pendencia_id: int, solicitante_id: int, decidido_por_id: int}|null  $origem
     */
    private function sincronizarPermissoesAuditando(NivelPermissao $nivel, array $permissoes, ?array $origem): void
    {
        $antes = $nivel->permissions()->pluck('name')->sort()->values()->all();
        $nivel->syncPermissions($permissoes);
        $depois = $nivel->load('permissions')->permissions->pluck('name')->sort()->values()->all();

        if ($antes !== $depois) {
            // syncPermissions muda SÓ a pivot: sem o touch, uma edição que preserva o
            // nome deixa `updated_at` parado — e o `base_versao` do OCC assíncrono
            // (e o If-Match) ficariam CEGOS para a mutação que mais importa (CR B1)
            $nivel->touch();
            RegistroDeAuditoria::registrar($nivel, 'alterou_permissoes', array_filter([
                'antes' => ['permissoes' => $antes],
                'depois' => ['permissoes' => $depois],
                'aprovacao' => $origem,
            ]));
        }
    }

    private function invalidarCacheDePermissoes(): void
    {
        // cache do Spatie é global (design, armadilha 3). APÓS o commit
        // (CR A1): invalidar dentro da transação abre a janela em que um request
        // concorrente reconstrói o cache com o estado PRÉ-commit e o stale dura horas.
        DB::afterCommit(fn () => app(PermissionRegistrar::class)->forgetCachedPermissions());
    }
}
