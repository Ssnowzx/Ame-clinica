import { useQuery } from '@tanstack/react-query'
import { Pencil } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { Botao } from '@/componentes/ui/botao'
import { EstadoErro } from '@/componentes/ui/estado-erro'
import { ListaDescricao, type ItemDescricao } from '@/componentes/ui/lista-descricao'
import { Skeleton } from '@/componentes/ui/skeleton'
import { chaves } from '@/lib/chaves-query'
import { dataLegivel } from '@/lib/datas'
// `aceito_em` do consentimento é um INSTANTE ISO (com offset) — a versão de `pacientes`
// (via `new Date`+Intl) é a correta para instante; o alias evita confundir com a
// homônima de `datas` (que é para a parede-da-clínica "Y-m-d H:i")
import {
  dataHoraLegivel as dataHoraDoInstante,
  formatarCpf,
  idadeEm,
  ROTULOS_DE_CONTATO,
  ROTULOS_DE_SEXO,
  rotuloDaNecessidade,
} from '@/lib/pacientes'
import { buscarPaciente } from '@/servicos/pacientes'
import { useAuthStore } from '@/stores/auth-store'
import type { EnderecoDoPaciente, Paciente } from '@/tipos'

interface SecaoCadastroProps {
  pacienteId: number
}

function enderecoLegivel(endereco: EnderecoDoPaciente | null): string | null {
  if (endereco === null) {
    return null
  }
  const linha = [
    [endereco.logradouro, endereco.numero].filter(Boolean).join(', '),
    endereco.complemento,
    endereco.bairro,
    [endereco.cidade, endereco.uf].filter(Boolean).join(' - '),
    endereco.cep,
  ]
    .filter((parte) => parte !== undefined && parte !== null && parte !== '')
    .join(' · ')
  return linha === '' ? null : linha
}

/**
 * Seção Cadastro (ficha do paciente) — LEITURA em `DescriptionList` (Decisão 5),
 * nunca o formulário cinza com fieldset desabilitado. A edição é DESTINO: o
 * "Editar" (sob `pacientes.editar`) leva à rota-destino `/pacientes/:id/editar`.
 *
 * Reusa a chave `chaves.paciente` (o cadastro é o mesmo dado do formulário de
 * edição) com `gcTime: 0` — contrato do gatilho CHAVE-DETALHE (a chave é DETALHE).
 */
