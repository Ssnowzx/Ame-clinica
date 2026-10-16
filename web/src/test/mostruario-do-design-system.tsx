import { CalendarDays, CalendarPlus, Inbox, Info, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import type { ReactNode } from 'react'

import { AvisoErro } from '@/componentes/ui/aviso-erro'
import { Botao } from '@/componentes/ui/botao'
import { Etiqueta } from '@/componentes/ui/etiqueta'
import { Realce } from '@/componentes/ui/realce'
import { Segmento } from '@/componentes/ui/segmento'
import { SeletorDeData } from '@/componentes/ui/seletor-de-data'
import { CampoBusca, type OpcaoDeBusca } from '@/componentes/ui/campo-busca'
import { CampoCheckbox } from '@/componentes/ui/campo-checkbox'
import { CampoComMascara } from '@/componentes/ui/campo-com-mascara'
import { CampoCor } from '@/componentes/ui/campo-cor'
import { CampoSelect } from '@/componentes/ui/campo-select'
import { CampoTexto } from '@/componentes/ui/campo-texto'
import { CampoTextoLongo } from '@/componentes/ui/campo-texto-longo'
import { ChipStatus } from '@/componentes/ui/chip-status'
import { Dialog } from '@/componentes/ui/dialog'
import { DialogConfirmacao } from '@/componentes/ui/dialog-confirmacao'
import { DicaVisual } from '@/componentes/ui/dica-visual'
import { EstadoErro } from '@/componentes/ui/estado-erro'
import { EstadoVazio } from '@/componentes/ui/estado-vazio'
import { ListaDescricao } from '@/componentes/ui/lista-descricao'
import { MarcadorEspecialidade } from '@/componentes/ui/marcador-especialidade'
import { Paginacao } from '@/componentes/ui/paginacao'
import { Skeleton } from '@/componentes/ui/skeleton'
import { Tabela } from '@/componentes/ui/tabela'
import { usarToast } from '@/componentes/ui/toast'
import { FORMATO_DO_CEP } from '@/lib/cep'
import { COR_DE_RESERVA } from '@/lib/cor-status'
import {
  COR_INVALIDA_EXEMPLO,
  ESPECIALIDADES_EXEMPLO,
  PACIENTES_DO_MOSTRUARIO,
  PAPEIS_DE_COR,
  STATUS_EXEMPLO,
} from '@/test/mostruario-do-design-system.dados'

function Secao({ titulo, descricao, children }: { titulo: string; descricao?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-titulo font-semibold text-texto">{titulo}</h2>
        {descricao !== undefined ? <p className="mt-1 text-corpo text-texto-suave">{descricao}</p> : null}
      </div>
      {children}
    </section>
  )
}

function Amostra({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 rounded-superficie border border-linha bg-superficie p-4">
      <p className="text-meta text-texto-suave">{rotulo}</p>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  )
}

const OPCOES_ESPECIALIDADE = ESPECIALIDADES_EXEMPLO.map(({ nome }) => ({ valor: nome, rotulo: nome }))

/**
 * Mostruário interno do design system (design.md D5 · spec "Mostruário interno
 * vivo") — o contrato visual que design-qa e as changes de tela comparam.
 * Atrás de RotaProtegida (P-02); todo dado exibido é fictício (T-ds-08).
 */
export function MostruarioDoDesignSystem() {
  const { notificar } = usarToast()
  const [dialogPerigoAberto, setDialogPerigoAberto] = useState(false)
  const [dialogAtencaoAberto, setDialogAtencaoAberto] = useState(false)
  const [dialogLeituraAberto, setDialogLeituraAberto] = useState(false)
  const [aceite, setAceite] = useState(true)
  const [pagina, setPagina] = useState(3)
  const [pacienteDoExemplo, setPacienteDoExemplo] = useState<OpcaoDeBusca | null>(null)
  const [observacao, setObservacao] = useState('Anotação fictícia de exemplo.')
  const [cep, setCep] = useState('')
  const [logradouro, setLogradouro] = useState('')
  const [termoDoExemplo, setTermoDoExemplo] = useState('')
  const [corDoExemplo, setCorDoExemplo] = useState(COR_DE_RESERVA)
  const [dataDoExemplo, setDataDoExemplo] = useState('2026-07-13')
  const [visaoDoExemplo, setVisaoDoExemplo] = useState<'dia' | 'semana'>('dia')

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-10">
      <header>
        <h1 className="text-display font-semibold text-texto">Design System — mostruário</h1>
        <p className="mt-2 text-corpo text-texto-suave">
          Ame Clínica · v1.0.0 · contrato visual vivo. Todos os dados desta galeria são fictícios. Componentes
          consomem SOMENTE tokens semânticos — valor mágico em tela é defeito de review.
        </p>
      </header>

      <Secao titulo="Tokens — cor" descricao="Papéis semânticos (nível 2) — o único nível que componentes tocam.">
        <ul className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {PAPEIS_DE_COR.map(({ token, classe, papel }) => (
            <li key={token} className="flex items-center gap-3 rounded-superficie border border-linha bg-superficie p-3">
              <span aria-hidden="true" className={`size-8 shrink-0 rounded-controle border border-linha ${classe}`} />
              <span className="flex flex-col">
                <code className="text-rotulo text-texto">{token}</code>
                <span className="text-meta text-texto-suave">{papel}</span>
              </span>
            </li>
          ))}
        </ul>
      </Secao>

      <Secao titulo="Tokens — tipografia" descricao="Papéis, não tamanhos soltos; números tabulares na grade.">
        <div className="flex flex-col gap-2 rounded-superficie border border-linha bg-superficie p-4">
          <p className="text-display font-semibold">display — título de página</p>
          <p className="text-titulo font-semibold">titulo — seção e dialog</p>
          <p className="text-subtitulo font-semibold">subtitulo — agrupamentos</p>
          <p className="text-corpo-lg">corpo-lg — inputs e leitura longa</p>
          <p className="text-corpo">corpo — padrão da UI</p>
          <p className="text-rotulo">rotulo — rótulos de campo e cabeçalho de tabela</p>
          <p className="text-meta text-texto-suave">meta — metadados, contadores, chips</p>
          <p className="text-corpo tabular-nums">tabular-nums: 08:00 · 3/12 · R$ 1.240,00</p>
        </div>
      </Secao>

      <Secao titulo="Tokens — raio e sombra" descricao="Por papel, nunca um valor único.">
        <div className="flex flex-wrap gap-3">
          <div className="rounded-controle border border-linha-forte bg-superficie p-3 text-meta">raio-controle</div>
          <div className="rounded-campo border border-linha-forte bg-superficie p-3 text-meta">raio-campo</div>
          <div className="rounded-superficie border border-linha-forte bg-superficie p-3 text-meta">raio-superficie</div>
          <div className="rounded-janela border border-linha-forte bg-superficie p-3 text-meta">raio-janela</div>
          <div className="rounded-superficie bg-superficie p-3 text-meta shadow-e1">sombra-e1</div>
          <div className="rounded-superficie bg-superficie p-3 text-meta shadow-e2">sombra-e2</div>
          <div className="rounded-superficie bg-superficie p-3 text-meta shadow-e3">sombra-e3</div>
        </div>
      </Secao>

      <Secao titulo="Botao" descricao="Um primario por região; perigo somente dentro/após o DialogConfirmacao; perigo-suave para a ação de impacto fora dele.">
        <Amostra rotulo="variantes × tamanhos">
          <Botao variante="primario">Salvar agendamento</Botao>
          <Botao variante="secundario">Cancelar</Botao>
          <Botao variante="perigo">Excluir</Botao>
          <Botao variante="perigo-suave">Desmarcar agenda</Botao>
          <Botao variante="fantasma">Ver detalhes</Botao>
          <Botao variante="primario" tamanho="sm">
            Compacto
          </Botao>
          <Botao variante="primario" tamanho="lg">
            Alvo primário
          </Botao>
        </Amostra>
        <Amostra rotulo="estados: disabled · carregando (rótulo preservado)">
          <Botao disabled>Indisponível</Botao>
          <Botao carregando>Salvando…</Botao>
          <Botao variante="secundario" carregando>
            Carregando…
          </Botao>
        </Amostra>
      </Secao>

      <Secao titulo="Segmento" descricao="Uma pele para todo controle segmentado: a opção ativa no acento, anunciada por aria-pressed.">
        <Amostra rotulo="visões">
          <Segmento
            rotulo="Visão de exemplo"
            opcoes={[
              { valor: 'dia', rotulo: 'Dia' },
              { valor: 'semana', rotulo: 'Semana' },
            ]}
            valor={visaoDoExemplo}
            aoMudar={setVisaoDoExemplo}
          />
        </Amostra>
      </Secao>

      <Secao titulo="Etiqueta" descricao="Estado fixo do sistema com PALAVRA: fundo suave + texto forte no tom. Status de agendamento continua no ChipStatus.">
        <Amostra rotulo="tons">
          <Etiqueta tom="sucesso">Ativo</Etiqueta>
          <Etiqueta tom="neutro">Inativo</Etiqueta>
          <Etiqueta tom="alerta">Alta</Etiqueta>
          <Etiqueta tom="perigo">Urgente</Etiqueta>
          <Etiqueta tom="info">Em conferência</Etiqueta>
          <Etiqueta tom="acento">3 na fila</Etiqueta>
        </Amostra>
      </Secao>

      <Secao
        titulo="Realce"
        descricao="Aviso que EXPLICA e não interrompe: dica (azul) ou atenção (âmbar). Não é erro — AvisoErro é role=alert e vermelho. Com `acao`, carrega a saída: aviso que diz o que está errado e não oferece caminho de volta é beco."
      >
        <Amostra rotulo="dica">
          <Realce
            tom="dica"
            rotulo="Dica"
            icone={<Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-info-texto" />}
            texto="A observação vira o rótulo da faixa na grade."
          />
        </Amostra>
        <Amostra rotulo="atenção">
          <Realce
            tom="atencao"
            rotulo="Atenção"
            icone={<TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-alerta-texto" />}
            texto="Não foi possível recuperar o cadastro que a família enviou. Ele pode já ter virado uma ficha."
          />
        </Amostra>
        <Amostra rotulo="atenção + ação (a saída ao lado do aviso)">
          <Realce
            tom="atencao"
            rotulo="Cadastro inativo"
            icone={<TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-alerta-texto" />}
            texto="Enquanto estiver assim, este paciente não aparece na agenda, na fila nem nas buscas de paciente. Reative para voltar a agendar."
            acao={<Botao tamanho="sm">Reativar</Botao>}
          />
        </Amostra>
      </Secao>

      <Secao titulo="SeletorDeData" descricao="Digita-se dd/mm/aaaa ou abre-se o calendário com mês e ano em listas — nunca o seletor nativo.">
        <Amostra rotulo="campo + calendário">
          <SeletorDeData rotulo="Data de exemplo" valor={dataDoExemplo} hoje="2026-07-15" aoMudar={setDataDoExemplo} />
        </Amostra>
      </Secao>

      <Secao titulo="Campos" descricao="Anatomia fixa: rótulo → controle → ajuda → erro. Borda nunca é o único sinal.">
        <div className="grid max-w-2xl grid-cols-1 gap-4 md:grid-cols-2">
          <CampoTexto rotulo="Nome do paciente" placeholder="Nome fictício de exemplo" ajuda="Como aparece na agenda." />
          <CampoTexto rotulo="CPF do responsável" obrigatorio erro="CPF inválido — confira os 11 dígitos." />
          <CampoTexto rotulo="Campo desabilitado" disabled value="Somente leitura" readOnly />
          <CampoTexto rotulo="Alvo confortável (lg)" tamanho="lg" />
          <CampoTextoLongo
            rotulo="Observação"
            value={observacao}
            limite={2000}
            onChange={(evento) => {
              setObservacao(evento.target.value)
            }}
            ajuda="Contador de caracteres — o limite é do servidor; truncar em silêncio, não."
          />
          <CampoTextoLongo
            rotulo="Observação com erro"
            value="Texto fictício"
            readOnly
            erro="Máximo de 2000 caracteres."
          />
          <CampoTexto
            rotulo="Logradouro (teto do servidor, longe do limite)"
            value={logradouro}
            limite={500}
            onChange={(evento) => {
              setLogradouro(evento.target.value)
            }}
            ajuda="O teto vem do servidor: o campo trava no limite e avisa quando ele se aproxima."
          />
          <CampoTexto
            rotulo="Estado civil (perto do teto)"
            value={'a'.repeat(14)}
            limite={20}
            readOnly
            onChange={() => {}}
          />
          <CampoComMascara
            rotulo="CEP"
            formato={FORMATO_DO_CEP}
            value={cep}
            onChangeValor={setCep}
            ajuda="Máscara de formato fixo — a tela mostra o separador, o formulário guarda dígitos."
          />
          <CampoComMascara
            rotulo="CEP (preencheu os outros campos)"
            formato={FORMATO_DO_CEP}
            value="88501050"
            readOnly
            onChangeValor={() => {}}
            anuncio="Endereço preenchido pelo CEP. Confira e informe o número."
          />
          <CampoComMascara
            rotulo="CEP (serviço fora do ar)"
            formato={FORMATO_DO_CEP}
            value="88501050"
            readOnly
            onChangeValor={() => {}}
            anuncio="Não foi possível buscar o endereço agora. Preencha à mão; o cadastro salva igual."
          />
          <CampoSelect rotulo="Especialidade" opcoes={OPCOES_ESPECIALIDADE} placeholder="Selecione…" defaultValue="" />
          <CampoSelect
            rotulo="Convênio"
            opcoes={[{ valor: 'particular', rotulo: 'Particular' }]}
            erro="Escolha um convênio para continuar."
          />
          <CampoCheckbox rotulo="Desconta sessão do tratamento" marcado={aceite} aoMudar={setAceite} ajuda="Regra configurável por status (§13)." />
          <CampoCheckbox rotulo="Notificar responsável" marcado={false} aoMudar={() => undefined} desabilitado />
        </div>
      </Secao>

      <Secao
        titulo="CampoBusca"
        descricao="Combobox para catálogo que não cabe numa lista. Abre com lista (em seções, rolando para carregar mais) e filtra ao digitar. O id só muda por SELEÇÃO EXPLÍCITA — digitar, rolar e realçar nunca escolhem."
      >
        <div className="max-w-md">
          <CampoBusca
            rotulo="Paciente"
            placeholder="Buscar ou escolher…"
            selecionado={pacienteDoExemplo}
            aoSelecionar={setPacienteDoExemplo}
            termo={termoDoExemplo}
            aoDigitar={setTermoDoExemplo}
            // sem termo, a lista vem em SEÇÕES (o atalho provável + o catálogo);
            // com termo, vira lista simples filtrada — os dois formatos do componente
            opcoes={
              termoDoExemplo.trim() === ''
                ? [
                    { nome: 'Recentes', opcoes: PACIENTES_DO_MOSTRUARIO.slice(0, 2) },
                    // o catálogo SEM quem já está no atalho: a referência do DS não pode
                    // ensinar a duplicata que o produto dedupe (achado CR-BPL-11)
                    { nome: 'Todos', opcoes: PACIENTES_DO_MOSTRUARIO.slice(2) },
                  ]
                : PACIENTES_DO_MOSTRUARIO.filter((opcao) =>
                    opcao.rotulo.toLowerCase().includes(termoDoExemplo.toLowerCase()),
                  )
            }
            ajuda="Lista fictícia — o mostruário nunca consulta o cadastro real."
          />
        </div>
      </Secao>

      <Secao
        titulo="AvisoErro"
        descricao="O erro que não pertence a nenhum campo (série em conflito, exclusão protegida). Vive DENTRO do formulário."
      >
        <div className="max-w-xl">
          <AvisoErro
            mensagens={[
              'Conflito de horário nas datas: 2026-07-18, 2026-07-25.',
              'Agendamento com sessão consumida não pode ser excluído — estorne primeiro mudando o status.',
            ]}
          />
        </div>
      </Secao>

      <Secao
        titulo="ChipStatus"
        descricao="Dirigido por DADO: a cor crua do cadastro vira trio suave com AA por construção — nunca bloco saturado."
      >
        <Amostra rotulo="os 10 status default (cor vinda do cadastro da clínica)">
          {STATUS_EXEMPLO.map(({ nome, cor, tipo }) => (
            <ChipStatus key={nome} nome={nome} cor={cor} tipo={tipo} />
          ))}
        </Amostra>
        <Amostra rotulo="acionável (o fluxo do dia troca o status pela grade)">
          <ChipStatus
            nome="Em Aberto"
            cor={STATUS_EXEMPLO[0].cor}
            tipo="circle-dashed"
            aoAcionar={() => {
              notificar({ tom: 'sucesso', titulo: 'Menu de status abriria aqui (exemplo)' })
            }}
            rotuloDaAcao="Mudar status de Paciente Exemplo"
          />
        </Amostra>
        <Amostra rotulo="tamanho sm (grade compacta) · fail-safe de cor inválida (cai no neutro)">
          <ChipStatus nome="Finalizado" cor={STATUS_EXEMPLO[2].cor} tipo="check" tamanho="sm" />
          <ChipStatus nome="Cor inválida no cadastro" cor={COR_INVALIDA_EXEMPLO} />
        </Amostra>
      </Secao>

      <Secao
        titulo="MarcadorEspecialidade"
        descricao="O fio de 3px — cor como metadado discreto, nunca preenchimento; o nome SEMPRE em texto ao lado."
      >
        <ul className="grid grid-cols-2 gap-2 md:grid-cols-3">
          {ESPECIALIDADES_EXEMPLO.map(({ nome, cor }) => (
            <li key={nome} className="flex items-stretch gap-2 rounded-superficie border border-linha bg-superficie p-2">
              <MarcadorEspecialidade cor={cor} />
              <span className="text-corpo text-texto">{nome}</span>
            </li>
          ))}
        </ul>
      </Secao>

      <Secao
        titulo="CampoCor"
        descricao="Dois controles, um valor: o seletor nativo (escolher com o olho) e o hexadecimal em texto (colar a cor do manual de marca). O seletor nunca recebe lixo — cor inválida cairia em preto sem avisar."
      >
        <Amostra rotulo="a cor da especialidade e a do status vêm daqui">
          <CampoCor rotulo="Cor da especialidade" valor={corDoExemplo} aoMudar={setCorDoExemplo} obrigatorio />
          <CampoCor
            rotulo="Cor com erro do servidor"
            valor={COR_INVALIDA_EXEMPLO}
            aoMudar={() => {}}
            erro="Cor inválida — use #RRGGBB."
          />
        </Amostra>
      </Secao>

      <Secao
        titulo="DicaVisual"
        descricao="Devolve aos olhos o rótulo que o trilho de ícones só mostra ao leitor de tela. É decorativa (aria-hidden): o nome acessível do alvo nunca depende dela. Passe o mouse ou tabule até o ícone."
      >
        <Amostra rotulo="alvo de ícone no trilho — o rótulo continua no DOM, como sr-only">
          <button
            type="button"
            className="relative flex size-10 items-center justify-center rounded-controle text-texto-suave hover:bg-neutro-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco"
          >
            <CalendarDays aria-hidden="true" className="size-4" />
            <span className="sr-only">Agenda</span>
            <DicaVisual>Agenda</DicaVisual>
          </button>
        </Amostra>
      </Secao>

      <Secao
        titulo="DialogConfirmacao"
        descricao="O padrão §2: nome do alvo + consequência explícita; foco inicial no Cancelar; Esc cancela."
      >
        <Amostra rotulo="tons: perigo (destrutiva) · atenção (mudança de regra)">
          <Botao
            variante="secundario"
            onClick={() => {
              setDialogPerigoAberto(true)
            }}
          >
            Abrir confirmação de exclusão
          </Botao>
          <Botao
            variante="secundario"
            onClick={() => {
              setDialogAtencaoAberto(true)
            }}
          >
            Abrir confirmação de regra
          </Botao>
        </Amostra>
        <DialogConfirmacao
          aberto={dialogPerigoAberto}
          aoMudarAberto={setDialogPerigoAberto}
          titulo="Desmarcar a sessão de Paciente Exemplo — qui 14:00?"
          consequencia="Os 11 agendamentos futuros da série também serão desmarcados. O saldo de sessões do tratamento não será descontado."
          rotuloConfirmar="Desmarcar série"
          tom="perigo"
          aoConfirmar={() => {
            notificar({ tom: 'sucesso', titulo: 'Série desmarcada (exemplo)' })
          }}
        />
        <DialogConfirmacao
          aberto={dialogAtencaoAberto}
          aoMudarAberto={setDialogAtencaoAberto}
          titulo="Ativar desconto de sessão no status Consulta?"
          consequencia="Novos agendamentos com este status passarão a descontar do saldo de sessões dos tratamentos."
          rotuloConfirmar="Ativar desconto"
          tom="atencao"
          aoConfirmar={() => {
            notificar({ tom: 'sucesso', titulo: 'Regra atualizada (exemplo)' })
          }}
        />
      </Secao>

      <Secao titulo="Tabela" descricao="Densidades nomeadas: compacta (36px, grades) e confortável (48px).">
        <Tabela legenda="Exemplo fictício — 3 de 3 registros" densidade="compacta">
          <Tabela.Cabecalho>
            <Tabela.Linha>
              <Tabela.CelulaCabecalho>Horário</Tabela.CelulaCabecalho>
              <Tabela.CelulaCabecalho>Paciente</Tabela.CelulaCabecalho>
              <Tabela.CelulaCabecalho>Status</Tabela.CelulaCabecalho>
              <Tabela.CelulaCabecalho>Sessões</Tabela.CelulaCabecalho>
            </Tabela.Linha>
          </Tabela.Cabecalho>
          <Tabela.Corpo>
            <Tabela.Linha>
              <Tabela.Celula numerica>08:00</Tabela.Celula>
              <Tabela.Celula>Paciente Exemplo A</Tabela.Celula>
              <Tabela.Celula>
                <ChipStatus nome="Em Aberto" cor={STATUS_EXEMPLO[0].cor} tipo="circle-dashed" tamanho="sm" />
              </Tabela.Celula>
              <Tabela.Celula numerica>3/12</Tabela.Celula>
            </Tabela.Linha>
            <Tabela.Linha selecionada>
              <Tabela.Celula numerica>09:00</Tabela.Celula>
              <Tabela.Celula>Paciente Exemplo B (linha selecionada)</Tabela.Celula>
              <Tabela.Celula>
                <ChipStatus nome="Finalizado" cor={STATUS_EXEMPLO[2].cor} tipo="check" tamanho="sm" />
              </Tabela.Celula>
              <Tabela.Celula numerica>11/12</Tabela.Celula>
            </Tabela.Linha>
            <Tabela.Linha>
              <Tabela.Celula numerica>10:00</Tabela.Celula>
              <Tabela.Celula>Paciente Exemplo C</Tabela.Celula>
              <Tabela.Celula>
                <ChipStatus nome="Reposição" cor={STATUS_EXEMPLO[9].cor} tipo="rotate-ccw" tamanho="sm" />
              </Tabela.Celula>
              <Tabela.Celula numerica>7/12</Tabela.Celula>
            </Tabela.Linha>
          </Tabela.Corpo>
        </Tabela>
      </Secao>

      <Secao titulo="Toast" descricao="Fio de 3px no tom; erro anuncia assertivo (8s), demais polite (5s).">
        <Amostra rotulo="disparadores">
          <Botao
            variante="secundario"
            onClick={() => {
              notificar({ tom: 'sucesso', titulo: 'Agendamento salvo', descricao: 'A série semanal foi criada.' })
            }}
          >
            Toast de sucesso
          </Botao>
          <Botao
            variante="secundario"
            onClick={() => {
              notificar({ tom: 'erro', titulo: 'Falha ao salvar', descricao: 'Tente novamente em instantes.' })
            }}
          >
            Toast de erro
          </Botao>
          <Botao
            variante="secundario"
            onClick={() => {
              notificar({ tom: 'aviso', titulo: 'Sessões quase no fim', descricao: 'Restam 2 sessões no tratamento.' })
            }}
          >
            Toast de aviso
          </Botao>
        </Amostra>
      </Secao>

      <Secao titulo="Estados async" descricao="Os 4 estados por superfície: carregando, vazio, erro e conteúdo.">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div aria-busy="true" className="flex flex-col gap-2 rounded-superficie border border-linha bg-superficie p-4">
            <p className="text-meta text-texto-suave">carregando (Skeleton pela caixa exata — CLS 0)</p>
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
          <EstadoVazio
            titulo="Nenhum paciente na lista de espera"
            descricao="Quando houver espera por horário, ela aparece aqui."
            icone={<Inbox className="size-8" />}
            acao={
              <Botao>
                <CalendarPlus aria-hidden="true" className="size-4" />
                Adicionar à espera
              </Botao>
            }
          />
          <EstadoErro
            mensagem="Não foi possível carregar a agenda. Verifique a conexão."
            aoTentarNovamente={() => {
              notificar({ tom: 'aviso', titulo: 'Tentando novamente (exemplo)' })
            }}
          />
        </div>
      </Secao>

      <Secao titulo="Paginacao" descricao="Página atual por cor + peso + aria-current; disabled real nos extremos.">
        <Paginacao pagina={pagina} totalPaginas={12} aoMudar={setPagina} totalItens={128} />
      </Secao>

      <Secao
        titulo="Dialog + ListaDescricao"
        descricao="Diálogo DISPENSÁVEL (Esc/overlay fecham) para LEITURA — não o AlertDialog. Metadados de leitura em <dl>/<dt>/<dd>."
      >
        <Amostra rotulo="Painel de leitura (Esc ou clicar fora fecha; foco volta ao gatilho)">
          <Botao
            variante="secundario"
            onClick={() => {
              setDialogLeituraAberto(true)
            }}
          >
            Abrir detalhe (exemplo)
          </Botao>
          <Dialog
            aberto={dialogLeituraAberto}
            aoMudarAberto={setDialogLeituraAberto}
            titulo="Detalhes do agendamento"
            rodape={
              <div className="flex justify-end">
                <Botao
                  onClick={() => {
                    setDialogLeituraAberto(false)
                  }}
                >
                  Iniciar atendimento
                </Botao>
              </div>
            }
          >
            <ListaDescricao
              itens={[
                { rotulo: 'Quando', valor: 'qui 14:00 — 40 min' },
                { rotulo: 'Profissional', valor: 'Mariana dos Santos' },
                { rotulo: 'Serviço', valor: 'Fonoaudiologia' },
                { rotulo: 'Convênio', valor: 'Particular' },
                { rotulo: 'Observação', valor: 'Dados fictícios de mostruário.', larguraTotal: true },
              ]}
            />
          </Dialog>
        </Amostra>
      </Secao>
    </div>
  )
}
