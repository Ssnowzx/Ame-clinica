<?php

namespace App\Http\Controllers\Publico;

use App\Http\Controllers\Controller;
use App\Http\Requests\EnvioDeCadastroRequest;
use App\Models\Clinica;
use App\Models\EnvioDeCadastro;
use App\Support\CadastroOnline\FormularioPublico;
use App\Support\Configuracoes\ConfiguracaoService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Storage;

/**
 * O formulário público de auto-cadastro — a LEITURA (change `cadastro-online-do-paciente`).
 *
 * É a primeira superfície do produto servida a quem não tem sessão. Duas regras governam tudo o
 * que ela faz:
 *
 * 1. **Ela não conta o que existe.** Endereço inexistente, clínica inativa e link desligado
 *    respondem igual — a recusa mora numa função só, em `LinkPublico`.
 * 2. **Ela devolve marca e campos, e nada mais.** Nenhuma contagem, nenhuma lista, nenhuma outra
 *    chave de `configuracoes`. A página que estranhos abrem não é uma janela para o cadastro da
 *    clínica.
 *
 * A rota da MARCA obedece às duas do mesmo jeito, e isso é o que o parecer pré-código chamou de
 * "o oráculo mudando de porta": se `/cadastro/{slug}` é cego mas a rota que serve a logo responde
 * 404 para endereço inexistente e 200 para link desligado, a cegueira do formulário não vale nada.
 */
class CadastroPublicoController extends Controller
{
    /** MIME servido a partir da extensão gravada no upload (nunca do cliente). */
    private const MIMES = ['png' => 'image/png', 'jpg' => 'image/jpeg', 'webp' => 'image/webp'];

    public function __construct(
        private readonly FormularioPublico $formulario,
        private readonly ConfiguracaoService $configuracoes,
    ) {}

    /**
     * O que a página precisa para se desenhar: a marca da clínica e os campos da régua.
     *
     * A ORDEM é a do parecer (`SEC-CO-17`): resolver o endereço vem **antes** de qualquer coisa,
     * e a resposta de link desligado sai antes de o payload ser sequer olhado. Invertido, um 422
     * de campo contaria "esta clínica existe e a régua dela é assim".
     */
    public function formulario(Request $requisicao): JsonResponse
    {
        return response()->json([
            'clinica' => $this->marca($this->clinicaDoLink($requisicao)),
            ...$this->formulario->montar(),
        ]);
    }

    /**
     * A clínica que o middleware `link-publico` já resolveu.
     *
     * O controller NÃO resolve de novo: seria uma segunda consulta e uma segunda chance de as duas
     * divergirem — e, sobretudo, o middleware existe justamente para que a resolução aconteça
     * antes da validação, que roda antes daqui.
     */
    private function clinicaDoLink(Request $requisicao): Clinica
    {
        return $requisicao->attributes->get('clinica_do_link');
    }

