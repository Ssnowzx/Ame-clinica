<?php

namespace App\Console\Commands;

use App\Models\Clinica;
use App\Models\Convenio;
use App\Models\Especialidade;
use App\Models\Paciente;
use App\Models\Profissional;
use App\Models\Tratamento;
use App\Support\Clinica\NomeNormalizado;
use Illuminate\Console\Command;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * A CARGA DA VIRADA (change importacao-da-virada) — o 1º comando artisan do produto.
 *
 * Lê os CSVs do preparador (`bin/preparar-virada.py`) e cria o estado pós-virada
 * mínimo: pacientes ATIVOS (cadastro mínimo) e tratamentos EM ANDAMENTO com saldo
 * restante. Roda UMA vez, no go-live — sob o contrato do parecer pré-código
 * (SEC-IV-04..14) e do gate de code-review (B1/I1–I5, NOVO-01..04):
 *
 * - dry-run como default absoluto; `--executar` com confirmação DIGITADA do nome
 *   da clínica;
 * - transação única com try/catch SANITIZADO (NOVO-01): exceção não-antecipada JAMAIS
 *   estampa SQL com bindings (nome/CPF) no console ou no log;
 * - idempotência pela MESMA régua da guarda de homônimos (NomeNormalizado), com a chave
 *   do tratamento SEM `sessoes_realizadas` (B1 — o progresso local muda com o uso e não
 *   pode furar a contagem de vagas);
 * - base JÁ OPERADA depois da carga (linha marcada com update posterior) RECUSA o
 *   re-run (NOVO-03) — re-execução pós-operação é decisão humana de runbook;
 * - colisão com paciente nascido no sistema NUNCA adotada em silêncio; stdout sem nome
 *   nem CPF (erros citam a LINHA do CSV); o relatório nominal de aceite vai para
 *   arquivo em `preparado/aceite.md`, SEM CPF, e a falha de escrita dele ABORTA (I5).
 */
class ViradaImportar extends Command
{
    protected $signature = 'virada:importar
        {--pasta=dados-da-virada : Pasta com preparado/cadastro.csv e preparado/pacotes.csv}
        {--executar : Grava de verdade; sem esta flag o dry-run NÃO escreve nada}';

    protected $description = 'Carga da virada: importa pacientes ativos e pacotes com saldo do ClinicaÁgil (dry-run por padrão)';

    private const CABECALHO_CADASTRO = ['nome', 'telefone', 'email', 'cpf', 'convenio', 'plano', 'matricula'];

    private const CABECALHO_PACOTES = ['paciente', 'especialidade_destino', 'convenio_destino',
        'profissional_destino', 'total', 'realizadas', 'saldo', 'ultima_sessao',
        'especialidade', 'convenio', 'profissional'];

    /** @var list<string> erros de validação — SÓ número de linha e campo, nunca conteúdo (SEC-IV-08) */
    private array $erros = [];

