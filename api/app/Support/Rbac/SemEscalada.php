<?php

namespace App\Support\Rbac;

use App\Models\AprovacaoDeAcesso;
use App\Models\NivelPermissao;
use App\Models\Usuario;
use App\Support\Relatorios\RecebidoPorProfissional;
use Illuminate\Database\Eloquent\Builder;

/**
 * "Ninguém concede, tira ou usa acesso que não tem" (change `trava-de-usuarios-e-niveis`, que fecha o
 * `SEC-USR-EDITA-ADMIN`): com `usuarios.editar`, a recepção trocava a senha da administradora e entrava
 * como ela; com `niveis_permissao.editar`, dava a si mesma o que não tinha.
 *
 * O acesso tem DOIS eixos, e a régua mede os dois:
 * - as PERMISSÕES efetivas, nunca o nome do nível (D1, §13): o acesso em jogo tem de estar contido no de
 *   quem age. O Administrador, que tem o catálogo inteiro, continua livre;
 * - o ESCOPO por vínculo (D11): sem `agenda.ver_todos`/`clinico.ver_todos`, a pessoa só alcança o próprio
 *   profissional — e não mexe em quem alcança outro, nem muda vínculo, que é dar escopo (gate r1, SEC-TRV-02).
 *
 * Chamada nas portas (antes de abrir a pendência ou de aplicar direto) e na aprovação, para o decisor
 * (D2). NÃO mora em `MutacoesDeAcesso`, que também serve quem não tem ator (a clínica recém-criada).
 */
class SemEscalada
{
    public function __construct(private readonly SegregacaoFinanceira $segregacao) {}

    /**
     * Memória de UM lote de leituras (`emLote`): a listagem de pendências pergunta a régua do decisor
     * para cada linha, e sem ela relia as mesmas permissões a cada uma (gate r2, CR-TRV-18). Fora do lote
     * fica vazia, e toda leitura é fresca — as portas que mudam acesso nunca a usam.
     *
     * @var array<string, list<string>>|null
     */
    private ?array $memoria = null;

    /** As flags aditivas do escopo (D11): quem as tem alcança a clínica inteira naquele eixo. */
    public const FLAGS_DE_ESCOPO = ['agenda.ver_todos', 'clinico.ver_todos'];

    private const SOBRE_USUARIO = 'Você não pode alterar um usuário que tem acesso que você não tem.';

    /** A permissão que abre o recebido do profissional VINCULADO (change painel-do-profissional, D4). */
    private const RECEBIDO_PROPRIO = 'repasse.ver_proprio';

    private const SOBRE_O_RECEBIDO = 'Dar a alguém o recebido de um profissional exige ver o recebido dos profissionais.';

    private const SOBRE_A_CREDENCIAL = 'Trocar a senha ou o e-mail de quem vê o próprio recebido exige ver o recebido dos profissionais.';

    /**
     * A edição de um usuário — ou a criação, sem alvo — e o vínculo proposto (`profissional_id` do
     * pedido). Nulo ou vazio desvincula, o que tira escopo e não pede nada; o mesmo vínculo de hoje
     * também não.
     *
     * @param  array<string, mixed>  $credencial  `senha` e `email` do pedido, só os que vieram (ainda não validados)
     */
    public function assegurarEdicaoDeUsuario(Usuario $ator, ?Usuario $alvo, mixed $vinculo, array $credencial = []): void
    {
        if ($alvo !== null) {
            $this->assegurarUsuario($ator, $alvo, $credencial);
        }
        // lista ou objeto não é vínculo: segue para a validação, que responde 422 (gate r2, CR-TRV-17). O
        // resto se compara como TEXTO — `1.0` e `true` passam na validação `integer`, que não é estrita, e
        // viravam vínculo sem conferência quando a régua só olhava int e string (gate r3, CR-TRV-22)
        $desvincula = $vinculo === null || $vinculo === '';
        if (! $desvincula && ! is_array($vinculo) && ! is_object($vinculo)
            && (string) $vinculo !== (string) $alvo?->profissional_id) {
            $this->assegurarVinculo($ator);
            // o vínculo de quem lê o PRÓPRIO recebido escolhe de quem é o dinheiro que ele lê
            // (SEC-PP-01): o usuário novo nasce sem nível — o recebido só chega pela atribuição
            if ($alvo !== null && in_array(self::RECEBIDO_PROPRIO, [...$this->doUsuario($alvo), ...$this->emPendencia($alvo)], true)) {
                $this->assegurarReguaDoRecebido($ator);
            }
        }
    }

