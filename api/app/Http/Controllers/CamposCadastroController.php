<?php

namespace App\Http\Controllers;

use App\Http\Requests\CamposCadastroRequest;
use App\Models\Paciente;
use App\Support\CamposCadastro\CatalogoCamposCadastro as Catalogo;
use App\Support\CamposCadastro\ReguaDoCadastro;
use Illuminate\Http\JsonResponse;

/**
 * A RÉGUA DO CADASTRO (capability `campos-do-cadastro`): o que a clínica exige e o que
 * ela esconde do formulário de paciente.
 *
 * Leitura LARGA, escrita ESTREITA (design D9): quem cadastra paciente precisa da régua
 * para montar o formulário e quase nunca tem `configuracoes.ver` — que dá o catálogo
 * inteiro (financeiro, encadeamento, mensageria). Escrever, aí sim, é de quem configura.
 *
 * A resposta expõe SÓ as chaves que têm efeito hoje (`obrigatorio`, `desabilitado`, `online`).
 * `online` passou a ter efeito com a change `cadastro-online-do-paciente` — é ela que decide o
 * que a família vê no formulário público. `rapido` segue no schema sem efeito (change 3 da
 * cadeia): devolvê-la agora poria na tela um controle que não faz nada.
 */
class CamposCadastroController extends Controller
{
    public function __construct(private readonly ReguaDoCadastro $regua) {}

    public function index(string $formulario): JsonResponse
    {
        return response()->json($this->efetiva($formulario));
    }

    public function update(CamposCadastroRequest $request): JsonResponse
    {
        $formulario = $request->formulario();

        foreach ($request->validated()['campos'] as $campo => $chaves) {
            // só as chaves ATIVAS chegam aqui (a FormRequest recusa o resto), e `null`
            // volta o campo ao padrão do catálogo — é o "não opinei" do design D2
            $this->regua->gravar($campo, $chaves, $formulario);
        }

        return response()->json($this->efetiva($formulario));
    }

    /**
     * Quantos cadastros ficariam INCOMPLETOS com a régua proposta.
     *
     * Existe para que apertar a régua seja uma decisão informada: a diferença entre "3
     * fichas" e "1.847 fichas" é a diferença entre um ajuste e um mutirão. Nenhum cadastro
     * é alterado — a régua nova vale da próxima gravação em diante; o que muda é o que a
     * listagem passa a acusar.
     *
     * É uma LEITURA que recebe corpo (o mesmo `{campos: {...}}` da gravação), por isso
     * `POST`: a régua proposta não cabe em query string sem virar ilegível.
     */
    public function previa(CamposCadastroRequest $request): JsonResponse
    {
        $formulario = $request->formulario();
        $obrigatorios = $this->regua->obrigatoriosCom($request->validated()['campos'], $formulario);

        // Só fichas ATIVAS: é o que a listagem mostra por padrão (parecer CR-I3). Contar os
        // inativos junto faria o aviso prometer um número que a lista não confirma — numa
        // clínica com centenas de arquivados, a diferença é grande o bastante para a
        // recepção achar que a tela mente.
        return response()->json([
            'total' => Paciente::query()->where('ativo', true)->count(),
            'incompletos' => $this->contarIncompletos($obrigatorios, $formulario),
        ]);
    }

    /** @param  list<string>  $obrigatorios */
    private function contarIncompletos(array $obrigatorios, string $formulario): int
    {
        if ($obrigatorios === []) {
            return 0;
        }

        // só as colunas de que a conta precisa — a mesma economia do design D6
        $colunas = array_values(array_unique([
            'id',
            ...Catalogo::colunasDe($obrigatorios, $formulario),
        ]));

        $incompletos = 0;
        Paciente::query()->where('ativo', true)->select($colunas)->chunkById(
            500,
            function ($pagina) use (&$incompletos, $obrigatorios, $formulario): void {
                foreach ($pagina as $paciente) {
                    if ($this->regua->faltaAlgum($paciente, $obrigatorios, $formulario)) {
                        $incompletos++;
                    }
                }
            },
        );

        return $incompletos;
    }

    /** @return array<string, mixed> */
    private function efetiva(string $formulario): array
    {
        $regua = $this->regua->todos($formulario);

        $campos = [];
        foreach (Catalogo::todos($formulario) as $campo => $definicao) {
            $campos[] = [
                'campo' => $campo,
                // rótulo e seção vêm do SERVIDOR para que nenhum cliente mantenha o
                // dicionário por conta própria — foi lista à mão que deixou texto de
                // máquina vazar para a tela (change texto-de-maquina-fora-da-tela)
                'rotulo' => $definicao['rotulo'],
                'secao' => $definicao['secao'],
                'lista' => Catalogo::eLista($campo, $formulario),
                // o TETO do campo, pelo mesmo motivo do rótulo e da seção logo acima: para
                // que nenhum cliente mantenha o número por conta própria. Com ele, o
                // formulário trava no limite em vez de perder a ficha inteira no salvar
                'tamanho' => Catalogo::tamanho($campo, $formulario),
                'tamanhos_dos_itens' => (object) Catalogo::tamanhosDosItens($campo, $formulario),
                'obrigatorio' => $regua[$campo]['obrigatorio'],
                'desabilitado' => $regua[$campo]['desabilitado'],
                // já resolvido pela régua: `desabilitado` vence `online` na leitura, então a
                // tela nunca recebe a combinação impossível para desenhar
                'online' => $regua[$campo]['online'],
                'travas' => Catalogo::travas($campo, $formulario),
                'motivo_trava' => $definicao['motivo'] ?? null,
            ];
        }

        return [
            'formulario' => $formulario,
            'secoes' => collect(Catalogo::SECOES)
                ->map(fn (string $rotulo, string $chave): array => ['secao' => $chave, 'rotulo' => $rotulo])
                ->values()
                ->all(),
            'campos' => $campos,
        ];
    }
}
