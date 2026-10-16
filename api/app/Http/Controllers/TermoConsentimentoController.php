<?php

namespace App\Http\Controllers;

use App\Http\Requests\TermoConsentimentoRequest;
use App\Models\TermoConsentimento;
use App\Support\Http\ConcorrenciaOtimista;
use App\Support\Rbac\AncoraDaClinica;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Response;
use Illuminate\Validation\ValidationException;

/**
 * O TERMO de consentimento da clínica (FA-08) — o contrato terapêutico como DADO
 * versionado, administrado pela tela (§13).
 *
 * Três invariantes, e cada uma existe por um motivo de PROVA:
 * 1. `versao` é do servidor e cresce a cada publicação (o cliente não escolhe a régua);
 * 2. publicar aposenta a anterior numa TRANSAÇÃO com lock — nunca duas vigentes;
 * 3. versão com aceite é IMUTÁVEL e não se exclui: editar o texto sob um aceite
 *    é falsificar o que a família assinou.
 *
 * O que este controller NUNCA devolve: quem aceitou. Só a CONTAGEM (design D8) —
 * listar aceitantes criaria superfície nova de nomes de MENORES sob permissão de
 * administração, que é o acúmulo cobrado pelo gatilho ENUM.
 */
class TermoConsentimentoController extends Controller
{
    public function __construct(private readonly AncoraDaClinica $ancora) {}

    /**
     * Histórico da clínica, do mais novo ao mais velho — SEM o texto.
     *
     * O texto é de até 50 KB por versão; uma lista de dez versões viraria meio mega
     * de payload para desenhar uma tabela de metadados. Quem quer ler um texto abre
     * a versão (`show`).
     */
    public function index(): JsonResponse
    {
        $termos = TermoConsentimento::query()->orderByDesc('versao')->get();

        return response()->json($termos->map(fn (TermoConsentimento $termo) => $this->resumir($termo)));
    }

    public function store(TermoConsentimentoRequest $request): JsonResponse
    {
        $dados = $request->validated();

        // A publicação é UMA operação: numerar, aposentar a anterior e marcar a nova.
        // Sem serialização, duas abas publicando ao mesmo tempo produziriam duas vigentes
        // (duas réguas em uso) ou colidiriam no único (versao) com um 500.
        // MariaDB não tem índice único parcial (`WHERE vigente`), então a unicidade do
        // vigente é invariante de ESCRITA — provada por teste de concorrência.
        //
        // A serialização vem da ÂNCORA DA CLÍNICA (`AncoraDaClinica`, a fonte única desta
        // casa, com a ordem canônica de locks no docblock), e não de um
        // `MAX(versao) FOR UPDATE`: na PRIMEIRA publicação não existe linha de termo
        // para travar, e as duas requisições calculariam `versao = 1`. A linha da clínica
        // existe sempre — é o ponto de serialização estável.
        $termo = $this->ancora->serializado(function () use ($dados): TermoConsentimento {
            $proxima = ((int) TermoConsentimento::query()->max('versao')) + 1;

            // atribuição, NUNCA `update(['vigente' => false])`: `vigente` está fora do
            // `$fillable` de propósito, e o mass-assignment o descartaria EM SILÊNCIO —
            // a versão anterior seguiria vigente e a clínica teria duas réguas em uso
            // (o teste "deve aposentar a versão anterior" existe por causa disso).
            // `save()` (e não update de query builder) mantém a mudança na trilha.
            TermoConsentimento::query()->where('vigente', true)->get()
                ->each(function (TermoConsentimento $anterior): void {
                    $anterior->vigente = false;
                    $anterior->save();
                });

            $novo = new TermoConsentimento;
            $novo->fill($dados);
            $novo->versao = $proxima;
            $novo->vigente = true;
            $novo->save();

            return $novo;
        });

        return response()->json($this->serializar($termo), 201);
    }

    public function show(int $id): JsonResponse
    {
        return response()->json($this->serializar(TermoConsentimento::findOrFail($id)));
    }