    /**
     * Editar um usuário — senha, e-mail, nome, `ativo`, vínculo — exige ter tudo o que ele tem HOJE e
     * tudo o que uma pendência está para lhe dar (gate r1, CR-TRV-01: sem isto, a recepção trocava a
     * senha de quem estava para virar administrador, e a aprovação entregava a conta promovida a ela).
     * O próprio usuário passa sempre.
     *
     * @param  array<string, mixed>  $credencial  `senha` e `email` do pedido, só os que vieram
     */
    private function assegurarUsuario(Usuario $ator, Usuario $alvo, array $credencial): void
    {
        // o próprio usuário passa SEMPRE — nem a pendência que o promove o impede de trocar a própria
        // senha (gate r2, CR-TRV-16); o vínculo segue medido à parte
        if ($ator->is($alvo)) {
            return;
        }
        $this->assegurarDentro($ator, [...$this->doUsuario($alvo), ...$this->emPendencia($alvo)], self::SOBRE_USUARIO);
        $this->assegurarEscopo($ator, $alvo, self::SOBRE_USUARIO);
        $this->assegurarCredencialDeQuemLeORecebido($ator, $alvo, $credencial);
    }

    /**
     * SEC-PP-04 (gate r2 de `painel-do-profissional`) — uma TRAVA até o "esqueci minha senha" por e-mail,
     * que será a solução definitiva numa change própria (decisão do dono, 2026-10-15).
     *
     * Quem troca a senha ou o e-mail de alguém TOMA a conta dele: com `usuarios.editar`, a gestora trocava
     * a senha da conta da Bia, entrava como ela e lia o recebido da Bia — o que a régua do vínculo
     * (`assegurarReguaDoRecebido`) fecha pela porta da frente, e isto pela dos fundos. Vale quando o alvo
     * lê o PRÓPRIO recebido (hoje ou numa pendência) e está vinculado a um profissional que NÃO é o de
     * quem age: aí, quem age tem de já ler o recebido de todo profissional.
     *
     * Só a senha e o e-mail entregam a conta. O e-mail conta só quando MUDA: a tela de usuários manda o
     * e-mail em toda edição, e renomear a Bia não é tomar a conta dela. Nome, `ativo` (reativar não dá a
     * senha a ninguém) e `acesso_mobile` não entregam a conta.
     *
     * @param  array<string, mixed>  $credencial  `senha` e `email` do pedido, só os que vieram
     */
    private function assegurarCredencialDeQuemLeORecebido(Usuario $ator, Usuario $alvo, array $credencial): void
    {
        $email = $credencial['email'] ?? null;
        $trocaAConta = array_key_exists('senha', $credencial)
            || (array_key_exists('email', $credencial)
                && (! is_string($email) || mb_strtolower(trim($email)) !== mb_strtolower((string) $alvo->email)));

        if (! $trocaAConta || $alvo->profissional_id === null
            || (int) $alvo->profissional_id === (int) $ator->profissional_id
            || ! in_array(self::RECEBIDO_PROPRIO, [...$this->doUsuario($alvo), ...$this->emPendencia($alvo)], true)) {
            return;
        }

        $this->assegurarReguaDoRecebido($ator, self::SOBRE_A_CREDENCIAL);
    }

    /**
     * Mudar o vínculo de um usuário com um profissional — no usuário novo, no de outro ou no próprio —
     * é dar escopo: exige alcançar a clínica inteira nos dois eixos. Desvincular tira escopo e não passa
     * por aqui.
     */
    private function assegurarVinculo(Usuario $ator): void
    {
        abort_if(array_diff(self::FLAGS_DE_ESCOPO, $this->doUsuario($ator)) !== [], 403,
            'Vincular um usuário a um profissional exige ver a agenda e o prontuário de toda a clínica.');
    }

