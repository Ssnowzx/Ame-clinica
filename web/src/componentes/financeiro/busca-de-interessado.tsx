import { useQuery } from '@tanstack/react-query'
import { UserRoundPlus, X } from 'lucide-react'
import { useRef, useState } from 'react'

import { DialogoDeInteressado } from '@/componentes/financeiro/dialogo-de-interessado'
import { FORNECEDORES, FUNCIONARIOS } from '@/componentes/financeiro/modulos-de-interessado'
import { Botao } from '@/componentes/ui/botao'
import { CampoSelect } from '@/componentes/ui/campo-select'
import { usarDebounce } from '@/hooks/usar-debounce'
import { cn } from '@/lib/cn'
import { buscarInteressados } from '@/servicos/financeiro'
import { useAuthStore } from '@/stores/auth-store'
import type { InteressadoTipo } from '@/tipos'

/** A permissão de leitura de cada tipo de interessado — a busca é gated por ela. */
const PERMISSAO_POR_TIPO: Record<InteressadoTipo, string> = {
  paciente: 'pacientes.ver',
  fornecedor: 'fornecedores.ver',
  funcionario: 'funcionarios.ver',
}

const ROTULO_POR_TIPO: Record<InteressadoTipo, string> = {
  paciente: 'Paciente',
  fornecedor: 'Fornecedor',
  funcionario: 'Funcionário',
}

export interface InteressadoSelecionado {
  tipo: InteressadoTipo
  id: number
  nome: string
  /**
   * A categoria PADRÃO do fornecedor (change `caixa-do-dia-a-dia`, design D6): o formulário a
   * copia para uma despesa com a categoria vazia. Ausente em paciente, funcionário e no interessado
   * de um lançamento já gravado — ali não há o que preencher.
   */
  categoria_id?: number | null
  subcategoria_id?: number | null
}

export interface BuscaDeInteressadoProps {
  /** Seleção atual (ou `null` = "Nenhum") */
  selecionado: InteressadoSelecionado | null
  aoMudar: (selecionado: InteressadoSelecionado | null) => void
  erro?: string
}

/** Quem pode cadastrar cada tipo pelo lançamento — paciente não: a ficha da criança tem o seu fluxo. */
const PERMISSAO_DE_CADASTRAR: Partial<Record<InteressadoTipo, string>> = {
  fornecedor: 'fornecedores.criar',
  funcionario: 'funcionarios.criar',
}

/**
 * O interessado do lançamento (§9) — paciente, fornecedor ou funcionário, OPCIONAL.
 *
 * A busca de cada tipo é gated pela sua permissão: quem não pode ler pacientes não
 * vê a busca de pacientes (o servidor negaria a query de qualquer forma — o campo
 * não promete o que a API recusa). O nome do menor é o dado mínimo; CPF fica no recibo.
 *
 * Fornecedor e funcionário têm CADASTRO RÁPIDO (design D5): "Cadastrar novo" abre o mesmo
 * formulário da tela do módulo, na versão curta, POR CIMA do lançamento — que não desmonta e não
 * perde nada do que já foi digitado. O recém-cadastrado volta escolhido. A oferta vem DEPOIS dos
 * resultados da busca, de propósito: os parecidos aparecem antes, e o cadastro em dobro fica mais
 * difícil.
 */
