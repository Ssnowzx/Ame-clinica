<?php

namespace App\Support\Configuracoes;

use App\Models\Configuracao;

/**
 * Leitura/escrita de configurações da clínica, com memoização por
 * request (instância scoped — design D5: sem cache persistente no v1).
 */
class ConfiguracaoService
{
    /** @var array<string, mixed> */
    private array $memo = [];

    public function get(string $chave): mixed
    {
        if (array_key_exists($chave, $this->memo)) {
            return $this->memo[$chave];
        }

        $override = Configuracao::where('chave', $chave)->first();

        $valor = $override !== null
            ? CatalogoConfiguracoes::deserializar($chave, $override->valor)
            : CatalogoConfiguracoes::default($chave);

        return $this->memo[$chave] = $valor;
    }

    /**
     * `get` sem a memória do request: o valor GRAVADO agora. Para as pré-condições que rodam sob a âncora da
     * clínica — a memória guardava o que se leu ANTES dela, e a âncora existe para ler o estado de depois
     * (`trava-de-usuarios-e-niveis`, gate r5, CR-TRV-29).
     */
    public function atual(string $chave): mixed
    {
        unset($this->memo[$chave]);

        return $this->get($chave);
    }

    /** Pré-condição: chave existente no catálogo e valor já validado por tipo. */
    public function set(string $chave, mixed $valor): void
    {
        Configuracao::updateOrCreate(
            ['chave' => $chave],
            ['valor' => CatalogoConfiguracoes::serializar($chave, $valor)]
        );

        unset($this->memo[$chave]);
    }

    /** @return list<array{chave: string, tipo: string, valor: mixed}> */
    public function todasEfetivas(): array
    {
        $efetivas = [];

        foreach (CatalogoConfiguracoes::todas() as $chave => $definicao) {
            // os metadados de widget (min/max/opcoes/formato) acompanham a leitura para a
            // tela não duplicar o catálogo — presentes só quando definidos (SEC-ADM-06)
            $efetivas[] = [
                'chave' => $chave,
                'tipo' => $definicao['tipo'],
                'valor' => $this->get($chave),
                ...CatalogoConfiguracoes::metadados($chave),
            ];
        }

        return $efetivas;
    }
}
