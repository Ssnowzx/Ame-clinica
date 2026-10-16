import { useQuery } from '@tanstack/react-query'
import { ChevronRight, FileText, Plus } from 'lucide-react'
import { useEffect, useId, useState } from 'react'

import { FormularioAnamnese } from '@/componentes/pacientes/ficha/formulario-anamnese'
import { LeitorDeAnamnese } from '@/componentes/pacientes/ficha/leitor-de-anamnese'
import { AcaoDoPreRequisito } from '@/componentes/ui/aviso-de-pre-requisito'
import { AvisoErro } from '@/componentes/ui/aviso-erro'
import { Botao } from '@/componentes/ui/botao'
import { CampoSelect } from '@/componentes/ui/campo-select'
import { Dialog } from '@/componentes/ui/dialog'
import { EstadoErro } from '@/componentes/ui/estado-erro'
import { EstadoVazio } from '@/componentes/ui/estado-vazio'
import { EstadosDaLista } from '@/componentes/cadastro/estados-da-lista'
import { Skeleton } from '@/componentes/ui/skeleton'
import { Tabela } from '@/componentes/ui/tabela'
import { usarMutacaoDeAnamnese } from '@/hooks/usar-mutacao-de-anamnese'
import { CAMINHOS } from '@/lib/caminhos-dos-cadastros'
import { chaves } from '@/lib/chaves-query'
import { dataHoraLegivel } from '@/lib/datas'
import { listarAnamneses, listarModelosDeAnamnese } from '@/servicos/anamneses'
import { useAuthStore } from '@/stores/auth-store'
import type { AnamneseDaLista, RespostasAnamnese } from '@/tipos'

interface SecaoAnamneseProps {
  pacienteId: number
}

/**
 * Seção Anamnese da ficha (Fase 5) — dado de saúde de MENOR (art. 11).
 *
 * A lista consome SÓ o index (metadados: modelo · data); `respostas_json` nunca entra
 * em linha nenhuma, e NENHUM `show` é disparado por render, hover ou focus — o único
 * caminho à resposta é o "Abrir", um clique deliberado (SEC-ANM-07). "Nova anamnese"
 * é gated pela CONJUNÇÃO `anamneses.criar && anamnese_modelos.ver` (SEC-ANM-04).
 */
export function SecaoAnamnese({ pacienteId }: SecaoAnamneseProps) {
  const [criando, setCriando] = useState(false)
  const [aberta, setAberta] = useState<AnamneseDaLista | null>(null)

  const lista = useQuery({
    queryKey: chaves.anamnesesDoPaciente(pacienteId),
    queryFn: () => listarAnamneses(pacienteId),
  })

  const anamneses = lista.data?.data ?? []
  const total = lista.data?.total ?? anamneses.length

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* contador só quando a lista carregou — "0" numa falha de rede mentiria */}
        {lista.isSuccess ? (
          <p className="text-corpo text-texto-suave">
            {total} {total === 1 ? 'anamnese' : 'anamneses'}
          </p>
        ) : (
          <span />
        )}
        <BotaoNovaAnamnese aoAbrir={() => setCriando(true)} />
      </div>

      <EstadosDaLista
        carregando={lista.isPending}
        erro={lista.isError}
        aoTentarNovamente={() => void lista.refetch()}
        vazio={anamneses.length === 0}
        vazioTitulo="Nenhuma anamnese registrada"
        vazioDescricao="As anamneses preenchidas para este paciente aparecem aqui."
        vazioAcao={<BotaoNovaAnamnese aoAbrir={() => setCriando(true)} />}
      >
        <Tabela densidade="confortavel" legenda="Anamneses do paciente">
          <Tabela.Cabecalho>
            <Tabela.Linha>
              <Tabela.CelulaCabecalho>Modelo</Tabela.CelulaCabecalho>
              <Tabela.CelulaCabecalho>Preenchida em</Tabela.CelulaCabecalho>
              <Tabela.CelulaCabecalho>
                <span className="sr-only">Ações</span>
              </Tabela.CelulaCabecalho>
            </Tabela.Linha>
          </Tabela.Cabecalho>
          <Tabela.Corpo>
            {anamneses.map((anamnese) => {
              const modelo = anamnese.modelo?.titulo ?? 'Modelo removido'
              const quando = dataHoraLegivel(anamnese.preenchida_em)
              return (
                <Tabela.Linha key={anamnese.id}>
                  <Tabela.Celula className="text-texto">{modelo}</Tabela.Celula>
                  <Tabela.Celula className="text-texto-suave">{quando}</Tabela.Celula>
                  <Tabela.Celula className="text-right">
                    <Botao
                      variante="fantasma"
                      tamanho="sm"
                      onClick={() => setAberta(anamnese)}
                      aria-label={`Abrir anamnese de ${modelo}, preenchida em ${quando}`}
                    >
                      Abrir
                      <ChevronRight aria-hidden="true" className="size-4" />
                    </Botao>
                  </Tabela.Celula>
                </Tabela.Linha>
              )
            })}
          </Tabela.Corpo>
        </Tabela>
      </EstadosDaLista>

      <DialogoNovaAnamnese
        pacienteId={pacienteId}
        aberto={criando}
        aoFechar={() => setCriando(false)}
      />

      {aberta !== null ? (
        <LeitorDeAnamnese anamnese={aberta} aberto={aberta !== null} aoFechar={() => setAberta(null)} />
      ) : null}
    </div>
  )
}

