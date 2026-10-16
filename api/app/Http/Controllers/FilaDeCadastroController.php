<?php

namespace App\Http\Controllers;

use App\Models\EnvioDeCadastro;
use App\Models\Paciente;
use App\Support\Clinica\ResumoDoPaciente;
use App\Support\Rbac\EscopoDoProfissional;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Validation\ValidationException;

/**
 * A fila de conferência do auto-cadastro (change `cadastro-online-do-paciente`).
 *
 * É o outro lado da porta pública, e a razão de ela ser suportável: nada do que a família envia
 * entra na base sem alguém olhar. O que este controller faz é mostrar o envio ao lado de quem já
 * existe e registrar a decisão — **ele não cria paciente**.
 *
 * **O aceite não grava.** Ele marca o envio como aceito e devolve o conteúdo para a tela abrir o
 * formulário de paciente PRÉ-PREENCHIDO, que é onde a recepção conserta o que a família digitou
 * errado antes de a base receber. Quem cria o paciente continua sendo `POST /pacientes`, com
 * todas as guardas — não existe um segundo caminho de escrita de paciente, e há guarda de
 * arquitetura cobrando isso.
 *
 * **Os candidatos parecidos exigem `pacientes.ver` junto** (parecer pré-código, condição 6 /
 * ameaça A4). Sem isso, a fila devolveria por dentro o oráculo que a resposta cega fecha por
 * fora: bastaria enviar pelo formulário público o CPF de quem se suspeita ser paciente e abrir a
 * fila para ler o nome.
 */
class FilaDeCadastroController extends Controller
{
    /**
     * Quantos candidatos cada VALOR pode trazer.
     *
     * Por valor, e não pela página: um teto de página deixava um telefone ruidoso consumir a cota
     * e apagar o parecido dos outros envios (rodada dirigida, CR2-02). Dez é folgado para o que a
     * fila precisa — ela existe para o humano decidir, não para listar homônimos.
     */
    private const TETO_DE_PARECIDOS_POR_VALOR = 10;

    public function __construct(private readonly EscopoDoProfissional $escopos) {}

    /** A fila, do mais antigo para o mais novo — quem esperou mais é quem a clínica atende antes. */
    public function index(Request $request): JsonResponse
    {
        $podeVerPacientes = $request->user()?->can('pacientes.ver') === true;

        $envios = EnvioDeCadastro::query()
            ->where('situacao', 'pendente')
            ->whereNull('expurgado_em')
            ->orderBy('enviado_em')
            ->paginate(50);

        // DUAS consultas para a página inteira, não duas por envio: com 50 envios eram 100 idas
        // ao banco, metade delas varredura completa (`JSON_CONTAINS` não tem índice que sirva).
        // Medido no gate: 106 consultas numa página (CO-06)
        $parecidos = $podeVerPacientes ? $this->parecidosDaPagina($request, $envios->getCollection()) : [];

        $envios->getCollection()->transform(fn (EnvioDeCadastro $envio): array => [
            'id' => $envio->id,
            'enviado_em' => $envio->enviado_em?->toDateTimeString(),
            'dados' => $envio->payload,
            // o bloco dos parecidos SÓ existe para quem pode ver paciente. Ausente, e não vazio:
            // uma lista vazia diria "procurei e não achei", que já é resposta
            ...($podeVerPacientes ? ['parecidos' => $parecidos[$envio->id] ?? []] : []),
        ]);

        return response()->json($envios);
    }

