<?php

namespace Database\Seeders\Apresentacao;

use App\Models\Anamnese;
use App\Models\AnamneseModelo;
use App\Models\Conversa;
use App\Models\EnvioDeCadastro;
use App\Models\Mensagem;
use App\Models\MensagemTemplate;
use App\Models\Tarefa;
use App\Models\TarefaComentario;
use Carbon\CarbonImmutable;
use Illuminate\Support\Str;

/**
 * O que a recepção vê além da agenda: lembretes confirmados pelo WhatsApp, conversas com
 * as famílias, o mural da equipe, informativos, anamneses e o cadastro on-line chegando.
 */
final class Comunicacao
{
    public function __construct(private readonly Contexto $ctx, private readonly Elenco $elenco) {}

    public function semear(): void
    {
        $this->lembretes();
        $this->templates();
        $this->conversas();
        $this->informativos();
        $this->mural();
        $this->anamneses();
        $this->cadastrosOnline();
    }

    /**
     * Lembrete da véspera para as sessões dos últimos 4 meses e das próximas 48 h. A
     * resposta acompanha o desfecho: quem desmarcou pediu pelo WhatsApp, quem veio quase
     * sempre confirmou — é o que faz a taxa de confirmação do painel ter sentido.
     */
    private function lembretes(): void
    {
        $linhas = [];
        $limite = $this->ctx->hoje->addDays(2)->endOfDay();
        foreach ($this->ctx->sessoes as $sessao) {
            if ($sessao['inicio'] < $this->ctx->hoje->subMonths(4) || $sessao['inicio'] > $limite) {
                continue;
            }
            // o disparo é de manhã: a tela de lembretes já abre com os de amanhã enviados
            $vespera = $sessao['inicio']->subDay()->setTime(8, 0);
            if ($vespera > $this->ctx->agora) {
                continue;
            }
            $enviado = $this->ctx->chance(0.95);
            $resposta = null;
            if ($enviado) {
                $resposta = match ($sessao['status']) {
                    'Desmarcado pelo Paciente' => $this->ctx->chance(0.8) ? 'pediu_desmarque' : null,
                    'Não Compareceu' => $this->ctx->chance(0.25) ? 'confirmou' : null,
                    default => $this->ctx->chance(0.78) ? 'confirmou' : null,
                };
            }
            $linhas[] = [
                'agendamento_id' => $sessao['id'], 'paciente_id' => $this->ctx->pacientes[$this->ctx->planos[$sessao['plano']]['paciente']]['id'],
                'tipo' => 'lembrete_agendamento', 'competencia' => $sessao['inicio']->toDateString(), 'inicio_lembrado' => $sessao['inicio']->format('Y-m-d H:i:s'),
                'status' => $enviado ? 'enviado' : 'nao_enviado', 'motivo' => $enviado ? null : 'Contato sem WhatsApp',
                'resposta' => $resposta, 'respondido_em' => $resposta !== null ? $this->ctx->utc($vespera->addMinutes($this->ctx->entre(4, 180))) : null,
                'created_at' => $this->ctx->utc($vespera),
            ];
        }
        $this->ctx->inserirEmLote('lembretes_enviados', $linhas);
    }

    private function templates(): void
    {
        $modelos = [
            ['lembrete_de_sessao', 'utility', 'Olá, {{1}}! Lembramos da sessão de {{2}} amanhã às {{3}} na Ame Clínica. Podemos confirmar?', ['Confirmar', 'Preciso desmarcar']],
            ['horario_liberado', 'utility', 'Oi, {{1}}! Abriu um horário de {{2}} em {{3}}. Quer que a gente reserve para você?', ['Quero', 'Agora não']],
            ['aniversario', 'marketing', 'Feliz aniversário, {{1}}! Toda a equipe da Ame Clínica deseja um dia cheio de alegria. 🎉', []],
        ];
        foreach ($modelos as [$nome, $categoria, $corpo, $botoes]) {
            $template = new MensagemTemplate;
            $template->forceFill(['nome' => $nome, 'idioma' => 'pt_BR', 'categoria' => $categoria, 'corpo_previa' => $corpo,
                'variaveis_json' => [], 'botoes_json' => $botoes, 'status_meta' => MensagemTemplate::APROVADO,
                'sincronizado_em' => $this->ctx->agora->subDays(3)])->save();
        }
    }

