import { Suspense, useEffect } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'

import { ExigePermissao } from '@/componentes/acesso-negado'
import { AppShell } from '@/componentes/app-shell'
import { RotaProtegida } from '@/componentes/rota-protegida'
import { ProvedorToast } from '@/componentes/ui/toast'
import { PaginaAgenda } from '@/paginas/pagina-agenda'
import { PaginaAnamneseModelos } from '@/paginas/pagina-anamnese-modelos'
import { PaginaAuditoria } from '@/paginas/pagina-auditoria'
import { PaginaListaEspera } from '@/paginas/pagina-lista-espera'
import { PaginaLogin } from '@/paginas/pagina-login'
import { PaginaCadastros } from '@/paginas/pagina-cadastros'
import { PaginaConvenio } from '@/paginas/pagina-convenio'
import { PaginaCartoes } from '@/paginas/pagina-cartoes'
import { PaginaCategoria } from '@/paginas/pagina-categoria'
import { PaginaCategorias } from '@/paginas/pagina-categorias'
import { PaginaContas } from '@/paginas/pagina-contas'
import { PaginaConvenios } from '@/paginas/pagina-convenios'
import { PaginaEquipamentos } from '@/paginas/pagina-equipamentos'
import { PaginaEspecialidades } from '@/paginas/pagina-especialidades'
import { PaginaFeriados } from '@/paginas/pagina-feriados'
import { PaginaFichaPaciente } from '@/paginas/pagina-ficha-paciente'
import { PaginaFichaProfissional } from '@/paginas/pagina-ficha-profissional'
import { EsqueletoDaArea } from '@/componentes/indicadores/moldura-dos-indicadores'
import { ShellDeIndicadores } from '@/componentes/indicadores/shell-de-indicadores'
import { PaginaMedicos } from '@/paginas/pagina-medicos'
import { PaginaPaciente } from '@/paginas/pagina-paciente'
import { PaginaPacientes } from '@/paginas/pagina-pacientes'
import { PaginaPendencias } from '@/paginas/pagina-pendencias'
import { PaginaProfissionais } from '@/paginas/pagina-profissionais'
import { PaginaSalas } from '@/paginas/pagina-salas'
import { PaginaEvolucoes } from '@/paginas/pagina-evolucoes'
import { PaginaFinanceiro } from '@/paginas/pagina-financeiro'
import { PaginaFornecedores } from '@/paginas/pagina-fornecedores'
import { PaginaFuncionarios } from '@/paginas/pagina-funcionarios'
import { PaginaVincularPagamentos } from '@/paginas/pagina-vincular-pagamentos'
import { PaginaConfigurarDre } from '@/paginas/pagina-configurar-dre'
import { PaginaTermos } from '@/paginas/pagina-termos'
import { PaginaTiposPagamento } from '@/paginas/pagina-tipos-pagamento'
import { PaginaTratamentos } from '@/paginas/pagina-tratamentos'
import { PaginaStatusAgendamento } from '@/paginas/pagina-status-agendamento'
import { PaginaMensagens } from '@/paginas/pagina-mensagens'
import { PaginaTarefas } from '@/paginas/pagina-tarefas'
import { PaginaWhatsapp } from '@/paginas/pagina-whatsapp'
import { PaginaUsuarios } from '@/paginas/pagina-usuarios'
import { PaginaConfiguracoes } from '@/paginas/pagina-configuracoes'
import { PaginaCadastroPublico } from '@/paginas/pagina-cadastro-publico'
import { PaginaCadastrosRecebidos } from '@/paginas/pagina-cadastros-recebidos'
import { PaginaManual } from '@/paginas/pagina-manual'
import { PaginaRelatorio } from '@/paginas/pagina-relatorio'
import { PaginaRelatorios } from '@/paginas/pagina-relatorios'
import { PERMISSOES_DE_CADASTRO, PERMISSOES_DE_INDICADORES, PERMISSOES_DE_RELATORIOS } from '@/lib/catalogos'
import { paginaSobDemanda } from '@/lib/versao-nova'
import { useAuthStore } from '@/stores/auth-store'

/*
 * A ÁREA DE INDICADORES sob demanda (PERF-08): as frases, os gráficos e as cinco abas só descem
 * quando alguém abre a área — a recepção, que vive na agenda, não paga por eles no primeiro
 * carregamento. O shell da área (título, período, abas) fica no pacote principal, e o `Suspense`
 * dele segura a caixa do conteúdo com o esqueleto (`EsqueletoDaArea`) enquanto o código chega.
 * As páginas têm export NOMEADO (a casa não usa default). `paginaSobDemanda` recarrega a página UMA
 * vez quando o código delas não vem — o caso de uma versão nova publicada com a página aberta (PERF-12).
 */
