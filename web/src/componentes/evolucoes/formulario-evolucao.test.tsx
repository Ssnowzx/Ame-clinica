import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http as msw } from 'msw'
import { useEffect, useState } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'

import { DialogoDeEvolucao } from '@/componentes/evolucoes/formulario-evolucao'
import { ProvedorToast } from '@/componentes/ui/toast'
import { queryClient } from '@/lib/query-client'
import { useAuthStore } from '@/stores/auth-store'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'
import type { EvolucaoDetalhe } from '@/tipos'

/** O DETALHE (`GET /evolucoes/{id}`) — o servidor SEMPRE manda o booleano do ciclo. */
function evolucaoFicticia(sobrescritas: Partial<EvolucaoDetalhe> = {}): EvolucaoDetalhe {
  return {
    id: 42,
    updated_at: '2026-07-15T10:00:00.000000Z',
    atendimento_id: 3,
    profissional_id: 1,
    responsavel_tecnico_id: null,
    conteudo: 'Sessão fictícia: a criança respondeu bem às atividades propostas.',
    preenchida_em: '2026-07-11 10:00',
    em_ciclo_fechado: false,
    ...sobrescritas,
  } satisfies EvolucaoDetalhe
}

/** Harness com botão real: só REABRINDO o diálogo o bug do cache aparece. */
function Harness({ evolucaoId }: { evolucaoId?: number }) {
  const [aberto, setAberto] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setAberto(true)
        }}
      >
        Abrir evolução
      </button>
      <DialogoDeEvolucao
        aberto={aberto}
        aoMudarAberto={setAberto}
        destino={{ atendimentoId: 3 }}
        evolucaoId={evolucaoId}
        profissionalSugerido={1}
        nomeDaCrianca="Ana Fictícia"
      />
    </>
  )
}

