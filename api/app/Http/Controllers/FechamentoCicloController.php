<?php

namespace App\Http\Controllers;

use App\Http\Requests\FechamentoCicloRequest;
use App\Http\Requests\ReaberturaDeCicloRequest;
use App\Models\Convenio;
use App\Models\FechamentoCiclo;
use App\Support\Auditoria\RegistroDeAuditoria;
use App\Support\Ciclos\CalendarioDoCiclo;
use App\Support\Ciclos\FechamentoDeCiclo;
use App\Support\Configuracoes\ConfiguracaoService;
use Illuminate\Http\JsonResponse;
use Illuminate\Validation\ValidationException;

/**
 * Ciclos de faturamento — agregado do CONVÊNIO (D2), no mesmo padrão das
 * regras de limite (SEC-LP-07): rotas aninhadas, pai resolvido por `findOrFail`/
 * `firstOrFail` (id inexistente → 404) e filho SEMPRE pela relação do pai.
 *
 * Toda escrita roda dentro de `FechamentoDeCiclo::comLockDoConvenio` — o ponto de
 * serialização comum com os caminhos de escrita dos módulos (SEC-FC-10/11/12).
 *
 * Leitura e escrita sob `ciclos.fechar`; a reabertura exige ainda `ciclos.reabrir`, e
 * esse gate mora no `authorize()` do `ReaberturaDeCicloRequest` (o 403 vence o 422).
 */
class FechamentoCicloController extends Controller
{
    public function __construct(private readonly ConfiguracaoService $configuracoes) {}

    /** Fechamentos do convênio, do mais recente para o mais antigo. */
    public function index(int $convenioId): JsonResponse
    {
        $convenio = Convenio::findOrFail($convenioId);

        return response()->json(
            $convenio->fechamentosCiclo()
                ->with(['fechadoPor:id,nome', 'reabertoPor:id,nome'])
                ->orderByDesc('periodo_inicio')->orderByDesc('id')->get()
                ->map(fn (FechamentoCiclo $fechamento) => $this->serializar($fechamento))
        );
    }

    /**
     * O próximo período FECHÁVEL derivado do calendário — a afordância da tela, não um
     * oráculo: devolve uma janela, nunca a lista de fechamentos de terceiros.
     *
     * É a última janela **inteiramente decorrida** na parede da clínica (o período que
     * contém hoje ainda está correndo, e fechá-lo congelaria produção que ainda entra).
     *
     * ## Por que o corpo é sempre um OBJETO, com `motivo`
     *
     * A primeira versão devolvia `null` para DOIS estados distintos: "este convênio não tem
     * calendário de ciclo" e "a última janela decorrida já foi fechada". São opostos na
     * tela — o primeiro pede que alguém CONFIGURE o dia de corte; o segundo é o desfecho
     * normal de quem acabou de fechar o mês e está com a linha nova bem ali embaixo, na
     * tabela de fechados. Com uma leitura só, a tela dizia "configure o corte" a cada ciclo
     * para um convênio configurado, contradizendo a tabela logo abaixo.
     *
     * Contrato: `{"periodo": {"periodo_inicio","periodo_fim"} | null, "motivo":
     * "sem_calendario" | "ja_fechado" | null}`. `motivo` é `null` exatamente quando há
     * período — os dois campos nunca são ambos nulos e nunca são ambos preenchidos.
     *
     * `ja_fechado` NÃO é "não há mais nada a fechar": fechar um período mais antigo continua
     * possível pelo POST, que valida a janela contra o mesmo calendário. É só a ausência de
     * uma SUGESTÃO.
     */
    public function proximo(int $convenioId): JsonResponse
    {
        $convenio = Convenio::findOrFail($convenioId);

        if (! CalendarioDoCiclo::doConvenio($convenio)) {
            return self::semJanela('sem_calendario');
        }

        $janela = CalendarioDoCiclo::janelaAnterior(
            $convenio->ciclo_tipo_corte,
            $convenio->ciclo_dia_corte,
            now($this->configuracoes->get('clinica.timezone'))
        );

        $jaFechada = $convenio->fechamentosCiclo()
            ->whereNull('reaberto_em')
            ->where('periodo_inicio', '<=', $janela['periodo_fim'])
            ->where('periodo_fim', '>=', $janela['periodo_inicio'])
            ->exists();

        return $jaFechada
            ? self::semJanela('ja_fechado')
            : response()->json(['periodo' => $janela, 'motivo' => null]);
    }

    /**
     * "Não há próximo período a sugerir" — e POR QUÊ.
     *
     * O `motivo` é o campo inteiro desta resposta: sem ele os dois estados colapsam num
     * `null` só, que foi o defeito que este formato existe para corrigir.
     */
    private static function semJanela(string $motivo): JsonResponse
    {
        return response()->json(['periodo' => null, 'motivo' => $motivo]);
    }