    /**
     * Criar ou editar um nível: as permissões PROPOSTAS e as que o nível tem HOJE — tirar permissão
     * do Administrador também é mexer em acesso que a pessoa não tem.
     *
     * @param  list<string>  $propostas
     */
    public function assegurarNivel(Usuario $ator, array $propostas, ?NivelPermissao $atual): void
    {
        $this->assegurarDentro($ator, [...$propostas, ...($atual === null ? [] : $this->doNivel($atual))],
            'Você não pode dar a um nível uma permissão que você não tem, nem alterar um nível que tem permissões que você não tem.', montagem: true);

        // pôr o PRÓPRIO recebido num nível que tem gente vinculada a um profissional dá a essa gente o
        // dinheiro dele (SEC-PP-01) — o nível novo não tem ninguém, e quem age não conta: o dele é dele
        if ($atual !== null && in_array(self::RECEBIDO_PROPRIO, $propostas, true)
            && ! in_array(self::RECEBIDO_PROPRIO, $this->doNivel($atual), true)
            && Usuario::query()
                ->whereNotNull('profissional_id')
                ->whereKeyNot($ator->id)
                ->whereHas('roles', fn (Builder $papel) => $papel->whereKey($atual->id))
                ->exists()) {
            $this->assegurarReguaDoRecebido($ator);
        }
    }

    /**
     * Atribuir: o nível novo E o acesso que o usuário tem hoje (e o que uma pendência está para lhe
     * dar) — não se promove nem se rebaixa quem está acima, nem quem alcança outro profissional.
     */
    public function assegurarAtribuicao(Usuario $ator, Usuario $alvo, NivelPermissao $nivel): void
    {
        $mensagem = 'Você não pode atribuir um nível, nem trocar o nível de alguém, com acesso que você não tem.';
        $this->assegurarDentro($ator, [...$this->doNivel($nivel), ...$this->doUsuario($alvo), ...$this->emPendencia($alvo)], $mensagem, montagem: true);
        $this->assegurarEscopo($ator, $alvo, $mensagem);

        // dar o PRÓPRIO recebido a quem está vinculado a um profissional é dar o dinheiro DELE
        // (SEC-PP-01): sem isto, vincular uma conta sem nível e atribuir-lhe o nível depois contornava
        // a régua do vínculo em dois passos
        if (! $ator->is($alvo) && $alvo->profissional_id !== null
            && in_array(self::RECEBIDO_PROPRIO, $this->doNivel($nivel), true)
            && ! in_array(self::RECEBIDO_PROPRIO, $this->doUsuario($alvo), true)) {
            $this->assegurarReguaDoRecebido($ator);
        }
    }

    /**
     * SEC-PP-01 (gate r1 de `painel-do-profissional`): `repasse.ver_proprio` abre o recebido do
     * profissional VINCULADO — então escolher o vínculo de quem a tem, ou dá-la a quem está vinculado,
     * é escolher de quem é o dinheiro lido. Com `usuarios.editar` e as flags de ver todos, quem age
     * se vinculava à colega e lia o recebido dela. Daí: quem faz isso tem de já ler o recebido de
     * qualquer profissional — as permissões do relatório "Recebido por profissional", lidas dele.
     */
    private function assegurarReguaDoRecebido(Usuario $ator, string $mensagem = self::SOBRE_O_RECEBIDO): void
    {
        abort_if(array_diff((new RecebidoPorProfissional)->permissoes(), $this->doUsuario($ator)) !== [], 403, $mensagem);
    }

    /**
     * Só os nomes do CATÁLOGO: um nome que não existe não é acesso, e a validação o recusa com 422
     * depois — a régua não troca esse 422 por um 403.
     *
     * @param  mixed  $cru  o `permissoes` do payload, ainda não validado
     * @return list<string>
     */
    public static function propostas(mixed $cru): array
    {
        return is_array($cru)
            ? array_values(array_intersect(array_filter($cru, 'is_string'), PermissaoCatalogo::PERMISSOES))
            : [];
    }

    /**
     * `$montagem`: com a segregação financeira ligada, a escrita financeira sai do acesso em jogo de quem
     * MONTA níveis e os atribui (gate r2, CR-TRV-21) — quem controla níveis não a tem por regra (AP-13), e
     * sem a exceção ninguém mais a concederia. Montar e atribuir passam pela aprovação dupla, que a
     * segregação exige (CR-TRV-27). Editar USUÁRIO não tem exceção: a credencial não passa pela dupla, e a
     * gestora de acesso trocaria a senha da funcionária do financeiro e chegaria ao dinheiro (CR-TRV-28).
     *
     * @param  list<string>  $emJogo
     */
    private function assegurarDentro(Usuario $ator, array $emJogo, string $mensagem, bool $montagem = false): void
    {
        if ($montagem && $this->segregacao->ligada()) {
            $emJogo = array_filter($emJogo, fn (string $permissao): bool => ! SegregacaoFinanceira::ehEscritaFinanceira($permissao));
        }
        abort_if(array_diff($emJogo, $this->doUsuario($ator)) !== [], 403, $mensagem);
    }

