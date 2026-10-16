<?php

namespace App\Support\Rbac;

use App\Models\NivelPermissao;
use App\Models\Usuario;
use Illuminate\Validation\ValidationException;

/**
 * Invariante do "último admin" (gatilho ADM, parecer SEC-ADM-01): nenhuma mutação de
 * acesso pode deixar a clínica sem ao menos um usuário ATIVO cujo nível efetivo conceda
 * `niveis_permissao.editar` — a capacidade de administrar a clínica. Trancar a clínica
 * para fora da própria administração só teria conserto no banco, na mão.
 *
 * A guarda vive no SERVIDOR nos três boundaries que podem removê-la (atribuir nível,
 * editar as permissões de um nível, desativar usuário). "Regra que vive só na tela não é
 * regra" (§13) — a tela apenas exibe o 422 no lugar certo.
 *
 * Cada método valida o ESTADO FINAL (após a mutação hipotética): conta os admins que
 * RESTARIAM e recusa quando restaria zero.
 */
class GuardaUltimoAdmin
{
    public const PERMISSAO = 'niveis_permissao.editar';

    /**
     * Boundary 1 — o usuário passa a ter `$novoNivel`. Se o novo nível concede a
     * permissão, o usuário é admin no estado final e nada tranca. Se não concede, ele
     * sai da administração: precisa restar OUTRO admin ativo.
     */
    public function garantirAtribuicao(int $usuarioId, NivelPermissao $novoNivel): void
    {
        $administradores = $this->nivelIdsAdministradores();

        if (in_array($novoNivel->id, $administradores, true)) {
            return;
        }

        if ($this->contarAdminsAtivos($administradores, exceto: $usuarioId) === 0) {
            $this->recusar('nivel_permissao_id');
        }
    }

    /**
     * Boundary 2 — o nível passa a ter `$novasPermissoes`. Se continua concedendo a
     * permissão, seus admins permanecem. Se a perde, os que restam são os de OUTROS
     * níveis administradores.
     *
     * @param  list<string>  $novasPermissoes
     */
    public function garantirEdicaoDeNivel(NivelPermissao $nivel, array $novasPermissoes): void
    {
        if (in_array(self::PERMISSAO, $novasPermissoes, true)) {
            return;
        }

        $outrosAdministradores = array_values(array_diff($this->nivelIdsAdministradores(), [$nivel->id]));

        if ($this->contarAdminsAtivos($outrosAdministradores) === 0) {
            $this->recusar('permissoes');
        }
    }

    /**
     * Boundary 3 — o usuário será desativado. Se sobra admin ativo depois dele, ok. Se
     * não sobra, só tranca quando o PRÓPRIO alvo era o admin que faltava (se já não havia
     * admin algum, desativá-lo não piora o estado — e bloquear seria estranho).
     *
     * Por HTTP, desde `trava-de-usuarios-e-niveis`, a régua do acesso chega ANTES: só quem tem
     * tudo o que o administrador tem o desativa, e esse é outro administrador ativo. A guarda
     * fica como defesa em profundidade (CR-TRV-03): ela não depende de a auto-desativação seguir
     * barrada nem de a permissão só vir pelo nível.
     */
    public function garantirDesativacao(Usuario $usuario): void
    {
        $administradores = $this->nivelIdsAdministradores();

        if ($this->contarAdminsAtivos($administradores, exceto: $usuario->id) >= 1) {
            return;
        }

        if ($this->contarAdminsAtivos($administradores) >= 1) {
            $this->recusar('ativo');
        }
    }

    /**
     * Contagem pública dos admins ativos da clínica — pré-condição de LIGAR a
     * aprovação dupla (SEC-SD: com um só admin, ninguém jamais aprovaria).
     */
    public function contarAdministradoresAtivos(): int
    {
        return $this->contarAdminsAtivos($this->nivelIdsAdministradores());
    }

    /**
     * IDs dos níveis cujo conjunto de permissões contém a permissão de
     * administração — a definição de "admin" no estado atual.
     *
     * @return list<int>
     */
    private function nivelIdsAdministradores(): array
    {
        return NivelPermissao::query()
            ->whereHas('permissions', fn ($consulta) => $consulta->where('name', self::PERMISSAO))
            ->pluck('id')
            ->all();
    }

    /**
     * Usuários ATIVOS cujo nível está entre `$nivelIds` (administradores),
     * opcionalmente excluindo um id (o alvo da mutação). Consulta explícita na pivot.
     *
     * @param  list<int>  $nivelIds
     */
    private function contarAdminsAtivos(array $nivelIds, ?int $exceto = null): int
    {
        if ($nivelIds === []) {
            return 0;
        }

        $pivot = config('permission.table_names.model_has_roles');
        $morph = (new Usuario)->getMorphClass();

        return Usuario::query()
            ->where('usuarios.ativo', true)
            ->when($exceto !== null, fn ($consulta) => $consulta->where('usuarios.id', '!=', $exceto))
            ->whereExists(function ($sub) use ($pivot, $morph, $nivelIds) {
                $sub->from($pivot)
                    ->whereColumn("{$pivot}.model_id", 'usuarios.id')
                    ->where("{$pivot}.model_type", $morph)
                    ->whereIn("{$pivot}.role_id", $nivelIds);
            })
            ->count();
    }

    private function recusar(string $campo): never
    {
        throw ValidationException::withMessages([
            $campo => 'Esta ação deixaria a clínica sem nenhum administrador ativo. '
                .'Garanta que outro usuário ativo tenha a permissão de gerenciar níveis antes de continuar.',
        ]);
    }
}