    public function store(FechamentoCicloRequest $request, int $convenioId): JsonResponse
    {
        $dados = $request->validated();

        // convênio relido sob lock: o calendário e os fechamentos usados na decisão são
        // os serializados, não os que uma leitura anterior enxergou (D8)
        $fechamento = FechamentoDeCiclo::comLockDoConvenio(
            $convenioId,
            fn (Convenio $convenio) => FechamentoDeCiclo::fechar(
                $convenio,
                $dados['periodo_inicio'],
                $dados['periodo_fim'],
                (int) $request->user()->id,
            )
        );

        return response()->json(
            $this->serializar($fechamento->load(['fechadoPor:id,nome', 'reabertoPor:id,nome'])),
            201
        );
    }

    /**
     * Reabrir MARCA a linha — nunca a apaga nem limpa a marca de outra (SEC-FC-02). A
     * reabertura e o evento `reabriu_ciclo` comitam JUNTOS (SEC-FC-04, molde
     * `assinou_por_outro`): não existe produção destravada sem a prova de quem destravou
     * e por quê — a trilha é append-only, perdido o evento, perdido para sempre.
     */
    public function reabrir(ReaberturaDeCicloRequest $request, int $convenioId, int $id): JsonResponse
    {
        $motivo = $request->validated()['motivo'];
        $usuarioId = (int) $request->user()->id;

        $fechamento = FechamentoDeCiclo::comLockDoConvenio(
            $convenioId,
            function (Convenio $convenio) use ($id, $motivo, $usuarioId): FechamentoCiclo {
                // filho SEMPRE pela relação do pai; lock na ordem fixa da
                // casa: convenios ANTES de fechamentos_ciclo
                $fechamento = $convenio->fechamentosCiclo()
                    ->whereKey($id)->lockForUpdate()->firstOrFail();

                if (! $fechamento->estaAberto()) {
                    // o concorrente que perdeu a corrida cai aqui (SEC-FC-04)
                    throw ValidationException::withMessages([
                        'fechamento_id' => 'Este ciclo já foi reaberto.',
                    ]);
                }

                $fechamento->reaberto_por = $usuarioId;
                $fechamento->reaberto_em = now();
                $fechamento->motivo_reabertura = $motivo;
                $fechamento->save();

                // whitelist LITERAL (molde do call-site do `assinou_por_outro`): o evento
                // carrega o que reconstrói "quem destravou o quê e por quê" — o diff do
                // `atualizou` do Auditavel carrega as colunas; os dois na mesma transação
                RegistroDeAuditoria::registrar($fechamento, 'reabriu_ciclo', [
                    'depois' => [
                        'fechamento_id' => (int) $fechamento->id,
                        'convenio_id' => (int) $fechamento->convenio_id,
                        'periodo_inicio' => $fechamento->periodo_inicio->format('Y-m-d'),
                        'periodo_fim' => $fechamento->periodo_fim->format('Y-m-d'),
                        'motivo' => $motivo,
                    ],
                ]);

                return $fechamento;
            }
        );

        return response()->json(
            $this->serializar($fechamento->load(['fechadoPor:id,nome', 'reabertoPor:id,nome']))
        );
    }

    /**
     * Payload do fechamento (contrato da change).
     *
     * `motivo_reabertura` fica DE FORA de propósito (SEC-FC-06): a tela precisa saber
     * QUE houve reabertura e por quem — o porquê é leitura de trilha, sob `auditoria.ver`,
     * onde o evento `reabriu_ciclo` o guarda com ator, IP e timestamp. Um motivo escrito
     * às pressas pode nomear paciente; ele não circula na listagem do cadastro.
     *
     * @return array<string, mixed>
     */
    private function serializar(FechamentoCiclo $fechamento): array
    {
        return [
            'id' => $fechamento->id,
            'periodo_inicio' => $fechamento->periodo_inicio->format('Y-m-d'),
            'periodo_fim' => $fechamento->periodo_fim->format('Y-m-d'),
            // NOT NULL na migration (+ restrictOnDelete no autor): o `?->` aqui seria
            // defesa morta que promete um `null` ao cliente e o faz tipar o campo como
            // nulável — a tela quebraria no render se algum dia ele viesse mesmo.
            'fechado_por' => $fechamento->fechadoPor->only(['id', 'nome']),
            // fechado_em/reaberto_em são gravados com now() UTC — a exibição
            // converte para a PAREDE (§13); sem isso saíam ~3h no futuro
            'fechado_em' => $fechamento->fechado_em->timezone($this->configuracoes->get('clinica.timezone'))->format('Y-m-d H:i'),
            'reaberto_por' => $fechamento->reabertoPor?->only(['id', 'nome']),
            'reaberto_em' => $fechamento->reaberto_em?->timezone($this->configuracoes->get('clinica.timezone'))->format('Y-m-d H:i'),
            'aberto' => $fechamento->estaAberto(),
        ];
    }
}