    /** Dez famílias conversando com a recepção — algumas com mensagem não lida. */
    private function conversas(): void
    {
        $roteiros = [
            [['recebida', 'Bom dia! O Davi pode trocar a sessão de quinta para sexta?'], ['enviada', 'Bom dia! Temos sexta às 14h40 com a mesma terapeuta. Pode ser?'], ['recebida', 'Perfeito, obrigada!']],
            [['enviada', 'Olá! Lembramos da sessão de amanhã às 09h20. Podemos confirmar?'], ['recebida', 'Confirmado 👍']],
            [['recebida', 'Vocês emitem recibo para reembolso do plano?'], ['enviada', 'Emitimos sim! Vou mandar o recibo de setembro por aqui ainda hoje.'], ['recebida', 'Ótimo, muito obrigado.']],
            [['recebida', 'Ela acordou com febre, não vamos conseguir ir hoje.'], ['enviada', 'Melhoras para ela! Já registrei como falta justificada.']],
            [['recebida', 'Oi, tem vaga para avaliação de fono para o meu filho de 4 anos?'], ['enviada', 'Oi! Temos sim. Pode me passar o nome completo e a data de nascimento dele?'], ['recebida', 'Claro, já te mando.']],
            [['enviada', 'Olá! O relatório de evolução do trimestre ficou pronto. Podemos marcar a devolutiva?'], ['recebida', 'Pode ser terça no fim da tarde?']],
            [['recebida', 'A guia do convênio venceu, o que eu preciso fazer?'], ['enviada', 'Precisamos de um novo pedido médico. Assim que tiver, nos envie a foto por aqui.']],
            [['recebida', 'Bom dia, quanto fica o pacote de psicopedagogia?']],
            [['enviada', 'Olá! Lembramos da sessão de amanhã às 15h20. Podemos confirmar?'], ['recebida', 'Preciso desmarcar, vamos viajar.'], ['enviada', 'Tudo bem! Desmarquei. Quer remarcar para a próxima semana?']],
            [['recebida', 'Obrigada pelo carinho com o Théo hoje, ele saiu muito feliz! 💛']],
        ];
        $ativos = array_values(array_filter($this->ctx->pacientes, fn (array $p) => $p['ativo']));
        foreach ($roteiros as $indice => $roteiro) {
            $paciente = $ativos[$indice * 7 % count($ativos)];
            $ultima = $this->ctx->agora->subMinutes($indice * 97 + 12);
            $conversa = new Conversa;
            $conversa->forceFill(['telefone_e164' => '+55'.preg_replace('/\D/', '', $paciente['responsaveis'][0]['telefone']),
                'paciente_id' => $paciente['id'], 'nome_perfil' => $paciente['responsaveis'][0]['nome'],
                'janela_expira_em' => $ultima->addDay(), 'ultima_mensagem_em' => $ultima,
                'nao_lidas' => end($roteiro)[0] === 'recebida' && $indice % 2 === 1 ? 1 : 0, 'sem_lembretes' => false])->save();
            $this->mensagens($conversa, $roteiro, $ultima);
        }
    }

    /** @param  list<array{0: string, 1: string}>  $roteiro */
    private function mensagens(Conversa $conversa, array $roteiro, CarbonImmutable $ultima): void
    {
        $quando = $ultima->subMinutes(count($roteiro) * 6);
        foreach ($roteiro as [$direcao, $texto]) {
            $quando = $quando->addMinutes(6);
            $mensagem = new Mensagem;
            $mensagem->forceFill(['conversa_id' => $conversa->id, 'direcao' => $direcao, 'tipo' => 'texto', 'corpo' => $texto,
                'wa_message_id' => 'wamid.DEMO'.strtoupper(Str::random(20)),
                'status' => $direcao === 'recebida' ? 'recebida' : 'lida', 'automatica' => false,
                'enviada_por' => $direcao === 'enviada' ? $this->ctx->recepcao[0] : null,
                'recebida_em' => $direcao === 'recebida' ? $quando : null, 'enviada_em' => $direcao === 'enviada' ? $quando : null,
                'entregue_em' => $direcao === 'enviada' ? $quando->addSeconds(4) : null, 'lida_em' => $direcao === 'enviada' ? $quando->addMinutes(2) : null,
                'created_at' => $quando])->save();
        }
    }