    /**
     * Quem já existe e pode ser a mesma pessoa — por CPF e por telefone, para a PÁGINA inteira.
     *
     * Objetivo de propósito: CPF e telefone são iguais ou não são. Nome semelhante exige critério
     * (fonético? distância?) e fica para depois — e, mesmo quando chegar, será sugestão para o
     * humano, nunca prova: a normalização de nome desta casa não dobra inversão de escrita nem
     * letra de outro alfabeto que se pareça com a nossa.
     *
     * **Duas consultas para a página toda** no caso comum — uma por eixo —, e mais uma varredura
     * do eixo do telefone só quando a anterior voltou truncada. Uma por envio dava 100 idas ao banco numa página de 50, metade delas
     * varredura completa — `JSON_CONTAINS` não tem índice que sirva no MariaDB.
     *
     * **O motivo da coincidência não sai da whitelist do menor.** `ResumoDoPaciente::CAMPOS` traz
     * só id e nome: CPF e telefone de criança não entram no processo, e é assim que tem de ser.
     * Para saber QUAL valor casou sem carregar a coluna, a consulta devolve a POSIÇÃO do valor na
     * lista que já está aqui — `FIELD` para o CPF, e `CONCAT_WS` de `IF(JSON_CONTAINS…)` para o
     * telefone, desdobrado no PHP. É um número, não um dado. Uma versão anterior tentou comparar `$paciente->cpf`, que não vinha carregado, e
     * rotulou todo candidato como "telefone"; alargar a whitelist para consertar teria trazido
     * CPF de criança para uma tela que não precisa dele.
     *
     * Respeita o escopo por vínculo (D11): um profissional escopado não passa a enxergar criança
     * de colega porque ela apareceu ao lado de um envio.
     *
     * @param  Collection<int, EnvioDeCadastro>  $envios
     * @return array<int, list<array<string, mixed>>>
     */
    private function parecidosDaPagina(Request $request, $envios): array
    {
        $cpfs = [];
        $telefones = [];

        foreach ($envios as $envio) {
            $payload = $envio->payload ?? [];

            if (is_string($payload['cpf'] ?? null) && $payload['cpf'] !== '') {
                $cpfs[] = $payload['cpf'];
            }

            foreach ($payload['contatos_json'] ?? [] as $contato) {
                if (is_string($contato['valor'] ?? null) && $contato['valor'] !== '') {
                    $telefones[] = $contato['valor'];
                }
            }
        }

        // `array_unique` numa LISTA, nunca chave de array: CPF e telefone são dígitos, e PHP
        // converte chave numérica em inteiro em silêncio — o `json_encode` do JSON_CONTAINS
        // passava a mandar `{"valor":48999998888}` (número) contra `"48999998888"` (texto), e
        // nenhum telefone casava
        $cpfs = array_values(array_unique($cpfs));
        $telefones = array_values(array_unique($telefones));

        $porCpf = $this->casadosPorCpf($request, $cpfs);
        $porTelefone = $this->casadosPorTelefone($request, $telefones);

        $resultado = [];

        foreach ($envios as $envio) {
            $payload = $envio->payload ?? [];
            $cpf = is_string($payload['cpf'] ?? null) ? $payload['cpf'] : null;
            $doEnvio = collect($payload['contatos_json'] ?? [])->pluck('valor')->filter()->all();

            $candidatos = [];

            // o CPF vem PRIMEIRO: quando a mesma criança casa pelos dois, ele é o sinal mais
            // forte, e repetir a linha faria a tela mostrar a mesma criança duas vezes
            foreach ($cpf !== null ? ($porCpf[$cpf] ?? []) : [] as $achado) {
                $candidatos[$achado['id']] ??= [...$achado, 'coincide_por' => 'cpf'];
            }

            foreach ($doEnvio as $telefone) {
                foreach ($porTelefone[$telefone] ?? [] as $achado) {
                    $candidatos[$achado['id']] ??= [...$achado, 'coincide_por' => 'telefone'];
                }
            }

            $resultado[$envio->id] = array_slice(array_values($candidatos), 0, 10);
        }

        return $resultado;
    }

    /**
     * Os pacientes que casam por CPF, agrupados pelo CPF que casou.
     *
     * `FIELD(cpf, ?, ?, …)` devolve a POSIÇÃO do valor na lista — um número. O CPF do paciente
     * não é selecionado, e por isso não entra no processo.
     *
     * @param  list<string>  $cpfs
     * @return array<string, list<array<string, mixed>>>
     */
    private function casadosPorCpf(Request $request, array $cpfs): array
    {
        if ($cpfs === []) {
            return [];
        }

        $marcadores = implode(', ', array_fill(0, count($cpfs), '?'));

        $encontrados = $this->pacientesDoEscopo($request)
            ->whereIn('cpf', $cpfs)
            // `select()` + `selectRaw()`, nunca `get($colunas)`: o argumento do `get` SUBSTITUI o
            // select montado, e a posição carimbada sumiria em silêncio
            ->select(ResumoDoPaciente::CAMPOS)
            // `FIELD` não colapsa aqui: um paciente tem UM cpf, então só um valor pode casar
            ->selectRaw("FIELD(cpf, {$marcadores}) as posicao_do_valor", $cpfs)
            ->orderBy('id')
            ->limit(self::TETO_DE_PARECIDOS_POR_VALOR * count($cpfs))
            ->get();

        return $this->agruparPelaPosicao($encontrados, $cpfs);
    }