export function BuscaDeInteressado({ selecionado, aoMudar, erro }: BuscaDeInteressadoProps) {
  const [tipo, setTipo] = useState<'' | InteressadoTipo>(selecionado?.tipo ?? '')
  const [termo, setTermo] = useState('')
  const [cadastrando, setCadastrando] = useState(false)
  const termoAtrasado = usarDebounce(termo, 300)
  const refDoCadastrar = useRef<HTMLButtonElement>(null)
  const refDaSelecao = useRef<HTMLSpanElement>(null)

  const temPermissao = useAuthStore((estado) => estado.temPermissao)
  const podeBuscar = tipo !== '' && temPermissao(PERMISSAO_POR_TIPO[tipo])
  const permissaoDeCadastrar = tipo === '' ? undefined : PERMISSAO_DE_CADASTRAR[tipo]
  const podeCadastrar = permissaoDeCadastrar !== undefined && temPermissao(permissaoDeCadastrar)

  const consulta = useQuery({
    queryKey: ['interessado-busca', tipo, termoAtrasado],
    queryFn: () => buscarInteressados(tipo as InteressadoTipo, termoAtrasado),
    enabled: podeBuscar && termoAtrasado.trim().length >= 2 && selecionado === null,
  })

  function trocarTipo(novo: string): void {
    setTipo(novo as '' | InteressadoTipo)
    setTermo('')
    aoMudar(null)
  }

  function escolherCadastrado(novo: InteressadoSelecionado): void {
    setTermo('')
    aoMudar(novo)
  }

  /** O foco vai para o NOME escolhido — o botão que abriu a janela não existe mais. */
  function focoDepoisDoCadastro(): HTMLElement | null {
    return refDaSelecao.current ?? refDoCadastrar.current
  }

  const resultados = consulta.data ?? []
  const rotuloDoTipo = tipo === '' ? '' : ROTULO_POR_TIPO[tipo].toLowerCase()

  return (
    <fieldset className="flex flex-col gap-3 rounded-campo border border-linha p-3">
      <legend className="px-1 text-rotulo font-medium text-texto-suave">Interessado (opcional)</legend>

      <CampoSelect
        rotulo="Tipo de interessado"
        value={tipo}
        onChange={(evento) => {
          trocarTipo(evento.target.value)
        }}
        opcoes={[
          { valor: '', rotulo: 'Nenhum' },
          { valor: 'paciente', rotulo: 'Paciente' },
          { valor: 'fornecedor', rotulo: 'Fornecedor' },
          { valor: 'funcionario', rotulo: 'Funcionário' },
        ]}
        erro={erro}
      />

      {tipo === '' ? null : selecionado !== null ? (
        <div className="flex items-center justify-between gap-2 rounded-campo bg-fundo px-3 py-2">
          {/* focável por programa (fora do Tab): é aqui que o foco pousa quando o cadastro rápido
              devolve o recém-cadastrado, para o leitor de tela dizer QUEM foi escolhido */}
          <span
            ref={refDaSelecao}
            tabIndex={-1}
            className="truncate text-corpo text-texto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco"
          >
            {ROTULO_POR_TIPO[selecionado.tipo]}: {selecionado.nome}
          </span>
          <Botao
            variante="fantasma"
            tamanho="sm"
            aria-label="Remover interessado"
            onClick={() => {
              aoMudar(null)
              setTermo('')
            }}
          >
            <X aria-hidden="true" className="size-4" />
          </Botao>
        </div>
      ) : !podeBuscar ? (
        <p className="text-meta text-texto-suave">
          Você não tem permissão para buscar {rotuloDoTipo}.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          <input
            type="search"
            value={termo}
            placeholder={`Buscar ${rotuloDoTipo}…`}
            // o termo pode ser o NOME de um menor: fora do autofill/corretor (D2)
            autoComplete="off"
            spellCheck={false}
            onChange={(evento) => {
              setTermo(evento.target.value)
            }}
            className="h-10 w-full rounded-campo border border-borda-campo bg-superficie px-3 text-corpo-lg text-texto placeholder:text-texto-suave focus-visible:border-foco"
          />
          {termoAtrasado.trim().length >= 2 && consulta.isSuccess && resultados.length === 0 ? (
            <p className="text-meta text-texto-suave">Nenhum resultado.</p>
          ) : null}
          {resultados.length > 0 ? (
            <ul className="flex max-h-40 flex-col gap-1 overflow-auto">
              {resultados.map((opcao) => (
                <li key={opcao.id}>
                  <button
                    type="button"
                    onClick={() => {
                      aoMudar({
                        tipo: tipo as InteressadoTipo,
                        id: opcao.id,
                        nome: opcao.nome,
                        categoria_id: opcao.categoria_id,
                        subcategoria_id: opcao.subcategoria_id,
                      })
                    }}
                    className={cn(
                      'w-full truncate rounded-campo px-3 py-2 text-left text-corpo text-texto',
                      'hover:bg-acento-suave focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco',
                    )}
                  >
                    {opcao.nome}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {podeCadastrar ? (
            <Botao
              ref={refDoCadastrar}
              type="button"
              variante="secundario"
              tamanho="sm"
              className="self-start"
              onClick={() => {
                setCadastrando(true)
              }}
            >
              <UserRoundPlus aria-hidden="true" className="size-4" />
              Cadastrar novo {rotuloDoTipo}
            </Botao>
          ) : null}
        </div>
      )}

      {cadastrando && tipo === 'fornecedor' ? (
        <DialogoDeInteressado
          modulo={FORNECEDORES}
          registro={null}
          curto
          empilhada
          nomeSugerido={termo.trim()}
          aoFechar={() => {
            setCadastrando(false)
          }}
          aoSalvar={(novo) => {
            escolherCadastrado(FORNECEDORES.comoInteressado(novo))
          }}
          focoAoFechar={focoDepoisDoCadastro}
        />
      ) : null}
      {cadastrando && tipo === 'funcionario' ? (
        <DialogoDeInteressado
          modulo={FUNCIONARIOS}
          registro={null}
          curto
          empilhada
          nomeSugerido={termo.trim()}
          aoFechar={() => {
            setCadastrando(false)
          }}
          aoSalvar={(novo) => {
            escolherCadastrado(FUNCIONARIOS.comoInteressado(novo))
          }}
          focoAoFechar={focoDepoisDoCadastro}
        />
      ) : null}
    </fieldset>
  )
}
