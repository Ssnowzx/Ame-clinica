import { useQuery } from '@tanstack/react-query'
import { Pencil, Plus, Power, Trash2 } from 'lucide-react'
import { AlertDialog } from 'radix-ui'
import { useState, type FormEvent } from 'react'

import { BuilderDeCampos } from '@/componentes/anamnese-modelos/builder-de-campos'
import { CabecalhoDeCadastro } from '@/componentes/cadastro/cabecalho-de-cadastro'
import { EstadosDaLista } from '@/componentes/cadastro/estados-da-lista'
import { ProtegidoPorPermissao } from '@/componentes/protegido-por-permissao'
import { AvisoErro } from '@/componentes/ui/aviso-erro'
import { Botao } from '@/componentes/ui/botao'
import { CampoCheckbox } from '@/componentes/ui/campo-checkbox'
import { CampoSelect } from '@/componentes/ui/campo-select'
import { CampoTexto } from '@/componentes/ui/campo-texto'
import { DialogConfirmacao } from '@/componentes/ui/dialog-confirmacao'
import { Tabela } from '@/componentes/ui/tabela'
import { usarMutacaoDeCatalogo } from '@/hooks/usar-mutacao-de-catalogo'
import { chaves } from '@/lib/chaves-query'
import { cn } from '@/lib/cn'
import {
  camposDeModelo,
  paraCamposJson,
  temErroDeModelo,
  validarModelo,
  type CampoEmEdicao,
  type ErrosDoModelo,
} from '@/lib/modelo-de-anamnese'
import { anamneseModelos, especialidades } from '@/servicos/catalogos-de-apoio'
import { useAuthStore } from '@/stores/auth-store'
import type { AnamneseModelo, PayloadAnamneseModelo } from '@/tipos'

/**
 * Só os campos do FORMULÁRIO entram no Set — a chave da ENTIDADE (`anamnese_modelo`,
 * com que o servidor recusa a exclusão de um modelo EM USO) fica fora, para cair em
 * `gerais` e aparecer no diálogo de exclusão (parecer SEC-CA-03). `campos_json` É
 * campo do formulário: incluí-lo faz o erro `campos_json.N.*` do servidor pousar na
 * linha certa do builder (via `erroDoItem`).
 */
const CAMPOS = new Set(['titulo', 'especialidade_id', 'ativo', 'campos_json'])

// Congelado, como o `SEM_ERROS` de `lib/erros.ts`: vazio compartilhado só de leitura —
// um `set` acidental num consumidor não vaza entre telas.
const ERROS_VAZIOS: ErrosDoModelo = Object.freeze({ porCampo: new Map() })

interface Valores {
  titulo: string
  /** value do <select>: '' = nenhuma especialidade (modelo geral) */
  especialidadeId: string
  ativo: boolean
  campos: CampoEmEdicao[]
}

function valoresIniciais(modelo?: AnamneseModelo): Valores {
  return {
    titulo: modelo?.titulo ?? '',
    especialidadeId:
      modelo?.especialidade_id !== undefined && modelo.especialidade_id !== null
        ? String(modelo.especialidade_id)
        : '',
    ativo: modelo?.ativo ?? true,
    campos: camposDeModelo(modelo),
  }
}

/**
 * Modelos de anamnese (change anamnese-modelos-tela) — a tela que faltava.
 *
 * O backend (`AnamneseModeloController`) já entregava o CRUD; aqui a clínica CRIA a
 * ficha inicial (builder de campos tipado), edita, ativa/inativa e exclui. Reusa a
 * camada de dados dos catálogos (`usarMutacaoDeCatalogo`: `retry:0`, invalidação da
 * lista, toast, recusa no campo certo, concorrência otimista). Um modelo ATIVO é o
 * que destrava "Nova anamnese" na ficha.
 */
