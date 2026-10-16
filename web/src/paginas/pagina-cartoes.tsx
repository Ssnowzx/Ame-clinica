import { useQuery } from '@tanstack/react-query'

import { TelaDeCatalogo } from '@/componentes/cadastro/tela-de-catalogo'
import { AvisoDePreRequisito } from '@/componentes/ui/aviso-de-pre-requisito'
import { CAMINHOS } from '@/lib/caminhos-dos-cadastros'
import { CampoCheckbox } from '@/componentes/ui/campo-checkbox'
import { CampoSelect } from '@/componentes/ui/campo-select'
import { CampoTexto } from '@/componentes/ui/campo-texto'
import { Etiqueta } from '@/componentes/ui/etiqueta'
import { Segmento } from '@/componentes/ui/segmento'
import { chaves } from '@/lib/chaves-query'
import { formatarPercentual, paraDecimalDaApi } from '@/lib/dinheiro'
import { cartoes, contas } from '@/servicos/financeiro'
import type { Bandeira, CartaoFinanceiro, PayloadCartao, RotuloDeParcela, TipoDeCartao } from '@/tipos'

/** `Cartao::PARCELAS` do servidor, na ordem que a operadora costuma anunciar. */
const PARCELAS: readonly RotuloDeParcela[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12']

const ROTULO_DA_PARCELA: Record<RotuloDeParcela, string> = {
  '2': '2x',
  '3': '3x',
  '4': '4x',
  '5': '5x',
  '6': '6x',
  '7': '7x',
  '8': '8x',
  '9': '9x',
  '10': '10x',
  '11': '11x',
  '12': '12x ou mais',
}

// A RAIZ basta: `distribuirErrosDoServidor` casa pelo primeiro segmento antes do ponto
// (`chave.split('.')[0]`) e guarda a chave INTEIRA no mapa — "pct_parcelas.6" chega ao
// campo certo porque a raiz "pct_parcelas" está aqui, não porque as 11 chaves estão.
const CAMPOS = new Set([
  'nome',
  'tipo',
  'bandeira',
  'pct_a_vista',
  'pct_parcelas',
  'dias_recebimento',
  'conta_id',
  'liquidar_auto',
  'antecipacao_credito',
])

interface Valores {
  nome: string
  tipo: TipoDeCartao
  bandeira: Bandeira | ''
  pct_a_vista: string
  /** Um valor por faixa (string vazia = não preenchida), nunca o objeto do payload direto. */
  parcelas: Record<RotuloDeParcela, string>
  dias_recebimento: string
  conta_id: string
  liquidar_auto: boolean
  antecipacao_credito: boolean
}

/** Domínio FECHADO (`Cartao::TIPOS`): estreitar por verificação, nunca por `as`. */
function tipoValido(valor: string): valor is TipoDeCartao {
  return valor === 'credito' || valor === 'debito'
}

const ROTULO_DO_TIPO: Record<TipoDeCartao, string> = {
  credito: 'Crédito',
  debito: 'Débito',
}

const ROTULO_DA_BANDEIRA: Record<Bandeira, string> = {
  visa: 'Visa',
  mastercard: 'Mastercard',
  elo: 'Elo',
  hipercard: 'Hipercard',
  amex: 'Amex',
  banescard: 'Banescard',
  outra: 'Outra',
}

const PARCELAS_VAZIAS: Record<RotuloDeParcela, string> = {
  '2': '',
  '3': '',
  '4': '',
  '5': '',
  '6': '',
  '7': '',
  '8': '',
  '9': '',
  '10': '',
  '11': '',
  '12': '',
}

/**
 * As máquinas de cartão da clínica (§9). No v1 isto é CADASTRO: taxa, prazo,
 * liquidação, bandeira, taxa por parcela e antecipação de crédito ficam guardados,
 * mas nada é descontado nem creditado sozinho — a engine de recebíveis é fase 2, e
 * a tela diz isso para ninguém esperar movimento de caixa que ainda não existe
 * (change `bandeira-e-parcelas-do-cartao`, comparado ao vivo com o ClinicaÁgil).
 */
export function PaginaCartoes() {
  const listaDeContas = useQuery({ queryKey: chaves.contas(), queryFn: contas.listar })
  const opcoesDeConta = (listaDeContas.data ?? []).map((conta) => ({
    valor: String(conta.id),
    rotulo: conta.nome,
  }))

  // A conta de destino decide PARA ONDE vai o dinheiro do cartão, e o servidor a exige.
  // Sem tratar os dois modos de "não há o que escolher", esta tela reintroduzia o beco
  // sem saída que a própria change veio matar (achados IMP-1/A2/SEC-CFT-02 do gate):
  // vazio ⇒ o caminho do cadastro; 403 (quem tem `cartoes.ver` sem `contas.ver`) ⇒ o
  // aviso de acesso, nunca um seletor mudo e uma coluna com "—".
  const contasVazias = listaDeContas.isSuccess && listaDeContas.data.length === 0
  const contasComErro = listaDeContas.isError

  return (
    <TelaDeCatalogo<CartaoFinanceiro, PayloadCartao, Valores>
      titulo="Cartões"
      modulo="cartoes"
      rotuloSingular="cartão"
      genero="m"
      chave={chaves.cartoes()}
      listar={cartoes.listar}
      recurso={cartoes}
      campos={CAMPOS}
      colunas={[
        {
          cabecalho: 'Cartão',
          celula: (cartao) => (
            <span className="flex items-center gap-2">
              {cartao.nome}
              {cartao.bandeira !== null ? (
                <Etiqueta tom="neutro">{ROTULO_DA_BANDEIRA[cartao.bandeira]}</Etiqueta>
              ) : null}
            </span>
          ),
        },
        { cabecalho: 'Tipo', celula: (cartao) => ROTULO_DO_TIPO[cartao.tipo] },
        { cabecalho: 'Taxa à vista', celula: (cartao) => formatarPercentual(cartao.pct_a_vista) },
        {
          cabecalho: 'Recebimento',
          celula: (cartao) =>
            cartao.dias_recebimento === 0 ? 'No mesmo dia' : `${cartao.dias_recebimento} dias`,
        },
        {
          cabecalho: 'Conta',
          celula: (cartao) => {
            const conta = (listaDeContas.data ?? []).find((item) => item.id === cartao.conta_id)
            if (conta !== undefined) return conta.nome
            // "—" mentiria: o cartão TEM conta; quem não a vê é esta tela
            return (
              <span className="text-texto-suave">
                {contasComErro ? 'Sem acesso às contas' : '—'}
              </span>
            )
          },
        },
      ]}
      valoresIniciais={(cartao) => ({
        nome: cartao?.nome ?? '',
        tipo: cartao?.tipo ?? 'credito',
        bandeira: cartao?.bandeira ?? '',
        // hidrata com vírgula: o campo é de leitura E escrita da MESMA pessoa
        pct_a_vista: cartao === undefined ? '' : cartao.pct_a_vista.replace('.', ','),
        parcelas: {
          ...PARCELAS_VAZIAS,
          ...Object.fromEntries(
            Object.entries(cartao?.pct_parcelas ?? {}).map(([parcela, valor]) => [
              parcela,
              valor.replace('.', ','),
            ]),
          ),
        },
        dias_recebimento: cartao === undefined ? '' : String(cartao.dias_recebimento),
        conta_id: cartao === undefined ? '' : String(cartao.conta_id),
        liquidar_auto: cartao?.liquidar_auto ?? false,
        antecipacao_credito: cartao?.antecipacao_credito ?? false,
      })}
      paraPayload={(valores) => {
        // Só as faixas PREENCHIDAS entram no OBJETO — mas a CHAVE `pct_parcelas` do
        // payload vai SEMPRE, mesmo `{}`. Omitir a chave (o que esta função fazia antes)
        // e "não ter faixa nenhuma" são coisas DIFERENTES para o servidor: a chave
        // ausente, com `sometimes` no request, significa "não mexi nisso" — apagar a
        // ÚLTIMA faixa preenchida produzia exatamente esse payload, e o servidor
        // preservava as parcelas antigas em silêncio (achado do gate, o mesmo bug que
        // a bandeira tinha). O mesmo vale para `bandeira`: `null` explícito É a limpeza;
        // chave ausente NÃO é.
        const parcelas = Object.fromEntries(
          PARCELAS.map((parcela) => [parcela, paraDecimalDaApi(valores.parcelas[parcela])]).filter(
            ([, valor]) => valor !== '',
          ),
        ) as Partial<Record<RotuloDeParcela, string>>

        return {
          nome: valores.nome,
          tipo: valores.tipo,
          bandeira: valores.bandeira === '' ? null : valores.bandeira,
          // a operadora digita "2,99", que é como se escreve em português; o servidor
          // espera "2.99" (mesma conversão do valor do lançamento)
          pct_a_vista: paraDecimalDaApi(valores.pct_a_vista),
          pct_parcelas: parcelas,
          dias_recebimento: Number(valores.dias_recebimento),
          conta_id: Number(valores.conta_id),
          liquidar_auto: valores.liquidar_auto,
          antecipacao_credito: valores.antecipacao_credito,
        }
      }}
      nomeDoRegistro={(cartao) => cartao.nome}
      // a conta de destino decide PARA ONDE o dinheiro vai; o tipo muda como a
      // clínica lê o recebimento — nenhum dos dois é preferência de tela (§2/§13).
      // Bandeira, taxa por parcela e antecipação são informativos: mudá-los não
      // altera nenhum lançamento já feito.
      consequenciasDaRegra={(valores, original) => {
        if (original === undefined) return []
        const mudancas: string[] = []
        if (original.conta_id !== Number(valores.conta_id)) {
          mudancas.push('O dinheiro deste cartão passa a ser considerado em outra conta.')
        }
        if (original.tipo !== valores.tipo) {
          mudancas.push(
            `O cartão deixa de ser ${ROTULO_DO_TIPO[original.tipo].toLowerCase()} e passa a ser ${ROTULO_DO_TIPO[valores.tipo].toLowerCase()}.`,
          )
        }
        return mudancas
      }}
      consequenciaDaExclusao="O cartão sai do cadastro. Os lançamentos já feitos continuam como estão."
      podeSalvar={!contasVazias && !contasComErro}
      vazioTitulo="Nenhum cartão cadastrado"
      vazioDescricao="Cadastre as máquinas da clínica para registrar a taxa e o prazo de cada uma."
      formulario={({ valores, definir, erros }) => (
        <>
          <CampoTexto
            rotulo="Nome"
            obrigatorio
            value={valores.nome}
            onChange={(evento) => {
              definir({ nome: evento.target.value })
            }}
            erro={erros.campos.get('nome')}
            ajuda="Como a equipe chama a máquina: Cielo, Stone, PagSeguro."
          />
          <CampoSelect
            rotulo="Tipo"
            obrigatorio
            value={valores.tipo}
            onChange={(evento) => {
              if (tipoValido(evento.target.value)) definir({ tipo: evento.target.value })
            }}
            opcoes={[
              { valor: 'credito', rotulo: 'Crédito' },
              { valor: 'debito', rotulo: 'Débito' },
            ]}
            erro={erros.campos.get('tipo')}
          />
          <div className="flex flex-col gap-1.5">
            <span className="text-rotulo font-medium text-texto">Bandeira</span>
            <Segmento
              rotulo="Bandeira"
              // 8 opções não cabem numa linha em 390px — sem quebrar, o overflow
              // escapava pelo `overflow-auto` do diálogo e arrastava o formulário
              // INTEIRO de lado (mouse e teclado: achado bloqueante do design-qa).
              // `flex-wrap` é o ponto de extensão que o próprio componente já expõe
              // via `className`; nenhuma mudança na API pública do Segmento.
              className="flex-wrap"
              valor={valores.bandeira}
              aoMudar={(valor) => {
                definir({ bandeira: valor })
              }}
              opcoes={[
                { valor: '', rotulo: 'Nenhuma' },
                { valor: 'visa', rotulo: 'Visa' },
                { valor: 'mastercard', rotulo: 'Mastercard' },
                { valor: 'elo', rotulo: 'Elo' },
                { valor: 'hipercard', rotulo: 'Hipercard' },
                { valor: 'amex', rotulo: 'Amex' },
                { valor: 'banescard', rotulo: 'Banescard' },
                { valor: 'outra', rotulo: 'Outra' },
              ]}
            />
            {erros.campos.get('bandeira') !== undefined ? (
              <p className="text-meta text-perigo-texto">{erros.campos.get('bandeira')}</p>
            ) : null}
            <p className="text-meta text-texto-suave">
              Opcional — só para identificar a máquina na lista.
            </p>
          </div>
          <CampoTexto
            rotulo="Taxa à vista (%)"
            obrigatorio
            inputMode="decimal"
            value={valores.pct_a_vista}
            onChange={(evento) => {
              definir({ pct_a_vista: evento.target.value })
            }}
            erro={erros.campos.get('pct_a_vista')}
            ajuda="Quanto a operadora desconta de cada venda à vista. Ex.: 2,99."
          />
          <CampoTexto
            rotulo="Dias para recebimento"
            obrigatorio
            inputMode="numeric"
            value={valores.dias_recebimento}
            onChange={(evento) => {
              definir({ dias_recebimento: evento.target.value })
            }}
            erro={erros.campos.get('dias_recebimento')}
            ajuda="Quantos dias a operadora leva para depositar. 0 = no mesmo dia."
          />
          <CampoSelect
            rotulo="Conta de destino"
            obrigatorio
            placeholder="Selecione a conta"
            value={valores.conta_id}
            onChange={(evento) => {
              definir({ conta_id: evento.target.value })
            }}
            opcoes={opcoesDeConta}
            erro={erros.campos.get('conta_id')}
            ajuda={
              contasComErro ? (
                'Não foi possível carregar as contas. Você pode não ter permissão para vê-las — fale com o administrador.'
              ) : contasVazias ? (
                <AvisoDePreRequisito para={CAMINHOS.conta} oQueFalta="Nenhuma conta cadastrada." />
              ) : (
                'Onde o dinheiro deste cartão entra.'
              )
            }
          />
          <CampoCheckbox
            rotulo="Liquidação automática"
            marcado={valores.liquidar_auto}
            aoMudar={(marcado) => {
              definir({ liquidar_auto: marcado })
            }}
            ajuda="Fica guardado para quando o sistema passar a dar baixa sozinho nos recebíveis. Por enquanto nada é lançado automaticamente."
          />

          <div className="mt-2 flex flex-col gap-3 border-t border-borda-campo pt-4">
            <div>
              <h3 className="text-corpo font-semibold text-texto">Taxa por parcela</h3>
              <p className="text-meta text-texto-suave">
                Opcional. Preencha só as faixas que a operadora cobra separado — o resto fica em
                branco, sem problema.
              </p>
              {erros.campos.get('pct_parcelas') !== undefined ? (
                <p className="text-meta text-perigo-texto">{erros.campos.get('pct_parcelas')}</p>
              ) : null}
            </div>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              {PARCELAS.map((parcela) => (
                <CampoTexto
                  key={parcela}
                  rotulo={ROTULO_DA_PARCELA[parcela]}
                  inputMode="decimal"
                  placeholder="0,00"
                  value={valores.parcelas[parcela]}
                  onChange={(evento) => {
                    definir({ parcelas: { ...valores.parcelas, [parcela]: evento.target.value } })
                  }}
                  erro={erros.campos.get(`pct_parcelas.${parcela}`)}
                />
              ))}
            </div>
          </div>

          <CampoCheckbox
            rotulo="Antecipação de crédito"
            marcado={valores.antecipacao_credito}
            aoMudar={(marcado) => {
              definir({ antecipacao_credito: marcado })
            }}
            ajuda="Registra que a operadora oferece antecipar o recebimento. Por enquanto é só um registro — nenhum custo de antecipação é calculado."
          />
        </>
      )}
    />
  )
}