function renderizar(evolucaoId?: number, vinculo: number | null = null) {
  useAuthStore.setState({
    usuario: {
      ...usuarioFicticio,
      // a persona sem vínculo destes testes é a administração AUTORIZADA — a
      // exceção de autoria (FA-04) exige a permissão dedicada para criar
      permissoes: ['evolucoes.ver', 'evolucoes.criar', 'evolucoes.editar', 'evolucoes.assinar_por_outro'],
      profissional_id: vinculo,
    },
    carregandoSessao: false,
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <ProvedorToast>
        <Harness evolucaoId={evolucaoId} />
      </ProvedorToast>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  queryClient.clear()
  servidor.use(
    msw.get('/api/profissionais', () =>
      HttpResponse.json([
        { id: 1, nome: 'Profissional Fictício', horarios: {}, obs: null, ativo: true, especialidades: [] },
      ]),
    ),
  )
})

describe('Evolução — reabrir o formulário não reverte o que foi escrito', () => {
  it('deve levar o texto NOVO no segundo salvamento seguido', async () => {
    // ARRANGE — O BUG QUE ESTA CHANGE NÃO PODE REPETIR.
    //
    // A fábrica de chaves arma a bomba: chave singular do detalhe nunca casa com a
    // invalidação plural da lista. Com cache quente, o `useState` (que inicializa UMA vez)
    // hidrata do dado VELHO na reabertura, e a SEGUNDA edição REVERTE a primeira.
    //
    // Nos tratamentos isso apagou a matrícula de um menor. AQUI o que se perderia é a
    // OBSERVAÇÃO CLÍNICA DE UMA CRIANÇA — num campo cujo valor a auditoria MASCARA (a perda
    // é detectável, não recuperável).
    //
    // Abrir uma vez só não pega nada: foi exatamente o que deixou o defeito passar na
    // rodada 1 dos tratamentos. Este teste REABRE.
    const usuario = userEvent.setup()
    const enviados: Array<Record<string, unknown>> = []
    let noServidor = evolucaoFicticia({ conteudo: 'Primeira versão.' })

    servidor.use(
      msw.get('/api/evolucoes/:id', () => HttpResponse.json(noServidor)),
      msw.put('/api/evolucoes/:id', async ({ request }) => {
        const corpo = (await request.json()) as Record<string, unknown>
        enviados.push(corpo)
        noServidor = { ...noServidor, ...(corpo as Partial<EvolucaoDetalhe>) }
        return HttpResponse.json(noServidor)
      }),
    )
    renderizar(42)

    // ACT 1 — abre, reescreve o conteúdo, salva
    await usuario.click(screen.getByRole('button', { name: 'Abrir evolução' }))
    let dialog = await screen.findByRole('alertdialog')
    let campo = await within(dialog).findByRole('textbox', { name: /Evolução da sessão/i })
    await usuario.clear(campo)
    await usuario.type(campo, 'Segunda versao.')
    await usuario.click(within(dialog).getByRole('button', { name: 'Salvar evolução' }))
    await waitFor(() => {
      expect(enviados).toHaveLength(1)
    })

    // ACT 2 — REABRE e acrescenta
    await usuario.click(screen.getByRole('button', { name: 'Abrir evolução' }))
    dialog = await screen.findByRole('alertdialog')
    await waitFor(() => {
      expect(within(dialog).getByRole('textbox', { name: /Evolução da sessão/i })).toHaveValue(
        'Segunda versao.',
      )
    })
    campo = within(dialog).getByRole('textbox', { name: /Evolução da sessão/i })
    await usuario.type(campo, ' Terceira.')
    await usuario.click(within(dialog).getByRole('button', { name: 'Salvar evolução' }))

    // ASSERT — o segundo PUT parte do que o primeiro gravou; nada foi revertido
    await waitFor(() => {
      expect(enviados).toHaveLength(2)
    })
    expect(enviados[1]).toMatchObject({ conteudo: 'Segunda versao. Terceira.' })
  })

  it('deve reabrir com o que OUTRA pessoa escreveu — nunca com o cache da abertura anterior', async () => {
    // ARRANGE — a camada que o teste acima NÃO prende.
    //
    // As chaves desta change nascem PREFIXO-CORRETAS, então `invalidateQueries(['evolucoes'])`
    // alcança `['evolucoes', 42]` e atualiza o cache do detalhe. Isso sozinho já faz o teste
    // anterior passar — inclusive SEM o `gcTime: 0`. Duas camadas, e um teste que só reprova
    // se as DUAS caírem é a armadilha que esta base já pagou caro (SEC-TR-18).
    //
    // Este cenário só a segunda camada cobre: a evolução muda no SERVIDOR sem que ESTE
    // cliente mute nada — outra profissional editou. Não há invalidação nenhuma para
    // atualizar o cache. Sem `gcTime: 0`, o formulário reabre com o texto VELHO, e salvar
    // apagaria o que a colega escreveu — num campo cujo valor a auditoria mascara.
    const usuario = userEvent.setup()
    let noServidor = evolucaoFicticia({ conteudo: 'O que eu escrevi.' })
    servidor.use(msw.get('/api/evolucoes/:id', () => HttpResponse.json(noServidor)))
    renderizar(42)

    // ACT 1 — abre e fecha, sem salvar nada (nenhuma invalidação acontece)
    await usuario.click(screen.getByRole('button', { name: 'Abrir evolução' }))
    let dialog = await screen.findByRole('alertdialog')
    await waitFor(() => {
      expect(within(dialog).getByRole('textbox', { name: /Evolução da sessão/i })).toHaveValue(
        'O que eu escrevi.',
      )
    })
    await usuario.click(within(dialog).getByRole('button', { name: 'Cancelar' }))

    // ...e OUTRA pessoa edita a evolução, noutra máquina
    noServidor = { ...noServidor, conteudo: 'O que a colega escreveu depois.' }

    // ACT 2 — reabre
    await usuario.click(screen.getByRole('button', { name: 'Abrir evolução' }))
    dialog = await screen.findByRole('alertdialog')

    // ASSERT — o formulário nasce com o texto DELA, não com o meu cache
    await waitFor(() => {
      expect(within(dialog).getByRole('textbox', { name: /Evolução da sessão/i })).toHaveValue(
        'O que a colega escreveu depois.',
      )
    })
  })

  it('deve ir ao SERVIDOR a cada abertura — o cache faria a auditoria mentir', async () => {
    // ARRANGE: cada GET do prontuário grava `consultou` no servidor (art. 11). Servido pelo
    // cache, o segundo profissional que abrisse NÃO apareceria na trilha — e a auditoria
    // estaria mentindo sobre quem leu o prontuário de um menor.
    const usuario = userEvent.setup()
    let leituras = 0
    servidor.use(
      msw.get('/api/evolucoes/:id', () => {
        leituras += 1
        return HttpResponse.json(evolucaoFicticia())
      }),
    )
    renderizar(42)

    // ACT — abre, fecha, abre
    await usuario.click(screen.getByRole('button', { name: 'Abrir evolução' }))
    await screen.findByRole('alertdialog')
    await usuario.click(screen.getByRole('button', { name: 'Cancelar' }))
    await usuario.click(screen.getByRole('button', { name: 'Abrir evolução' }))
    await screen.findByRole('alertdialog')

    // ASSERT — DUAS leituras, duas linhas na trilha
    await waitFor(() => {
      expect(leituras).toBe(2)
    })
  })
})

describe('Evolução — o diálogo termina o que começou', () => {
  it('deve FECHAR ao registrar — e não virar tela de edição debaixo do usuário', async () => {
    // ARRANGE — DEFEITO ENCONTRADO DIRIGINDO A APP REAL, com a suíte inteira verde.
    //
    // Registrar a evolução invalida o atendimento, e o `evolucao_id` APARECE enquanto o
    // diálogo ainda está aberto. Sem congelar o id na abertura, o "Registrar evolução"
    // virava "Evolução da sessão" NO MEIO do salvamento: a query do detalhe ligava, o
    // formulário desmontava para dar lugar ao Skeleton — e o React Query **descarta os
    // callbacks de um componente que desmontou**. O `aoFechar` nunca rodava.
    //
    // Para a recepção: clicou em "Registrar", o diálogo continuou lá. "Não aconteceu nada."
    //
    // A suíte não via porque assertava o PAYLOAD, não o FECHAMENTO. Teste de tela prova o
    // que o usuário VÊ — não só o que a rede leva.
    const usuario = userEvent.setup()
    servidor.use(
      msw.post('/api/atendimentos/:id/evolucao', () =>
        HttpResponse.json(evolucaoFicticia(), { status: 201 }),
      ),
    )

    // O pai reflete o `evolucao_id` que a invalidação traz — e ele chega COM O DIÁLOGO
    // ABERTO, que é exatamente a condição do defeito.
    function HarnessQueRecebeOId() {
      const [aberto, setAberto] = useState(false)
      const [idDaEvolucao, setIdDaEvolucao] = useState<number | undefined>(undefined)

      useEffect(() => {
        if (aberto) {
          setIdDaEvolucao(42)
        }
      }, [aberto])

      return (
        <>
          <button
            type="button"
            onClick={() => {
              setAberto(true)
            }}
          >
            Abrir evolução
          </button>
          <DialogoDeEvolucao
            aberto={aberto}
            aoMudarAberto={setAberto}
            destino={{ atendimentoId: 3 }}
            evolucaoId={idDaEvolucao}
            profissionalSugerido={1}
            nomeDaCrianca="Ana Fictícia"
          />
        </>
      )
    }

    useAuthStore.setState({
      usuario: { ...usuarioFicticio, permissoes: ['evolucoes.criar'], profissional_id: 1 },
      carregandoSessao: false,
    })
    render(
      <QueryClientProvider client={queryClient}>
        <ProvedorToast>
          <HarnessQueRecebeOId />
        </ProvedorToast>
      </QueryClientProvider>,
    )

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Abrir evolução' }))
    const dialog = await screen.findByRole('alertdialog')
    // o id do prontuário já chegou (o efeito acima) — e o diálogo NÃO pode ter se
    // transformado: ele continua sendo o de REGISTRAR, que foi o que o usuário abriu
    expect(within(dialog).getByRole('heading', { name: /Registrar evolução/ })).toBeInTheDocument()

    await usuario.type(
      within(dialog).getByRole('textbox', { name: /Evolução da sessão/i }),
      'Registro ficticio.',
    )
    await usuario.click(within(dialog).getByRole('button', { name: 'Registrar evolução' }))

    // ASSERT: o diálogo FECHA
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })
  })
})