    /**
     * Os pacientes que casam por telefone, agrupados pelo telefone que casou.
     *
     * @param  list<string>  $telefones
     * @return array<string, list<array<string, mixed>>>
     */
    private function casadosPorTelefone(Request $request, array $telefones): array
    {
        if ($telefones === []) {
            return [];
        }

        /*
         * UMA varredura, devolvendo TODAS as posições que casaram em cada linha — e uma SEGUNDA,
         * dirigida, só se algum valor tiver ficado sem candidato por causa do teto.
         *
         * A história desta consulta, em três defeitos:
         *
         * 1. um `CASE` compartilhado devolvia só o PRIMEIRO ramo verdadeiro, e a criança com dois
         *    telefones sumia do envio que trouxe o segundo (CR2-01);
         * 2. trocar por um ramo `union` por valor consertou isso e trouxe 50 varreduras completas
         *    numa página de 50 telefones distintos — 49× as linhas lidas, medido (CR3-06);
         * 3. o `CONCAT_WS` resolveu os dois, mas o teto virou da PÁGINA: um telefone compartilhado
         *    (escola, abrigo, mãe de vários irmãos) consumia a cota e cortava o candidato dos
         *    outros envios ANTES de o PHP recortar por valor — a fila deixava de avisar que a
         *    criança já é paciente, em silêncio (CR4-01).
         *
         * O laço fecha o 3 sem reabrir o 2: cada rodada ou enche pelo menos um balde ou volta sem
         * truncamento e para. No caso comum é UMA varredura; nunca uma por valor. As posições são inteiros do laço, nunca valor de fora — o único dado da família
         * que entra na consulta entra por binding.
         */
        $por = [];
        $pendentes = $telefones;

        while ($pendentes !== []) {
            $limite = self::TETO_DE_PARECIDOS_POR_VALOR * count($pendentes);
            $encontrados = $this->varrer($request, $pendentes);
            $por += $this->recortarPorValor($encontrados, $pendentes);

            /*
             * O predicado é TRUNCAMENTO, não orfandade.
             *
             * A versão anterior repescava uma vez, para os valores que ficaram sem candidato — e a
             * repescagem herdava o mesmo teto. Com DOIS telefones compartilhados na mesma página,
             * o segundo enchia a segunda varredura e o candidato legítimo morria igual: o repro
             * (um ruidoso) tinha sido consertado, o predicado não (rodada 5).
             *
             * Se a varredura voltou SEM truncar, todo mundo que casava já veio: quem ficou sem
             * candidato é porque não existe. É também o caso comum, e ele sai daqui em UMA ida ao
             * banco.
             */
            if ($encontrados->count() < $limite) {
                break;
            }

            $restantes = array_values(array_filter($pendentes, fn (string $t): bool => ! isset($por[$t])));

            // sem progresso numa rodada inteira: parar em vez de girar
            if (count($restantes) === count($pendentes)) {
                break;
            }

            $pendentes = $restantes;
        }

        return $por;
    }

    /**
     * Uma varredura: cada paciente volta uma vez, carimbado com a LISTA de posições que casaram.
     *
     * @param  list<string>  $telefones
     * @return Collection<int, Paciente>
     */
    private function varrer(Request $request, array $telefones): Collection
    {
        $ramos = [];
        $valores = [];

        foreach ($telefones as $indice => $telefone) {
            $ramos[] = 'IF(JSON_CONTAINS(contatos_json, ?), '.($indice + 1).', NULL)';
            // o contato mora num JSON; a comparação é pelo valor cru que a família digitou
            $valores[] = json_encode([['valor' => $telefone]]);
        }

        return $this->pacientesDoEscopo($request)
            ->where(function ($sub) use ($telefones): void {
                foreach ($telefones as $telefone) {
                    $sub->orWhereJsonContains('contatos_json', ['valor' => $telefone]);
                }
            })
            // `select()` + `selectRaw()`, nunca `get($colunas)`: o argumento do `get` SUBSTITUI o
            // select montado, e as posições carimbadas sumiriam em silêncio
            ->select(ResumoDoPaciente::CAMPOS)
            ->selectRaw('CONCAT_WS(\',\', '.implode(', ', $ramos).') as posicoes_do_valor', $valores)
            ->orderBy('id')
            ->limit(self::TETO_DE_PARECIDOS_POR_VALOR * count($telefones))
            ->get();
    }

    /**
     * Desdobra as posições carimbadas em baldes por VALOR, com o teto de cada um.
     *
     * @param  Collection<int, Paciente>  $encontrados
     * @param  list<string>  $telefones
     * @return array<string, list<array<string, mixed>>>
     */
    private function recortarPorValor($encontrados, array $telefones): array
    {
        $por = [];

        foreach ($encontrados as $paciente) {
            $posicoes = array_filter(explode(',', (string) ($paciente->posicoes_do_valor ?? '')), 'strlen');

            foreach ($posicoes as $posicao) {
                $indice = (int) $posicao - 1;

                if (! isset($telefones[$indice])) {
                    continue;
                }

                $chave = $telefones[$indice];
                $por[$chave] ??= [];

                if (count($por[$chave]) < self::TETO_DE_PARECIDOS_POR_VALOR) {
                    $por[$chave][] = ResumoDoPaciente::de($paciente);
                }
            }
        }

        return $por;
    }