export function PaginaAnamneseModelos() {
  const consulta = useQuery({
    queryKey: chaves.modelosDeAnamnese(),
    queryFn: anamneseModelos.listar,
  })

  const podeVerEspecialidades = useAuthStore((estado) => estado.temPermissao('especialidades.ver'))
  const consultaEspecialidades = useQuery({
    queryKey: chaves.especialidades(),
    queryFn: especialidades.listar,
    enabled: podeVerEspecialidades,
  })
  const mapaEspecialidades = new Map(
    (consultaEspecialidades.data ?? []).map((especialidade) => [especialidade.id, especialidade.nome]),
  )

  const podeEditar = useAuthStore((estado) => estado.temPermissao('anamnese_modelos.editar'))
  const podeExcluir = useAuthStore((estado) => estado.temPermissao('anamnese_modelos.excluir'))
  const temAcoes = podeEditar || podeExcluir

  const { erros, limparErros, criar, atualizar, excluir, salvando, excluindo } =
    usarMutacaoDeCatalogo<AnamneseModelo, PayloadAnamneseModelo>({
      recurso: anamneseModelos,
      chave: chaves.modelosDeAnamnese(),
      campos: CAMPOS,
      rotuloSingular: 'modelo',
      genero: 'm',
    })

  const [emEdicao, setEmEdicao] = useState<AnamneseModelo | null>(null)
  const [formularioAberto, setFormularioAberto] = useState(false)
  const [valores, setValores] = useState<Valores>(() => valoresIniciais())
  const [errosCliente, setErrosCliente] = useState<ErrosDoModelo>(ERROS_VAZIOS)
  const [aExcluir, setAExcluir] = useState<AnamneseModelo | null>(null)

  const modelos = consulta.data ?? []

  function definir(parciais: Partial<Valores>): void {
    setValores((anteriores) => ({ ...anteriores, ...parciais }))
  }

  function abrirFormulario(modelo?: AnamneseModelo): void {
    limparErros()
    setErrosCliente(ERROS_VAZIOS)
    setEmEdicao(modelo ?? null)
    setValores(valoresIniciais(modelo))
    setFormularioAberto(true)
  }

  function paraPayload(): PayloadAnamneseModelo {
    return {
      titulo: valores.titulo.trim(),
      especialidade_id: valores.especialidadeId === '' ? null : Number(valores.especialidadeId),
      ativo: valores.ativo,
      campos_json: paraCamposJson(valores.campos),
    }
  }

  function salvar(): void {
    const payload = paraPayload()
    const fechar = { onSuccess: () => setFormularioAberto(false) }
    if (emEdicao === null) {
      criar.mutate(payload, fechar)
      return
    }
    atualizar.mutate({ id: emEdicao.id, payload, versao: emEdicao.updated_at }, fechar)
  }

  function submeter(evento: FormEvent): void {
    evento.preventDefault()
    const validacao = validarModelo(valores.titulo, valores.campos)
    setErrosCliente(validacao)
    if (temErroDeModelo(validacao)) {
      return // bloqueia antes da rede — a recusa aparece no campo/linha
    }
    salvar()
  }

  /**
   * Ativar/inativar sem abrir o form: o `index` já traz `campos_json`, então a linha
   * tem o payload completo (o servidor exige `campos_json` no `update`). Inverte `ativo`
   * e reusa a mesma mutação (concorrência otimista + invalidação + toast).
   */
  function alternarAtivo(modelo: AnamneseModelo): void {
    atualizar.mutate({
      id: modelo.id,
      payload: {
        titulo: modelo.titulo,
        especialidade_id: modelo.especialidade_id,
        ativo: !modelo.ativo,
        campos_json: modelo.campos_json,
      },
      versao: modelo.updated_at,
    })
  }

  return (
    <section className="flex flex-col gap-6">
      <CabecalhoDeCadastro
        titulo="Modelos de anamnese"
        voltar={{ rota: '/cadastros', rotulo: 'Cadastros' }}
        contador={consulta.isSuccess ? `${modelos.length} ${modelos.length === 1 ? 'modelo' : 'modelos'}` : undefined}
        acao={
          <ProtegidoPorPermissao permissao="anamnese_modelos.criar">
            <Botao
              onClick={() => {
                abrirFormulario()
              }}
            >
              <Plus aria-hidden="true" className="size-4" />
              Cadastrar modelo
            </Botao>
          </ProtegidoPorPermissao>
        }
      />

      <EstadosDaLista
        carregando={consulta.isPending}
        erro={consulta.isError}
        aoTentarNovamente={() => {
          void consulta.refetch()
        }}
        vazio={consulta.isSuccess && modelos.length === 0}
        vazioTitulo="Nenhum modelo de anamnese"
        vazioDescricao="Crie um modelo para que a equipe possa preencher a anamnese na ficha do paciente."
        vazioAcao={
          <ProtegidoPorPermissao permissao="anamnese_modelos.criar">
            <Botao
              onClick={() => {
                abrirFormulario()
              }}
            >
              <Plus aria-hidden="true" className="size-4" />
              Cadastrar modelo
            </Botao>
          </ProtegidoPorPermissao>
        }
      >
        <Tabela legenda={`${modelos.length} modelos de anamnese`}>
          <Tabela.Cabecalho>
            <Tabela.Linha>
              <Tabela.CelulaCabecalho scope="col">Modelo</Tabela.CelulaCabecalho>
              <Tabela.CelulaCabecalho scope="col">Especialidade</Tabela.CelulaCabecalho>
              <Tabela.CelulaCabecalho scope="col">Campos</Tabela.CelulaCabecalho>
              <Tabela.CelulaCabecalho scope="col">Situação</Tabela.CelulaCabecalho>
              {temAcoes ? <Tabela.CelulaCabecalho scope="col">Ações</Tabela.CelulaCabecalho> : null}
            </Tabela.Linha>
          </Tabela.Cabecalho>
          <Tabela.Corpo>
            {modelos.map((modelo) => (
              <Tabela.Linha key={modelo.id}>
                <Tabela.Celula className="text-texto">{modelo.titulo}</Tabela.Celula>
                <Tabela.Celula className="text-texto-suave">
                  {modelo.especialidade_id === null
                    ? '—'
                    : (mapaEspecialidades.get(modelo.especialidade_id) ?? '—')}
                </Tabela.Celula>
                <Tabela.Celula className="text-texto-suave tabular-nums">
                  {modelo.campos_json.length}
                </Tabela.Celula>
                <Tabela.Celula>
                  <span
                    className={cn(
                      'inline-flex items-center gap-1.5 text-meta',
                      modelo.ativo ? 'text-texto' : 'text-texto-suave',
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn('size-1.5 rounded-full', modelo.ativo ? 'bg-acento' : 'bg-neutro-desativado')}
                    />
                    {modelo.ativo ? 'Ativo' : 'Inativo'}
                  </span>
                </Tabela.Celula>
                {temAcoes ? (
                  <Tabela.Celula>
                    <div className="flex gap-2">
                      <ProtegidoPorPermissao permissao="anamnese_modelos.editar">
                        <Botao
                          variante="secundario"
                          tamanho="sm"
                          onClick={() => {
                            abrirFormulario(modelo)
                          }}
                        >
                          <Pencil aria-hidden="true" className="size-3.5" />
                          Editar
                        </Botao>
                      </ProtegidoPorPermissao>
                      <ProtegidoPorPermissao permissao="anamnese_modelos.editar">
                        <Botao
                          variante="fantasma"
                          tamanho="sm"
                          disabled={salvando}
                          onClick={() => {
                            alternarAtivo(modelo)
                          }}
                        >
                          <Power aria-hidden="true" className="size-3.5" />
                          {modelo.ativo ? 'Inativar' : 'Ativar'}
                        </Botao>
                      </ProtegidoPorPermissao>
                      <ProtegidoPorPermissao permissao="anamnese_modelos.excluir">
                        <Botao
                          variante="perigo-suave"
                          tamanho="sm"
                          onClick={() => {
                            limparErros()
                            setAExcluir(modelo)
                          }}
                        >
                          <Trash2 aria-hidden="true" className="size-3.5" />
                          Excluir
                        </Botao>
                      </ProtegidoPorPermissao>
                    </div>
                  </Tabela.Celula>
                ) : null}
              </Tabela.Linha>
            ))}
          </Tabela.Corpo>
        </Tabela>
      </EstadosDaLista>

      {formularioAberto ? (
        <AlertDialog.Root
          open
          onOpenChange={(aberto) => {
            if (!aberto && !salvando) setFormularioAberto(false)
          }}
        >
          <AlertDialog.Portal>
            <AlertDialog.Overlay className="fixed inset-0 z-(--z-scrim) bg-texto/40" />
            <AlertDialog.Content className="fixed left-1/2 top-1/2 z-(--z-dialogo) max-h-[90vh] w-full max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-janela bg-superficie-elevada p-6 shadow-e3">
              <AlertDialog.Title className="text-titulo font-semibold text-texto">
                {emEdicao === null ? 'Cadastrar modelo de anamnese' : `Editar ${emEdicao.titulo}`}
              </AlertDialog.Title>
              <AlertDialog.Description className="sr-only">
                Defina o título e os campos que compõem esta ficha inicial de anamnese.
              </AlertDialog.Description>

              <form onSubmit={submeter} className="mt-5 flex flex-col gap-4">
                <AvisoErro mensagens={erros.gerais} />

                <CampoTexto
                  rotulo="Título do modelo"
                  obrigatorio
                  value={valores.titulo}
                  onChange={(evento) => {
                    definir({ titulo: evento.target.value })
                  }}
                  erro={errosCliente.titulo ?? erros.campos.get('titulo')}
                />

                {podeVerEspecialidades ? (
                  <CampoSelect
                    rotulo="Especialidade"
                    ajuda="Opcional — deixe em branco para um modelo geral."
                    value={valores.especialidadeId}
                    onChange={(evento) => {
                      definir({ especialidadeId: evento.target.value })
                    }}
                    opcoes={[
                      { valor: '', rotulo: 'Nenhuma (modelo geral)' },
                      ...(consultaEspecialidades.data ?? []).map((especialidade) => ({
                        valor: String(especialidade.id),
                        rotulo: especialidade.nome,
                      })),
                    ]}
                    erro={erros.campos.get('especialidade_id')}
                  />
                ) : null}

                <BuilderDeCampos
                  campos={valores.campos}
                  aoMudar={(campos) => {
                    definir({ campos })
                  }}
                  erros={erros}
                  errosCliente={errosCliente}
                />

                <CampoCheckbox
                  rotulo="Modelo ativo"
                  ajuda="Só modelos ativos aparecem no seletor de Nova anamnese, na ficha do paciente."
                  marcado={valores.ativo}
                  aoMudar={(marcado) => {
                    definir({ ativo: marcado })
                  }}
                />

                <div className="mt-2 flex justify-end gap-3">
                  <Botao
                    type="button"
                    variante="secundario"
                    tamanho="lg"
                    disabled={salvando}
                    onClick={() => {
                      setFormularioAberto(false)
                    }}
                  >
                    Cancelar
                  </Botao>
                  <Botao type="submit" tamanho="lg" carregando={salvando}>
                    {emEdicao === null ? 'Cadastrar' : 'Salvar'}
                  </Botao>
                </div>
              </form>
            </AlertDialog.Content>
          </AlertDialog.Portal>
        </AlertDialog.Root>
      ) : null}

      {/* Exclusão PROTEGIDA no servidor: modelo em uso → 422 com a chave da entidade,
          que cai em `gerais` — a promessa rejeita, o diálogo fica aberto e o modelo
          permanece íntegro. */}
      <DialogConfirmacao
        aberto={aExcluir !== null}
        aoMudarAberto={(aberto) => {
          if (!aberto) setAExcluir(null)
        }}
        titulo={aExcluir !== null ? `Excluir ${aExcluir.titulo}?` : ''}
        consequencia="Um modelo vinculado a anamneses já preenchidas não pode ser excluído — o sistema recusa. Para tirá-lo de circulação sem apagar, use Inativar."
        rotuloConfirmar="Excluir modelo"
        tom="perigo"
        carregando={excluindo}
        erros={erros.gerais}
        aoConfirmar={() =>
          new Promise<void>((resolver, rejeitar) => {
            if (aExcluir === null) {
              resolver()
              return
            }
            excluir.mutate(aExcluir.id, {
              onSuccess: () => {
                setAExcluir(null)
                resolver()
              },
              onError: () => {
                rejeitar(new Error('recusado'))
              },
            })
          })
        }
      />
    </section>
  )
}
