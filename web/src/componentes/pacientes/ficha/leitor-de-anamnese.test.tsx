import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http as msw } from 'msw'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { LeitorDeAnamnese } from '@/componentes/pacientes/ficha/leitor-de-anamnese'
import { ProvedorToast } from '@/componentes/ui/toast'
import { queryClient } from '@/lib/query-client'
import { useAuthStore } from '@/stores/auth-store'
import { anamneseDaListaFicticia, anamneseFicticia, modeloFicticio } from '@/test/dados-anamnese'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'
import type { AnamneseDaLista } from '@/tipos'

const TUDO = ['anamneses.ver', 'anamneses.editar', 'anamnese_modelos.ver']

function renderizar(anamnese: AnamneseDaLista = anamneseDaListaFicticia(), permissoes: string[] = TUDO) {
  const aoFechar = vi.fn()
  useAuthStore.setState({ usuario: { ...usuarioFicticio, permissoes }, carregandoSessao: false })

  const utils = render(
    <QueryClientProvider client={queryClient}>
      <ProvedorToast>
        <LeitorDeAnamnese anamnese={anamnese} aberto aoFechar={aoFechar} />
      </ProvedorToast>
    </QueryClientProvider>,
  )
  return { ...utils, aoFechar }
}

beforeEach(() => {
  queryClient.clear()
})

describe('Leitor de anamnese — leitura auditada, por rótulo, escapada (art. 11)', () => {
  it('deve buscar o detalhe UMA vez ao abrir e exibir as respostas por rótulo', async () => {
    // ARRANGE
    let leituras = 0
    servidor.use(
      msw.get('/api/anamneses/:id', () => {
        leituras += 1
        return HttpResponse.json(anamneseFicticia())
      }),
      msw.get('/api/anamnese-modelos', () => HttpResponse.json([modeloFicticio()])),
    )

    // ACT
    renderizar()

    // ASSERT — rótulo do modelo + valor da resposta; UMA leitura auditada
    expect(await screen.findByText('Queixa principal')).toBeInTheDocument()
    expect(screen.getByText('Fala fictícia da triagem')).toBeInTheDocument()
    await waitFor(() => expect(leituras).toBe(1))
  })

  it('deve escapar HTML da resposta, do rótulo e do título — texto literal, nunca markup', async () => {
    // ARRANGE — respostas E campos_json.rotulo E modelo.titulo são dado da clínica
    const modelo = modeloFicticio({
      campos_json: [{ id: 'queixa', tipo: 'texto', rotulo: '<b>Queixa</b>', obrigatorio: false }],
    })
    servidor.use(
      msw.get('/api/anamneses/:id', () =>
        HttpResponse.json(anamneseFicticia({ respostas_json: { queixa: '<script>alert(1)</script>' } })),
      ),
      msw.get('/api/anamnese-modelos', () => HttpResponse.json([modelo])),
    )

    // ACT
    renderizar(anamneseDaListaFicticia({ modelo: { id: 1, titulo: '<i>Título Fictício</i>' } }))

    // ASSERT — tudo sai como texto; nenhum elemento nasceu dos campos da clínica
    expect(await screen.findByText('<script>alert(1)</script>')).toBeInTheDocument()
    expect(screen.getByText('<b>Queixa</b>')).toBeInTheDocument()
    expect(screen.getByText('<i>Título Fictício</i>')).toBeInTheDocument()
    expect(document.querySelector('script')).toBeNull()
    expect(document.querySelector('b')).toBeNull()
    expect(document.querySelector('i')).toBeNull()
  })

  it('deve renderizar resposta ÓRFÃ sob id cru com aviso, NUNCA ocultada (SEC-ANM-05)', async () => {
    // ARRANGE — o modelo perdeu o campo `extra_removido`, mas a anamnese tem resposta dele
    const modelo = modeloFicticio({
      campos_json: [{ id: 'queixa', tipo: 'texto', rotulo: 'Queixa principal', obrigatorio: false }],
    })
    servidor.use(
      msw.get('/api/anamneses/:id', () =>
        HttpResponse.json(
          anamneseFicticia({ respostas_json: { queixa: 'Fala fictícia', extra_removido: 'resposta órfã fictícia' } }),
        ),
      ),
      msw.get('/api/anamnese-modelos', () => HttpResponse.json([modelo])),
    )

    // ACT
    renderizar()

    // ASSERT — id cru + aviso + valor, tudo visível
    expect(await screen.findByText('extra_removido')).toBeInTheDocument()
    expect(screen.getByText(/campo removido do modelo/)).toBeInTheDocument()
    expect(screen.getByText('resposta órfã fictícia')).toBeInTheDocument()
  })

  it('deve DEGRADAR para id cru sem anamnese_modelos.ver, sem pedir os modelos', async () => {
    // ARRANGE — sem a permissão de modelos, a leitura por rótulo degrada; as respostas seguem visíveis
    let modelosPedidos = 0
    servidor.use(
      msw.get('/api/anamneses/:id', () =>
        HttpResponse.json(anamneseFicticia({ respostas_json: { queixa: 'Fala fictícia degradada' } })),
      ),
      msw.get('/api/anamnese-modelos', () => {
        modelosPedidos += 1
        return HttpResponse.json([modeloFicticio()])
      }),
    )

    // ACT
    renderizar(anamneseDaListaFicticia(), ['anamneses.ver'])

    // ASSERT
    expect(await screen.findByText(/Modelos indisponíveis/)).toBeInTheDocument()
    expect(screen.getByText('queixa')).toBeInTheDocument() // id cru como rótulo
    expect(screen.getByText('Fala fictícia degradada')).toBeInTheDocument()
    expect(modelosPedidos).toBe(0) // a query de modelos nem dispara sem permissão
  })

  it('deve mostrar ERRO com repetir e NÃO re-tentar sozinho (retry:false)', async () => {
    // ARRANGE
    let leituras = 0
    servidor.use(
      msw.get('/api/anamneses/:id', () => {
        leituras += 1
        return new HttpResponse(null, { status: 500 })
      }),
      msw.get('/api/anamnese-modelos', () => HttpResponse.json([modeloFicticio()])),
    )

    // ACT
    renderizar()

    // ASSERT — erro específico; uma única tentativa (leitura de prontuário não re-dispara sozinha)
    expect(await screen.findByText(/Não foi possível abrir esta anamnese/)).toBeInTheDocument()
    await waitFor(() => expect(leituras).toBe(1))
  })
})