describe('Evolução — o dado de saúde do menor não passeia pela tela', () => {
  it('deve proteger o conteúdo do corretor do navegador', async () => {
    // ARRANGE: o corretor "enhanced" do Chrome e o Editor do Edge ENVIAM o texto do campo
    // para os servidores do fornecedor. Dado de saúde de um MENOR não sai da clínica por um
    // default de navegador.
    const usuario = userEvent.setup()
    renderizar()

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Abrir evolução' }))
    const campo = await screen.findByRole('textbox', { name: /Evolução da sessão/i })

    // ASSERT
    expect(campo).toHaveAttribute('spellcheck', 'false')
    expect(campo).toHaveAttribute('autocomplete', 'off')
  })

  it('deve manter o conteúdo fora do título do diálogo', async () => {
    // ARRANGE: título, aba do navegador, toast e URL são superfícies de vazamento
    const usuario = userEvent.setup()
    servidor.use(msw.get('/api/evolucoes/:id', () => HttpResponse.json(evolucaoFicticia())))
    renderizar(42)

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Abrir evolução' }))
    const dialog = await screen.findByRole('alertdialog')

    // ASSERT: o título identifica a SESSÃO (o nome), nunca o que a evolução diz
    expect(within(dialog).getByRole('heading', { name: /Evolução da sessão — Ana Fictícia/ })).toBeInTheDocument()
    expect(document.title).not.toContain('respondeu bem')
    expect(window.location.href).not.toContain('respondeu')
  })

  it('deve mostrar a recusa do servidor sem ecoar o texto enviado', async () => {
    // ARRANGE: um erro que devolve o conteúdo enviado o reimprimiria na tela — e num toast,
    // que atravessa páginas
    const usuario = userEvent.setup()
    servidor.use(
      // a chave REAL com que o servidor recusa o prazo é `evolucao` (não `conteudo`): ela
      // não tem campo na tela, e por isso cai em `gerais` — que é onde o AvisoErro a mostra.
      // Mockar a chave errada testaria um caminho que a API nunca percorre.
      msw.post('/api/atendimentos/:id/evolucao', () =>
        HttpResponse.json(
          { errors: { evolucao: ['O prazo para registrar a evolução desta sessão venceu em 10/07/2026.'] } },
          { status: 422 },
        ),
      ),
    )
    renderizar()

    // ACT — sem vínculo, registrar passa pela exceção de autoria: motivo + ASSINAR
    await usuario.click(screen.getByRole('button', { name: 'Abrir evolução' }))
    const dialog = await screen.findByRole('alertdialog')
    await usuario.type(
      within(dialog).getByRole('textbox', { name: /Evolução da sessão/i }),
      'Texto clinico ficticio da sessao.',
    )
    await usuario.type(
      within(dialog).getByRole('textbox', { name: /Motivo de registrar em nome de outro/i }),
      'Registro administrativo.',
    )
    await usuario.click(within(dialog).getByRole('button', { name: 'Registrar evolução' }))
    const confirmacao = await screen.findByRole('alertdialog', { name: /Registrar em nome de/ })
    await usuario.type(
      within(confirmacao).getByRole('textbox', { name: /Digite ASSINAR/i }),
      'ASSINAR',
    )
    await usuario.click(within(confirmacao).getByRole('button', { name: 'Assinar em nome de outro' }))

    // ASSERT: a recusa é dita (também DENTRO da confirmação, onde a pessoa está)...
    const recusa = await within(dialog).findByText(/prazo para registrar a evolução/)
    expect(recusa).toBeInTheDocument()

    // ...a confirmação continua aberta (nada aconteceu em silêncio); fechada ela,
    // o formulário atrás volta à árvore de acessibilidade
    await usuario.click(within(confirmacao).getByRole('button', { name: 'Cancelar' }))
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog', { name: /Registrar em nome de/ })).not.toBeInTheDocument()
    })

    // ...e o texto digitado NÃO é ECOADO fora do campo. Ele CONTINUA no campo, de
    // propósito: perder o texto num erro empurraria a pessoa a colar no bloco de notas —
    // e aí o dado de saúde do menor sai do sistema pela via humana, que nenhuma cifra
    // alcança. O que não pode é o servidor devolver o conteúdo e a tela reimprimi-lo num
    // aviso ou num toast (que atravessa páginas).
    const textoDigitado = 'Texto clinico ficticio da sessao.'
    expect(within(dialog).getByRole('textbox', { name: /Evolução da sessão/i })).toHaveValue(textoDigitado)

    for (const aviso of screen.queryAllByRole('alert')) {
      expect(aviso.textContent ?? '').not.toContain(textoDigitado)
    }
    for (const aviso of screen.queryAllByRole('status')) {
      expect(aviso.textContent ?? '').not.toContain(textoDigitado)
    }
  })
})

