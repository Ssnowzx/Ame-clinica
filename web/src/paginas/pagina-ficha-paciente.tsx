import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, CalendarDays, Lock, TriangleAlert } from 'lucide-react'
import { useEffect, useId, useRef } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'

import { AcaoDeSituacao } from '@/componentes/pacientes/acao-de-situacao'
import { BuscaDeOutroPaciente } from '@/componentes/pacientes/ficha/busca-de-outro-paciente'
import { SecaoAgendamentos } from '@/componentes/pacientes/ficha/secao-agendamentos'
import { SecaoAnamnese } from '@/componentes/pacientes/ficha/secao-anamnese'
import { SecaoAnexos } from '@/componentes/pacientes/ficha/secao-anexos'
import { SecaoCadastro } from '@/componentes/pacientes/ficha/secao-cadastro'
import { SecaoFinanceiro } from '@/componentes/pacientes/ficha/secao-financeiro'
import { SecaoPainel } from '@/componentes/pacientes/ficha/secao-painel'
import { SecaoPresenca } from '@/componentes/pacientes/ficha/secao-presenca'
import { SecaoProntuario } from '@/componentes/pacientes/ficha/secao-prontuario'
import { SecaoReservada } from '@/componentes/pacientes/ficha/secao-reservada'
import { SecaoTermo } from '@/componentes/pacientes/ficha/secao-termo'
import { ProtegidoPorPermissao } from '@/componentes/protegido-por-permissao'
import { Botao } from '@/componentes/ui/botao'
import { EstadoErro } from '@/componentes/ui/estado-erro'
import { Etiqueta } from '@/componentes/ui/etiqueta'
import { Realce } from '@/componentes/ui/realce'
import { Skeleton } from '@/componentes/ui/skeleton'
import { chaves } from '@/lib/chaves-query'
import { cn } from '@/lib/cn'
import { idadeEm, nomeDeExibicao, ROTULOS_DE_SEXO } from '@/lib/pacientes'
import { acharSecao, secoesPermitidas, type SecaoDaFicha } from '@/lib/secoes-da-ficha'
import { buscarPaciente } from '@/servicos/pacientes'
import { useAuthStore } from '@/stores/auth-store'

/** O conteúdo da seção construída/reservada, derivado do registro (fonte única). */
function ConteudoDaSecao({ secao, pacienteId }: { secao: SecaoDaFicha; pacienteId: number }) {
  if (secao.reservada !== null) {
    return <SecaoReservada rotulo={secao.rotulo} motivo={secao.reservada} />
  }
  switch (secao.id) {
    case 'painel':
      return <SecaoPainel pacienteId={pacienteId} />
    case 'cadastro':
      return <SecaoCadastro pacienteId={pacienteId} />
    case 'agendamentos':
      return <SecaoAgendamentos pacienteId={pacienteId} />
    case 'financeiro':
      return <SecaoFinanceiro pacienteId={pacienteId} />
    case 'prontuario':
      return <SecaoProntuario pacienteId={pacienteId} />
    case 'presenca':
      return <SecaoPresenca pacienteId={pacienteId} />
    case 'anamnese':
      return <SecaoAnamnese pacienteId={pacienteId} />
    case 'anexos':
      return <SecaoAnexos pacienteId={pacienteId} />
    case 'termo':
      return <SecaoTermo pacienteId={pacienteId} />
    // uma seção construída sem case aqui é bug de registro — trate como reservada, nunca em branco
    default:
      return <SecaoReservada rotulo={secao.rotulo} motivo="Seção ainda não disponível." />
  }
}

/**
 * A ficha do paciente (change ficha-do-paciente) — a rota `/pacientes/:id` deixa
 * de ser o formulário e passa a ser a página de LEITURA: cabeçalho de identidade,
 * navegação lateral das seções filtrada por permissão (do registro — fonte única),
 * busca de outro paciente e atalho para a agenda. A seção vive no path
 * (`/pacientes/:id/:secao?`) e, sem seção, abre a primeira permitida (Decisão 6).
 *
 * A edição do cadastro é DESTINO (`/pacientes/:id/editar`), acionada pelo "Editar"
 * da seção Cadastro — nunca um modo-leitura degradado dentro da ficha.
 */