    public function handle(): int
    {
        $clinica = Clinica::atual();

        // NOVO-03 — a base foi OPERADA depois da carga? Re-executar sobre números que a
        // clínica já moveu é decisão humana (runbook), nunca automática. A comparação é
        // updated_at > created_at (criação grava os dois iguais): qualquer edição
        // posterior numa linha MARCADA fecha a porta.
        $operadas = Paciente::whereNotNull('importado_clinicaagil_em')
            ->whereColumn('updated_at', '>', 'created_at')->count()
            + Tratamento::whereNotNull('importado_clinicaagil_em')
                ->whereColumn('updated_at', '>', 'created_at')->count();
        if ($operadas > 0) {
            $this->error(sprintf(
                'A base já foi operada depois da carga (%d linha(s) marcada(s) com edição '
                .'posterior). Re-executar agora é decisão humana — ver o runbook da virada.',
                $operadas,
            ));

            return self::FAILURE;
        }

        $pasta = rtrim((string) $this->option('pasta'), '/');
        $cadastro = $this->lerCsv("{$pasta}/preparado/cadastro.csv", self::CABECALHO_CADASTRO);
        $pacotes = $this->lerCsv("{$pasta}/preparado/pacotes.csv", self::CABECALHO_PACOTES);
        if ($cadastro === null || $pacotes === null) {
            return self::FAILURE;
        }

        $classificacao = $this->classificarCadastro($cadastro);
        $plano = $this->planejarTratamentos($pacotes, $classificacao);
        if ($this->erros !== []) {
            $this->error('A validação reprovou (nenhuma linha citada pelo conteúdo — SEC-IV-08):');
            foreach ($this->erros as $erro) {
                $this->line("  - {$erro}");
            }

            return self::FAILURE;
        }

        // o aceite é o artefato de DECISÃO do go-live: falha ao escrevê-lo aborta (I5) —
        // seguir apontando para um aceite velho faria a Mariana conferir o arquivo errado
        if (! $this->escreverAceite($pasta, $plano)) {
            $this->error('Falha ao escrever preparado/aceite.md — nada foi gravado.');

            return self::FAILURE;
        }
        $this->resumo($plano);

        if (! $this->option('executar')) {
            $this->info('Dry-run: NADA foi gravado. Relatório de aceite em '
                ."{$pasta}/preparado/aceite.md — conferir antes do --executar.");

            return self::SUCCESS;
        }

        // SEC-IV-04 — confirmação DIGITADA do nome da clínica; divergiu → aborta sem tocar o banco
        $confirmacao = (string) $this->ask('Digite o NOME da clínica para confirmar a gravação');
        if ($confirmacao !== $clinica->nome) {
            $this->error('Confirmação não confere com o nome da clínica. Nada foi gravado.');

            return self::FAILURE;
        }

        // SEC-IV-11 — UM timestamp para a corrida inteira: o recorte da reversão cirúrgica
        $marcador = Carbon::now();

        // SEC-IV-05 — transação única: qualquer violação desfaz TUDO. O catch é
        // SANITIZADO (NOVO-01): uma QueryException carrega o SQL com bindings — nome e
        // CPF de criança — e re-lançá-la estamparia tudo no console e no laravel.log,
        // fora da regra de retenção da virada. A classe da exceção basta para depurar.
        try {
            DB::transaction(function () use ($plano, $marcador): void {
                $this->gravar($plano, $marcador);
            });
        } catch (Throwable $excecao) {
            $this->error(sprintf(
                'Transação desfeita — NADA foi gravado. Causa: %s (código %s; mensagem '
                .'suprimida: pode conter dados de paciente — nunca vai a log).',
                $excecao::class,
                (string) $excecao->getCode(),
            ));

            return self::FAILURE;
        }

        $this->info(sprintf(
            'Gravado: %d paciente(s) e %d tratamento(s), marcador %s.',
            count($plano['pacientes_a_criar']),
            count($plano['tratamentos_a_criar']),
            $marcador->toDateTimeString(),
        ));

        return self::SUCCESS;
    }