export function SecaoCadastro({ pacienteId }: SecaoCadastroProps) {
  const navigate = useNavigate()
  const podeEditar = useAuthStore((estado) => estado.temPermissao('pacientes.editar'))

  const consulta = useQuery({
    queryKey: chaves.paciente(pacienteId),
    queryFn: () => buscarPaciente(pacienteId),
    // chave de DETALHE: o formulário de edição hidrata `useState` a partir dela,
    // então TODA leitura dessa chave declara gcTime: 0 (senão o Math.max do
    // updateGcTime reergue o cache e a bomba do CHAVE-DETALHE volta armada)
    gcTime: 0,
  })

  if (consulta.isPending) {
    return (
      <div aria-busy className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {[0, 1, 2, 3, 4, 5].map((indice) => (
          <div key={indice}>
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-2 h-4 w-40" />
          </div>
        ))}
      </div>
    )
  }

  if (consulta.isError) {
    return (
      <EstadoErro
        mensagem="Não foi possível carregar o cadastro do paciente."
        aoTentarNovamente={() => void consulta.refetch()}
      />
    )
  }

  const paciente: Paciente = consulta.data
  const endereco = enderecoLegivel(paciente.endereco_json)
  // as colunas JSON vêm NULL do servidor quando vazias (o tipo diz array, mas mente —
  // o formulário já se protege com `?? []`); sem isto, `null.length` derruba a ficha
  const responsaveis = paciente.responsaveis_json ?? []
  const contatos = paciente.contatos_json ?? []
  const consentimentos = paciente.consentimentos_json ?? []

  const identificacao: ItemDescricao[] = [
    { rotulo: 'Nome', valor: paciente.nome },
    ...(paciente.nome_social !== null && paciente.nome_social !== ''
      ? [{ rotulo: 'Nome social', valor: paciente.nome_social }]
      : []),
    { rotulo: 'Nascimento', valor: `${dataLegivel(paciente.nascimento)} · ${idadeEm(paciente.nascimento)}` },
    { rotulo: 'Sexo', valor: ROTULOS_DE_SEXO[paciente.sexo] },
    { rotulo: 'CPF', valor: paciente.cpf !== null ? formatarCpf(paciente.cpf) : '—' },
    { rotulo: 'Necessidade', valor: rotuloDaNecessidade(paciente.necessidade) },
    /*
     * O convênio VIGENTE, na ficha (change convenio-no-cadastro-do-paciente, task 7.8).
     *
     * Esta é a tela que a recepção abre para atender. Sem estes campos aqui, o pedido
     * original — "não precisar abrir um pacote para saber de que plano a família é" —
     * ficava pela metade: ela deixaria de abrir um pacote para passar a clicar em
     * "Editar". O design tinha classificado isto como pergunta adiável, e a conferência
     * ao vivo mostrou que não era.
     *
     * Só aparecem quando existem: criança particular sem plano não ganha três linhas com
     * travessão. A carteirinha é da classe do CPF — vive no DETALHE, nunca em listagem.
     */
    ...(paciente.convenio !== null
      ? [{ rotulo: 'Convênio', valor: paciente.convenio.nome }]
      : []),
    ...(paciente.plano !== null && paciente.plano !== ''
      ? [{ rotulo: 'Plano', valor: paciente.plano }]
      : []),
    ...(paciente.carteirinha !== null && paciente.carteirinha !== ''
      ? [{ rotulo: 'Carteirinha', valor: paciente.carteirinha }]
      : []),
    ...(paciente.carteirinha_validade !== null
      ? [{ rotulo: 'Validade da carteirinha', valor: dataLegivel(paciente.carteirinha_validade) }]
      : []),
    ...(paciente.indicacao !== null && paciente.indicacao !== ''
      ? [{ rotulo: 'Indicação', valor: paciente.indicacao }]
      : []),
    ...(endereco !== null ? [{ rotulo: 'Endereço', valor: endereco, larguraTotal: true }] : []),
    ...(paciente.obs !== null && paciente.obs !== ''
      ? [{ rotulo: 'Observação', valor: paciente.obs, larguraTotal: true }]
      : []),
  ]

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-3">
        <ListaDescricao itens={identificacao} className="flex-1" />
        {podeEditar ? (
          <Botao
            variante="secundario"
            onClick={() => navigate(`/pacientes/${pacienteId}/editar`)}
          >
            <Pencil aria-hidden className="size-4" />
            Editar
          </Botao>
        ) : null}
      </div>

      {responsaveis.length > 0 ? (
        <section>
          <h3 className="text-rotulo font-semibold text-texto-suave">Responsáveis</h3>
          <ul className="mt-2 flex flex-col gap-1.5">
            {responsaveis.map((responsavel, indice) => (
              <li key={indice} className="text-corpo text-texto">
                {responsavel.nome}
                <span className="text-texto-suave"> · {responsavel.parentesco}</span>
                {responsavel.telefone !== undefined && responsavel.telefone !== null && responsavel.telefone !== ''
                  ? <span className="text-texto-suave"> · {responsavel.telefone}</span>
                  : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {contatos.length > 0 ? (
        <section>
          <h3 className="text-rotulo font-semibold text-texto-suave">Contatos</h3>
          <ul className="mt-2 flex flex-col gap-1.5">
            {contatos.map((contato, indice) => (
              <li key={indice} className="text-corpo text-texto">
                <span className="text-texto-suave">{ROTULOS_DE_CONTATO[contato.tipo]}: </span>
                {contato.valor}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {consentimentos.length > 0 ? (
        <section>
          <h3 className="text-rotulo font-semibold text-texto-suave">Consentimentos</h3>
          <ul className="mt-2 flex flex-col gap-1.5">
            {consentimentos.map((consentimento, indice) => (
              <li key={indice} className="text-corpo text-texto">
                {consentimento.termo}
                <span className="text-texto-suave">
                  {' '}· {consentimento.responsavel} · {dataHoraDoInstante(consentimento.aceito_em)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}
