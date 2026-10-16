import { HttpResponse, http as msw } from 'msw'
import { setupServer } from 'msw/node'

import type { Usuario } from '@/tipos'

export const usuarioFicticio: Usuario = {
  id: 1,
  updated_at: '2026-07-15T10:00:00.000000Z',
  nome: 'Operadora Fictícia',
  email: 'operadora@exemplo.com.br',
  acesso_mobile: false,
  ativo: true,
  profissional_id: null,
  nivel_permissao_id: 1,
  nivel_permissao: 'Administrador',
  permissoes: ['configuracoes.ver', 'niveis_permissao.ver'],
  marca: { nome: '', identidade: 'nome', fonte: 'padrao', tema: 'padrao', logo_versao: null },
  avatar_versao: null,
}

// Estado default: ninguém logado; login com credenciais fictícias válidas funciona.
export const servidor = setupServer(
  msw.get('/sanctum/csrf-cookie', () => new HttpResponse(null, { status: 204 })),

  msw.get('/api/me', () => HttpResponse.json({ message: 'Unauthenticated.' }, { status: 401 })),

  msw.post('/api/login', async ({ request }) => {
    const corpo = (await request.json()) as { email: string; senha: string }

    if (corpo.email === usuarioFicticio.email && corpo.senha === 'senha-de-teste-123') {
      return HttpResponse.json(usuarioFicticio)
    }

    return HttpResponse.json(
      { message: 'Credenciais inválidas.', errors: { email: ['Credenciais inválidas.'] } },
      { status: 422 },
    )
  }),

  msw.post('/api/logout', () => new HttpResponse(null, { status: 204 })),

  // O shell consulta o centro de notificações em toda tela: default vazio
  // (bloco ausente ≠ zero — nada é renderizado).
  msw.get('/api/notificacoes', () => HttpResponse.json({})),
  // o endereço do cadastro pelo link: sem endereço e desligado por padrão (o botão de copiar some)
  msw.get('/api/cadastro-online/link', () => HttpResponse.json({ slug: null, ativo: false, url: null })),

  // O formulário de lançamento pede a sugestão do tratamento ao escolher a criança (change
  // vincular-pagamentos-ao-tratamento). O default é "sem sugestão" — o estado que não muda nada no
  // formulário; quem testa a sugestão sobrescreve com o tratamento sugerido.
  msw.get('/api/lancamentos/sugestao-de-tratamento', () => HttpResponse.json({ tratamento_id: null })),
  // A edição do lançamento abre com a seção Anexos (change anexo-no-lancamento). O default é o
  // lançamento sem arquivo; quem testa os anexos sobrescreve com a lista.
  msw.get('/api/lancamentos/:id/anexos', () => HttpResponse.json([])),

  // A aba Fluxo de caixa abre com o saldo de cada conta (change saldo-das-contas). O default é a
  // clínica sem conta nenhuma — o estado vazio; quem testa os cartões sobrescreve com as contas.
  msw.get('/api/contas/saldos', () => HttpResponse.json({ em: '2026-09-25', contas: [], total: '0.00' })),

  // O cadastro do paciente pergunta qual termo está em vigor (FA-08). O default é
  // ter um publicado, que é o estado normal da clínica depois do go-live; quem
  // testa a clínica SEM termo sobrescreve com `{ termo: null }`.
  msw.get('/api/termos-consentimento/vigente', () =>
    HttpResponse.json({ termo: { id: 1, titulo: 'Regulamento dos Atendimentos', versao: 1 } }),
  ),
)