describe('Leitor de anamnese — editar hidrata de PROP e envia só respostas_json', () => {
  const modeloSoQueixa = modeloFicticio({
    campos_json: [{ id: 'queixa', tipo: 'texto', rotulo: 'Queixa principal', obrigatorio: true }],
  })

  it('deve oferecer Editar (com anamneses.editar) e hidratar o form do detalhe já carregado', async () => {
    // ARRANGE — hidratar de PROP: nenhum segundo GET de detalhe
    const usuario = userEvent.setup()
    let leituras = 0
    servidor.use(
      msw.get('/api/anamneses/:id', () => {
        leituras += 1
        return HttpResponse.json(anamneseFicticia({ respostas_json: { queixa: 'Fala fictícia da triagem' } }))
      }),
      msw.get('/api/anamnese-modelos', () => HttpResponse.json([modeloSoQueixa])),
    )
    renderizar()
    await screen.findByText('Queixa principal')

    // ACT
    await usuario.click(screen.getByRole('button', { name: /Editar/ }))

    // ASSERT — o campo nasce com o valor do detalhe; sem segunda leitura auditada
    const campo = await screen.findByLabelText(/Queixa principal/)
    expect(campo).toHaveValue('Fala fictícia da triagem')
    await waitFor(() => expect(leituras).toBe(1))
  })

  it('deve mover o foco ao 1º controle ao editar e devolvê-lo ao "Editar" ao cancelar (2.4.3)', async () => {
    // ARRANGE — a troca no MESMO diálogo não pode desmontar o botão focado sem levar o foco junto
    const usuario = userEvent.setup()
    servidor.use(
      msw.get('/api/anamneses/:id', () =>
        HttpResponse.json(anamneseFicticia({ respostas_json: { queixa: 'Fala fictícia da triagem' } })),
      ),
      msw.get('/api/anamnese-modelos', () => HttpResponse.json([modeloSoQueixa])),
    )
    renderizar()
    await screen.findByText('Queixa principal')

    // ACT 1 — entra em edição
    await usuario.click(screen.getByRole('button', { name: /Editar/ }))

    // ASSERT 1 — foco no 1º controle do formulário
    const campo = await screen.findByLabelText(/Queixa principal/)
    await waitFor(() => expect(campo).toHaveFocus())

    // ACT 2 — cancela
    await usuario.click(screen.getByRole('button', { name: 'Cancelar' }))

    // ASSERT 2 — foco de volta ao "Editar"
    await waitFor(() => expect(screen.getByRole('button', { name: /Editar/ })).toHaveFocus())
  })

  it('deve NÃO oferecer Editar sem anamneses.editar', async () => {
    // ARRANGE
    servidor.use(
      msw.get('/api/anamneses/:id', () => HttpResponse.json(anamneseFicticia())),
      msw.get('/api/anamnese-modelos', () => HttpResponse.json([modeloFicticio()])),
    )

    // ACT
    renderizar(anamneseDaListaFicticia(), ['anamneses.ver', 'anamnese_modelos.ver'])

    // ASSERT
    await screen.findByText('Queixa principal')
    expect(screen.queryByRole('button', { name: /Editar/ })).not.toBeInTheDocument()
  })

  it('deve enviar SÓ respostas_json no PUT (sem modelo_id) e fechar (SEC-ANM-02/09)', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    let putBody: Record<string, unknown> | null = null
    servidor.use(
      msw.get('/api/anamneses/:id', () =>
        HttpResponse.json(anamneseFicticia({ respostas_json: { queixa: 'Fala fictícia da triagem' } })),
      ),
      msw.get('/api/anamnese-modelos', () => HttpResponse.json([modeloSoQueixa])),
      msw.put('/api/anamneses/:id', async ({ request }) => {
        putBody = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(anamneseFicticia())
      }),
    )
    const { aoFechar } = renderizar()

    // ACT — edita e salva
    await usuario.click(await screen.findByRole('button', { name: /Editar/ }))
    const campo = await screen.findByLabelText(/Queixa principal/)
    await usuario.clear(campo)
    await usuario.type(campo, 'Editado fictício')
    await usuario.click(screen.getByRole('button', { name: 'Salvar alterações' }))

    // ASSERT — payload é só respostas_json (o modelo é fixo); e o diálogo fecha
    await waitFor(() => expect(putBody).not.toBeNull())
    expect(putBody).toEqual({ respostas_json: { queixa: 'Editado fictício' } })
    expect(putBody).not.toHaveProperty('modelo_id')
    await waitFor(() => expect(aoFechar).toHaveBeenCalled())
  })
})