const PaginaIndicadores = paginaSobDemanda(() => import('@/paginas/pagina-indicadores'), 'PaginaIndicadores')
const PaginaIndicadoresAgenda = paginaSobDemanda(() => import('@/paginas/pagina-indicadores-agenda'), 'PaginaIndicadoresAgenda')
const PaginaIndicadoresEquipe = paginaSobDemanda(() => import('@/paginas/pagina-indicadores-equipe'), 'PaginaIndicadoresEquipe')
const RedirecionarParaEquipe = paginaSobDemanda(() => import('@/paginas/pagina-indicadores-equipe'), 'RedirecionarParaEquipe')
const PaginaIndicadoresFinanceiro = paginaSobDemanda(() => import('@/paginas/pagina-indicadores-financeiro'), 'PaginaIndicadoresFinanceiro')
const PaginaIndicadoresItens = paginaSobDemanda(() => import('@/paginas/pagina-indicadores-itens'), 'PaginaIndicadoresItens')
const PaginaIndicadoresPacientes = paginaSobDemanda(() => import('@/paginas/pagina-indicadores-pacientes'), 'PaginaIndicadoresPacientes')
const PaginaIndicadoresProdutividadeProfissional = paginaSobDemanda(
  () => import('@/paginas/pagina-indicadores-produtividade-profissional'),
  'PaginaIndicadoresProdutividadeProfissional',
)
const PaginaIndicadoresProfissional = paginaSobDemanda(() => import('@/paginas/pagina-indicadores-profissional'), 'PaginaIndicadoresProfissional')

/**
 * As rotas que NÃO têm conta por trás.
 *
 * A página do auto-cadastro é aberta por uma família, sem nenhuma credencial. Carregar a sessão
 * ali não é só inútil: `GET /api/me` está no grupo `api`, que é STATEFUL — cada visitante anônimo
 * ganhava um cookie de sessão do sistema clínico e uma linha na tabela `sessions`, num endereço
 * que a clínica vai divulgar por WhatsApp. A separação estrutural que o `routes/publico.php` fez
 * no servidor estava sendo desfeita por um `useEffect` aqui (parecer PÓS-código, SEC-CO-31).
 */