    /**
     * O ENVIO — a primeira escrita do produto sem sessão.
     *
     * A ordem aqui é a invariante `SEC-CO-17` do parecer, e ela é o que impede o 422 de virar
     * oráculo: **resolver o endereço vem antes de qualquer validação de payload**. Invertido, um
     * link desligado responderia 422 de campo para um payload torto — e o 422 contaria "esta
     * clínica existe, e a régua dela é assim".
     *
     * Quem garante a ordem é o middleware `ResolveLinkPublico`, e tem de ser ele: o Laravel
     * resolve a `FormRequest` **antes** do corpo do método, então resolver o endereço aqui dentro
     * já seria tarde — o 422 sairia primeiro. Este comentário afirmava o contrário, e era a razão
     * exata de o middleware existir (gate, CO-14).
     *
     * A resposta é **sempre a mesma**, e é aqui que a change inverte o cadastro interno: coincidir
     * com alguém que já é paciente não muda nada — nem o corpo, nem o código, nem o trabalho feito.
     * Não há consulta de duplicata a medir porque não há consulta de duplicata (`SEC-CO-04`); a
     * duplicata é resolvida na fila, por quem já tem permissão para saber quem é paciente.
     */
    public function enviar(EnvioDeCadastroRequest $requisicao): JsonResponse
    {
        $envio = new EnvioDeCadastro([
            // SÓ o que a validação aprovou. O corpo cru traria JSON arbitrário do remetente para
            // dentro da tela de quem confere (parecer, condição 9)
            'payload' => $requisicao->validated(),
            'enviado_em' => now(),
        ]);

        // o IP entra por `forceFill` porque está fora do mass assignment de propósito: ele vem da
        // REQUISIÇÃO, e um payload que pudesse escolhê-lo apagaria o único fio forense da porta.
        // E entra ANTES do save, num insert só: gravá-lo depois criaria duas linhas de trilha para
        // um ato só — "criou" e "atualizou" —, e a segunda não descreve nada que aconteceu.
        $envio->forceFill(['ip' => $requisicao->ip()])->save();

        return response()->json([
            'mensagem' => 'Recebemos o seu cadastro. A clínica vai conferir os dados e entrar em contato.',
        ], 201);
    }

    /**
     * A marca, e SÓ a marca: o nome, a fonte escolhida e se existe logo para buscar.
     *
     * MUST NOT sair daqui CNPJ, razão social, endereço, telefone, contagem de usuários, plano ou
     * qualquer outra chave do catálogo — a leitura pública da identidade é uma janela do tamanho
     * exato da marca.
     *
     * @return array<string, mixed>
     */
    private function marca(Clinica $clinica): array
    {
        $identidade = (string) $this->configuracoes->get('clinica.identidade');
        $temLogo = $clinica->logo_path !== null;

        return [
            'nome' => (string) $this->configuracoes->get('clinica.nome'),
            // a escolha da clínica só vale se houver arquivo: identidade em "logo" sem arquivo
            // degrada para o nome, do mesmo jeito que já degrada na barra lateral
            'identidade' => $identidade === 'logo' && $temLogo ? 'logo' : 'nome',
            'fonte_do_nome' => (string) $this->configuracoes->get('clinica.fonte_do_nome'),
            // a família reconhece a clínica também pela cor (change tema-da-clinica)
            'tema' => (string) $this->configuracoes->get('clinica.tema'),
        ];
    }

    /**
     * A logo, servida sem sessão para a família reconhecer a clínica ao abrir o link.
     *
     * Cega do mesmo jeito que o formulário: endereço inexistente, clínica inativa e link desligado
     * respondem igual. **Clínica sem arquivo de logo responde igual também** — senão a diferença
     * entre "não existe" e "existe e não tem logo" seria, ela própria, o oráculo.
     */
    public function logo(Request $requisicao): Response
    {
        $caminho = $this->clinicaDoLink($requisicao)->logo_path;

        if ($caminho === null || ! Storage::disk('local')->exists($caminho)) {
            abort(404, 'Este endereço de cadastro não está disponível.');
        }

        $extensao = pathinfo($caminho, PATHINFO_EXTENSION);

        return response(Storage::disk('local')->get($caminho), 200, [
            'Content-Type' => self::MIMES[$extensao] ?? 'application/octet-stream',
            /*
             * `no-store`, e o middleware da rota pública o reafirma na volta.
             *
             * O valor aqui era `private, max-age=3600`, com o comentário prometendo que a imagem
             * ficaria no navegador de quem a abriu — e o `RotaPublicaHumana` sobrescrevia tudo com
             * `no-store` logo depois, porque ele roda DEPOIS. A promessa nunca valeu (gate,
             * CO-10/SEC-CO-41), e manter o par contraditório é pior que a rebusca: a marca é da
             * clínica, e o que não se guarda não é servido para quem pediu a de outra.
             */
            'Cache-Control' => 'no-store, private',
            'X-Content-Type-Options' => 'nosniff',
        ]);
    }
}
