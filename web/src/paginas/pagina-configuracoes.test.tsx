import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http as msw, delay } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { axe, toHaveNoViolations } from 'jest-axe'
import { describe, expect, it } from 'vitest'

import { ProvedorToast } from '@/componentes/ui/toast'
import { chaves } from '@/lib/chaves-query'
import { queryClient } from '@/lib/query-client'
import { PaginaConfiguracoes } from '@/paginas/pagina-configuracoes'
import { useAuthStore } from '@/stores/auth-store'
import { reguaFicticia } from '@/test/dados-cadastros'
import {
  BLOCOS_FICTICIOS,
  SECOES_FICTICIAS,
  catalogoQueSeContradiz as contradicao,
  configuracaoFicticia,
  leituraFicticia,
} from '@/test/dados-configuracoes'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'
import type { AlvoEncadeamento, Configuracao, LeituraDeConfiguracoes } from '@/tipos'

/**
 * O mock recebe PARCIAIS: `rotulo`, `secao` e `bloco` são obrigatórios no tipo — vêm do
 * catálogo do servidor. Os defaults da fábrica são **propositalmente estranhos ao prefixo da
 * chave**: se espelhassem o prefixo, um teste que não declara `secao` continuaria passando
 * caso a tela voltasse a derivar a aba da chave, e provaria zero sobre a tese desta change.
 *
 * **Quem exercita agrupamento declara `secao` e `bloco`.** Quem assegura rótulo na tela passa
 * o rótulo de verdade.
 */
type ConfigDeTeste = Partial<Configuracao> & Pick<Configuracao, 'chave'>

expect.extend(toHaveNoViolations)

function mockConfiguracoes(
  parciais: ConfigDeTeste[],
  alvos: AlvoEncadeamento[] = [],
  secoes?: LeituraDeConfiguracoes['secoes'],
  blocos?: LeituraDeConfiguracoes['blocos'],
) {
  const configuracoes = parciais.map(configuracaoFicticia)
  servidor.use(
    msw.get('/api/configuracoes', () => HttpResponse.json(leituraFicticia(configuracoes, secoes, blocos))),
    msw.get('/api/configuracoes/alvos-encadeamento', () => HttpResponse.json({ alvos })),
    // a aba "Cadastro" (régua dos campos) vive nesta tela desde a change
    // campos-do-cadastro-configuraveis
    msw.get('/api/campos-cadastro/:formulario', () => HttpResponse.json(reguaFicticia())),
  )
}

function renderizar(permissoes: string[] = ['configuracoes.ver', 'configuracoes.editar']) {
  useAuthStore.setState({ usuario: { ...usuarioFicticio, permissoes }, carregandoSessao: false })
  return render(
    <QueryClientProvider client={queryClient}>
      <ProvedorToast>
        <MemoryRouter initialEntries={['/configuracoes']}>
          <PaginaConfiguracoes />
        </MemoryRouter>
      </ProvedorToast>
    </QueryClientProvider>,
  )
}

describe('PaginaConfiguracoes — widget por tipo e metadado', () => {
  it('deve mostrar sob o campo a ajuda que o catálogo manda, ligada ao campo', async () => {
    // ARRANGE — change inicio-dos-indicadores: o rótulo sozinho não dizia o que a data faz
    mockConfiguracoes([
      {
        chave: 'indicadores.comparar_a_partir_de',
        rotulo: 'Indicadores a partir de',
        valor: '',
        formato: 'date',
        ajuda: 'O dia 1º do mês em que a clínica passou a usar o sistema de verdade.',
      },
    ])

    // ACT
    renderizar()

    // ASSERT — a frase lida pelo leitor de tela junto com o campo, e o "Salvar" na linha do CAMPO
    // (não ao lado da ajuda — gate r2 e r3)
    const campo = await screen.findByLabelText('Indicadores a partir de')
    expect(campo).toHaveAccessibleDescription('O dia 1º do mês em que a clínica passou a usar o sistema de verdade.')
    const linha = screen.getByRole('button', { name: 'Salvar' }).parentElement
    expect(linha).toContainElement(campo)
    expect(linha).not.toContainElement(screen.getByText('O dia 1º do mês em que a clínica passou a usar o sistema de verdade.'))
  })

  it('deve travar a segurança, com o motivo, para quem edita configurações sem administrar o acesso', async () => {
    // ARRANGE — change trava-de-usuarios-e-niveis: o servidor recusa `seguranca.*` com 403
    mockConfiguracoes([{ chave: 'seguranca.aprovacao_dupla', rotulo: 'Exigir aprovação de dois administradores', tipo: 'bool', valor: false }])

    // ACT
    renderizar(['configuracoes.ver', 'configuracoes.editar'])

    // ASSERT
    const caixa = await screen.findByRole('checkbox', { name: 'Exigir aprovação de dois administradores' })
    expect(caixa).toBeDisabled()
    expect(caixa).toHaveAccessibleDescription('As configurações de segurança são de quem administra o acesso da clínica.')
  })

  it('deve deixar a segurança a quem administra o acesso', async () => {
    // ARRANGE
    mockConfiguracoes([{ chave: 'seguranca.aprovacao_dupla', rotulo: 'Exigir aprovação de dois administradores', tipo: 'bool', valor: false }])

    // ACT
    renderizar(['configuracoes.ver', 'configuracoes.editar', 'niveis_permissao.editar'])

    // ASSERT
    expect(await screen.findByRole('checkbox', { name: 'Exigir aprovação de dois administradores' })).toBeEnabled()
  })

  it('deve limitar o campo inteiro ao min/max do catálogo', async () => {
    // ARRANGE
    mockConfiguracoes([
      { chave: 'agenda.granularidade_min', rotulo: 'Granularidade da grade (minutos)', tipo: 'int', valor: 40, min: 5, max: 120 },
    ])

    // ACT
    renderizar()

    // ASSERT
    const campo = await screen.findByLabelText('Granularidade da grade (minutos)')
    expect(campo).toHaveAttribute('type', 'number')
    expect(campo).toHaveAttribute('min', '5')
    expect(campo).toHaveAttribute('max', '120')
  })

  it('deve renderizar select para chave com opções', async () => {
    // ARRANGE
    mockConfiguracoes([
      { chave: 'agenda.visao_padrao', rotulo: 'Visão padrão da agenda', tipo: 'string', valor: 'dia', opcoes: ['dia', 'semana', 'geral'] },
    ])

    // ACT
    renderizar()

    // ASSERT
    const select = await screen.findByLabelText('Visão padrão da agenda')
    expect(select.tagName).toBe('SELECT')
  })

  it('deve oferecer a ação do conflito de paciente em português, não o verbo cru', async () => {
    // ARRANGE — a chave nasce em `bloquear` (conflito-do-paciente, §13). O select traduz os
    // VALORES: "bloquear" não diz à administradora o que acontece com o agendamento dela.
    mockConfiguracoes([
      {
        chave: 'agenda.conflito_paciente',
        rotulo: 'Mesmo paciente em horários sobrepostos',
        secao: 'agenda',
        bloco: 'agenda',
        tipo: 'string',
        valor: 'bloquear',
        opcoes: ['bloquear', 'avisar', 'permitir'],
      },
    ])

    // ACT
    renderizar()

    // ASSERT
    const select = await screen.findByLabelText('Mesmo paciente em horários sobrepostos')
    expect(select.tagName).toBe('SELECT')
    expect(
      Array.from((select as HTMLSelectElement).options).map((opcao) => opcao.textContent),
    ).toEqual(['Bloquear o agendamento', 'Avisar e deixar salvar', 'Permitir sem avisar'])
  })

  it('deve editar a janela da pendência de retorno pela aba Agenda', async () => {
    // ARRANGE — a janela é DADO (§13, change protocolo-de-pendencias): a tela edita a
    // chave como qualquer inteiro do catálogo, com a faixa 7..180 vinda do servidor
    mockConfiguracoes([
      { chave: 'agenda.pendencia_retorno_dias', rotulo: 'Dias sem próximo agendamento para entrar nas pendências', tipo: 'int', valor: 30, min: 7, max: 180 },
    ])

    // ACT
    renderizar()

    // ASSERT — o rótulo diz o que a janela significa, sem a chave crua
    const campo = await screen.findByLabelText('Dias sem próximo agendamento para entrar nas pendências')
    expect(campo).toHaveAttribute('type', 'number')
    expect(campo).toHaveAttribute('min', '7')
    expect(campo).toHaveAttribute('max', '180')
    expect(campo).toHaveValue(30)
  })

  it('não deve esconder chave que a tela nunca viu', async () => {
    /*
     * ARRANGE — antes, prefixo desconhecido caía na aba "Outros" e a tela mostrava a CHAVE.
     * Agora a seção vem declarada: a chave aparece na aba dela, com o rótulo do servidor.
     */
    mockConfiguracoes([
      {
        chave: 'modulo_novo.flag',
        rotulo: 'Bandeira de um módulo que a tela desconhece',
        secao: 'clinica',
        bloco: 'clinica',
        tipo: 'bool',
        valor: false,
      },
    ])

    // ACT
    renderizar()

    // ASSERT
    expect(await screen.findByLabelText('Bandeira de um módulo que a tela desconhece')).toBeInTheDocument()
    expect(screen.queryByText('modulo_novo.flag')).not.toBeInTheDocument()
  })

})