describe('Evolução — a autoria vinculada não é uma escolha falsa', () => {
  it('deve fixar o autor quando o usuário TEM vínculo profissional', async () => {
    // ARRANGE: o servidor RECUSA evolução em nome de outro profissional para quem tem
    // vínculo. Oferecer a escolha seria prometer o que o servidor nega.
    const usuario = userEvent.setup()
    renderizar(undefined, 1)

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Abrir evolução' }))
    const dialog = await screen.findByRole('alertdialog')

    // ASSERT
    expect(within(dialog).queryByRole('combobox', { name: /Responsável/i })).not.toBeInTheDocument()
    expect(within(dialog).getByText(/registrada em seu nome/i)).toBeInTheDocument()
  })

  it('deve deixar escolher o autor quando NÃO há vínculo (recepção/administração)', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    renderizar(undefined, null)

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Abrir evolução' }))
    const dialog = await screen.findByRole('alertdialog')

    // ASSERT
    expect(await within(dialog).findByRole('combobox', { name: /Responsável/i })).toBeInTheDocument()
  })
})

describe('Evolução — a autoria do prontuário não troca de dono', () => {
  it('deve NOMEAR quem assinou, e NÃO reassinar ao editar', async () => {
    // ARRANGE — gate CR, BLOQUEANTE 2.
    //
    // O formulário mandava `profissional_id` SEMPRE, com o vínculo de QUEM ABRIU. Quem
    // editasse a evolução escrita por outra profissional a **assinava com o próprio nome**,
    // em silêncio — e a produção e a pendência de evolução migravam junto.
    //
    // E a tela nunca dizia de quem era o registro: mostrava só a data. Sem o NOME, ninguém
    // sabe que está mexendo em prontuário alheio — que era a compensação exigida pelo
    // gatilho EVO-LOSTUPDATE (o texto perdido não é recuperável nem pela trilha).
    const usuario = userEvent.setup()
    const enviados: Array<Record<string, unknown>> = []
    servidor.use(
      // a evolução foi escrita pela profissional 3
      msw.get('/api/evolucoes/:id', () =>
        HttpResponse.json(evolucaoFicticia({ profissional_id: 3, conteudo: 'Escrita pela colega.' })),
      ),
      msw.get('/api/profissionais', () =>
        HttpResponse.json([
          { id: 1, nome: 'Profissional Fictício Um', horarios: {}, obs: null, ativo: true, especialidades: [] },
          { id: 3, nome: 'Colega Fictícia Três', horarios: {}, obs: null, ativo: true, especialidades: [] },
        ]),
      ),
      msw.put('/api/evolucoes/:id', async ({ request }) => {
        enviados.push((await request.json()) as Record<string, unknown>)
        return HttpResponse.json(evolucaoFicticia())
      }),
    )
    // ...e quem abre é da coordenação, SEM vínculo — o único perfil que edita nota alheia
    renderizar(42, null)

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Abrir evolução' }))
    const dialog = await screen.findByRole('alertdialog')

    // ASSERT 1 — a tela DIZ de quem é o registro
    expect(await within(dialog).findByText(/Registrada por Colega Fictícia Três/)).toBeInTheDocument()

    // ACT — edita o texto e salva
    const campo = within(dialog).getByRole('textbox', { name: /Evolução da sessão/i })
    await usuario.type(campo, ' Ajuste.')
    await usuario.click(within(dialog).getByRole('button', { name: 'Salvar evolução' }))

    // ASSERT 2 — o PUT NÃO carrega autoria: no servidor o campo é `prohibited` na edição
    await waitFor(() => {
      expect(enviados).toHaveLength(1)
    })
    expect(enviados[0]).not.toHaveProperty('profissional_id')
    expect(enviados[0]).toMatchObject({ conteudo: 'Escrita pela colega. Ajuste.' })
  })

  it('deve abrir em LEITURA a evolução de OUTRA profissional para quem tem vínculo', async () => {
    // ARRANGE — re-review I-3. O servidor SEMPRE recusa esta edição (T-ate-06: vinculada só
    // assina em nome próprio, e a autoria é imutável) — então um "Salvar" aqui é um botão
    // que promete o que o servidor nega, com 422 garantido no fim do texto digitado.
    const usuario = userEvent.setup()
    servidor.use(
      msw.get('/api/evolucoes/:id', () =>
        HttpResponse.json(evolucaoFicticia({ profissional_id: 3, conteudo: 'Escrita pela colega.' })),
      ),
      msw.get('/api/profissionais', () =>
        HttpResponse.json([
          { id: 1, nome: 'Profissional Fictício Um', horarios: {}, obs: null, ativo: true, especialidades: [] },
          { id: 3, nome: 'Colega Fictícia Três', horarios: {}, obs: null, ativo: true, especialidades: [] },
        ]),
      ),
    )
    // quem abre TEM vínculo (profissional 1) e até tem `evolucoes.editar`
    renderizar(42, 1)

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Abrir evolução' }))
    const dialog = await screen.findByRole('alertdialog')

    // ASSERT — leitura: sem salvar, campo travado, e a tela diz de quem é o registro
    expect(await within(dialog).findByText(/Registrada por Colega Fictícia Três/)).toBeInTheDocument()
    expect(within(dialog).getByRole('textbox', { name: /Evolução da sessão/i })).toBeDisabled()
    expect(within(dialog).queryByRole('button', { name: 'Salvar evolução' })).not.toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Fechar' })).toBeInTheDocument()
  })

  it('deve abrir em LEITURA quem só tem evolucoes.ver — botão não promete o que o servidor nega', async () => {
    // ARRANGE: o PUT exige `evolucoes.editar`. Um textarea editável com botão de salvar
    // levaria a recepcionista direto a um 403.
    const usuario = userEvent.setup()
    useAuthStore.setState({
      usuario: { ...usuarioFicticio, permissoes: ['evolucoes.ver'], profissional_id: null },
      carregandoSessao: false,
    })
    servidor.use(msw.get('/api/evolucoes/:id', () => HttpResponse.json(evolucaoFicticia())))
    render(
      <QueryClientProvider client={queryClient}>
        <ProvedorToast>
          <Harness evolucaoId={42} />
        </ProvedorToast>
      </QueryClientProvider>,
    )

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Abrir evolução' }))
    const dialog = await screen.findByRole('alertdialog')

    // ASSERT
    expect(await within(dialog).findByRole('textbox', { name: /Evolução da sessão/i })).toBeDisabled()
    expect(within(dialog).queryByRole('button', { name: 'Salvar evolução' })).not.toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Fechar' })).toBeInTheDocument()
  })
})