    /**
     * Devolve o resumo de cada paciente sob o VALOR que o casou, usando a posição que a consulta
     * carimbou — o dado sensível nunca precisa voltar do banco.
     *
     * @param  Collection<int, Paciente>  $encontrados
     * @param  list<string>  $valores
     * @return array<string, list<array<string, mixed>>>
     */
    private function agruparPelaPosicao($encontrados, array $valores): array
    {
        $por = [];

        foreach ($encontrados as $paciente) {
            $posicao = (int) ($paciente->posicao_do_valor ?? 0);

            if ($posicao < 1 || $posicao > count($valores)) {
                continue;
            }

            $por[$valores[$posicao - 1]][] = ResumoDoPaciente::de($paciente);
        }

        return $por;
    }

    /** A base das duas consultas de candidatos, já recortada pelo escopo por vínculo (D11). */
    private function pacientesDoEscopo(Request $request): Builder
    {
        return $this->escopos->restringirAosPacientesDoEscopo(
            $this->escopos->agenda($request->user()),
            Paciente::query(),
        );
    }

    /**
     * ACEITAR: marca o envio e devolve o conteúdo para a tela abrir o cadastro pré-preenchido.
     *
     * Exige `pacientes.criar` além de `cadastro_online.conferir` (parecer, condição 10): aceitar é
     * o primeiro passo de criar paciente, e sem essa exigência `conferir` viraria permissão de
     * criação por porta lateral.
     *
     * Conferido não se confere de novo — nem para aceitar duas vezes, nem para desfazer.
     */
    public function aceitar(Request $request, int $id): JsonResponse
    {
        $envio = $this->pendente($id);

        $envio->forceFill([
            'situacao' => 'aceito',
            'conferido_por' => $request->user()?->id,
            'conferido_em' => now(),
        ])->save();

        return response()->json([
            'id' => $envio->id,
            // o conteúdo volta para a tela PRÉ-PREENCHER o formulário de paciente. Ele não vira
            // paciente aqui: quem cria é `POST /pacientes`, com as guardas de sempre
            'dados' => $envio->payload,
        ]);
    }

    /**
     * RASCUNHO: devolve o conteúdo de um envio já aceito que ainda NÃO virou ficha.
     *
     * É o que faz o formulário sobreviver a um F5 depois do aceite. Sem ele, o conteúdo só existia
     * no `state` da navegação — que morre no recarregamento e, pior, ficava guardado no histórico
     * do navegador de uma máquina compartilhada.
     *
     * O recorte é estreito de propósito: `aceito` **e** sem `paciente_id`. Envio que já virou
     * ficha se lê pela ficha; envio pendente se lê pela fila; envio descartado não se lê.
     */
    public function rascunho(int $id): JsonResponse
    {
        $envio = EnvioDeCadastro::query()->findOrFail($id);

        if ($envio->situacao !== 'aceito' || $envio->paciente_id !== null || $envio->expurgado()) {
            abort(404);
        }

        return response()->json(['id' => $envio->id, 'dados' => $envio->payload]);
    }

    /** DESCARTAR: exige motivo — decisão sem razão registrada é decisão que ninguém consegue revisar. */
    public function descartar(Request $request, int $id): JsonResponse
    {
        // EXISTÊNCIA antes de validação, que é a ordem registrada da casa
        // (`autorizacao-antes-de-validacao-e-de-existencia`). Sem vazamento aqui — o 422 do
        // motivo não depende de o envio existir — mas a ordem invertida é o padrão de onde os
        // oráculos nascem, e não vale manter uma exceção só porque esta é inofensiva
        $envio = $this->pendente($id);

        $dados = $request->validate([
            'motivo' => ['required', 'string', 'min:3', 'max:500'],
        ], [
            'motivo.required' => 'Diga por que este cadastro está sendo descartado.',
        ]);

        $envio->forceFill([
            'situacao' => 'descartado',
            'motivo_descarte' => $dados['motivo'],
            'conferido_por' => $request->user()?->id,
            'conferido_em' => now(),
        ])->save();

        return response()->json(['id' => $envio->id, 'situacao' => 'descartado']);
    }

    /**
     * O envio ainda pendente — ou a recusa.
     *
     * Envio já conferido responde 422, e não 404: a linha existe, quem tem a permissão pode
     * saber que ela existe, e "já foi conferido por alguém" é exatamente o que essa pessoa
     * precisa ler para não conferir de novo. Aqui não há oráculo a proteger: quem chega já tem
     * permissão de ver a fila inteira.
     */
    private function pendente(int $id): EnvioDeCadastro
    {
        $envio = EnvioDeCadastro::query()->findOrFail($id);

        if ($envio->conferido()) {
            throw ValidationException::withMessages([
                'envio' => 'Este cadastro já foi conferido.',
            ]);
        }

        if ($envio->expurgado()) {
            throw ValidationException::withMessages([
                'envio' => 'Este cadastro venceu o prazo e o conteúdo foi apagado.',
            ]);
        }

        return $envio;
    }
}