describe('PaginaConfiguracoes — abas por grupo', () => {
  /*
   * A seção NÃO é o prefixo da chave — é o ponto da change. Tratamentos e evoluções dividem
   * "Atendimento"; mensagens, WhatsApp, lembretes e notificações dividem "Comunicação", que é
   * a aba composta onde os subtítulos importam.
   */
  const catalogoCompleto: ConfigDeTeste[] = [
    { chave: 'clinica.nome', rotulo: 'Nome da clínica', secao: 'clinica', bloco: 'clinica', valor: 'Clínica' },
    { chave: 'agenda.permitir_retroativo', rotulo: 'Permitir agendamento retroativo', secao: 'agenda', bloco: 'agenda', tipo: 'bool', valor: false },
    { chave: 'tratamentos.bloquear_duplicado_mesmo_servico', rotulo: 'Bloquear tratamento duplicado com o mesmo serviço', secao: 'atendimento', bloco: 'tratamentos', tipo: 'bool', valor: false },
    { chave: 'evolucoes.prazo_dias', rotulo: 'Prazo para evolução (dias corridos)', secao: 'atendimento', bloco: 'evolucoes', tipo: 'int', valor: 100, min: 1, max: 3650 },
    { chave: 'financeiro.contabil_padrao', rotulo: 'Marcar lançamentos como contábeis por padrão', secao: 'financeiro', bloco: 'financeiro', tipo: 'bool', valor: true },
    { chave: 'whatsapp.automatico', rotulo: 'Enviar mensagens automáticas', secao: 'comunicacao', bloco: 'whatsapp', tipo: 'bool', valor: false },
    { chave: 'whatsapp.limite_mensal', rotulo: 'Teto de mensagens por mês', secao: 'comunicacao', bloco: 'whatsapp', tipo: 'int', valor: 500 },
    { chave: 'lembretes.antecedencia_horas', rotulo: 'Antecedência do lembrete (horas)', secao: 'comunicacao', bloco: 'lembretes', tipo: 'int', valor: 24 },
    { chave: 'mensagens.retencao_dias', rotulo: 'Retenção do histórico de mensagens (dias)', secao: 'comunicacao', bloco: 'mensagens', tipo: 'int', valor: 90 },
    { chave: 'notificacoes.a_partir_de', rotulo: 'Considerar notificações a partir de', secao: 'comunicacao', bloco: 'notificacoes', valor: '', formato: 'date' },
    { chave: 'seguranca.aprovacao_dupla', rotulo: 'Exigir aprovação de dois administradores nas mudanças de acesso', secao: 'seguranca', bloco: 'seguranca', tipo: 'bool', valor: false },
  ]



  it('deve renderizar uma aba por seção na ordem canônica, com a primeira ativa', async () => {
    // ARRANGE
    mockConfiguracoes(catalogoCompleto, [], SECOES_FICTICIAS, BLOCOS_FICTICIOS)

    // ACT
    renderizar()

    // ASSERT — a ordem é a que o servidor mandou, e só os campos da aba ativa no painel
    const abas = await screen.findAllByRole('tab')
    expect(abas.map((aba) => aba.textContent)).toEqual([
      ...SECOES_FICTICIAS.map((s) => s.rotulo),
      // a régua dos campos: recurso próprio, mas é aqui que a clínica a procura
      'Cadastro',
    ])
    expect(abas[0]).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByLabelText('Nome da clínica')).toBeInTheDocument()
    expect(screen.queryByLabelText('Permitir agendamento retroativo')).not.toBeInTheDocument()
  })

  it('NÃO deve deixar nenhuma seção com um controle só', async () => {
    // ARRANGE — o desequilíbrio que a change desfez: quatro abas de 1 ou 2 controles
    mockConfiguracoes(catalogoCompleto, [], SECOES_FICTICIAS, BLOCOS_FICTICIOS)
    const usuario = userEvent.setup()
    renderizar()

    // ACT / ASSERT — "Mensagens" e "Notificações" não são mais abas; viraram subtítulos
    await screen.findAllByRole('tab')
    expect(screen.queryByRole('tab', { name: 'Mensagens' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Notificações' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'WhatsApp' })).not.toBeInTheDocument()

    await usuario.click(screen.getByRole('tab', { name: 'Comunicação' }))
    expect(screen.getByLabelText('Retenção do histórico de mensagens (dias)')).toBeInTheDocument()
    expect(screen.getByLabelText('Considerar notificações a partir de')).toBeInTheDocument()
  })

  it('deve pôr o WhatsApp PRIMEIRO na aba Comunicação', async () => {
    // ARRANGE — é o assunto que a clínica mais procura ali, e o único que leva a outra página
    mockConfiguracoes(catalogoCompleto, [], SECOES_FICTICIAS, BLOCOS_FICTICIOS)
    const usuario = userEvent.setup()
    renderizar()

    // ACT
    await usuario.click(await screen.findByRole('tab', { name: 'Comunicação' }))

    // ASSERT
    // `h3`: o `h2` do painel é o rótulo da aba (sr-only com tablist), e os subtítulos de
    // bloco vêm um degrau abaixo dele
    const subtitulos = [...screen.getByRole('tabpanel').querySelectorAll('h3')].map((h) => h.textContent)
    expect(subtitulos[0]).toBe('WhatsApp')
  })

  it('deve destacar a conexão do WhatsApp como cartão com botão, não como link solto', async () => {
    /*
     * ARRANGE — era um link sublinhado no rodapé do bloco e ninguém achava (reportado pela
     * clínica). A versão anterior deste teste passaria com o link de volta: `role=link` e o
     * título no documento são satisfeitos por um `<p>` + `<Link>` soltos (achado design-qa F6).
     *
     * As três asserções abaixo carregam o requisito inteiro: a UNIDADE (o acesso e a descrição
     * dentro da mesma âncora nomeada), a PELE DE CONTROLE (classe estrutural do `Botao`, não
     * cor — cor é guardada no teste do componente) e a POSIÇÃO (antes do primeiro campo).
     */
    mockConfiguracoes(catalogoCompleto, [], SECOES_FICTICIAS, BLOCOS_FICTICIOS)
    const usuario = userEvent.setup()
    renderizar(['configuracoes.ver', 'configuracoes.editar', 'mensagens.conectar'])

    // ACT
    await usuario.click(await screen.findByRole('tab', { name: 'Comunicação' }))

    // ASSERT
    const cartao = within(screen.getByRole('tabpanel')).getByRole('group', {
      name: 'Conexão do WhatsApp',
    })
    within(cartao).getByText(/Número conectado, credencial da Meta/)

    const acesso = within(cartao).getByRole('link', { name: 'Abrir configuração do WhatsApp' })
    expect(acesso).toHaveClass('rounded-botao')

    const primeiroCampo = screen.getByLabelText('Enviar mensagens automáticas')
    expect(acesso.compareDocumentPosition(primeiroCampo) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('deve dar ao cartão da conexão um CABEÇALHO, não só um nome acessível', async () => {
    /*
     * ARRANGE — `role="group"` e `aria-labelledby` já têm guarda (remover qualquer um derruba
     * o teste acima). O que NÃO tinha é o título ser CABEÇALHO: o nome acessível do grupo é
     * resolvido igual apontando para um `<p>`, e o axe não exige cabeçalho. A mutação
     * `<h4>` → `<p>` passava 32/32 (achado a11y BLOQ-GUARDA-02 = CR-IMPORTANTE-1).
     *
     * Sem cabeçalho, o cartão sai da navegação por H do leitor de tela — e ele era justamente
     * o único bloco visual da tela que estava fora da lista de cabeçalhos.
     *
     * O NÍVEL faz parte do requisito: o cartão vive dentro do bloco "WhatsApp", que é `h3`.
     * `h3` competiria com o subtítulo do bloco; `h5` saltaria um degrau.
     */
    mockConfiguracoes(catalogoCompleto, [], SECOES_FICTICIAS, BLOCOS_FICTICIOS)
    const usuario = userEvent.setup()
    renderizar(['configuracoes.ver', 'configuracoes.editar', 'mensagens.conectar'])

    // ACT
    await usuario.click(await screen.findByRole('tab', { name: 'Comunicação' }))

    // ASSERT
    const cartao = within(screen.getByRole('tabpanel')).getByRole('group', {
      name: 'Conexão do WhatsApp',
    })
    expect(within(cartao).getByRole('heading', { name: 'Conexão do WhatsApp', level: 4 })).toBeInTheDocument()
  })

  it('NÃO deve oferecer a conexão do WhatsApp sem permissão de conectar', async () => {
    // ARRANGE
    mockConfiguracoes(catalogoCompleto, [], SECOES_FICTICIAS, BLOCOS_FICTICIOS)
    const usuario = userEvent.setup()
    renderizar(['configuracoes.ver'])

    // ACT
    await usuario.click(await screen.findByRole('tab', { name: 'Comunicação' }))

    // ASSERT
    expect(screen.queryByRole('link', { name: 'Abrir configuração do WhatsApp' })).not.toBeInTheDocument()
  })

  it('deve separar as origens em subtítulos dentro da aba composta', async () => {
    // ARRANGE — Comunicação junta quatro assuntos; sem subtítulo vira lista indistinta
    mockConfiguracoes(catalogoCompleto, [], SECOES_FICTICIAS, BLOCOS_FICTICIOS)
    const usuario = userEvent.setup()
    renderizar()

    // ACT
    await usuario.click(await screen.findByRole('tab', { name: 'Comunicação' }))

    // ASSERT
    expect(screen.getByRole('heading', { name: 'WhatsApp', level: 3 })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Lembretes', level: 3 })).toBeInTheDocument()
  })

  it('NÃO deve pôr subtítulo na aba de assunto único', async () => {
    // ARRANGE — cabeçalho redundante é ruído; a aba Agenda tem um bloco só
    mockConfiguracoes(catalogoCompleto, [], SECOES_FICTICIAS, BLOCOS_FICTICIOS)
    const usuario = userEvent.setup()
    renderizar()

    // ACT
    await usuario.click(await screen.findByRole('tab', { name: 'Agenda' }))

    // ASSERT — nenhum cabeçalho VISÍVEL no painel: o `h2` do painel é `sr-only` com tablist,
    // e o subtítulo é suprimido porque repetiria o rótulo da aba.
    // (A versão anterior procurava `level: 3` quando os subtítulos eram `h2` — nível que não
    // existia nesta tela, então o teste não tinha como cair: achado CR-I2.)
    const painel = screen.getByRole('tabpanel')
    const visiveis = within(painel)
      .queryAllByRole('heading')
      .filter((h) => !h.className.includes('sr-only'))
    expect(visiveis).toHaveLength(0)
    expect(screen.getByLabelText('Permitir agendamento retroativo')).toBeInTheDocument()
  })

  it('deve trocar de aba sem confirmação quando não há edição pendente', async () => {
    // ARRANGE
    mockConfiguracoes(catalogoCompleto, [], SECOES_FICTICIAS, BLOCOS_FICTICIOS)
    const usuario = userEvent.setup()
    renderizar()

    // ACT
    await usuario.click(await screen.findByRole('tab', { name: 'Agenda' }))

    // ASSERT — painel troca direto, sem diálogo
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Permitir agendamento retroativo')).toBeInTheDocument()
    expect(screen.queryByLabelText('Nome da clínica')).not.toBeInTheDocument()
  })

  it('NÃO deve oferecer aba de despejo quando o catálogo está íntegro', async () => {
    /*
     * ARRANGE — a aba "Outros" era o depósito de chave com prefixo desconhecido, e foi por ela
     * que `whatsapp.limite_mensal` chegou cru à tela da clínica em 2026-08-21. Ela não existe
     * mais como destino de operação NORMAL: o servidor valida `secao` e `bloco` na leitura.
     *
     * A versão anterior deste teste procurava a aba pelo nome `'Outros'` — e `getByRole` usa
     * match EXATO, então ela nunca casaria com o rótulo real, que é `'Outros ajustes'`. O
     * teste não podia falhar pelo que o nome dele prometia: emitir a aba SEMPRE
     * (`if (orfas.length > 0)` → `if (true)`) deixava a suíte verde (achado CR-IMPORTANTE-2).
     *
     * O nome também contradizia a spec DESTA rodada, que passou a admitir a aba de exceção
     * quando o servidor se contradiz. O que continua proibido é o despejo POR PREFIXO.
     */
    mockConfiguracoes(catalogoCompleto, [], SECOES_FICTICIAS, BLOCOS_FICTICIOS)

    // ACT
    renderizar()

    // ASSERT — catálogo íntegro não produz aba de exceção, e nenhuma aba se chama por prefixo
    const abas = await screen.findAllByRole('tab')
    expect(screen.queryByRole('tab', { name: 'Outros ajustes' })).not.toBeInTheDocument()
    expect(abas.map((aba) => aba.textContent)).toEqual([
      ...SECOES_FICTICIAS.map((secao) => secao.rotulo),
      'Cadastro',
    ])
  })

  it('deve pôr a chave que a tela nunca viu na aba da seção dela, com o rótulo do servidor', async () => {
    // ARRANGE — a tela não tem dicionário próprio para ficar desatualizado
    mockConfiguracoes(
      [
        { chave: 'clinica.nome', rotulo: 'Nome da clínica', secao: 'clinica', bloco: 'clinica', valor: 'Clínica' },
        {
          chave: 'modulo_novo.flag',
          rotulo: 'Bandeira de um módulo que a tela desconhece',
          secao: 'agenda',
          bloco: 'agenda',
          tipo: 'bool',
          valor: false,
        },
      ],
      [],
      SECOES_FICTICIAS,
    )
    const usuario = userEvent.setup()
    renderizar()

    // ACT
    await usuario.click(await screen.findByRole('tab', { name: 'Agenda' }))

    // ASSERT — o rótulo que veio na leitura, nunca a chave
    expect(screen.getByLabelText('Bandeira de um módulo que a tela desconhece')).toBeInTheDocument()
    expect(screen.queryByText('modulo_novo.flag')).not.toBeInTheDocument()
  })

  it('deve pedir confirmação ao trocar de aba com edição digitada não salva', async () => {
    // ARRANGE
    mockConfiguracoes(catalogoCompleto, [], SECOES_FICTICIAS, BLOCOS_FICTICIOS)
    const usuario = userEvent.setup()
    renderizar()
    await usuario.type(await screen.findByLabelText('Nome da clínica'), ' Nova')

    // ACT
    await usuario.click(screen.getByRole('tab', { name: 'Agenda' }))

    // ASSERT — a troca espera a decisão; cancelar mantém a aba e o texto digitado
    expect(await screen.findByRole('alertdialog', { name: /Trocar para Agenda sem salvar/ })).toBeInTheDocument()
    await usuario.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(screen.getByLabelText('Nome da clínica')).toHaveValue('Clínica Nova')
    expect(screen.queryByLabelText('Permitir agendamento retroativo')).not.toBeInTheDocument()
  })

  it('deve descartar a edição e trocar de aba quando o usuário confirma', async () => {
    // ARRANGE
    mockConfiguracoes(catalogoCompleto, [], SECOES_FICTICIAS, BLOCOS_FICTICIOS)
    const usuario = userEvent.setup()
    renderizar()
    await usuario.type(await screen.findByLabelText('Nome da clínica'), ' Nova')
    await usuario.click(screen.getByRole('tab', { name: 'Agenda' }))

    // ACT
    await usuario.click(await screen.findByRole('button', { name: 'Descartar e trocar' }))

    // ASSERT — painel da Agenda ativo; a volta encontra o valor efetivo, não o digitado
    expect(await screen.findByLabelText('Permitir agendamento retroativo')).toBeInTheDocument()
    await usuario.click(screen.getByRole('tab', { name: 'Clínica' }))
    expect(await screen.findByLabelText('Nome da clínica')).toHaveValue('Clínica')
  })

  // change tema-da-clinica
  it('deve dar à aba o canto de controle em cima, e não a pílula do botão', async () => {
    // ARRANGE + ACT — com o raio do botão em pílula, a aba virava um arco sobre o sublinhado
    mockConfiguracoes(catalogoCompleto, [], SECOES_FICTICIAS, BLOCOS_FICTICIOS)
    renderizar()

    // ASSERT
    await screen.findByRole('tab', { name: 'Agenda' })
    const abas = screen.getAllByRole('tab')
    // a escolhida E as demais: as duas peles da aba precisam do canto de controle
    expect(abas.some((aba) => aba.getAttribute('aria-selected') === 'true')).toBe(true)
    for (const aba of abas) {
      expect(aba).toHaveClass('rounded-t-controle', 'rounded-b-none')
    }
  })
})

describe('PaginaConfiguracoes — somente leitura (SEC-ADM)', () => {
  it('deve marcar somente leitura e não oferecer salvar sem configuracoes.editar', async () => {
    // ARRANGE
    mockConfiguracoes([{ chave: 'clinica.nome', rotulo: 'Nome da clínica', tipo: 'string', valor: 'Clínica' }])

    // ACT
    renderizar(['configuracoes.ver'])

    // ASSERT — o campo aparece desabilitado e não há botão Salvar
    const campo = await screen.findByLabelText('Nome da clínica')
    expect(campo).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Salvar' })).not.toBeInTheDocument()
    expect(screen.getByText('Somente leitura')).toBeInTheDocument()
  })
})

describe('PaginaConfiguracoes — alvo do encadeamento validado na leitura (CONFIG-SEM-FK)', () => {
  it('deve avisar quando o status-alvo atual não está entre os elegíveis', async () => {
    // ARRANGE — valor 99 aponta para um status que não está nos alvos
    mockConfiguracoes(
      [{ chave: 'agenda.encadeamento_status_id', rotulo: 'Status-alvo do encadeamento', tipo: 'int', valor: 99, min: 0 }],
      [{ id: 2, nome: 'Reserva de Agenda' }],
    )

    // ACT
    renderizar()

    // ASSERT — estado inválido explícito
    expect(await screen.findByText(/status-alvo atual foi excluído ou passou a descontar sessão/i)).toBeInTheDocument()
  })

  it('deve mostrar o nome do status quando o alvo é válido', async () => {
    // ARRANGE
    mockConfiguracoes(
      [{ chave: 'agenda.encadeamento_status_id', rotulo: 'Status-alvo do encadeamento', tipo: 'int', valor: 2, min: 0 }],
      [{ id: 2, nome: 'Reserva de Agenda' }],
    )

    // ACT
    renderizar()

    // ASSERT — sem aviso; a opção com o nome está selecionada
    const select = (await screen.findByLabelText('Status-alvo do encadeamento')) as HTMLSelectElement
    expect(select.value).toBe('2')
    expect(screen.queryByText(/foi excluído ou passou a descontar sessão/i)).not.toBeInTheDocument()
  })

  it('não deve marcar órfão nem oferecer desligar quando os alvos chegam DEPOIS das configurações', async () => {
    // ARRANGE — a leitura de alvos ATRASA; sem o gate, o widget montaria com alvos=[] e
    // marcaria o status 2 como órfão, deixando o Salvar (que gravaria 0) habilitado
    servidor.use(
      msw.get('/api/configuracoes', () =>
        HttpResponse.json(
          leituraFicticia([
            configuracaoFicticia({
              chave: 'agenda.encadeamento_status_id',
              rotulo: 'Status-alvo do encadeamento',
              tipo: 'int',
              valor: 2,
              min: 0,
            }),
          ]),
        ),
      ),
      msw.get('/api/configuracoes/alvos-encadeamento', async () => {
        await delay(60)
        return HttpResponse.json({ alvos: [{ id: 2, nome: 'Reserva de Agenda' }] })
      }),
    )

    // ACT
    renderizar()

    // ASSERT — quando o campo aparece, o alvo válido está selecionado, sem aviso de órfão
    const select = (await screen.findByLabelText('Status-alvo do encadeamento')) as HTMLSelectElement
    expect(select.value).toBe('2')
    expect(screen.queryByText(/foi excluído ou passou a descontar sessão/i)).not.toBeInTheDocument()
  })
})

/**
 * Os PONTEIROS de status viram lista pelo nome (change lembrete-com-botoes-de-resposta, 1.4): a
 * clínica tropeçou em 28/09 no campo que pedia o "número interno" do status. O valor gravado
 * continua sendo o id — o que muda é que ninguém mais precisa sabê-lo.
 */
describe('PaginaConfiguracoes — ponteiros de status escolhidos pelo nome', () => {
  // status que NÃO descontam sessão (é o que `alvos-encadeamento` devolve), com e sem o horário
  const STATUS_SEM_DESCONTO: AlvoEncadeamento[] = [
    { id: 7, nome: 'Desmarcado pelo Profissional', ocupa_horario: false },
    { id: 8, nome: 'Desmarcado pelo Paciente', ocupa_horario: false },
    { id: 2, nome: 'Reserva de Agenda', ocupa_horario: true },
  ]

  const DESMARQUE_DO_PROFISSIONAL: ConfigDeTeste = {
    chave: 'agenda.status_desmarque_id',
    rotulo: 'Status aplicado ao desmarcar a agenda do profissional',
    secao: 'agenda',
    bloco: 'agenda',
    tipo: 'int',
    valor: 0,
    min: 0,
    formato: 'status',
  }

  const DESMARQUE_DA_FAMILIA: ConfigDeTeste = {
    chave: 'lembretes.status_desmarque_familia_id',
    rotulo: 'Status aplicado quando a família desmarca',
    secao: 'comunicacao',
    bloco: 'lembretes',
    tipo: 'int',
    valor: 0,
    min: 0,
    formato: 'status_que_libera',
  }

  /** Captura o corpo de cada gravação — a escrita é chave a chave. */
  function capturarGravacoes(): Array<Record<string, unknown>> {
    const corpos: Array<Record<string, unknown>> = []
    servidor.use(
      msw.put('/api/configuracoes', async ({ request }) => {
        const corpo = (await request.json()) as Record<string, unknown>
        corpos.push(corpo)
        return HttpResponse.json(corpo)
      }),
    )
    return corpos
  }

  function opcoesDe(select: HTMLElement): Array<string | null> {
    return Array.from((select as HTMLSelectElement).options).map((opcao) => opcao.textContent)
  }

  it('deve mostrar o status do desmarque do profissional como lista de nomes, com o 0 como "Não configurado"', async () => {
    // ARRANGE
    mockConfiguracoes([DESMARQUE_DO_PROFISSIONAL], STATUS_SEM_DESCONTO)

    // ACT
    renderizar()

    // ASSERT — nenhum número interno à vista: os nomes, e o 0 dito em palavras
    const select = await screen.findByLabelText('Status aplicado ao desmarcar a agenda do profissional')
    expect(select.tagName).toBe('SELECT')
    expect((select as HTMLSelectElement).value).toBe('0')
    expect(opcoesDe(select)).toEqual([
      'Não configurado',
      'Desmarcado pelo Profissional',
      'Desmarcado pelo Paciente',
      'Reserva de Agenda',
    ])
  })

  it('deve gravar o ID do status escolhido, como número', async () => {
    // ARRANGE
    mockConfiguracoes([DESMARQUE_DO_PROFISSIONAL], STATUS_SEM_DESCONTO)
    const gravacoes = capturarGravacoes()
    const usuario = userEvent.setup()
    renderizar()
    const select = await screen.findByLabelText('Status aplicado ao desmarcar a agenda do profissional')

    // ACT
    await usuario.selectOptions(select, 'Desmarcado pelo Profissional')
    await usuario.click(screen.getByRole('button', { name: 'Salvar' }))

    // ASSERT — o servidor recebe o id (número), nunca o nome nem a string do select
    await screen.findByText(/Status aplicado ao desmarcar a agenda do profissional atualizado/)
    expect(gravacoes).toEqual([{ chave: 'agenda.status_desmarque_id', valor: 7 }])
  })

  it('deve marcar a seleção da agenda como velha ao salvar, para o aviso de "falta configurar" não sobreviver no cache', async () => {
    // ARRANGE — os avisos de pré-requisito da agenda leem as flags derivadas da seleção (gate CR-AVI-02)
    mockConfiguracoes([DESMARQUE_DO_PROFISSIONAL], STATUS_SEM_DESCONTO)
    capturarGravacoes()
    queryClient.setQueryData(chaves.selecaoDaAgenda(), { profissionais: [], status: [] })
    const usuario = userEvent.setup()
    renderizar()
    const select = await screen.findByLabelText('Status aplicado ao desmarcar a agenda do profissional')

    // ACT
    await usuario.selectOptions(select, 'Desmarcado pelo Profissional')
    await usuario.click(screen.getByRole('button', { name: 'Salvar' }))

    // ASSERT
    await screen.findByText(/Status aplicado ao desmarcar a agenda do profissional atualizado/)
    expect(queryClient.getQueryState(chaves.selecaoDaAgenda())?.isInvalidated).toBe(true)
  })

  it('deve gravar 0 ao voltar para "Não configurado"', async () => {
    // ARRANGE — o ponteiro já apontava para o status 7
    mockConfiguracoes([{ ...DESMARQUE_DO_PROFISSIONAL, valor: 7 }], STATUS_SEM_DESCONTO)
    const gravacoes = capturarGravacoes()
    const usuario = userEvent.setup()
    renderizar()
    const select = await screen.findByLabelText('Status aplicado ao desmarcar a agenda do profissional')
    expect((select as HTMLSelectElement).value).toBe('7')

    // ACT
    await usuario.selectOptions(select, 'Não configurado')
    await usuario.click(screen.getByRole('button', { name: 'Salvar' }))

    // ASSERT
    await screen.findByText(/Status aplicado ao desmarcar a agenda do profissional atualizado/)
    expect(gravacoes).toEqual([{ chave: 'agenda.status_desmarque_id', valor: 0 }])
  })

  it('não deve oferecer, no status do desmarque pela família, status que segura o horário', async () => {
    // ARRANGE — "Reserva de Agenda" não desconta, mas SEGURA o horário: não devolveria a vaga
    mockConfiguracoes([DESMARQUE_DA_FAMILIA], STATUS_SEM_DESCONTO)

    // ACT
    renderizar()

    // ASSERT
    const select = await screen.findByLabelText('Status aplicado quando a família desmarca')
    expect(opcoesDe(select)).toEqual(['Não configurado', 'Desmarcado pelo Profissional', 'Desmarcado pelo Paciente'])
  })

  it.each([
    // o 2 segura o horário: não serve para o desmarque pela família
    [DESMARQUE_DA_FAMILIA, 2, /Status aplicado quando a família desmarca: o status gravado .*deixou de liberar o horário/],
    // o 99 não está entre os que não descontam (excluído, ou passou a descontar)
    [DESMARQUE_DO_PROFISSIONAL, 99, /Status aplicado ao desmarcar a agenda do profissional: o status gravado foi excluído/],
    [
      {
        chave: 'agenda.encadeamento_status_id',
        rotulo: 'Status-alvo do encadeamento',
        secao: 'agenda',
        bloco: 'agenda',
        tipo: 'int' as const,
        valor: 0,
        min: 0,
      },
      99,
      /Status-alvo do encadeamento: o status-alvo atual foi excluído/,
    ],
  ])('deve ligar ao próprio campo, pelo nome, o aviso do status gravado que saiu da lista (%#)', async (config, valor, aviso) => {
    // ARRANGE — o valor gravado não está entre os status que o ponteiro aceita
    mockConfiguracoes([{ ...config, valor }], STATUS_SEM_DESCONTO)

    // ACT
    renderizar()

    // ASSERT — é erro DO campo (inválido e descrito por ele), a frase diz de qual campo fala, e a
    // tela não finge que o valor órfão está escolhido
    const select = await screen.findByLabelText(String(config.rotulo))
    expect(select).toHaveAttribute('aria-invalid', 'true')
    expect(select).toHaveAccessibleDescription(aviso)
    expect((select as HTMLSelectElement).value).toBe('0')
  })

  /**
   * evolucao-finaliza-a-sessao (D3): o status que salvar a evolução aplica. A lista é OUTRA — a dos
   * status que finalizam (desconta e segura o horário) —, e o 0 é "Desligado", como nasce.
   */
  const STATUS_AO_SALVAR_A_EVOLUCAO: ConfigDeTeste = {
    chave: 'evolucoes.status_ao_salvar',
    rotulo: 'Status aplicado ao salvar a evolução',
    secao: 'atendimento',
    bloco: 'evolucoes',
    tipo: 'int',
    valor: 0,
    min: 0,
    formato: 'status_que_finaliza',
  }

  function mockStatusQueFinalizam() {
    mockConfiguracoes([STATUS_AO_SALVAR_A_EVOLUCAO], STATUS_SEM_DESCONTO)
    servidor.use(
      msw.get('/api/configuracoes/alvos-encadeamento', () =>
        HttpResponse.json({
          alvos: STATUS_SEM_DESCONTO,
          finalizam: [
            { id: 4, nome: 'Finalizado com Evolução' },
            { id: 5, nome: 'Finalizado sem Evolução' },
          ],
        }),
      ),
    )
  }

  it('deve oferecer, no status ao salvar a evolução, só os status que finalizam a sessão', async () => {
    // ARRANGE
    mockStatusQueFinalizam()

    // ACT
    renderizar()

    // ASSERT — nenhum status sem desconto (desmarque, reserva) entra; o 0 é "Desligado"
    const select = await screen.findByLabelText('Status aplicado ao salvar a evolução')
    expect((select as HTMLSelectElement).value).toBe('0')
    expect(opcoesDe(select)).toEqual(['Desligado', 'Finalizado com Evolução', 'Finalizado sem Evolução'])
  })

  it('deve gravar o ID do status que finaliza a sessão', async () => {
    // ARRANGE
    mockStatusQueFinalizam()
    const gravacoes = capturarGravacoes()
    const usuario = userEvent.setup()
    renderizar()
    const select = await screen.findByLabelText('Status aplicado ao salvar a evolução')

    // ACT
    await usuario.selectOptions(select, 'Finalizado com Evolução')
    await usuario.click(screen.getByRole('button', { name: 'Salvar' }))

    // ASSERT
    await screen.findByText(/Status aplicado ao salvar a evolução atualizado/)
    expect(gravacoes).toEqual([{ chave: 'evolucoes.status_ao_salvar', valor: 4 }])
  })

  it('deve avisar no próprio campo quando o status gravado deixou de finalizar a sessão', async () => {
    // ARRANGE — o 7 está gravado, mas não está entre os que finalizam (a clínica editou o status)
    mockConfiguracoes([{ ...STATUS_AO_SALVAR_A_EVOLUCAO, valor: 7 }], STATUS_SEM_DESCONTO)
    servidor.use(
      msw.get('/api/configuracoes/alvos-encadeamento', () =>
        HttpResponse.json({ alvos: STATUS_SEM_DESCONTO, finalizam: [{ id: 4, nome: 'Finalizado com Evolução' }] }),
      ),
    )

    // ACT
    renderizar()

    // ASSERT
    const select = await screen.findByLabelText('Status aplicado ao salvar a evolução')
    expect(select).toHaveAttribute('aria-invalid', 'true')
    expect(select).toHaveAccessibleDescription(/salvar a evolução não vai finalizar a sessão/)
  })

  it('deve oferecer a ação do "Preciso desmarcar" em português, não o verbo cru', async () => {
    // ARRANGE — a chave nasce em `sinalizar`
    mockConfiguracoes([
      {
        chave: 'lembretes.acao_desmarque',
        rotulo: 'Quando a família toca em "Preciso desmarcar"',
        secao: 'comunicacao',
        bloco: 'lembretes',
        tipo: 'string',
        valor: 'sinalizar',
        opcoes: ['sinalizar', 'desmarcar'],
      },
    ])

    // ACT
    renderizar()

    // ASSERT
    const select = await screen.findByLabelText('Quando a família toca em "Preciso desmarcar"')
    expect(opcoesDe(select)).toEqual(['Avisar a recepção, que resolve', 'Desmarcar sozinho'])
  })
})

/**
 * 3.6 e 4.3 — a ordem não pode divergir do catálogo, e a tela precisa de gate automatizado.
 *
 * A ordem das abas é a que o servidor manda: escrever a ordem canônica na spec não impede a
 * tela de reordenar por conta própria, e este teste impede. O `axe` fecha a lacuna que a tela
 * de Configurações ainda tinha — a mesma que a change anterior fechou nas duas telas dela.
 */
describe('PaginaConfiguracoes — ordem e gate de acessibilidade', () => {
  const CATALOGO: ConfigDeTeste[] = [
    { chave: 'clinica.nome', rotulo: 'Nome da clínica', secao: 'clinica', bloco: 'clinica', valor: 'Clínica' },
    { chave: 'whatsapp.automatico', rotulo: 'Enviar mensagens automáticas', secao: 'comunicacao', bloco: 'whatsapp', tipo: 'bool', valor: false },
    { chave: 'agenda.permitir_retroativo', rotulo: 'Permitir agendamento retroativo', secao: 'agenda', bloco: 'agenda', tipo: 'bool', valor: false },
    { chave: 'whatsapp.limite_mensal', rotulo: 'Teto de mensagens por mês', secao: 'comunicacao', bloco: 'whatsapp', tipo: 'int', valor: 500 },
    { chave: 'mensagens.retencao_dias', rotulo: 'Retenção do histórico de mensagens (dias)', secao: 'comunicacao', bloco: 'mensagens', tipo: 'int', valor: 90 },
  ]

  it('deve renderizar as abas na ordem que o SERVIDOR mandou, não numa ordem própria', async () => {
    // ARRANGE — ordem deliberadamente fora do alfabeto e diferente da ordem das chaves
    const secoesFora = [
      { secao: 'comunicacao', rotulo: 'Comunicação' },
      { secao: 'clinica', rotulo: 'Clínica' },
      { secao: 'agenda', rotulo: 'Agenda' },
    ]
    mockConfiguracoes(CATALOGO, [], secoesFora)

    // ACT
    renderizar()

    // ASSERT
    const abas = await screen.findAllByRole('tab')
    expect(abas.map((aba) => aba.textContent)).toEqual(['Comunicação', 'Clínica', 'Agenda', 'Cadastro'])
  })

  /**
   * As 4 chaves REAIS da aba Clínica — duas delas (`identidade`, `fonte_do_nome`) montam a
   * seção de identidade, que emite um `h3` próprio. A fixture recortada de antes não as
   * tinha, e por isso o gate nascia verde numa tela que o `axe` reprovava (bloqueante
   * BLOQ-02). É a aba ATIVA por padrão: a primeira coisa que a clínica vê.
   */
  const CLINICA_REAL: ConfigDeTeste[] = [
    { chave: 'clinica.nome', rotulo: 'Nome da clínica', secao: 'clinica', bloco: 'clinica', valor: 'Clínica Exemplo' },
    { chave: 'clinica.timezone', rotulo: 'Fuso horário', secao: 'clinica', bloco: 'clinica', valor: 'America/Sao_Paulo', formato: 'timezone' },
    { chave: 'clinica.identidade', rotulo: 'Identidade na barra lateral', secao: 'clinica', bloco: 'clinica', valor: 'nome', opcoes: ['nome', 'logo'] },
    { chave: 'clinica.fonte_do_nome', rotulo: 'Fonte do nome', secao: 'clinica', bloco: 'clinica', valor: 'padrao', opcoes: ['padrao', 'serifada', 'arredondada', 'manuscrita'] },
  ]

  /*
   * Orçamento explícito, e NÃO um timeout aumentado no chute.
   *
   * Esta aba tem `clinica.timezone`, cujo widget é um `<select>` com os fusos de
   * `Intl.supportedValuesOf('timeZone')` — **418 `<option>`** nesta máquina. O `axe` caminha
   * os 418, e a célula leva ~4,7s contra o padrão de 5s: 94% do orçamento. Sob carga ela
   * ficou VERMELHA duas vezes no gate, sem nenhuma mutação que explicasse (achado a11y
   * A11Y-R4-01). Gate que troca de cor com a carga da máquina deixou de ser gate — e este
   * vira ainda mais frágil no dia em que rodar em CI, que é máquina compartilhada.
   *
   * O custo é inerente ao DOM real desta aba, não sinal de defeito. Reduzi-lo exigiria
   * combobox virtualizado — mudança de produto, não de teste.
   */
  it('deve passar no axe na aba CLÍNICA com as 4 chaves reais', async () => {
    // ARRANGE / ACT — é onde o `h3` da identidade pendurava direto no `h1`
    mockConfiguracoes(CLINICA_REAL, [], SECOES_FICTICIAS, BLOCOS_FICTICIOS)
    const { container } = renderizar()
    // por papel: "Nome da clínica" também rotula um rádio na seção de identidade
    await screen.findByRole('textbox', { name: 'Nome da clínica' })

    // ASSERT
    expect(await axe(container)).toHaveNoViolations()
  }, 20_000)

  it('deve passar no axe na aba CADASTRO, que emite cinco h3 próprios', async () => {
    // ARRANGE / ACT — a régua dos campos, que esta change manteve na barra
    mockConfiguracoes(CLINICA_REAL, [], SECOES_FICTICIAS, BLOCOS_FICTICIOS)
    const usuario = userEvent.setup()
    const { container } = renderizar()

    // ACT
    await usuario.click(await screen.findByRole('tab', { name: 'Cadastro' }))
    await screen.findByRole('radiogroup', { name: 'Nome' })

    // ASSERT
    expect(await axe(container)).toHaveNoViolations()
  })

  it('deve passar no axe na aba composta COM o cartão da conexão', async () => {
    /*
     * ARRANGE — a célula composta de antes rodava sem `mensagens.conectar`, então o cartão,
     * que é a entrega visível da change, nunca entrou em nenhuma execução do axe.
     */
    mockConfiguracoes(CATALOGO, [], SECOES_FICTICIAS, BLOCOS_FICTICIOS)
    const usuario = userEvent.setup()
    const { container } = renderizar(['configuracoes.ver', 'configuracoes.editar', 'mensagens.conectar'])

    // ACT
    await usuario.click(await screen.findByRole('tab', { name: 'Comunicação' }))
    await screen.findByRole('link', { name: 'Abrir configuração do WhatsApp' })

    // ASSERT
    expect(await axe(container)).toHaveNoViolations()
  })

  it('deve passar no axe na aba de EXCEÇÃO', async () => {
    /*
     * ARRANGE — a aba de exceção é a única superfície da tela que nasceu nesta rodada e nunca
     * entrou numa execução do axe. Ela monta uma árvore própria (aba + bloco órfão com rótulo
     * neutro), e é justamente onde os cabeçalhos podem sair errados sem ninguém ver: por
     * definição, ninguém a abre em operação normal.
     */
    mockConfiguracoes(
      contradicao().configuracoes,
      [],
      contradicao().secoes,
      contradicao().blocos,
    )
    const usuario = userEvent.setup()
    const { container } = renderizar()

    // ACT — o axe precisa rodar com a aba de exceção ATIVA, não com ela apenas presente
    await usuario.click(await screen.findByRole('tab', { name: 'Outros ajustes' }))
    await screen.findByLabelText('Exigir aprovação de dois administradores')

    // ASSERT
    expect(await axe(container)).toHaveNoViolations()
  })

  it('deve passar no axe na aba simples', async () => {
    // ARRANGE / ACT
    mockConfiguracoes(CATALOGO)
    const { container } = renderizar()
    await screen.findByLabelText('Nome da clínica')

    // ASSERT
    expect(await axe(container)).toHaveNoViolations()
  })

  it('deve passar no axe na aba COMPOSTA, que é a que ganhou subtítulos', async () => {
    // ARRANGE
    mockConfiguracoes(CATALOGO, [], [
      { secao: 'comunicacao', rotulo: 'Comunicação' },
      { secao: 'clinica', rotulo: 'Clínica' },
    ])
    const usuario = userEvent.setup()
    const { container } = renderizar()

    // ACT
    await usuario.click(await screen.findByRole('tab', { name: 'Comunicação' }))

    // ASSERT
    expect(await axe(container)).toHaveNoViolations()
  })

  it('deve passar no axe em somente leitura', async () => {
    // ARRANGE / ACT
    mockConfiguracoes(CATALOGO)
    const { container } = renderizar(['configuracoes.ver'])
    await screen.findByLabelText('Nome da clínica')

    // ASSERT
    expect(await axe(container)).toHaveNoViolations()
  })
})

/**
 * As guardas que faltavam, cada uma provada por mutação (achados CR-B1, CR-I1, CR-I3,
 * SEC-SDC-02 e BLOQ-02 do a11y).
 */
describe('PaginaConfiguracoes — o que não pode sumir nem passar batido', () => {
  it('NÃO deve oferecer aba de seção declarada e VAZIA', async () => {
    // ARRANGE — a guarda `itens.length === 0` não tinha teste: removê-la passava 24/24
    mockConfiguracoes(
      [{ chave: 'clinica.nome', rotulo: 'Nome da clínica', secao: 'clinica', bloco: 'clinica', valor: 'Clínica' }],
      [],
      [
        { secao: 'clinica', rotulo: 'Clínica' },
        { secao: 'financeiro', rotulo: 'Financeiro' },
      ],
    )

    // ACT
    renderizar()

    // ASSERT
    await screen.findByRole('tab', { name: 'Clínica' })
    expect(screen.queryByRole('tab', { name: 'Financeiro' })).not.toBeInTheDocument()
  })

  it('NÃO deve engolir chave cuja SEÇÃO o servidor não declarou', async () => {
    /*
     * ARRANGE — antes ela sumia sem erro, sem aviso e sem estado vazio. É pior que o defeito
     * de 21/08 que originou a change: lá a chave aparecia crua e a clínica reclamou; aqui não
     * apareceria nada, e ninguém configura o que não sabe que existe.
     */
    mockConfiguracoes(
      contradicao().configuracoes,
      [],
      contradicao().secoes,
      contradicao().blocos,
    )
    const usuario = userEvent.setup()
    renderizar()

    // ACT
    await usuario.click(await screen.findByRole('tab', { name: 'Outros ajustes' }))

    // ASSERT — continua configurável, e sem expor o slug da seção
    expect(screen.getByLabelText('Exigir aprovação de dois administradores')).toBeInTheDocument()
    expect(screen.queryByText('governanca')).not.toBeInTheDocument()
  })

  it('deve pôr a aba de exceção em ÚLTIMO, atrás inclusive da Cadastro', async () => {
    /*
     * ARRANGE — a aba de anomalia não pode ficar na frente de uma aba de uso diário. Nenhum
     * teste verificava a POSIÇÃO: os dois que comparam a ordem das abas com a lista `secoes`
     * usam catálogo íntegro, onde a aba de exceção nem existe, e o teste acima a clica pelo
     * nome. Inverter a ordem passava 32/32 (achado CR-BLOQUEANTE-2 = design-qa IMP-1).
     *
     * O custo da inversão não é cosmético: `abaAtual = grupos[0]?.id`, então a aba de anomalia
     * viraria a ATIVA POR PADRÃO — quem administra abre /configuracoes e cai em "Outros
     * ajustes", com as abas de uso diário atrás.
     */
    mockConfiguracoes(
      contradicao().configuracoes,
      [],
      contradicao().secoes,
      contradicao().blocos,
    )

    // ACT
    renderizar()

    // ASSERT — a exceção é a última, e a primeira aba (a ativa por padrão) é de uso diário
    const abas = await screen.findAllByRole('tab')
    expect(abas.map((aba) => aba.textContent)).toEqual(['Clínica', 'Cadastro', 'Outros ajustes'])
    expect(abas[0]).toHaveAttribute('aria-selected', 'true')
  })

  it('NÃO deve engolir chave cujo BLOCO o servidor não declarou', async () => {
    // ARRANGE — mesma perda, um nível abaixo: a aba renderiza e o controle some
    mockConfiguracoes(
      [
        { chave: 'clinica.nome', rotulo: 'Nome da clínica', secao: 'clinica', bloco: 'clinica', valor: 'Clínica' },
        { chave: 'relatorios.retencao', rotulo: 'Retenção dos relatórios (dias)', secao: 'clinica', bloco: 'relatorios', tipo: 'int', valor: 30 },
      ],
      [],
      [{ secao: 'clinica', rotulo: 'Clínica' }],
      [{ bloco: 'clinica', rotulo: 'Clínica' }],
    )

    // ACT
    const { container } = renderizar()

    // ASSERT
    expect(await screen.findByLabelText('Retenção dos relatórios (dias)')).toBeInTheDocument()
    expect(screen.queryByText('relatorios')).not.toBeInTheDocument()

    /*
     * O `axe` aqui NÃO guarda o rótulo do bloco órfão — eu afirmei que guardava, e era falso.
     * Neste cenário a aba tem o bloco `clinica` rotulado, então o órfão recebe "Outros
     * ajustes"; com o rótulo vazio a guarda `bloco.rotulo !== ''` suprime o `<h3>`, não existe
     * `empty-heading`, e o axe passa (achado CR-BLOQUEANTE-1). Quem guarda aquele ramo é a
     * célula "deve ANCORAR o campo órfão…" adiante. Este axe é higiene do DOM, e só.
     */
    expect(await axe(container)).toHaveNoViolations()
  })
})

describe('PaginaConfiguracoes — resposta antiga, sem as listas novas', () => {
  it('NÃO deve quebrar quando a API responde sem `secoes` nem `blocos`', async () => {
    /*
     * ARRANGE — rollout na ordem inversa à do Migration Plan: front novo contra API antiga,
     * que responde só `configuracoes`. O fallback do OBJETO inteiro (`consulta.data ?? {...}`)
     * cobre apenas `data === undefined` e dava impressão de defesa que não existia
     * (achado SEC-SDC-03); o `??` por LISTA é que segura este caso — e não tinha guarda:
     * voltar ao fallback do objeto passava 32/32 (achado CR-IMPORTANTE-4).
     *
     * Sem ele, `leitura.secoes.map` estoura `TypeError` dentro do `useMemo` e a tela de
     * Configurações fica BRANCA — não degradada, branca.
     */
    servidor.use(
      msw.get('/api/configuracoes', () =>
        HttpResponse.json({ configuracoes: [configuracaoFicticia({ chave: 'clinica.nome' })] }),
      ),
      msw.get('/api/configuracoes/alvos-encadeamento', () => HttpResponse.json({ alvos: [] })),
      msw.get('/api/campos-cadastro/:formulario', () => HttpResponse.json(reguaFicticia())),
    )

    // ACT
    renderizar()

    // ASSERT — a tela sobrevive: a aba própria da régua continua lá, sem crash
    expect(await screen.findByRole('tab', { name: 'Cadastro' })).toBeInTheDocument()
  })
})

/**
 * As TRÊS guardas do SUBTÍTULO, cada uma no ramo que ela guarda.
 *
 * A primeira tentativa pôs o `axe` no teste do bloco órfão — mas lá a aba tem bloco rotulado,
 * o órfão recebe "Outros ajustes", e o ramo de rótulo VAZIO nunca era exercitado: as duas
 * mutações passavam 30/30 (achado CR-IMP-2). `axe` no cenário vizinho não prova guarda nenhuma.
 *
 * O terceiro ramo — o rótulo NEUTRO — só ganhou guarda na rodada 3, e a rodada 4 mostrou que
 * mesmo então eu tinha provado só metade dele: a mutação que fixa `'Outros ajustes'` para
 * SEMPRE sobrevivia, porque o cenário sem bloco rotulado assere ausência de cabeçalho VAZIO,
 * e um subtítulo redundante não é vazio. Ternário tem dois lados; guarda de ternário também.
 */
describe('PaginaConfiguracoes — o subtítulo nos três ramos que ele tem', () => {
  it('NÃO deve emitir cabeçalho vazio quando a aba é SÓ de órfãos', async () => {
    /*
     * ARRANGE — seção declarada, ZERO blocos declarados: todo campo é órfão e o bloco fica
     * sem rótulo. Sem a guarda `bloco.rotulo !== ''`, renderiza `<h3></h3>` e o axe reprova
     * com `empty-heading`.
     */
    mockConfiguracoes(
      [
        { chave: 'clinica.nome', rotulo: 'Nome da clínica', secao: 'clinica', bloco: 'desconhecido', valor: 'Clínica' },
        { chave: 'clinica.timezone', rotulo: 'Fuso horário', secao: 'clinica', bloco: 'desconhecido', valor: 'America/Sao_Paulo' },
      ],
      [],
      [{ secao: 'clinica', rotulo: 'Clínica' }],
      [],
    )

    // ACT
    const { container } = renderizar()
    await screen.findByRole('textbox', { name: 'Nome da clínica' })

    // ASSERT — nenhum cabeçalho vazio, e o axe confirma
    const vazios = [...container.querySelectorAll('h1,h2,h3,h4')].filter(
      (h) => (h.textContent ?? '').trim() === '',
    )
    expect(vazios).toHaveLength(0)
    expect(await axe(container)).toHaveNoViolations()

    /*
     * E NENHUM subtítulo: sem bloco rotulado não há grupo de cima com que confundir, e um
     * cabeçalho aqui seria ruído cobrindo a aba inteira. Sem esta linha, fixar o rótulo em
     * `'Outros ajustes'` para sempre sobrevivia 37/37 (achado CR r4) — as asserções acima
     * cobrem só cabeçalho VAZIO, e um subtítulo redundante não é vazio.
     *
     * O ramo não é hipotético: é o rollout front-novo/API-antiga do describe acima. Sem
     * `blocos`, TODA chave é órfã e TODA aba cairia nele.
     */
    expect([...container.querySelectorAll('h3')]).toHaveLength(0)
  })

  it('deve MOSTRAR o subtítulo homônimo quando ele não é o primeiro bloco', async () => {
    /*
     * ARRANGE — a supressão só vale na primeira posição. Fora dela, suprimir ancoraria os
     * campos no `h3` do bloco anterior: a flag de aprovação dupla ficaria sob "Auditoria".
     * Sem esta célula, voltar à regra antiga (`!== grupoAtual.rotulo`) não derrubava nada.
     */
    mockConfiguracoes(
      [
        { chave: 'auditoria.retencao', rotulo: 'Retenção da auditoria (dias)', secao: 'seguranca', bloco: 'auditoria', tipo: 'int', valor: 90 },
        { chave: 'seguranca.aprovacao_dupla', rotulo: 'Exigir aprovação de dois administradores', secao: 'seguranca', bloco: 'seguranca', tipo: 'bool', valor: false },
      ],
      [],
      [{ secao: 'seguranca', rotulo: 'Segurança' }],
      [
        { bloco: 'auditoria', rotulo: 'Auditoria' },
        { bloco: 'seguranca', rotulo: 'Segurança' },
      ],
    )

    // ACT
    const { container } = renderizar()
    await screen.findByLabelText('Retenção da auditoria (dias)')

    // ASSERT — os dois subtítulos aparecem; sem o segundo, a flag de acesso se lê como auditoria
    const subtitulos = [...container.querySelectorAll('h3')].map((h) => h.textContent)
    expect(subtitulos).toEqual(['Auditoria', 'Segurança'])
  })

  it('deve ANCORAR o campo órfão em subtítulo próprio quando a aba já tem bloco rotulado', async () => {
    /*
     * ARRANGE — o TERCEIRO ramo, e o único que ficou sem guarda: `blocos.length > 0`, que dá ao
     * órfão o rótulo NEUTRO. A mutação `rotulo: ''` passava 32/32 (a11y BLOQ-GUARDA-01 =
     * CR-BLOQUEANTE-1), e o commit que se intitula "prova cada guarda no ramo que ela guarda"
     * é justamente o que deixou este de fora.
     *
     * Sem cabeçalho próprio o campo órfão não fica "sem grupo": fica parecendo do grupo DE
     * CIMA. Aqui, uma flag de governança de acesso lida como se fosse de notificação — quem
     * administra mexe na permissão achando que mexe em lembrete. Foi o achado a que os três
     * pareceres da rodada 2 chegaram por caminhos diferentes (design-qa A10, SEC-SDC-08,
     * a11y IMP-03).
     *
     * O bloco rotulado aqui NÃO é homônimo da aba, de propósito: assim o `h3` dele renderiza e
     * a âncora errada fica visível na asserção. No teste do bloco órfão o único bloco é
     * homônimo, o `h3` é suprimido, e a diferença entre "âncora própria" e "nenhuma âncora"
     * não aparece.
     */
    mockConfiguracoes(
      [
        { chave: 'notificacoes.a_partir_de', rotulo: 'Considerar notificações a partir de', secao: 'comunicacao', bloco: 'notificacoes', valor: '' },
        { chave: 'seguranca.aprovacao_dupla', rotulo: 'Exigir aprovação de dois administradores', secao: 'comunicacao', bloco: 'seguranca', tipo: 'bool', valor: false },
      ],
      [],
      [{ secao: 'comunicacao', rotulo: 'Comunicação' }],
      [{ bloco: 'notificacoes', rotulo: 'Notificações' }],
    )

    // ACT
    const { container } = renderizar()
    await screen.findByLabelText('Exigir aprovação de dois administradores')

    // ASSERT — o órfão ganha âncora própria em vez de herdar a do bloco anterior
    const subtitulos = [...container.querySelectorAll('h3')].map((h) => h.textContent)
    expect(subtitulos).toEqual(['Notificações', 'Outros ajustes'])
  })
})