describe('Evolução — responsável técnico é REGRA CONFIGURÁVEL, não código', () => {
  it('deve exigir o responsável técnico quando a clínica liga a configuração', async () => {
    // ARRANGE — gate CR, IMPORTANTE 1. Sem este campo, ligar a configuração tornava
    // IMPOSSÍVEL registrar qualquer evolução: o servidor recusava com 422 numa chave que a
    // tela não tinha, e o texto clínico ficava preso no formulário.
    const usuario = userEvent.setup()
    let corpo: Record<string, unknown> | null = null
    servidor.use(
      msw.get('/api/agenda/configuracoes', () =>
        HttpResponse.json({
          configuracoes: [{ chave: 'evolucoes.responsavel_tecnico_obrigatorio', valor: true }],
        }),
      ),
      msw.post('/api/atendimentos/:id/evolucao', async ({ request }) => {
        corpo = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(evolucaoFicticia(), { status: 201 })
      }),
    )
    renderizar(undefined, 1)

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Abrir evolução' }))
    const dialog = await screen.findByRole('alertdialog')
    const responsavel = await within(dialog).findByRole('combobox', { name: /Responsável técnico/i })
    await usuario.selectOptions(responsavel, '1')
    await usuario.type(within(dialog).getByRole('textbox', { name: /Evolução da sessão/i }), 'Texto ficticio.')
    await usuario.click(within(dialog).getByRole('button', { name: 'Registrar evolução' }))

    // ASSERT — o responsável VAI no payload
    await waitFor(() => {
      expect(corpo).not.toBeNull()
    })
    expect(corpo).toMatchObject({ responsavel_tecnico_id: 1 })
  })

  it('deve NASCER sem valor e dizer isso — o select não finge estar preenchido', async () => {
    // ARRANGE — achado dirigindo a app real (re-review rodada 2): sem a opção-placeholder,
    // o select nativo EXIBIA a primeira profissional enquanto o estado era vazio — o
    // formulário mandava nada, o servidor recusava, e o usuário via um campo "preenchido"
    // recusado como ausente.
    const usuario = userEvent.setup()
    servidor.use(
      msw.get('/api/agenda/configuracoes', () =>
        HttpResponse.json({
          configuracoes: [{ chave: 'evolucoes.responsavel_tecnico_obrigatorio', valor: true }],
        }),
      ),
    )
    renderizar(undefined, 1)

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Abrir evolução' }))
    const dialog = await screen.findByRole('alertdialog')
    const responsavel = await within(dialog).findByRole('combobox', { name: /Responsável técnico/i })

    // ASSERT — o que a tela MOSTRA é o que o formulário MANDA
    expect(responsavel).toHaveValue('')
    expect(
      within(dialog).getByRole('option', { name: 'Selecione o responsável técnico' }),
    ).toBeInTheDocument()
  })

  it('deve deixar PREENCHER a lacuna do responsável ao editar evolução antiga', async () => {
    // ARRANGE — re-review I-2. Evolução criada antes de a clínica ligar a exigência não
    // tem responsável; o servidor valida o ESTADO FINAL e recusava a edição do conteúdo com
    // 422 num campo que o modo edição não renderizava — beco sem saída até desligarem a
    // configuração.
    const usuario = userEvent.setup()
    const enviados: Array<Record<string, unknown>> = []
    servidor.use(
      msw.get('/api/agenda/configuracoes', () =>
        HttpResponse.json({
          configuracoes: [{ chave: 'evolucoes.responsavel_tecnico_obrigatorio', valor: true }],
        }),
      ),
      msw.get('/api/evolucoes/:id', () =>
        HttpResponse.json(evolucaoFicticia({ responsavel_tecnico_id: null })),
      ),
      msw.put('/api/evolucoes/:id', async ({ request }) => {
        enviados.push((await request.json()) as Record<string, unknown>)
        return HttpResponse.json(evolucaoFicticia({ responsavel_tecnico_id: 1 }))
      }),
    )
    renderizar(42, null)

    // ACT — o select da lacuna aparece na edição; preenche e salva
    await usuario.click(screen.getByRole('button', { name: 'Abrir evolução' }))
    const dialog = await screen.findByRole('alertdialog')
    const responsavel = await within(dialog).findByRole('combobox', { name: /Responsável técnico/i })
    await usuario.selectOptions(responsavel, '1')
    await usuario.click(within(dialog).getByRole('button', { name: 'Salvar evolução' }))

    // ASSERT — a lacuna vai no PUT; a autoria continua fora dele
    await waitFor(() => {
      expect(enviados).toHaveLength(1)
    })
    expect(enviados[0]).toMatchObject({ responsavel_tecnico_id: 1 })
    expect(enviados[0]).not.toHaveProperty('profissional_id')
  })

  it('deve NÃO oferecer a troca de responsável já assinado ao editar', async () => {
    // ARRANGE — a lacuna se preenche; assinatura não se troca (re-review I-2, limite)
    const usuario = userEvent.setup()
    servidor.use(
      msw.get('/api/agenda/configuracoes', () =>
        HttpResponse.json({
          configuracoes: [{ chave: 'evolucoes.responsavel_tecnico_obrigatorio', valor: true }],
        }),
      ),
      msw.get('/api/evolucoes/:id', () =>
        HttpResponse.json(evolucaoFicticia({ responsavel_tecnico_id: 1 })),
      ),
    )
    renderizar(42, null)

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Abrir evolução' }))
    const dialog = await screen.findByRole('alertdialog')
    await within(dialog).findByRole('textbox', { name: /Evolução da sessão/i })

    // ASSERT
    expect(within(dialog).queryByRole('combobox', { name: /Responsável técnico/i })).not.toBeInTheDocument()
  })

  it('deve NÃO pedir responsável técnico com a configuração desligada (o default)', async () => {
    // ARRANGE: fricção onde o risco não está vira ruído
    const usuario = userEvent.setup()
    servidor.use(
      msw.get('/api/agenda/configuracoes', () => HttpResponse.json({ configuracoes: [] })),
    )
    renderizar(undefined, 1)

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Abrir evolução' }))
    const dialog = await screen.findByRole('alertdialog')
    await within(dialog).findByRole('textbox', { name: /Evolução da sessão/i })

    // ASSERT
    expect(within(dialog).queryByRole('combobox', { name: /Responsável técnico/i })).not.toBeInTheDocument()
  })
})

