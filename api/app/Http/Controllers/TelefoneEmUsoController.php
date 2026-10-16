<?php

namespace App\Http\Controllers;

use App\Models\ContatoNormalizado;
use App\Models\Paciente;
use App\Support\Mensageria\TelefoneE164;
use App\Support\Rbac\EscopoDoProfissional;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * "Este número também está no cadastro de…" (change telefone-que-chega-no-whatsapp, D6).
 *
 * Em 08/09 a mesma pessoa cadastrou duas pacientes em 5 minutos, e a primeira ficou com o celular
 * da segunda. Em 01/10 o lembrete com o nome de uma criança chegou à outra família. O alerta tem de
 * aparecer quando o número é DIGITADO, com a ficha na mão — por isso uma consulta própria, e não
 * um aviso na resposta do salvar.
 *
 * - POST, e não GET: o número de uma família de criança não pode ir para o log de acesso do
 *   proxy como query string.
 * - Sob `pacientes.ver` (na rota): quem pode listar a base inteira. Devolve só id, nome e
 *   situação — nunca contato, documento ou responsável do outro paciente.
 * - Só a tela INTERNA chama. O formulário público nunca diz que um número existe: seria contar a
 *   uma família que outra criança é paciente da clínica.
 * - Irmãos dividem o telefone da mãe, então isto é ALERTA, não recusa: quem decide se é a mesma
 *   família é a pessoa que está cadastrando.
 * - O escopo por vínculo vale aqui como na fila de cadastro (gate r1, SEC-TEL-03): o profissional
 *   escopado só ouve falar das crianças dele — e a CONTAGEM vem da mesma consulta, senão ela
 *   denunciaria quem está fora do escopo.
 */
class TelefoneEmUsoController extends Controller
{
    /** Um número de escola ou de recepção colado em muitos cadastros não vira uma lista sem fim. */
    private const NO_MAXIMO = 5;

    public function __construct(private readonly EscopoDoProfissional $escopos) {}

    public function __invoke(Request $request): JsonResponse
    {
        $dados = $request->validate([
            'numero' => ['required', 'string', 'max:255'],
            'ignorar_paciente_id' => ['sometimes', 'nullable', 'integer'],
        ]);

        $classe = TelefoneE164::classificar($dados['numero']);

        if ($classe['forma'] === null) {
            return response()->json([...$classe, 'tambem_em' => [], 'total' => 0]);
        }

        $ids = ContatoNormalizado::query()
            ->whereIn('e164', TelefoneE164::variantes($classe['forma']))
            ->when(
                isset($dados['ignorar_paciente_id']),
                fn ($consulta) => $consulta->where('paciente_id', '!=', $dados['ignorar_paciente_id']),
            )
            ->distinct()
            ->pluck('paciente_id');

        $doEscopo = $this->escopos->restringirAosPacientesDoEscopo(
            $this->escopos->agenda($request->user()),
            Paciente::query()->whereKey($ids->all()),
        );
        $total = (clone $doEscopo)->count();
        $pacientes = $doEscopo->orderBy('nome')->limit(self::NO_MAXIMO)->get(['id', 'nome', 'ativo']);

        return response()->json([
            ...$classe,
            'tambem_em' => $pacientes->map(fn (Paciente $paciente): array => [
                'id' => $paciente->id,
                'nome' => $paciente->nome,
                'ativo' => (bool) $paciente->ativo,
            ])->values(),
            'total' => $total,
        ]);
    }
}
