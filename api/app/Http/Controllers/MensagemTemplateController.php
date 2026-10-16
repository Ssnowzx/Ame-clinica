<?php

namespace App\Http\Controllers;

use App\Models\MensagemTemplate;
use App\Support\Mensageria\ConexaoDaClinica;
use App\Support\Mensageria\ErroDeEnvio;
use App\Support\Mensageria\FabricaDeCliente;
use Illuminate\Http\JsonResponse;
use Illuminate\Validation\ValidationException;

/**
 * Os templates aprovados na Meta, espelhados aqui (change mensageria-whatsapp).
 *
 * O cadastro e a submissão à aprovação acontecem no Business Manager — fora do escopo desta
 * change, e fora do nosso alcance: quem aprova o texto é a Meta. Aqui só se SINCRONIZA a
 * lista, para a tela montar a prévia e cobrar as variáveis ANTES do envio, em vez de deixar
 * a recepção descobrir pelo erro cru de um terceiro.
 */
class MensagemTemplateController extends Controller
{
    public function __construct(private readonly FabricaDeCliente $fabrica) {}

    public function index(): JsonResponse
    {
        $templates = MensagemTemplate::query()->orderBy('nome')->get();

        return response()->json($templates->map(fn (MensagemTemplate $template) => [
            'nome' => $template->nome,
            'idioma' => $template->idioma,
            'categoria' => $template->categoria,
            'corpo' => $template->corpo_previa,
            'variaveis' => $template->variaveis_json ?? [],
            'aprovado' => $template->estaAprovado(),
            'sincronizado_em' => $template->sincronizado_em?->toIso8601String(),
        ]));
    }

    public function sincronizar(): JsonResponse
    {
        $conexao = ConexaoDaClinica::atual();

        if ($conexao === null || ! $conexao->estaConectada()) {
            throw ValidationException::withMessages([
                'conexao' => 'Conecte o WhatsApp antes de sincronizar os templates.',
            ]);
        }

        try {
            $daMeta = $this->fabrica->paraClinica()->listarTemplates();
        } catch (ErroDeEnvio $erro) {
            throw ValidationException::withMessages(['meta' => $erro->getMessage()]);
        }

        // carimbo ÚNICO para a rodada inteira: `now()` chamado dentro do laço faria o
        // primeiro template ficar milissegundos "mais velho" que o último, e a limpeza
        // logo abaixo compara justamente contra esse instante
        $desdeAgora = now();

        foreach ($daMeta as $bruto) {
            MensagemTemplate::query()->updateOrCreate(
                ['nome' => $bruto['nome'], 'idioma' => $bruto['idioma']],
                [
                    'categoria' => $bruto['categoria'],
                    'corpo_previa' => $bruto['corpo'],
                    'variaveis_json' => $bruto['variaveis'],
                    // os botões de resposta rápida (lembrete-com-botoes-de-resposta): é por eles que o
                    // envio sabe mandar o payload de cada botão
                    'botoes_json' => $bruto['botoes'] ?? [],
                    'status_meta' => $bruto['status'],
                    'sincronizado_em' => $desdeAgora,
                ],
            );
        }

        // Template que sumiu da Meta é APOSENTADO, não apagado: mensagens antigas ainda
        // apontam para o nome dele, e apagar a linha deixaria a thread sem a prévia.
        MensagemTemplate::query()
            ->where(fn ($q) => $q->where('sincronizado_em', '<', $desdeAgora)
                ->orWhereNull('sincronizado_em'))
            ->update(['status_meta' => 'REJECTED']);

        return $this->index();
    }
}