    private function informativos(): void
    {
        $itens = [
            ['Recesso de fim de ano', "A clínica não atende de 24/12 a 01/01. As sessões desses dias serão remarcadas pela recepção.\nBoas festas a todos!", true],
            ['Nova sala de integração sensorial', 'A sala de integração sensorial ganhou um balanço novo e plataforma. Reservem pela agenda com antecedência.', true],
            ['Reunião clínica mensal', 'Toda última sexta do mês, das 12h às 13h, reunião de discussão de casos. Presença de todos os terapeutas.', true],
            ['Rascunho: campanha de setembro', 'Ideias para a campanha de conscientização sobre o desenvolvimento infantil.', false],
        ];
        foreach ($itens as $posicao => [$titulo, $corpo, $publicado]) {
            $this->ctx->inserir('informativos', ['titulo' => $titulo, 'corpo' => $corpo, 'publicado' => $publicado, 'criado_por' => $this->ctx->adminId,
                'created_at' => $this->ctx->utc($this->ctx->agora->subDays(3 + $posicao * 9))]);
        }
    }

    private function mural(): void
    {
        [$larissa, $bruno] = $this->ctx->recepcao;
        $financeiro = $this->ctx->ids['usuario:financeiro'];
        $cartoes = [
            ['Renovar guias da Vida Plena que vencem este mês', 'a_fazer', 'alta', 3, 'convênio', [$larissa]],
            ['Comprar massinha e papel kraft para a TO', 'a_fazer', 'media', null, 'compras', []],
            ['Ligar para as famílias da fila de espera de fono', 'a_fazer', 'urgente', 1, 'fila de espera', [$bruno]],
            ['Conferir repasse de setembro com os terapeutas', 'em_andamento', 'alta', 5, 'financeiro', [$financeiro]],
            ['Organizar a sala de espera com os brinquedos novos', 'em_andamento', 'media', null, 'recepção', [$larissa, $bruno]],
            ['Aguardando retorno do Sempre Bem sobre a glosa de agosto', 'aguardando', 'urgente', -2, 'convênio', [$financeiro]],
            ['Orçamento do ar-condicionado da sala 3', 'aguardando', 'baixa', 10, 'manutenção', []],
            ['Atualizar o regulamento no mural da recepção', 'concluida', 'baixa', null, 'recepção', [$larissa]],
            ['Fechar o ciclo de setembro dos convênios', 'concluida', 'alta', null, 'financeiro', [$financeiro]],
        ];
        foreach ($cartoes as $posicao => [$titulo, $coluna, $prioridade, $prazo, $etiqueta, $responsaveis]) {
            $tarefa = new Tarefa(['titulo' => $titulo, 'coluna' => $coluna, 'prioridade' => $prioridade, 'etiquetas' => $etiqueta,
                'prazo' => $prazo !== null ? $this->ctx->hoje->addDays($prazo)->toDateString() : null]);
            $tarefa->posicao = $posicao;
            $tarefa->criado_por = $this->ctx->adminId;
            $tarefa->concluida_em = $coluna === 'concluida' ? $this->ctx->agora->subDays(2) : null;
            $tarefa->save();
            $tarefa->responsaveis()->sync($responsaveis);
            if ($posicao === 4) {
                $comentario = new TarefaComentario(['corpo' => 'Larissa, consegue separar os brinquedos por idade antes de segunda?']);
                $comentario->tarefa_id = $tarefa->id;
                $comentario->autor_id = $this->ctx->adminId;
                $comentario->save();
                $comentario->mencionados()->sync([$larissa]);
            }
        }
    }