    public function update(TermoConsentimentoRequest $request, int $id): JsonResponse
    {
        $termo = TermoConsentimento::findOrFail($id);
        ConcorrenciaOtimista::assegurar($termo, $request);

        // A checagem de aceite e a escrita correm SOB A ÂNCORA (parecer SEC-TR-01/CR-1):
        // fora dela, isto era check-then-act — a administradora corrige uma versão
        // recém-publicada no mesmo instante em que a recepção registra o primeiro aceite
        // dela, as duas passam, e a família fica com um aceite apontando para um texto
        // que mudou DEPOIS da assinatura. O registro do aceite toma a MESMA âncora
        // (`PacienteController`), que é o que faz as duas se enxergarem.
        $termo = $this->ancora->serializado(function () use ($request, $termo): TermoConsentimento {
            $termo->refresh();

            // Texto sob aceite é prova do que a família assinou: mudá-lo é reescrever o
            // passado. O caminho é publicar uma versão nova — que é o que o FA-08 pede
            // ("trocar o regulamento NÃO reescreve aceites passados").
            if ($termo->temAceite()) {
                throw ValidationException::withMessages([
                    'texto' => 'Esta versão já foi aceita por pacientes e não pode ser alterada. '
                        .'Publique uma nova versão.',
                ]);
            }

            $termo->update($request->validated());

            return $termo;
        });

        return response()->json($this->serializar($termo));
    }

    public function destroy(int $id): Response
    {
        $termo = TermoConsentimento::findOrFail($id);

        $this->ancora->serializado(function () use ($termo): void {
            $termo->refresh();

            if ($termo->temAceite()) {
                throw ValidationException::withMessages([
                    'termo' => 'Esta versão já foi aceita por pacientes e não pode ser excluída — '
                        .'ela é a prova do que foi aceito.',
                ]);
            }

            // Excluir a VIGENTE havendo outra versão deixaria a clínica com histórico e
            // SEM RÉGUA — e o estrago é silencioso: o registro de aceite passa a recusar
            // (422) e a fila de termos pendentes **zera**, indistinguível de "todo mundo
            // assinou". É a mentira que esta change existe para matar, re-armada por uma
            // ação de administração (parecer SEC-TR-02/CR-2). Excluir a ÚNICA versão
            // continua permitido: é o desfazer honesto de uma publicação errada, e leva
            // a clínica de volta ao estado "ainda não publicou".
            if ($termo->vigente && TermoConsentimento::query()->count() > 1) {
                throw ValidationException::withMessages([
                    'termo' => 'Esta é a versão em vigor. Publique a versão que passa a valer '
                        .'antes de excluí-la — sem uma versão vigente, a clínica não consegue '
                        .'registrar aceite e a fila de termos pendentes fica vazia.',
                ]);
            }

            $termo->delete();
        });

        return response()->noContent();
    }

    /**
     * A régua que está valendo, para quem REGISTRA aceite.
     *
     * Existe porque a recepção tem `pacientes.editar` — não `termos_consentimento.ver` —
     * e precisa saber qual termo o formulário vai gravar (e se existe algum: sem vigente,
     * a tela mostra o próximo passo em vez de um campo que o servidor recusaria).
     *
     * Payload MÍNIMO de propósito: nomeia a régua (id, título, versão) e nada mais. O
     * TEXTO fica fora — quem colhe a assinatura tem o papel na mão, e servir 50 KB do
     * documento sob `pacientes.ver` seria ampliar a leitura sem que ninguém pedisse.
     *
     * A resposta é um ENVELOPE (`{termo: ... | null}`) porque "ainda não publicaram" é
     * uma resposta legítima, e não um erro: `response()->json(null)` viraria `{}` no
     * corpo (o JsonResponse do Symfony troca null por objeto vazio), e o cliente teria
     * de adivinhar se aquilo é "sem termo" ou "termo sem campos".
     */
    public function vigente(): JsonResponse
    {
        $termo = TermoConsentimento::emVigor();

        return response()->json(['termo' => $termo === null ? null : [
            'id' => $termo->id,
            'titulo' => $termo->titulo,
            'versao' => $termo->versao,
        ]]);
    }

    /** @return array<string, mixed> */
    private function serializar(TermoConsentimento $termo): array
    {
        return [...$this->resumir($termo), 'texto' => $termo->texto];
    }

    /** @return array<string, mixed> */
    private function resumir(TermoConsentimento $termo): array
    {
        return [
            'id' => $termo->id,
            'titulo' => $termo->titulo,
            'versao' => $termo->versao,
            'vigente' => $termo->vigente,
            // CONTAGEM, nunca a lista: o catálogo não diz quem aceitou (design D8).
            // É o que explica ao administrador por que o texto travou.
            'aceites_total' => $termo->aceitesTotal(),
            'updated_at' => $termo->updated_at?->toJSON(), // token da concorrência otimista (If-Match)
        ];
    }
}
