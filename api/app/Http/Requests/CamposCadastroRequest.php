<?php

namespace App\Http\Requests;

use App\Support\CamposCadastro\CatalogoCamposCadastro as Catalogo;
use App\Support\CamposCadastro\ReguaDoCadastro;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Validator;

/**
 * Escrita da régua do cadastro (capability `campos-do-cadastro`).
 *
 * Payload: `{"campos": {"<campo>": {"obrigatorio": bool|null, "desabilitado": bool|null,
 * "online": bool|null}}}` — `online` decide o que aparece no formulário público.
 * `null` numa chave devolve o campo ao padrão do catálogo — é o "não opinei" do design D2,
 * e é diferente de `false`.
 *
 * Três recusas moram aqui, e todas devolvem 422 em vez de aceitar-e-ignorar:
 * campo fora do catálogo, chave fora do catálogo e TRAVA violada.
 */
class CamposCadastroRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true; // autorização é do middleware permission: da rota
    }

    public function rules(): array
    {
        return [
            'campos' => ['required', 'array', 'min:1'],
            'campos.*' => ['required', 'array'],
            'campos.*.obrigatorio' => ['sometimes', 'nullable', 'boolean'],
            'campos.*.desabilitado' => ['sometimes', 'nullable', 'boolean'],
            'campos.*.online' => ['sometimes', 'nullable', 'boolean'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator): void {
            $formulario = $this->formulario();
            $regua = app(ReguaDoCadastro::class);

            foreach ((array) $this->input('campos', []) as $campo => $chaves) {
                if (! is_string($campo) || ! Catalogo::existe($campo, $formulario)) {
                    // não ecoa o valor recebido: quem digitou já sabe o que mandou, e
                    // devolver texto do cliente na mensagem é vetor de XSS refletido
                    $validator->errors()->add('campos', 'Há um campo que não existe no cadastro.');

                    continue;
                }

                if (! is_array($chaves)) {
                    continue; // já recusado pelas rules
                }

                $extras = array_diff(array_keys($chaves), Catalogo::CHAVES_ATIVAS);
                if ($extras !== []) {
                    $validator->errors()->add(
                        "campos.{$campo}",
                        'Só é possível definir se o campo é obrigatório, se ele não aparece, e se '
                        .'ele entra no formulário público.'
                    );

                    continue;
                }

                $this->validarTravas($validator, $campo, $chaves, $formulario);
                $this->validarCombinacao($validator, $campo, $chaves, $regua, $formulario);
            }
        });
    }

    /** @param array<string, mixed> $chaves */
    private function validarTravas(Validator $validator, string $campo, array $chaves, string $formulario): void
    {
        $definicao = Catalogo::definicao($campo, $formulario);

        foreach (array_keys($chaves) as $chave) {
            if (! Catalogo::estaTravado($campo, $chave, $formulario)) {
                continue;
            }

            // `null` na chave travada é "voltar ao padrão", que É o valor travado —
            // recusar isso seria recusar um no-op e confundir quem só reenvia a tela
            if ($chaves[$chave] === null) {
                continue;
            }

            if ($chaves[$chave] === Catalogo::padrao($campo, $chave, $formulario)) {
                continue;
            }

            $validator->errors()->add(
                "campos.{$campo}",
                $definicao['motivo'] ?? "O campo \"{$definicao['rotulo']}\" não pode ser alterado."
            );
        }
    }

    /**
     * Obrigatório E escondido ao mesmo tempo é um cadastro impossível de salvar.
     *
     * A conta é sobre o resultado EFETIVO, não sobre o payload: mandar só
     * `desabilitado: true` num campo cujo padrão é obrigatório produziria a combinação
     * sem que ela aparecesse na requisição.
     *
     * @param  array<string, mixed>  $chaves
     */
    private function validarCombinacao(
        Validator $validator,
        string $campo,
        array $chaves,
        ReguaDoCadastro $regua,
        string $formulario,
    ): void {
        $atual = $regua->doCampo($campo, $formulario);

        // só as duas chaves da combinação impossível: `online` não participa, porque
        // `desabilitado` + `online` é intenção coerente que a LEITURA resolve (ReguaDoCadastro)
        $efetivo = [];
        foreach (['obrigatorio', 'desabilitado'] as $chave) {
            $efetivo[$chave] = array_key_exists($chave, $chaves)
                ? ($chaves[$chave] ?? Catalogo::padrao($campo, $chave, $formulario))
                : $atual[$chave];
        }

        if ($efetivo['obrigatorio'] && $efetivo['desabilitado']) {
            $validator->errors()->add(
                "campos.{$campo}",
                'Um campo que não aparece no formulário não pode ser obrigatório.'
            );
        }
    }

    public function formulario(): string
    {
        return (string) $this->route('formulario');
    }
}
