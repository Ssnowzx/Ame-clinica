import { HttpResponse, http as msw } from 'msw'

import type { ChaveDaRegua, Paciente, PacienteDaLista, Profissional, ReguaDoCadastro } from '@/tipos'

/** Fixtures dos cadastros — 100% fictícias (LGPD: nunca dado que possa ser real). */

export function pacienteDaListaFicticio(sobrescritas: Partial<PacienteDaLista> = {}): PacienteDaLista {
  return {
    id: 1,
    nome: 'Paciente Fictício Andréa',
    nome_social: null,
    nascimento: '2018-03-12',
    necessidade: 'sem',
    ativo: true,
    cadastro_incompleto: false,
    ...sobrescritas,
  }
}

export function pacienteFicticio(sobrescritas: Partial<Paciente> = {}): Paciente {
  return {
    ...pacienteDaListaFicticio(),
    updated_at: '2026-07-15T10:00:00.000000Z',
    sexo: 'feminino',
    cpf: null,
    // convênio VIGENTE: nasce VAZIO de propósito — criança particular é o caso mais
    // comum, e teste que exercita convênio declara o dele. Fixture que já vem preenchida
    // faz passar teste que nunca provou nada sobre o campo.
    convenio_id: null,
    convenio: null,
    plano: null,
    carteirinha: null,
    carteirinha_validade: null,
    responsaveis_json: [{ nome: 'Responsável Fictícia', parentesco: 'Mãe', telefone: null, email: null }],
    contatos_json: [{ tipo: 'celular', valor: '(00) 00000-0000', obs: null }],
    endereco_json: null,
    consentimentos_json: [],
    indicacao: null,
    estado_civil: null,
    profissao: null,
    obs: null,
    ...sobrescritas,
  }
}

export function profissionalFicticio(sobrescritas: Partial<Profissional> = {}): Profissional {
  return {
    id: 1,
    updated_at: '2026-07-15T10:00:00.000000Z',
    nome: 'Profissional Fictício A',
    foto_versao: null,
    conselho: 'CRP',
    uf_conselho: 'SP',
    num_conselho: '000000',
    cbos_id: null,
    obs: null,
    ativo: true,
    // no formato da produção: a API sempre manda os dois desde as changes que os criaram
    atendimentos_simultaneos: 1,
    mensagens_automaticas: true,
    horarios: { '1': [{ inicio: '08:00', fim: '12:00' }] },
    especialidades: [{ id: 1, nome: 'Fonoaudiologia' }],
    ...sobrescritas,
  }
}

/** Página do Laravel. */
function paginaDe(pacientes: PacienteDaLista[], pagina = 1, porPagina = 50) {
  return {
    data: pacientes,
    current_page: pagina,
    last_page: Math.max(1, Math.ceil(pacientes.length / porPagina)),
    per_page: porPagina,
    total: pacientes.length,
  }
}

/**
 * A RÉGUA DO CADASTRO no seu estado PADRÃO — espelho do `CatalogoCamposCadastro` do
 * servidor (change campos-do-cadastro-configuraveis).
 *
 * Existe para que os testes de formulário rodem contra a régua real em vez de contra a
 * ausência dela: sem este handler, todo campo sairia sem marca de obrigatório e as
 * asserções passariam a provar o contrário do que o produto faz.
 *
 * `sobrescritas` permite ao teste esconder ou exigir um campo sem montar a régua inteira.
 */
