<?php

namespace App\Http\Controllers;

use App\Models\Clinica;
use App\Support\Auditoria\RegistroDeAuditoria;
use App\Support\CadastroOnline\LinkPublico;
use App\Support\Configuracoes\ConfiguracaoService;
use Illuminate\Http\JsonResponse;

/**
 * O endereço público do auto-cadastro, do lado de dentro (change `cadastro-online-do-paciente`).
 *
 * Gerar e rotacionar é **parametrização da clínica**, não operação de cadastro: exige
 * `configuracoes.editar`, a mesma permissão que liga e desliga o link.
 *
 * **A trilha registra que houve rotação, nunca para qual valor** (design D5). O motivo é o mesmo
 * que manteve o endereço fora do catálogo de configurações: a trilha é legível por quem tem
 * `auditoria.ver`, e gravar o endereço ali o entregaria pela porta que existe para vigiar o
 * sistema. O que interessa auditar é o ato — "alguém trocou o endereço, e foi fulano" —, e é
 * exatamente isso que fica.
 */
class LinkDeCadastroController extends Controller
{
    public function __construct(
        private readonly LinkPublico $link,
        private readonly ConfiguracaoService $configuracoes,
    ) {}

    /** O estado do link: se existe endereço, se está ligado, e o endereço para copiar. */
    public function show(): JsonResponse
    {
        $slug = $this->link->atual();

        return response()->json([
            'slug' => $slug,
            'ativo' => $this->configuracoes->get('cadastro_online.ativo') === true,
            // a URL completa é montada AQUI e não na tela: o front não conhece o endereço público
            // do sistema, e montá-lo lá espalharia a base da URL por dois lugares
            'url' => $slug === null ? null : rtrim((string) config('app.url'), '/').'/cadastro/'.$slug,
        ]);
    }

    /**
     * Gera o primeiro endereço, ou troca o que existe.
     *
     * É a mesma operação de propósito: "gerar" e "rotacionar" são o mesmo ato do ponto de vista do
     * sistema, e ter dois caminhos daria duas chances de esquecer a auditoria. Quem explica a
     * diferença ao operador é a tela, que só pede confirmação quando já existe endereço divulgado.
     */
    public function rotacionar(): JsonResponse
    {
        $tinhaEndereco = $this->link->atual() !== null;

        $novo = $this->link->rotacionar();

        RegistroDeAuditoria::registrar(
            Clinica::atual(),
            $tinhaEndereco ? 'rotacionou_link_de_cadastro' : 'gerou_link_de_cadastro',
            // NENHUM valor de endereço no diff — nem o novo, nem o antigo. O que a trilha prova é
            // que o ato aconteceu, quem o fez e quando; o endereço em si é o que ela não pode contar
            ['depois' => ['link_de_cadastro' => 'rotacionado']],
        );

        return response()->json([
            'slug' => $novo,
            'ativo' => $this->configuracoes->get('cadastro_online.ativo') === true,
            'url' => rtrim((string) config('app.url'), '/').'/cadastro/'.$novo,
        ]);
    }
}