    /** A gravação em si — chamada SÓ de dentro da transação. */
    private function gravar(array $plano, Carbon $marcador): void
    {
        foreach ($plano['pacientes_a_criar'] as $linha) {
            $paciente = new Paciente([
                'nome' => $linha['nome'],
                'cpf' => $linha['cpf'] !== '' ? $linha['cpf'] : null,
                // a MESMA estrutura do balcão (SEC-IV-12); sexo/nascimento ficam nulos —
                // a carga jamais inventa dado (PREP-03), e o `cadastro_incompleto`
                // derivado sinaliza a ficha a completar
                'contatos_json' => $linha['contatos'],
                'responsaveis_json' => [],
                'consentimentos_json' => [],
            ]);
            $paciente->importado_clinicaagil_em = $marcador; // server-set, fora de $fillable
            $paciente->save();
            $linha['registro']->id_destino = $paciente->id;
        }

        foreach ($plano['tratamentos_a_criar'] as $t) {
            $tratamento = new Tratamento([
                'paciente_id' => $t['paciente']->id_destino,
                'convenio_id' => $t['convenio_id'],
                'especialidade_id' => $t['especialidade_id'],
                'profissional_id' => $t['profissional_id'],
                'sessoes_total' => $t['total'],
                // SEC-IV-14 — matrícula SÓ no tratamento cujo convênio casa com o do cadastro
                'matricula' => $t['matricula'],
            ]);
            $tratamento->sessoes_realizadas = $t['realizadas']; // server-managed: fora de $fillable
            $tratamento->importado_clinicaagil_em = $marcador;
            $tratamento->save();
        }
    }

    /**
     * Lê e REVALIDA o CSV (SEC-IV-09 — o comando não confia no preparador): cabeçalho
     * exato, linha LONGA reprovada (I4), escape RFC-4180 puro (I3 — `escape: ''` casa
     * com o csv.writer do python; o default do PHP ativaria um mecanismo proprietário).
     *
     * @param  list<string>  $cabecalho
     * @return list<array<string, string>>|null
     */
    private function lerCsv(string $caminho, array $cabecalho): ?array
    {
        if (! is_readable($caminho)) {
            $this->error("Arquivo ausente ou ilegível: {$caminho}");

            return null;
        }
        $arquivo = fopen($caminho, 'r');
        if ($arquivo === false) {
            $this->error("Não foi possível abrir: {$caminho}");

            return null;
        }
        $lido = fgetcsv($arquivo, null, ',', '"', '');
        if ($lido !== $cabecalho) {
            fclose($arquivo);
            $this->error("Cabeçalho inesperado em {$caminho} — rode o preparador de novo.");

            return null;
        }
        $linhas = [];
        $numero = 1;
        while (($valores = fgetcsv($arquivo, null, ',', '"', '')) !== false) {
            $numero++;
            if ($valores === [null]) {
                continue;
            }
            if (count($valores) > count($cabecalho)) {
                $this->erros[] = basename($caminho)." linha {$numero}: colunas a mais";

                continue;
            }
            $linha = array_combine($cabecalho, array_pad($valores, count($cabecalho), ''));
            // desfaz a neutralização de fórmula do preparador (PREP-08) — e SÓ ela: o
            // preparador só prefixa `'` diante de = + - @ (NOVO-04)
            foreach ($linha as $chave => $valor) {
                if (str_starts_with($valor, "'") && in_array(substr($valor, 1, 1), ['=', '+', '-', '@'], true)) {
                    $linha[$chave] = substr($valor, 1);
                }
            }
            $linha['__linha'] = (string) $numero;
            $linhas[] = $linha;
        }
        fclose($arquivo);

        return $linhas;
    }