export function reguaFicticia(
  sobrescritas: Record<string, { obrigatorio?: boolean; desabilitado?: boolean; online?: boolean }> = {},
): ReguaDoCadastro {
  // ESPELHA o catálogo do servidor (`CatalogoCamposCadastro::BASE`), inclusive travas e a chave
  // `online`. Fixture que mente é barata e cara ao mesmo tempo: um teste de tela que passa contra
  // um servidor que não pode existir não prova nada sobre o servidor que existe — foi por isso
  // que a suíte já ganhou uma guarda para o catálogo de configurações.
  const base: [string, string, string, boolean, boolean, boolean, ChaveDaRegua[]][] = [
    ['nome', 'Nome', 'identificacao', true, false, true, ['obrigatorio', 'desabilitado', 'online']],
    ['nome_social', 'Nome social', 'identificacao', false, false, false, []],
    // `nascimento` é travado nas TRÊS chaves: é a data que diz se o paciente é menor, e a
    // exigência legal de responsável se avalia por ela — inclusive no formulário público
    ['nascimento', 'Nascimento', 'identificacao', true, false, true, ['obrigatorio', 'desabilitado', 'online']],
    ['sexo', 'Sexo', 'identificacao', true, false, true, []],
    ['cpf', 'CPF', 'identificacao', false, false, true, ['desabilitado']],
    // convênio VIGENTE (change convenio-no-cadastro-do-paciente): os quatro nascem opcionais —
    // a clínica que só atende particular esconde a seção inteira. `online` é travado em `false`:
    // o formulário público não mostra a lista de convênios da clínica
    ['convenio_id', 'Convênio', 'convenio', false, false, false, ['online']],
    ['plano', 'Plano', 'convenio', false, false, false, ['online']],
    ['carteirinha', 'Carteirinha', 'convenio', false, false, false, ['online']],
    ['carteirinha_validade', 'Validade da carteirinha', 'convenio', false, false, false, ['online']],
    ['necessidade', 'Necessidade', 'identificacao', true, false, false, []],
    ['indicacao', 'Indicação', 'identificacao', false, false, true, []],
    ['responsaveis_json', 'Responsáveis', 'responsaveis', false, false, true, ['desabilitado', 'online']],
    ['contatos_json', 'Contatos', 'contatos', false, false, true, []],
    ['endereco_cep', 'CEP', 'endereco', false, false, true, []],
    ['endereco_logradouro', 'Logradouro', 'endereco', false, false, true, []],
    ['endereco_numero', 'Número', 'endereco', false, false, false, []],
    ['endereco_complemento', 'Complemento', 'endereco', false, false, false, []],
    ['endereco_bairro', 'Bairro', 'endereco', false, false, false, []],
    ['endereco_cidade', 'Cidade', 'endereco', false, false, false, []],
    ['endereco_uf', 'UF', 'endereco', false, false, false, []],
    ['estado_civil', 'Estado civil', 'outros', false, false, false, []],
    ['profissao', 'Profissão', 'outros', false, false, true, []],
    ['obs', 'Observação', 'outros', false, false, true, []],
  ]

  /*
   * Os tetos ESPELHAM `FormaDoCampo::regras()` do servidor, pela mesma razão que o resto desta
   * fixture espelha o catálogo: fixture que mente faz passar teste de tela contra um servidor
   * que não pode existir. Campo sem teto de TEXTO — data, lista fechada, número — e campo-lista
   * (cujo `max` conta itens) vêm com `null`.
   */
  const tetos: Record<string, number> = {
    nome: 255,
    nome_social: 255,
    indicacao: 255,
    profissao: 255,
    plano: 255,
    carteirinha: 60,
    estado_civil: 20,
    obs: 2000,
    endereco_cep: 9,
    endereco_logradouro: 500,
    endereco_numero: 20,
    endereco_complemento: 255,
    endereco_bairro: 150,
    endereco_cidade: 150,
  }

  const tetosDosItens: Record<string, Record<string, number>> = {
    responsaveis_json: { nome: 255, parentesco: 60, telefone: 20, email: 255 },
    contatos_json: { valor: 255, obs: 255 },
  }

  return {
    formulario: 'paciente',
    secoes: [
      { secao: 'identificacao', rotulo: 'Identificação' },
      { secao: 'convenio', rotulo: 'Convênio' },
      { secao: 'responsaveis', rotulo: 'Responsáveis' },
      { secao: 'contatos', rotulo: 'Contatos' },
      { secao: 'endereco', rotulo: 'Endereço' },
      { secao: 'outros', rotulo: 'Outros' },
    ],
    campos: base.map(([campo, rotulo, secao, obrigatorio, desabilitado, online, travas]) => {
      const escondido = sobrescritas[campo]?.desabilitado ?? desabilitado
      return {
        campo,
        rotulo,
        secao,
        lista: campo.endsWith('_json'),
        obrigatorio: escondido ? false : (sobrescritas[campo]?.obrigatorio ?? obrigatorio),
        desabilitado: escondido,
        // o servidor resolve a precedência antes de servir: campo escondido nunca chega à
        // tela com `online` verdadeiro
        online: escondido ? false : (sobrescritas[campo]?.online ?? online),
        tamanho: tetos[campo] ?? null,
        tamanhos_dos_itens: tetosDosItens[campo] ?? {},
        travas,
        motivo_trava: travas.length > 0 ? 'Motivo fictício da trava.' : null,
      }
    }),
  }
}

export function handlersDeCadastros(
  pacientes: PacienteDaLista[] = [pacienteDaListaFicticio()],
  profissionais: Profissional[] = [profissionalFicticio()],
) {
  return [
    msw.get('/sanctum/csrf-cookie', () => new HttpResponse(null, { status: 204 })),
    msw.get('/api/notificacoes', () => HttpResponse.json({})),
    // a régua do cadastro no padrão; o teste que precisa de outra passa handlersExtras
    msw.get('/api/campos-cadastro/:formulario', () => HttpResponse.json(reguaFicticia())),
    // o catálogo de convênios da clínica, para a seção de convênio do cadastro
    msw.get('/api/convenios', () =>
      HttpResponse.json([
        { id: 7, nome: 'Convênio Fictício A', particular: false, ativo: true },
        { id: 8, nome: 'Particular Fictício', particular: true, ativo: true },
        { id: 9, nome: 'Convênio Fictício Desativado', particular: false, ativo: false },
      ]),
    ),
    msw.get('/api/pacientes', ({ request }) => {
      const url = new URL(request.url)
      const busca = url.searchParams.get('busca')
      const filtrados =
        busca !== null && busca !== ''
          ? pacientes.filter((paciente) => paciente.nome.toLowerCase().includes(busca.toLowerCase()))
          : pacientes
      return HttpResponse.json(paginaDe(filtrados, Number(url.searchParams.get('page') ?? 1)))
    }),
    msw.get('/api/pacientes/:id', ({ params }) =>
      HttpResponse.json(pacienteFicticio({ id: Number(params.id) })),
    ),
    msw.post('/api/pacientes', () => HttpResponse.json(pacienteFicticio(), { status: 201 })),
    msw.put('/api/pacientes/:id', () => HttpResponse.json(pacienteFicticio())),
    msw.get('/api/profissionais', () => HttpResponse.json(profissionais)),
    msw.post('/api/profissionais', () => HttpResponse.json(profissionalFicticio(), { status: 201 })),
    msw.put('/api/profissionais/:id', () => HttpResponse.json(profissionalFicticio())),
    msw.delete('/api/profissionais/:id', () => new HttpResponse(null, { status: 204 })),
    msw.get('/api/especialidades', () =>
      HttpResponse.json([
        { id: 1, nome: 'Fonoaudiologia', cor: '#A85550', tempo_sessao: 40 },
        { id: 2, nome: 'Psicologia', cor: '#A25E2B', tempo_sessao: 40 },
      ]),
    ),
    msw.get('/api/cbos', () => HttpResponse.json([{ id: 1, codigo: '251510', nome: 'Psicólogo clínico' }])),
  ]
}