/**
 * GUARDA MECÂNICA (SEC-ANM-06) — nenhuma superfície da anamnese imprime HTML de dado
 * da clínica. A needle é o vetor que o parecer nomeia; a guarda ENUMERA os arquivos
 * reais e a reprova por varredura de fonte. Introduzi-la (erodir o piso) deixa isto
 * vermelho — sem depender de alguém lembrar da regra na próxima tela.
 */
describe('Anamnese — o injetor de HTML é proibido nos arquivos reais (SEC-ANM-06)', () => {
  it('deve não usar o injetor de HTML em nenhum componente da anamnese nem na página da ficha', () => {
    // ARRANGE — sem comentários (senão a guarda casaria o token de um JSDoc explicativo)
    const semComentarios = (fonte: string): string =>
      fonte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    const proibido = ['dangerously', 'SetInnerHTML'].join('')
    const base = join(process.cwd(), 'src')
    const arquivos = [
      join(base, 'componentes', 'pacientes', 'ficha', 'formulario-anamnese.tsx'),
      join(base, 'componentes', 'pacientes', 'ficha', 'secao-anamnese.tsx'),
      join(base, 'componentes', 'pacientes', 'ficha', 'leitor-de-anamnese.tsx'),
      join(base, 'paginas', 'pagina-ficha-paciente.tsx'),
    ]

    // ACT
    const infratores = arquivos.filter((caminho) =>
      semComentarios(readFileSync(caminho, 'utf-8')).includes(proibido),
    )

    // ASSERT
    expect(infratores).toEqual([])
  })
})