    /**
     * Classifica cada linha do cadastro: criar · já importado (idempotência) · colisão
     * RETIDA (SEC-IV-07). Devolve o índice por nome normalizado que os pacotes usam.
     *
     * @return array{indice: array<string, array>, pacientes_a_criar: list<array>,
     *               ja_importados: int, colisoes: list<string>, nominal: list<string>}
     */
    private function classificarCadastro(array $cadastro): array
    {
        // o banco inteiro da clínica, UMA vez, normalizado pela régua única (SEC-IV-06)
        $existentes = [];
        foreach (Paciente::query()->get(['id', 'nome', 'cpf', 'importado_clinicaagil_em']) as $p) {
            $existentes[NomeNormalizado::aplicar($p->nome)][] = $p;
        }
        $cpfsNoBanco = Paciente::query()->whereNotNull('cpf')->pluck('cpf')->flip();

        $indice = [];
        $linhaDaChave = [];
        $cpfsNoCsv = [];
        $pacientesACriar = [];
        $jaImportados = 0;
        $colisoes = [];
        $nominal = [];

        foreach ($cadastro as $linha) {
            $n = $linha['__linha'];
            if ($linha['nome'] === '') {
                $this->erros[] = "cadastro.csv linha {$n}: nome vazio";

                continue;
            }
            $chave = NomeNormalizado::aplicar($linha['nome']);
            // I1/NOVO-02 — o comando NÃO confia no dedupe do preparador: chave repetida
            // no arquivo grudaria os pacotes das duas crianças no mesmo registro
            if (isset($linhaDaChave[$chave])) {
                $this->erros[] = "cadastro.csv linha {$n}: nome normalizado duplicado "
                    .'(1ª ocorrência na linha '.$linhaDaChave[$chave].') — SEC-IV-09';

                continue;
            }
            $linhaDaChave[$chave] = $n;

            $cpf = $linha['cpf'];
            if ($cpf !== '' && ! $this->cpfValido($cpf)) {
                $this->erros[] = "cadastro.csv linha {$n}: cpf inválido (11 dígitos + DV)";

                continue;
            }
            if ($cpf !== '') {
                if (isset($cpfsNoCsv[$cpf])) {
                    $this->erros[] = "cadastro.csv linha {$n}: cpf duplicado no arquivo "
                        .'(1ª ocorrência na linha '.$cpfsNoCsv[$cpf].') — SEC-IV-10';

                    continue;
                }
                $cpfsNoCsv[$cpf] = $n;
            }

            // objeto compartilhado por handle: a transação preenche id_destino e os
            // tratamentos do plano enxergam (deliberado; um value object dedicado seria
            // o mesmo mecanismo com mais cerimônia — nit M3 do gate, declinado)
            $registro = new \stdClass;
            $registro->id_destino = null;

            $casados = $existentes[$chave] ?? [];
            if ($casados !== []) {
                $comMarcador = array_filter($casados, fn ($p) => $p->importado_clinicaagil_em !== null);
                if ($comMarcador !== []) {
                    // idempotência (SEC-IV-06): a carga anterior já criou — reusa o id.
                    // convênio/matrícula PERMANECEM (I2): um pacote novo num re-run
                    // ainda precisa casar a matrícula
                    $registro->id_destino = reset($comMarcador)->id;
                    $jaImportados++;
                    $indice[$chave] = ['registro' => $registro, 'retida' => false,
                        'convenio' => $linha['convenio'], 'matricula' => $linha['matricula']];

                    continue;
                }
                // SEC-IV-07 — nasceu NO sistema: jamais adotar em silêncio
                $colisoes[] = "cadastro.csv linha {$n}: paciente homônimo já existe no "
                    .'sistema SEM marcador da carga — linha RETIDA com os seus pacotes';
                $indice[$chave] = ['registro' => $registro, 'retida' => true];

                continue;
            }

            if ($cpf !== '' && isset($cpfsNoBanco[$cpf])) {
                $this->erros[] = "cadastro.csv linha {$n}: cpf já existe na base em outro "
                    .'paciente — SEC-IV-10';

                continue;
            }

            $contatos = [];
            if ($linha['telefone'] !== '') {
                $contatos[] = ['tipo' => 'celular', 'valor' => $linha['telefone']];
            }
            if ($linha['email'] !== '') {
                $contatos[] = ['tipo' => 'email', 'valor' => $linha['email']];
            }
            $pacientesACriar[] = [
                'nome' => $linha['nome'], 'cpf' => $cpf, 'contatos' => $contatos,
                'registro' => $registro,
            ];
            $nominal[] = "- CRIAR paciente: {$linha['nome']} (convênio do cadastro: "
                .($linha['convenio'] ?: '—').')';
            $indice[$chave] = ['registro' => $registro, 'retida' => false,
                'convenio' => $linha['convenio'], 'matricula' => $linha['matricula']];
        }

        return ['indice' => $indice, 'pacientes_a_criar' => $pacientesACriar,
            'ja_importados' => $jaImportados, 'colisoes' => $colisoes, 'nominal' => $nominal];
    }