const ROTAS_SEM_CONTA = [/^\/cadastro\//]

function App() {
  const carregarSessao = useAuthStore((estado) => estado.carregarSessao)
  const { pathname } = useLocation()
  const semConta = ROTAS_SEM_CONTA.some((rota) => rota.test(pathname))

  useEffect(() => {
    if (semConta) return

    void carregarSessao()
  }, [carregarSessao, semConta])

  return (
    <ProvedorToast>
      <Routes>
        <Route path="/login" element={<PaginaLogin />} />
        {/*
          O AUTO-CADASTRO PÚBLICO fica aqui, fora do `RotaProtegida` e fora do `AppShell`: quem a
          abre não tem conta. O shell consulta sessão, contadores e permissões — montá-lo aqui
          seria uma tela que falha em toda chamada.
        */}
        <Route path="/cadastro/:slug" element={<PaginaCadastroPublico />} />
        <Route element={<RotaProtegida />}>
          <Route element={<AppShell />}>
            <Route path="/" element={<Navigate to="/agenda" replace />} />
            <Route
              path="/agenda"
              element={
                <ExigePermissao permissao="agenda.ver">
                  <PaginaAgenda />
                </ExigePermissao>
              }
            />
            <Route
              path="/lista-espera"
              element={
                <ExigePermissao permissao="lista_espera.ver">
                  <PaginaListaEspera />
                </ExigePermissao>
              }
            />
            <Route
              path="/cadastros-recebidos"
              element={
                <ExigePermissao permissao="cadastro_online.conferir">
                  <PaginaCadastrosRecebidos />
                </ExigePermissao>
              }
            />
            <Route
              path="/pacientes"
              element={
                <ExigePermissao permissao="pacientes.ver">
                  <PaginaPacientes />
                </ExigePermissao>
              }
            />
            <Route
              path="/pacientes/novo"
              element={
                <ExigePermissao permissao="pacientes.criar">
                  <PaginaPaciente />
                </ExigePermissao>
              }
            />
            {/* Edição do cadastro é DESTINO da ficha (Decisão 0) — o formulário, edit-only */}
            <Route
              path="/pacientes/:id/editar"
              element={
                <ExigePermissao permissao="pacientes.editar">
                  <PaginaPaciente />
                </ExigePermissao>
              }
            />
            {/* A rota do paciente agora é a FICHA de leitura; a seção vive no path */}
            <Route
              path="/pacientes/:id"
              element={
                <ExigePermissao permissao="pacientes.ver">
                  <PaginaFichaPaciente />
                </ExigePermissao>
              }
            />
            <Route
              path="/pacientes/:id/:secao"
              element={
                <ExigePermissao permissao="pacientes.ver">
                  <PaginaFichaPaciente />
                </ExigePermissao>
              }
            />
            <Route
              path="/profissionais"
              element={
                <ExigePermissao permissao="profissionais.ver">
                  <PaginaProfissionais />
                </ExigePermissao>
              }
            />
            {/* a FICHA se autoguarda (profissionais.ver OU o PRÓPRIO): o ExigePermissao
                não conhece o :id — e o servidor decide de verdade (own-show) */}
            <Route path="/profissionais/:id" element={<PaginaFichaProfissional />} />
            <Route
              path="/tratamentos"
              element={
                <ExigePermissao permissao="tratamentos.ver">
                  <PaginaTratamentos />
                </ExigePermissao>
              }
            />
            <Route
              path="/financeiro"
              element={
                <ExigePermissao permissao="lancamentos.ver">
                  <PaginaFinanceiro />
                </ExigePermissao>
              }
            />
            {/* O lote de vínculos (vincular-pagamentos-ao-tratamento): as TRÊS permissões da
                listagem no servidor, em E — encadeadas, porque o array do `ExigePermissao` é
                "qualquer uma". São as de `PERMISSOES_DO_VINCULO_EM_LOTE`, e o `app.test` tira
                uma de cada vez para provar que nenhuma sobrou fora daqui */}
            <Route
              path="/financeiro/vincular"
              element={
                <ExigePermissao permissao="lancamentos.ver">
                  <ExigePermissao permissao="lancamentos.editar">
                    <ExigePermissao permissao="lancamentos.pagar">
                      <ExigePermissao permissao="tratamentos.ver">
                        <PaginaVincularPagamentos />
                      </ExigePermissao>
                    </ExigePermissao>
                  </ExigePermissao>
                </ExigePermissao>
              }
            />
            {/* A configuração do DRE (dre-gerencial): é o resultado da clínica — `GET /dre/linhas`
                responde só a `fluxo_caixa.ver`; trocar a linha é decidido item a item na tela */}
            <Route
              path="/financeiro/dre/configurar"
              element={
                <ExigePermissao permissao="fluxo_caixa.ver">
                  <PaginaConfigurarDre />
                </ExigePermissao>
              }
            />
            {/* O dashboard do §11: qualquer módulo dono abre a página; dentro dela,
                cada bloco só monta com a permissão da própria vista. */}
            {/* a ÁREA de indicadores: o shell traz título, período compartilhado, abas e
                o botão Imprimir; cada aba é uma rota FILHA e mantém a sua permissão */}
            <Route
              element={
                <ExigePermissao permissao={PERMISSOES_DE_INDICADORES}>
                  <ShellDeIndicadores />
                </ExigePermissao>
              }
            >
              {/* a proteção é declarada na FILHA também, e não só herdada do shell: o
                  guarda de contrato da casa exige que toda rota diga a sua — assim
                  ninguém acrescenta aba nova sem porta */}
              <Route
                path="/indicadores"
                element={
                  <ExigePermissao permissao={PERMISSOES_DE_INDICADORES}>
                    <PaginaIndicadores />
                  </ExigePermissao>
                }
              />
              <Route
                path="/indicadores/financeiro"
                element={
                  <ExigePermissao permissao="fluxo_caixa.ver">
                    <PaginaIndicadoresFinanceiro />
                  </ExigePermissao>
                }
              />
              <Route
                path="/indicadores/agenda"
                element={
                  <ExigePermissao permissao="agenda.ver">
                    <PaginaIndicadoresAgenda />
                  </ExigePermissao>
                }
              />
              <Route
                path="/indicadores/pacientes"
                element={
                  <ExigePermissao permissao="pacientes.ver">
                    <PaginaIndicadoresPacientes />
                  </ExigePermissao>
                }
              />
              {/* A Equipe cruza os dois eixos (capacidade e marcações são da AGENDA, realizados e
                  evoluções são CLÍNICOS): as DUAS permissões, encadeadas — o array do
                  `ExigePermissao` é "qualquer uma", e aqui é "todas" */}
              <Route
                path="/indicadores/equipe"
                element={
                  <ExigePermissao permissao="agenda.ver">
                    <ExigePermissao permissao="atendimentos.ver">
                      <PaginaIndicadoresEquipe />
                    </ExigePermissao>
                  </ExigePermissao>
                }
              />
              {/* o link antigo da aba Produtividade leva à Equipe do MESMO mês (`?mes=` preservado);
                  com as mesmas duas permissões, para a porta antiga não abrir mais do que a nova */}
              <Route
                path="/indicadores/produtividade"
                element={
                  <ExigePermissao permissao="agenda.ver">
                    <ExigePermissao permissao="atendimentos.ver">
                      <RedirecionarParaEquipe />
                    </ExigePermissao>
                  </ExigePermissao>
                }
              />
              <Route
                path="/indicadores/produtividade/:id"
                element={
                  <ExigePermissao permissao="agenda.ver">
                    <ExigePermissao permissao="atendimentos.ver">
                      <PaginaIndicadoresProdutividadeProfissional />
                    </ExigePermissao>
                  </ExigePermissao>
                }
              />
            </Route>
            {/* drill-down: a página de itens fica atrás do MESMO guarda-chuva do
                painel — a vista pedida continua sob a permissão do módulo dono
                no servidor (403 para quem digitar a URL da vista errada) */}
            <Route
              path="/indicadores/itens"
              element={
                <ExigePermissao permissao={PERMISSOES_DE_INDICADORES}>
                  <Suspense fallback={<EsqueletoDaArea />}>
                    <PaginaIndicadoresItens />
                  </Suspense>
                </ExigePermissao>
              }
            />
            <Route
              path="/indicadores/profissionais/:id"
              element={
                <ExigePermissao permissao="atendimentos.ver">
                  <Suspense fallback={<EsqueletoDaArea />}>
                    <PaginaIndicadoresProfissional />
                  </Suspense>
                </ExigePermissao>
              }
            />
            {/* A ÁREA de relatórios (area-de-relatorios): o catálogo abre com QUALQUER
                permissão de um relatório; a página de cada relatório exige TODAS as do
                seu slug por dentro (aninhando `ExigePermissao`) — e slug fora do catálogo
                é "não existe" com a volta. O servidor decide de verdade (403 antes de 422). */}
            <Route
              path="/relatorios"
              element={
                <ExigePermissao permissao={PERMISSOES_DE_RELATORIOS}>
                  <PaginaRelatorios />
                </ExigePermissao>
              }
            />
            <Route
              path="/relatorios/:slug"
              element={
                <ExigePermissao permissao={PERMISSOES_DE_RELATORIOS}>
                  <PaginaRelatorio />
                </ExigePermissao>
              }
            />

            {/* A fila que o contador do cabeçalho passou a abrir. Sem `evolucoes.ver` não
                há contador NEM porta: link que leva a "acesso negado" é promessa vazia. */}
            <Route
              path="/evolucoes"
              element={
                <ExigePermissao permissao="evolucoes.ver">
                  <PaginaEvolucoes />
                </ExigePermissao>
              }
            />
            {/* A fila de RETORNOS (protocolo-de-pendencias) — quem parou de ser agendado.
                Sob `agenda.ver`, a mesma permissão do bloco: a pendência é a AUSÊNCIA de
                horário, fato da agenda. Não confundir com a Lista de Espera (entrada). */}
            <Route
              path="/pendencias"
              element={
                <ExigePermissao permissao="agenda.ver">
                  <PaginaPendencias />
                </ExigePermissao>
              }
            />
            {/* Mural de tarefas da equipe (kanban-da-equipe) — módulo interno, sem
                dado de paciente; o bloco do centro deep-linka com ?tarefa=<id> */}
            <Route
              path="/tarefas"
              element={
                <ExigePermissao permissao="tarefas.ver">
                  <PaginaTarefas />
                </ExigePermissao>
              }
            />
            {/* Canal de WhatsApp (mensageria-whatsapp) — a caixa de entrada da clínica;
                o bloco do centro de notificações deep-linka com ?conversa=<id> */}
            <Route
              path="/mensagens"
              element={
                <ExigePermissao permissao="mensagens.ver">
                  <PaginaMensagens />
                </ExigePermissao>
              }
            />
            {/* A conexão vive DENTRO de Configurações, sob permissão própria: guardar a
                credencial da Meta é gesto de administração, não de operação */}
            <Route
              path="/configuracoes/whatsapp"
              element={
                <ExigePermissao permissao="mensagens.conectar">
                  <PaginaWhatsapp />
                </ExigePermissao>
              }
            />
            <Route
              path="/cadastros"
              element={
                <ExigePermissao permissao={PERMISSOES_DE_CADASTRO}>
                  <PaginaCadastros />
                </ExigePermissao>
              }
            />
            <Route
              path="/especialidades"
              element={
                <ExigePermissao permissao="especialidades.ver">
                  <PaginaEspecialidades />
                </ExigePermissao>
              }
            />
            <Route
              path="/salas"
              element={
                <ExigePermissao permissao="salas.ver">
                  <PaginaSalas />
                </ExigePermissao>
              }
            />
            <Route
              path="/equipamentos"
              element={
                <ExigePermissao permissao="equipamentos.ver">
                  <PaginaEquipamentos />
                </ExigePermissao>
              }
            />
            <Route
              path="/medicos"
              element={
                <ExigePermissao permissao="medicos.ver">
                  <PaginaMedicos />
                </ExigePermissao>
              }
            />
            <Route
              path="/convenios"
              element={
                <ExigePermissao permissao="convenios.ver">
                  <PaginaConvenios />
                </ExigePermissao>
              }
            />
            <Route
              path="/convenios/:id"
              element={
                <ExigePermissao permissao="convenios.ver">
                  <PaginaConvenio />
                </ExigePermissao>
              }
            />
            <Route
              path="/status-agendamento"
              element={
                <ExigePermissao permissao="status_agendamento.ver">
                  <PaginaStatusAgendamento />
                </ExigePermissao>
              }
            />
            <Route
              path="/feriados"
              element={
                <ExigePermissao permissao="feriados.ver">
                  <PaginaFeriados />
                </ExigePermissao>
              }
            />
            <Route
              path="/anamnese-modelos"
              element={
                <ExigePermissao permissao="anamnese_modelos.ver">
                  <PaginaAnamneseModelos />
                </ExigePermissao>
              }
            />
            <Route
              path="/termos"
              element={
                <ExigePermissao permissao="termos_consentimento.ver">
                  <PaginaTermos />
                </ExigePermissao>
              }
            />
            {/* Os catálogos do DINHEIRO (§9) — cada um sob a permissão do próprio módulo:
                dinheiro não herda permissão de cadastro clínico (parecer §3). */}
            <Route
              path="/contas"
              element={
                <ExigePermissao permissao="contas.ver">
                  <PaginaContas />
                </ExigePermissao>
              }
            />
            <Route
              path="/tipos-pagamento"
              element={
                <ExigePermissao permissao="tipos_pagamento.ver">
                  <PaginaTiposPagamento />
                </ExigePermissao>
              }
            />
            <Route
              path="/categorias"
              element={
                <ExigePermissao permissao="categorias.ver">
                  <PaginaCategorias />
                </ExigePermissao>
              }
            />
            <Route
              path="/categorias/:id"
              element={
                <ExigePermissao permissao="categorias.ver">
                  <PaginaCategoria />
                </ExigePermissao>
              }
            />
            <Route
              path="/cartoes"
              element={
                <ExigePermissao permissao="cartoes.ver">
                  <PaginaCartoes />
                </ExigePermissao>
              }
            />
            {/* a quem a clínica paga (caixa-do-dia-a-dia) — cada um sob a permissão do seu módulo */}
            <Route
              path="/fornecedores"
              element={
                <ExigePermissao permissao="fornecedores.ver">
                  <PaginaFornecedores />
                </ExigePermissao>
              }
            />
            <Route
              path="/funcionarios"
              element={
                <ExigePermissao permissao="funcionarios.ver">
                  <PaginaFuncionarios />
                </ExigePermissao>
              }
            />
            <Route
              path="/usuarios"
              element={
                <ExigePermissao permissao={['usuarios.ver', 'niveis_permissao.ver']}>
                  <PaginaUsuarios />
                </ExigePermissao>
              }
            />
            {/* trilha de auditoria (§12) — somente leitura, sob auditoria.ver */}
            <Route
              path="/auditoria"
              element={
                <ExigePermissao permissao="auditoria.ver">
                  <PaginaAuditoria />
                </ExigePermissao>
              }
            />
            {/* manual de uso (manual-do-operador): SEM `ExigePermissao` de propósito — a tela
                não lê nada da clínica, e quem não sabe operar não tem como pedir permissão
                para aprender. `RotaProtegida` continua exigindo sessão. */}
            <Route path="/manual" element={<PaginaManual />} />
            <Route
              path="/configuracoes"
              element={
                <ExigePermissao permissao="configuracoes.ver">
                  <PaginaConfiguracoes />
                </ExigePermissao>
              }
            />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ProvedorToast>
  )
}

export default App