describe('Evolução — exceção de autoria (assinar em nome de outro, FA-04)', () => {
  it('deve exigir confirmação DIGITADA + motivo ao registrar em nome de outro — e levar o motivo no payload', async () => {
    // ARRANGE — a palavra digitada quebra o automatismo do clique (padrão do
    // CORRIGIR); o motivo vai ao servidor e fica na trilha
    const usuario = userEvent.setup()
    let corpo: Record<string, unknown> | null = null
    servidor.use(
      msw.post('/api/atendimentos/:id/evolucao', async ({ request }) => {
        corpo = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(evolucaoFicticia(), { status: 201 })
      }),
    )
    renderizar()

    // ACT — preencher o formulário e tentar registrar
    await usuario.click(screen.getByRole('button', { name: 'Abrir evolução' }))
    const dialog = await screen.findByRole('alertdialog')
    await usuario.type(
      within(dialog).getByRole('textbox', { name: /Evolução da sessão/i }),
      'Registro ficticio da sessao.',
    )
    await usuario.type(
      within(dialog).getByRole('textbox', { name: /Motivo de registrar em nome de outro/i }),
      'Profissional sem acesso ao sistema hoje.',
    )
    await usuario.click(within(dialog).getByRole('button', { name: 'Registrar evolução' }))

    // ASSERT — nada foi ao servidor ainda: a confirmação digitada vem antes
    const confirmacao = await screen.findByRole('alertdialog', { name: /Registrar em nome de Profissional Fictício/ })
    expect(corpo).toBeNull()

    // o botão só arma com a palavra exata
    const confirmar = within(confirmacao).getByRole('button', { name: 'Assinar em nome de outro' })
    // `aria-disabled` (não `disabled`): a ação primária bloqueada continua na sequência
    // de Tab para poder dizer o que falta — contrato do DS (IMP-4)
    expect(confirmar).toHaveAttribute('aria-disabled', 'true')
    await usuario.type(within(confirmacao).getByRole('textbox', { name: /Digite ASSINAR/i }), 'ASSINAR')
    await usuario.click(confirmar)

    // o payload leva autor + motivo; os diálogos fecham
    await waitFor(() => {
      expect(corpo).toMatchObject({
        profissional_id: 1,
        motivo_assinatura: 'Profissional sem acesso ao sistema hoje.',
      })
    })
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })
  })

  it('deve manter o vinculado FORA da exceção: sem campo de motivo, sem diálogo, payload limpo', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    let corpo: Record<string, unknown> | null = null
    servidor.use(
      msw.post('/api/atendimentos/:id/evolucao', async ({ request }) => {
        corpo = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(evolucaoFicticia(), { status: 201 })
      }),
    )
    renderizar(undefined, 1)

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Abrir evolução' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).queryByRole('textbox', { name: /Motivo de registrar/i })).not.toBeInTheDocument()
    await usuario.type(
      within(dialog).getByRole('textbox', { name: /Evolução da sessão/i }),
      'Registro ficticio em nome proprio.',
    )
    await usuario.click(within(dialog).getByRole('button', { name: 'Registrar evolução' }))

    // ASSERT — direto ao servidor (sem confirmação de exceção), sem a chave do motivo
    await waitFor(() => {
      expect(corpo).not.toBeNull()
    })
    expect(corpo).not.toHaveProperty('motivo_assinatura')
    expect(screen.queryByRole('alertdialog', { name: /Registrar em nome de/ })).not.toBeInTheDocument()
  })

  it('deve ficar FAIL-CLOSED sem a permissão de exceção: aviso no lugar do formulário', async () => {
    // ARRANGE — sem vínculo e SEM evolucoes.assinar_por_outro, o formulário não
    // promete o que o servidor nega com 403
    const usuario = userEvent.setup()
    useAuthStore.setState({
      usuario: {
        ...usuarioFicticio,
        permissoes: ['evolucoes.ver', 'evolucoes.criar', 'evolucoes.editar'],
        profissional_id: null,
      },
      carregandoSessao: false,
    })
    render(
      <QueryClientProvider client={queryClient}>
        <ProvedorToast>
          <Harness />
        </ProvedorToast>
      </QueryClientProvider>,
    )

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Abrir evolução' }))
    const dialog = await screen.findByRole('alertdialog')

    // ASSERT
    await within(dialog).findByText(/exige a liberação do administrador/)
    expect(within(dialog).queryByRole('textbox', { name: /Evolução da sessão/i })).not.toBeInTheDocument()
  })

  it('deve proteger o motivo do corretor do navegador — e nascer limpo ao reabrir', async () => {
    // ARRANGE — mesmo motivo do campo de conteúdo: o corretor "enhanced" envia o
    // texto ao fornecedor; e reabrir NUNCA nasce pré-preenchido
    const usuario = userEvent.setup()
    renderizar()

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Abrir evolução' }))
    let dialog = await screen.findByRole('alertdialog')
    const motivo = within(dialog).getByRole('textbox', { name: /Motivo de registrar em nome de outro/i })

    // ASSERT — atributos de proteção
    expect(motivo).toHaveAttribute('spellcheck', 'false')
    expect(motivo).toHaveAttribute('autocomplete', 'off')

    // fechar com texto digitado e reabrir: o campo nasce vazio (o formulário desmonta)
    await usuario.type(motivo, 'Motivo que nao pode sobreviver.')
    await usuario.click(within(dialog).getByRole('button', { name: 'Cancelar' }))
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })
    await usuario.click(screen.getByRole('button', { name: 'Abrir evolução' }))
    dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByRole('textbox', { name: /Motivo de registrar em nome de outro/i })).toHaveValue('')
  })
})