    /**
     * Valida os pacotes, resolve os catálogos da clínica e monta o plano final.
     *
     * A chave de idempotência do tratamento NÃO inclui `sessoes_realizadas` (B1 do
     * gate): o progresso local MUDA quando a clínica opera (`ConsumoSessaoService`), e
     * uma chave com ele re-criaria o pacote com números velhos num re-run — a sessão
     * cobrada duas vezes que o 3º formulário proibiu. Vaga consumida com progresso
     * divergente conta como "já existente".
     *
     * @return array{pacientes_a_criar: list<array>, tratamentos_a_criar: list<array>,
     *               ja_importados: int, colisoes: list<string>, pacotes_retidos: int,
     *               tratamentos_ja_existentes: int, nominal: list<string>}
     */
    private function planejarTratamentos(array $pacotes, array $classificacao): array
    {
        $indice = $classificacao['indice'];

        $convenios = Convenio::query()->pluck('id', 'nome');
        $especialidades = Especialidade::query()->pluck('id', 'nome');
        $profissionais = Profissional::query()->pluck('id', 'nome');

        // tratamentos JÁ criados por carga anterior — vagas por chave SEM realizadas (B1)
        $vagas = [];
        foreach (Tratamento::query()->whereNotNull('importado_clinicaagil_em')
            ->get(['paciente_id', 'convenio_id', 'especialidade_id', 'sessoes_total']) as $t) {
            $chave = "{$t->paciente_id}|{$t->convenio_id}|{$t->especialidade_id}|{$t->sessoes_total}";
            $vagas[$chave] = ($vagas[$chave] ?? 0) + 1;
        }

        $tratamentosACriar = [];
        $pacotesRetidos = 0;
        $tratamentosJaExistentes = 0;
        $nominal = $classificacao['nominal'];

        foreach ($pacotes as $linha) {
            $n = $linha['__linha'];
            $total = (int) $linha['total'];
            $realizadas = (int) $linha['realizadas'];
            if ($total <= 0 || $realizadas < 0 || $realizadas >= $total) {
                $this->erros[] = "pacotes.csv linha {$n}: total/realizadas sem saldo válido";

                continue;
            }
            $dono = $indice[NomeNormalizado::aplicar($linha['paciente'])] ?? null;
            if ($dono === null) {
                $this->erros[] = "pacotes.csv linha {$n}: paciente ausente do cadastro.csv";

                continue;
            }
            if ($dono['retida']) {
                $pacotesRetidos++;

                continue;
            }
            $convenioId = $convenios[$linha['convenio_destino']] ?? null;
            $especialidadeId = $especialidades[$linha['especialidade_destino']] ?? null;
            $profissionalId = $profissionais[$linha['profissional_destino']] ?? null;
            if ($convenioId === null) {
                $this->erros[] = "pacotes.csv linha {$n}: convenio_destino não existe na clínica";

                continue;
            }
            if ($especialidadeId === null) {
                $this->erros[] = "pacotes.csv linha {$n}: especialidade_destino não existe na clínica";

                continue;
            }
            if ($profissionalId === null) {
                $this->erros[] = "pacotes.csv linha {$n}: profissional_destino não existe na clínica";

                continue;
            }

            $idDestino = $dono['registro']->id_destino ?? 0;
            $chave = "{$idDestino}|{$convenioId}|{$especialidadeId}|{$total}";
            if (($vagas[$chave] ?? 0) > 0) {
                $vagas[$chave]--;
                $tratamentosJaExistentes++;

                continue;
            }

            $tratamentosACriar[] = [
                'paciente' => $dono['registro'],
                'convenio_id' => $convenioId,
                'especialidade_id' => $especialidadeId,
                'profissional_id' => $profissionalId,
                'total' => $total,
                'realizadas' => $realizadas,
                // SEC-IV-14: matrícula só quando o convênio do pacote casa com o do cadastro
                'matricula' => (($dono['convenio'] ?? '') !== '' && $dono['convenio'] === $linha['convenio'])
                    ? (($dono['matricula'] ?? '') !== '' ? $dono['matricula'] : null)
                    : null,
            ];
            $nominal[] = "- CRIAR pacote: {$linha['paciente']} · {$linha['especialidade_destino']} · "
                ."{$linha['convenio_destino']} · {$realizadas}/{$total} (saldo ".($total - $realizadas).')';
        }

        return [
            'pacientes_a_criar' => $classificacao['pacientes_a_criar'],
            'tratamentos_a_criar' => $tratamentosACriar,
            'ja_importados' => $classificacao['ja_importados'],
            'colisoes' => $classificacao['colisoes'],
            'pacotes_retidos' => $pacotesRetidos,
            'tratamentos_ja_existentes' => $tratamentosJaExistentes,
            'nominal' => $nominal,
        ];
    }