    private function anamneses(): void
    {
        $geral = new AnamneseModelo;
        $geral->forceFill(['titulo' => 'Anamnese infantil — primeira consulta', 'ativo' => true, 'campos_json' => [
            ['id' => 'queixa', 'tipo' => 'texto', 'rotulo' => 'Queixa principal', 'obrigatorio' => true],
            ['id' => 'gestacao', 'tipo' => 'opcoes', 'rotulo' => 'Gestação', 'obrigatorio' => false, 'opcoes' => ['A termo', 'Prematura', 'Pós-termo']],
            ['id' => 'andou', 'tipo' => 'numero', 'rotulo' => 'Idade em que andou (meses)', 'obrigatorio' => false],
            ['id' => 'escola', 'tipo' => 'booleano', 'rotulo' => 'Frequenta escola?', 'obrigatorio' => false],
            ['id' => 'diagnostico', 'tipo' => 'data', 'rotulo' => 'Data do último laudo', 'obrigatorio' => false],
        ]])->save();
        $fono = new AnamneseModelo;
        $fono->forceFill(['titulo' => 'Anamnese fonoaudiológica', 'ativo' => true, 'especialidade_id' => $this->ctx->especialidades['Fonoaudiologia'], 'campos_json' => [
            ['id' => 'primeiras_palavras', 'tipo' => 'numero', 'rotulo' => 'Primeiras palavras (meses)', 'obrigatorio' => false],
            ['id' => 'alimentacao', 'tipo' => 'opcoes', 'rotulo' => 'Alimentação', 'obrigatorio' => false, 'opcoes' => ['Sem dificuldade', 'Seletiva', 'Dificuldade de mastigação']],
            ['id' => 'observacoes', 'tipo' => 'texto', 'rotulo' => 'Observações', 'obrigatorio' => false],
        ]])->save();

        $queixas = ['Atraso na fala e dificuldade de se fazer entender.', 'Agitação na escola e dificuldade de atenção.',
            'Seletividade alimentar e sensibilidade a barulhos.', 'Dificuldade de leitura no 2º ano.', 'Investigação de TEA a pedido do neuropediatra.'];
        foreach ($this->ctx->pacientes as $indice => $paciente) {
            if ($indice % 3 === 2) {
                continue;
            }
            $anamnese = new Anamnese;
            $anamnese->forceFill(['paciente_id' => $paciente['id'], 'modelo_id' => $geral->id,
                'preenchida_em' => $paciente['entrada']->setTime(10, 0)->format('Y-m-d H:i:s'),
                'respostas_json' => ['queixa' => $this->ctx->um($queixas), 'gestacao' => $this->ctx->pesado(['A termo' => 80, 'Prematura' => 17, 'Pós-termo' => 3]),
                    'andou' => $this->ctx->entre(10, 18), 'escola' => $this->ctx->chance(0.85)]])->save();
        }
    }

    private function cadastrosOnline(): void
    {
        $envios = [['pendente', 0], ['pendente', 1], ['pendente', 3], ['aceito', 9], ['aceito', 16], ['descartado', 21]];
        foreach ($envios as $posicao => [$situacao, $dias]) {
            $crianca = $this->elenco->crianca();
            $responsaveis = $this->elenco->responsaveis($crianca['sobrenome']);
            $envio = new EnvioDeCadastro;
            $envio->forceFill(['payload' => [
                'nome' => $crianca['nome'], 'nascimento' => $this->ctx->hoje->subYears($this->ctx->entre(3, 9))->toDateString(), 'sexo' => $crianca['sexo'],
                'indicacao' => 'Instagram', 'necessidade' => 'sem', 'responsaveis_json' => [array_diff_key($responsaveis[0], ['telefone' => 1])],
                'contatos_json' => [['tipo' => 'whatsapp', 'valor' => $responsaveis[0]['telefone']]], 'endereco_json' => $this->elenco->endereco(),
            ], 'ip' => '177.10.'.($posicao + 20).'.'.(40 + $posicao), 'enviado_em' => $this->ctx->agora->subDays($dias)->subHours($posicao),
                'situacao' => $situacao, 'motivo_descarte' => $situacao === 'descartado' ? 'Cadastro duplicado — a família já é paciente' : null,
                'conferido_por' => $situacao === 'pendente' ? null : $this->ctx->recepcao[0],
                'conferido_em' => $situacao === 'pendente' ? null : $this->ctx->agora->subDays($dias - 1)])->save();
        }
    }
}