export function PaginaFichaPaciente() {
  const { id, secao } = useParams()
  const navigate = useNavigate()
  const temPermissao = useAuthStore((estado) => estado.temPermissao)
  const podeEditarCadastro = temPermissao('pacientes.editar')
  const refConteudo = useRef<HTMLDivElement>(null)
  const refErro = useRef<HTMLDivElement>(null)
  const idSecao = useId()

  const pacienteId = Number(id)
  const idValido = Number.isInteger(pacienteId) && pacienteId > 0

  const visiveis = secoesPermitidas(temPermissao)
  const padrao = visiveis[0]
  const pedida = acharSecao(secao)
  // seção ativa: a pedida (se existe E é permitida), senão a padrão
  const ativa = pedida !== undefined && visiveis.includes(pedida) ? pedida : padrao

  const consulta = useQuery({
    queryKey: chaves.paciente(pacienteId),
    queryFn: () => buscarPaciente(pacienteId),
    enabled: idValido,
    // chave de DETALHE compartilhada com o formulário de edição — gcTime: 0 (contrato)
    gcTime: 0,
  })

  // foco declarado ao entrar/trocar de seção (WCAG 2.4.3); no erro de página, o foco
  // vai ao alerta, que existe nos dois ramos (não some num beco)
  useEffect(() => {
    if (consulta.isError) {
      refErro.current?.focus()
    } else {
      refConteudo.current?.focus()
    }
  }, [ativa?.id, pacienteId, consulta.isError])

  if (!idValido) {
    return <Navigate to="/pacientes" replace />
  }

  // seção pedida por URL mas sem permissão / desconhecida: negada — volta à ficha
  // (a nav lateral nem a oferece; o acesso direto não a alcança)
  if (secao !== undefined && (pedida === undefined || !visiveis.includes(pedida))) {
    return <Navigate to={`/pacientes/${pacienteId}`} replace />
  }

  const paciente = consulta.data

  return (
    <section className="flex flex-col gap-6">
      {/* Cabeçalho de identidade */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <Link
              to="/pacientes"
              className="flex items-center gap-1 text-meta text-texto-suave hover:text-texto"
            >
              <ArrowLeft size={14} aria-hidden="true" />
              Pacientes
            </Link>
            {consulta.isPending ? (
              <Skeleton className="mt-1 h-8 w-56" />
            ) : (
              // o h1 é ESTÁVEL: nome quando carregou, rótulo genérico no erro — a página
              // nunca fica sem cabeçalho (2.4.6)
              <h1 className="mt-1 text-titulo font-semibold text-texto">
                {paciente !== undefined ? nomeDeExibicao(paciente) : 'Ficha do paciente'}
              </h1>
            )}
            {paciente !== undefined ? (
              <div className="mt-1 flex flex-wrap items-center gap-2 text-meta text-texto-suave">
                <span>{idadeEm(paciente.nascimento)}</span>
                <span aria-hidden>·</span>
                <span>{ROTULOS_DE_SEXO[paciente.sexo]}</span>
                {paciente.necessidade === 'necessidades_especiais' ? (
                  <span className="inline-flex items-center gap-1 rounded-pilula bg-neutro-100 px-2 py-0.5 font-medium">
                    <TriangleAlert aria-hidden className="size-3" />
                    Necessidades especiais
                  </span>
                ) : null}
                {/* ETIQUETA do Design System, não pílula artesanal: o produto dizia "inativo" de
                    três jeitos em três telas, e esta era a segunda (achado DQ-PIS-04) */}
                {!paciente.ativo ? <Etiqueta tom="neutro">Inativo</Etiqueta> : null}
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <BuscaDeOutroPaciente secaoAtiva={ativa?.id ?? 'painel'} pacienteAberto={pacienteId} />
            <ProtegidoPorPermissao permissao="agenda.ver">
              <Botao variante="secundario" onClick={() => navigate('/agenda')}>
                <CalendarDays aria-hidden className="size-4" />
                Ir para a agenda
              </Botao>
            </ProtegidoPorPermissao>
          </div>
        </div>

        {/* Cadastro inativo: a etiqueta ao lado do nome NOMEIA o estado; esta faixa diz o que ele
            CAUSA e oferece a saída. Enquanto havia só a etiqueta, a recepção chegava até aqui
            para voltar a atender uma criança antiga e não encontrava caminho nenhum — o paciente
            some da agenda sem explicação, e reativar vivia escondido dentro do formulário de
            edição (relato da clínica, 2026-09-14).
            Sem `pacientes.editar` o aviso FICA, sem o botão: a essa pessoa falta a informação,
            não a ação — e o servidor decide de verdade (403 no endpoint de situação). */}
        {paciente !== undefined && !paciente.ativo ? (
          <Realce
            tom="atencao"
            rotulo="Cadastro inativo"
            icone={<TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-alerta-texto" />}
            // o rótulo do Realce já imprime "Cadastro inativo"; repetir a palavra quatro
            // palavras adiante era eco (achado DQ-PIS-06)
            texto={
              podeEditarCadastro
                ? 'Enquanto estiver assim, este paciente não aparece na agenda, na fila nem nas buscas de paciente. Reative para voltar a agendar.'
                : 'Enquanto estiver assim, este paciente não aparece na agenda, na fila nem nas buscas de paciente. Reativar depende de quem pode editar o cadastro.'
            }
            // a ação é CONDICIONAL aqui, e não dentro do componente: `AcaoDeSituacao` devolve
            // `null` sem `pacientes.editar`, e uma prop que existe renderizando nada deixava um
            // `<div>` vazio comendo o `gap` da faixa (achado CR-NIT-1)
            acao={
              podeEditarCadastro ? (
                <AcaoDeSituacao
                  paciente={paciente}
                  tamanho="sm"
                  // a faixa some junto com o botão que tinha o foco: sem uma âncora que
                  // sobrevive à mutação, o foco cai no `body` (WCAG 2.4.3)
                  focoAposTroca={() => refConteudo.current}
                />
              ) : undefined
            }
          />
        ) : null}
      </div>

      {consulta.isError ? (
        <div ref={refErro} tabIndex={-1} className="outline-none">
          <EstadoErro
            mensagem="Não foi possível carregar o paciente."
            aoTentarNovamente={() => void consulta.refetch()}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-6 md:flex-row md:items-start">
          {/* Navegação lateral das seções — filtrada por permissão (do registro).
              São LINKS (a seção é deep-linkável, /pacientes/:id/:secao): preservam
              abrir-em-nova-aba, ctrl/cmd+clique e a role de link (A11y A1 / Design A-1). */}
          <nav aria-label="Seções da ficha" className="shrink-0 md:w-56">
            <ul className="flex flex-wrap gap-1 md:flex-col">
              {visiveis.map((item) => {
                const ehAtiva = item.id === ativa?.id
                return (
                  <li key={item.id}>
                    <Link
                      to={`/pacientes/${pacienteId}/${item.id}`}
                      aria-current={ehAtiva ? 'page' : undefined}
                      className={cn(
                        'flex w-full items-center justify-between gap-2 rounded-controle border-l-[3px] border-transparent px-3 py-2 text-corpo outline-none transition-colors duration-(--duracao-1) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco',
                        ehAtiva
                          ? 'border-l-acento bg-acento-suave font-semibold text-acento'
                          : 'text-texto-suave hover:bg-hover-de-linha hover:text-texto',
                      )}
                    >
                      <span>{item.rotulo}</span>
                      {item.reservada !== null ? (
                        <Lock aria-label="indisponível" className="size-3.5 shrink-0 text-texto-suave" />
                      ) : null}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </nav>

          {/* Conteúdo da seção ativa — região nomeada pelo h2 (sem duplicar rótulo);
              foco declarado na troca (2.4.3) */}
          <div
            ref={refConteudo}
            tabIndex={-1}
            role="region"
            aria-labelledby={idSecao}
            className="min-w-0 flex-1 rounded-superficie border border-linha bg-superficie p-5 outline-none"
          >
            <h2 id={idSecao} className="mb-4 text-subtitulo font-semibold text-texto">
              {ativa?.rotulo}
            </h2>
            {ativa !== undefined ? <ConteudoDaSecao secao={ativa} pacienteId={pacienteId} /> : null}
          </div>
        </div>
      )}
    </section>
  )
}