    /**
     * Roda `$leituras` com a memória ligada e a desliga ao sair — só para listagens que perguntam a régua
     * muitas vezes no MESMO estado (a de pendências). Nunca em porta que muda acesso.
     *
     * @template T
     *
     * @param  callable(): T  $leituras
     * @return T
     */
    public function emLote(callable $leituras): mixed
    {
        $this->memoria = [];
        try {
            return $leituras();
        } finally {
            $this->memoria = null;
        }
    }

    /**
     * @param  callable(): list<string>  $ler
     * @return list<string>
     */
    private function lembrar(string $chave, callable $ler): array
    {
        if ($this->memoria === null) {
            return $ler();
        }

        return $this->memoria[$chave] ??= $ler();
    }

    /**
     * Em cada eixo que quem age NÃO alcança inteiro, o alvo tem de estar no alcance dela: sem vínculo
     * (não alcança nada) ou no MESMO profissional. Sem isto, quem só vê a própria agenda trocava a
     * senha do colega e lia as crianças dele (SEC-TRV-02). A flag do alvo já foi medida pelas permissões.
     */
    private function assegurarEscopo(Usuario $ator, Usuario $alvo, string $mensagem): void
    {
        if ($ator->is($alvo) || $alvo->profissional_id === null || (int) $alvo->profissional_id === (int) $ator->profissional_id) {
            return;
        }
        abort_if(array_diff(self::FLAGS_DE_ESCOPO, $this->doUsuario($ator)) !== [], 403, $mensagem);
    }

    /**
     * Lido do banco numa CÓPIA sem relações: o estado ATUAL (o decisor roda sob a âncora), e sem deixar
     * `roles` carregado no modelo de quem chamou — a trilha do `atribuiu_nivel` lê o nível "antes" de lá
     * (gate r1, CR-TRV-07).
     *
     * @return list<string>
     */
    private function doUsuario(Usuario $usuario): array
    {
        return $this->lembrar("usuario#{$usuario->id}", fn (): array => (clone $usuario)->setRelations([])->getAllPermissions()->pluck('name')->all());
    }

    /** @return list<string> */
    private function doNivel(NivelPermissao $nivel): array
    {
        return $this->lembrar("nivel#{$nivel->id}", fn (): array => $nivel->permissions()->pluck('name')->all());
    }

    /**
     * O que as pendências ABERTAS estão para dar ao usuário: a atribuição de um nível a ele — com o que
     * outra pendência está para dar a ESSE nível (gate r2, CR-TRV-15: pedir a Nova num nível e, em
     * seguida, o caixa para o nível) — e a edição do nível que ele tem.
     *
     * @return list<string>
     */
    private function emPendencia(Usuario $usuario): array
    {
        return $this->lembrar("pendencia#{$usuario->id}", function () use ($usuario): array {
            $nivelAtual = (clone $usuario)->setRelations([])->roles()->value('id');
            $abertas = AprovacaoDeAcesso::query()->where('status', 'pendente')->whereIn('tipo', ['atribuir_nivel', 'editar_nivel'])->get();
            $propostasDoNivel = fn (int $nivelId): array => $abertas
                ->filter(fn (AprovacaoDeAcesso $p): bool => $p->tipo === 'editar_nivel' && (int) $p->alvo_id === $nivelId)
                ->flatMap(fn (AprovacaoDeAcesso $p): array => self::propostas($p->payload_json['permissoes'] ?? null))
                ->all();

            return $abertas
                ->filter(fn (AprovacaoDeAcesso $p): bool => $p->tipo === 'atribuir_nivel' && (int) $p->alvo_id === $usuario->id)
                ->flatMap(function (AprovacaoDeAcesso $p) use ($propostasDoNivel): array {
                    $nivel = NivelPermissao::query()->find($p->payload_json['nivel_permissao_id'] ?? 0);

                    return $nivel === null ? [] : [...$this->doNivel($nivel), ...$propostasDoNivel($nivel->id)];
                })
                ->merge($nivelAtual === null ? [] : $propostasDoNivel($nivelAtual))
                ->values()
                ->all();
        });
    }
}