/**
 * "Nova anamnese" — CONJUNÇÃO `anamneses.criar && anamnese_modelos.ver` (SEC-ANM-04).
 * Sem `anamneses.criar`, não renderiza; com ela mas sem `anamnese_modelos.ver`, degrada
 * DESABILITADA com o motivo (ligado por `aria-describedby`) — nunca promete um form que
 * não popula. O servidor é a autoridade; a tela só reflete.
 */
function BotaoNovaAnamnese({ aoAbrir }: { aoAbrir: () => void }) {
  const podeCriar = useAuthStore((estado) => estado.temPermissao('anamneses.criar'))
  const podeVerModelos = useAuthStore((estado) => estado.temPermissao('anamnese_modelos.ver'))
  const idNota = useId()

  if (!podeCriar) {
    return null
  }

  if (!podeVerModelos) {
    return (
      <div className="flex flex-col gap-1">
        <Botao variante="primario" disabled aria-describedby={idNota}>
          <Plus aria-hidden="true" className="size-4" />
          Nova anamnese
        </Botao>
        <p id={idNota} className="text-meta text-texto-suave">
          É preciso acesso aos modelos de anamnese para preencher uma nova.
        </p>
      </div>
    )
  }

  return (
    <Botao variante="primario" onClick={aoAbrir}>
      <Plus aria-hidden="true" className="size-4" />
      Nova anamnese
    </Botao>
  )
}

/**
 * Nova anamnese — escolher um modelo ATIVO e preencher o formulário dinâmico. Os
 * modelos são buscados AO ABRIR (disciplina sob demanda), nos 4 estados; só os `ativo`
 * são oferecidos (a API recusa a criação com modelo inativo). Sucesso invalida a LISTA
 * (no hook) e fecha.
 */