    /** O relatório NOMINAL vai para ARQUIVO (SEC-IV-08) — nomes sim, CPF jamais. */
    private function escreverAceite(string $pasta, array $plano): bool
    {
        $linhas = ['# Relatório de aceite — virada', ''];
        $linhas[] = sprintf(
            'Pacientes a criar: %d · já importados (idempotência): %d · colisões retidas: %d',
            count($plano['pacientes_a_criar']), $plano['ja_importados'], count($plano['colisoes']),
        );
        $linhas[] = sprintf(
            'Pacotes a criar: %d (saldo total %d) · já existentes: %d · retidos: %d',
            count($plano['tratamentos_a_criar']),
            array_sum(array_map(fn ($t) => $t['total'] - $t['realizadas'], $plano['tratamentos_a_criar'])),
            $plano['tratamentos_ja_existentes'],
            $plano['pacotes_retidos'],
        );
        $linhas[] = '';
        foreach ($plano['colisoes'] as $colisao) {
            $linhas[] = "- COLISÃO: {$colisao}";
        }
        $linhas = [...$linhas, '', ...$plano['nominal'], ''];

        return file_put_contents("{$pasta}/preparado/aceite.md", implode("\n", $linhas)) !== false;
    }

    /** stdout: SÓ agregados (SEC-IV-08). */
    private function resumo(array $plano): void
    {
        $this->info(sprintf(
            'Plano: %d paciente(s) a criar · %d já importado(s) · %d colisão(ões) retida(s) · '
            .'%d pacote(s) a criar · %d já existente(s) · %d retido(s).',
            count($plano['pacientes_a_criar']), $plano['ja_importados'], count($plano['colisoes']),
            count($plano['tratamentos_a_criar']), $plano['tratamentos_ja_existentes'],
            $plano['pacotes_retidos'],
        ));
        if ($plano['colisoes'] !== []) {
            // colisão retida não é erro (SEC-IV-07), mas exige resolução humana e
            // RE-EXECUÇÃO — que o runbook governa (NOVO-03); merece destaque (M6)
            $this->warn('Há colisões retidas: resolver no aceite e re-executar conforme o runbook.');
        }
    }

    private function cpfValido(string $cpf): bool
    {
        if (! preg_match('/^\d{11}$/', $cpf) || $cpf === str_repeat($cpf[0], 11)) {
            return false;
        }
        foreach ([9, 10] as $tamanho) {
            $soma = 0;
            for ($i = 0; $i < $tamanho; $i++) {
                $soma += (int) $cpf[$i] * ($tamanho + 1 - $i);
            }
            if ((($soma * 10) % 11) % 10 !== (int) $cpf[$tamanho]) {
                return false;
            }
        }

        return true;
    }
}