function DialogoNovaAnamnese({
  pacienteId,
  aberto,
  aoFechar,
}: {
  pacienteId: number
  aberto: boolean
  aoFechar: () => void
}) {
  const podeVerModelos = useAuthStore((estado) => estado.temPermissao('anamnese_modelos.ver'))
  const { erros, criar, salvando } = usarMutacaoDeAnamnese(pacienteId)
  const [modeloId, setModeloId] = useState('')
  const formId = useId()
  const idDoAviso = useId()
  const idDoPedido = useId()

  useEffect(() => {
    if (!aberto) {
      setModeloId('')
    }
  }, [aberto])

  const modelos = useQuery({
    queryKey: chaves.modelosDeAnamnese(),
    queryFn: listarModelosDeAnamnese,
    enabled: aberto && podeVerModelos,
  })

  const ativos = (modelos.data ?? []).filter((modelo) => modelo.ativo)
  const selecionado = ativos.find((modelo) => String(modelo.id) === modeloId)
  // nada a preencher: o corpo vira o estado vazio com a saída, e o "Salvar" desabilitado mudo sai
  const semModelo = !(modelos.isPending && podeVerModelos) && !modelos.isError && ativos.length === 0

  const avisosGerais = [...erros.gerais, erros.campos.get('respostas_json')].filter(
    (mensagem): mensagem is string => mensagem !== undefined,
  )

  function salvar(respostas: RespostasAnamnese) {
    if (selecionado === undefined) {
      return
    }
    criar.mutate(
      { modelo_id: selecionado.id, respostas_json: respostas },
      { onSuccess: () => aoFechar() },
    )
  }

  // sem modelo, o rodapé sai inteiro: o "Fechar" do cabeçalho é a saída, e um segundo "Fechar"
  // seria o mesmo nome duas vezes no diálogo
  const rodape = semModelo ? undefined : (
    <div className="flex justify-end gap-3">
      <Botao variante="secundario" onClick={aoFechar}>
        Cancelar
      </Botao>
      <Botao
        type="submit"
        form={formId}
        variante="primario"
        carregando={salvando}
        disabled={selecionado === undefined}
      >
        Salvar anamnese
      </Botao>
    </div>
  )

  return (
    <Dialog
      aberto={aberto}
      aoMudarAberto={(proximo) => {
        if (!proximo) {
          aoFechar()
        }
      }}
      titulo="Nova anamnese"
      rodape={rodape}
      idDoAviso={semModelo ? `${idDoAviso} ${idDoPedido}` : undefined}
    >
      {modelos.isPending && podeVerModelos ? (
        <div aria-busy="true">
          <Skeleton className="h-10 w-full" />
        </div>
      ) : modelos.isError ? (
        <EstadoErro
          mensagem="Não foi possível carregar os modelos de anamnese."
          aoTentarNovamente={() => void modelos.refetch()}
        />
      ) : semModelo ? (
        // o aviso entra na DESCRIÇÃO do diálogo: o foco abre no "Fechar", e quem usa leitor de tela
        // ouvia só "Nova anamnese", sem saber que não há o que preencher (A11Y-AVI-03)
        // só o TEXTO do vazio (sem o botão), para a descrição não repetir o nome da ação (A11Y-AVI-R2-02)
        <EstadoVazio
          idDoTexto={idDoAviso}
          icone={<FileText className="size-8" aria-hidden="true" />}
          titulo="Nenhum modelo de anamnese ativo"
          descricao="A anamnese é preenchida a partir de um modelo ativo do cadastro de modelos."
          acao={<AcaoDoPreRequisito para={CAMINHOS.modeloDeAnamnese} aoNavegar={aoFechar} idDoPedido={idDoPedido} />}
        />
      ) : (
        <div className="flex flex-col gap-6">
          <AvisoErro mensagens={avisosGerais} />

          <CampoSelect
            rotulo="Modelo de anamnese"
            obrigatorio
            placeholder="Escolha um modelo de anamnese"
            opcoes={ativos.map((modelo) => ({ valor: String(modelo.id), rotulo: modelo.titulo }))}
            value={modeloId}
            onChange={(evento) => setModeloId(evento.target.value)}
          />

          {selecionado !== undefined ? (
            <FormularioAnamnese
              key={selecionado.id}
              modelo={selecionado}
              formId={formId}
              erros={erros}
              aoSalvar={salvar}
            />
          ) : null}
        </div>
      )}
    </Dialog>
  )
}
