import { useRef } from 'react'

import { AvisoErro } from '@/componentes/ui/aviso-erro'
import { CampoComMascara } from '@/componentes/ui/campo-com-mascara'
import { CampoSelect } from '@/componentes/ui/campo-select'
import { CampoTexto } from '@/componentes/ui/campo-texto'
import { CampoTextoLongo } from '@/componentes/ui/campo-texto-longo'
import { ID_DO_CAMPO, usarConsultaDeCep } from '@/hooks/usar-consulta-de-cep'
import type { ReguaDoFormulario } from '@/hooks/usar-regua-do-cadastro'
import { FORMATO_DO_CEP } from '@/lib/cep'
import type { ErrosDoServidor } from '@/lib/erros'
import { formatarCpf, ROTULOS_DE_NECESSIDADE, ROTULOS_DE_SEXO } from '@/lib/pacientes'
import { OPCOES_DE_UF } from '@/lib/ufs'
import { NECESSIDADES, SEXOS } from '@/tipos'
import type { EnderecoDoPaciente, Necessidade, Sexo } from '@/tipos'

/**
 * As seções escalares do cadastro (§5). Extraídas da página quando ela passou do
 * gatilho de tamanho que o próprio design fixou (design.md, Risks: "se passar de
 * ~400 linhas, as seções viram componentes").
 *
 * QUAIS campos aparecem e QUAIS levam asterisco vêm da RÉGUA da clínica (capability
 * `campos-do-cadastro`) — este arquivo não mantém lista própria de obrigatórios. Foi
 * lista paralela mantida à mão que deixou `required_unless` vazar em inglês para a tela
 * em produção (change `texto-de-maquina-fora-da-tela`).
 */

export interface DadosDaIdentificacao {
  nome: string
  nome_social: string
  nascimento: string
  sexo: Sexo
  cpf: string
  necessidade: Necessidade
  indicacao: string
}

/** Os campos escalares do convênio vigente (change convenio-no-cadastro-do-paciente). */
export interface DadosDeConvenio {
  convenio_id: string
  plano: string
  carteirinha: string
  carteirinha_validade: string
}

interface SecaoProps<T> {
  dados: T
  aoMudar: (mudanca: Partial<T>) => void
  erros: ErrosDoServidor
  somenteLeitura: boolean
  regua: ReguaDoFormulario
}

export function SecaoIdentificacao({
  dados,
  aoMudar,
  erros,
  somenteLeitura,
  regua,
}: SecaoProps<DadosDaIdentificacao>) {
  return (
    <fieldset className="flex flex-col gap-4">
      <legend className="text-subtitulo font-semibold text-texto">Identificação</legend>

      {/*
        UMA grade por seção, e não uma por linha (achado DQA-I10). Com grades fixas de 2/3
        colunas, esconder `Sexo` deixava Nascimento e CPF a 1/3 com um vão à direita, e
        esconder `CEP` deixava a primeira linha do endereço com um campo só. O ritmo do
        formulário degradava exatamente quando a régua era usada; o auto-flow fecha os
        buracos sozinho.
      */}
      {/*
        Spans UNIFORMES (achado DQA-I10, 2ª rodada). Com spans desiguais (3/3/2/2/2/3/3),
        esconder um campo do meio empurra o seguinte para uma coluna onde ele não cabe e
        abre buraco no MEIO da linha — dois deles, escondendo só `nome_social`. Com todos
        do mesmo tamanho o auto-flow nunca produz buraco de meio de linha; o único vão
        possível é no fim, que é o comportamento normal de qualquer formulário.
      */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {regua.visivel('nome') ? (
          <CampoTexto
            rotulo="Nome"
            limite={regua.limite('nome')}
            obrigatorio={regua.obrigatorio('nome')}
            value={dados.nome}
            disabled={somenteLeitura}
            onChange={(evento) => {
              aoMudar({ nome: evento.target.value })
            }}
            erro={erros.campos.get('nome')}
          />
        ) : null}
        {regua.visivel('nome_social') ? (
          <CampoTexto
            rotulo="Nome social"
            limite={regua.limite('nome_social')}
            obrigatorio={regua.obrigatorio('nome_social')}
            value={dados.nome_social}
            disabled={somenteLeitura}
            onChange={(evento) => {
              aoMudar({ nome_social: evento.target.value })
            }}
            ajuda="Se informado, é o nome que aparece na agenda."
            erro={erros.campos.get('nome_social')}
          />
        ) : null}
        {regua.visivel('nascimento') ? (
          <CampoTexto
            rotulo="Nascimento"
            type="date"
            obrigatorio={regua.obrigatorio('nascimento')}
            value={dados.nascimento}
            disabled={somenteLeitura}
            onChange={(evento) => {
              aoMudar({ nascimento: evento.target.value })
            }}
            erro={erros.campos.get('nascimento')}
          />
        ) : null}
        {regua.visivel('sexo') ? (
          <CampoSelect
            rotulo="Sexo"
            obrigatorio={regua.obrigatorio('sexo')}
            value={dados.sexo}
            disabled={somenteLeitura}
            onChange={(evento) => {
              aoMudar({ sexo: evento.target.value as Sexo })
            }}
            opcoes={SEXOS.map((sexo) => ({ valor: sexo, rotulo: ROTULOS_DE_SEXO[sexo] }))}
            erro={erros.campos.get('sexo')}
          />
        ) : null}
        {regua.visivel('cpf') ? (
          <CampoTexto
            rotulo="CPF"
            obrigatorio={regua.obrigatorio('cpf')}
            value={dados.cpf}
            disabled={somenteLeitura}
            onChange={(evento) => {
              aoMudar({ cpf: formatarCpf(evento.target.value) })
            }}
            placeholder="000.000.000-00"
            inputMode="numeric"
            ajuda={regua.obrigatorio('cpf') ? 'Não aparece em listas.' : 'Opcional. Não aparece em listas.'}
            erro={erros.campos.get('cpf')}
          />
        ) : null}
        {regua.visivel('necessidade') ? (
          <CampoSelect
            rotulo="Necessidade"
            obrigatorio={regua.obrigatorio('necessidade')}
            value={dados.necessidade}
            disabled={somenteLeitura}
            onChange={(evento) => {
              aoMudar({ necessidade: evento.target.value as Necessidade })
            }}
            opcoes={NECESSIDADES.map((necessidade) => ({
              valor: necessidade,
              rotulo: ROTULOS_DE_NECESSIDADE[necessidade],
            }))}
            erro={erros.campos.get('necessidade')}
          />
        ) : null}
        {regua.visivel('indicacao') ? (
          <CampoTexto
            rotulo="Indicação"
            limite={regua.limite('indicacao')}
            obrigatorio={regua.obrigatorio('indicacao')}
            value={dados.indicacao}
            disabled={somenteLeitura}
            onChange={(evento) => {
              aoMudar({ indicacao: evento.target.value })
            }}
            ajuda="Quem indicou a clínica."
            erro={erros.campos.get('indicacao')}
          />
        ) : null}
      </div>
    </fieldset>
  )
}

export function SecaoEndereco({ dados, aoMudar, erros, somenteLeitura, regua }: SecaoProps<EnderecoDoPaciente>) {
  // a recusa de chave fora do whitelist chega na chave PLANA (`endereco_json`)
  const erroDoEndereco = erros.campos.get('endereco_json')

  /*
   * O CEP responde o endereço (capability `consulta-de-cep`). O Número é o único campo que
   * consulta nenhuma sabe — por isso é para ele que o foco vai depois do preenchimento.
   *
   * O hook é IMPERATIVO de propósito: nada dispara ao montar. Abrir a ficha de uma criança
   * para ver um telefone não pode reescrever o endereço dela.
   */
  const refDoNumero = useRef<HTMLInputElement>(null)
  const cep = usarConsultaDeCep({
    aoPreencher: aoMudar,
    campoVisivel: regua.visivel,
    refDoNumero,
  })

  // seção sem nenhum campo visível não vira cabeçalho solto na tela
  if (!regua.secaoVisivel('endereco')) return null

  return (
    <fieldset className="flex flex-col gap-4">
      <legend className="text-subtitulo font-semibold text-texto">Endereço</legend>
      {erroDoEndereco !== undefined ? <AvisoErro mensagens={[erroDoEndereco]} /> : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        {regua.visivel('endereco_cep') ? (
          <CampoComMascara
            rotulo="CEP"
            formato={FORMATO_DO_CEP}
            obrigatorio={regua.obrigatorio('endereco_cep')}
            value={dados.cep ?? ''}
            disabled={somenteLeitura}
            onChangeValor={(digitos) => {
              aoMudar({ cep: digitos })
              if (!somenteLeitura) cep.aoDigitarCep(digitos)
            }}
            ajuda={cep.ajuda}
            anuncio={cep.mensagem}
            erro={erros.campos.get('endereco_json.cep')}
          />
        ) : null}
        {regua.visivel('endereco_logradouro') ? (
          <CampoTexto
            rotulo="Logradouro"
            limite={regua.limite('endereco_logradouro')}
            id={ID_DO_CAMPO.logradouro}
            obrigatorio={regua.obrigatorio('endereco_logradouro')}
            className="md:col-span-2"
            value={dados.logradouro ?? ''}
            disabled={somenteLeitura}
            onChange={(evento) => {
              aoMudar({ logradouro: evento.target.value })
            }}
            erro={erros.campos.get('endereco_json.logradouro')}
          />
        ) : null}
        {regua.visivel('endereco_numero') ? (
          <CampoTexto
            rotulo="Número"
            limite={regua.limite('endereco_numero')}
            ref={refDoNumero}
            obrigatorio={regua.obrigatorio('endereco_numero')}
            value={dados.numero ?? ''}
            disabled={somenteLeitura}
            onChange={(evento) => {
              aoMudar({ numero: evento.target.value })
            }}
            erro={erros.campos.get('endereco_json.numero')}
          />
        ) : null}
        {regua.visivel('endereco_complemento') ? (
          <CampoTexto
            rotulo="Complemento"
            limite={regua.limite('endereco_complemento')}
            obrigatorio={regua.obrigatorio('endereco_complemento')}
            value={dados.complemento ?? ''}
            disabled={somenteLeitura}
            onChange={(evento) => {
              aoMudar({ complemento: evento.target.value })
            }}
            erro={erros.campos.get('endereco_json.complemento')}
          />
        ) : null}
        {regua.visivel('endereco_bairro') ? (
          <CampoTexto
            rotulo="Bairro"
            limite={regua.limite('endereco_bairro')}
            id={ID_DO_CAMPO.bairro}
            obrigatorio={regua.obrigatorio('endereco_bairro')}
            value={dados.bairro ?? ''}
            disabled={somenteLeitura}
            onChange={(evento) => {
              aoMudar({ bairro: evento.target.value })
            }}
            erro={erros.campos.get('endereco_json.bairro')}
          />
        ) : null}
        {regua.visivel('endereco_cidade') ? (
          <CampoTexto
            rotulo="Cidade"
            limite={regua.limite('endereco_cidade')}
            id={ID_DO_CAMPO.cidade}
            obrigatorio={regua.obrigatorio('endereco_cidade')}
            value={dados.cidade ?? ''}
            disabled={somenteLeitura}
            onChange={(evento) => {
              aoMudar({ cidade: evento.target.value })
            }}
            erro={erros.campos.get('endereco_json.cidade')}
          />
        ) : null}
        {regua.visivel('endereco_uf') ? (
          <CampoSelect
            rotulo="UF"
            id={ID_DO_CAMPO.uf}
            obrigatorio={regua.obrigatorio('endereco_uf')}
            value={dados.uf ?? ''}
            disabled={somenteLeitura}
            onChange={(evento) => {
              aoMudar({ uf: evento.target.value })
            }}
            opcoes={OPCOES_DE_UF}
            placeholder="—"
            erro={erros.campos.get('endereco_json.uf')}
          />
        ) : null}
      </div>
    </fieldset>
  )
}

export interface DadosDeOutros {
  estado_civil: string
  profissao: string
  obs: string
}

/**
 * O convênio VIGENTE da criança.
 *
 * O convênio já existia — no tratamento —, e a recepção precisava abrir um pacote para
 * descobrir de que plano a família é. Aqui está o valor de HOJE; o que valia quando cada
 * pacote foi vendido continua no tratamento, e os dois podem divergir sem que nenhum
 * esteja errado (design D2).
 *
 * A escolha lista os convênios ATIVOS da clínica e NÃO oferece criar convênio novo: isso é
 * cadastro de apoio e tem tela própria — abrir um atalho aqui espalharia a criação de
 * catálogo por duas telas com regras diferentes.
 */
export function SecaoConvenio({
  dados,
  aoMudar,
  erros,
  somenteLeitura,
  regua,
  convenios,
}: SecaoProps<DadosDeConvenio> & { convenios: Array<{ id: number; nome: string }> }) {
  // a clínica que só atende particular esconde os quatro, e a seção some inteira em vez
  // de virar cabeçalho solto
  if (!regua.secaoVisivel('convenio')) return null

  return (
    <fieldset className="flex flex-col gap-4">
      <legend className="text-subtitulo font-semibold text-texto">Convênio</legend>
      <p className="text-meta text-texto-suave">
        O convênio atual da criança. Cada pacote de sessões guarda o convênio que valia
        quando foi vendido — trocar aqui não altera os pacotes já abertos.
      </p>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {regua.visivel('convenio_id') ? (
          <CampoSelect
            rotulo="Convênio"
            obrigatorio={regua.obrigatorio('convenio_id')}
            value={dados.convenio_id}
            disabled={somenteLeitura}
            onChange={(evento) => {
              aoMudar({ convenio_id: evento.target.value })
            }}
            erro={erros.campos.get('convenio_id')}
            opcoes={[
              { valor: '', rotulo: 'Sem convênio' },
              ...convenios.map((convenio) => ({ valor: String(convenio.id), rotulo: convenio.nome })),
            ]}
          />
        ) : null}
        {regua.visivel('plano') ? (
          <CampoTexto
            rotulo="Plano"
            limite={regua.limite('plano')}
            obrigatorio={regua.obrigatorio('plano')}
            value={dados.plano}
            disabled={somenteLeitura}
            onChange={(evento) => {
              aoMudar({ plano: evento.target.value })
            }}
            erro={erros.campos.get('plano')}
          />
        ) : null}
        {regua.visivel('carteirinha') ? (
          <CampoTexto
            rotulo="Carteirinha"
            limite={regua.limite('carteirinha')}
            obrigatorio={regua.obrigatorio('carteirinha')}
            value={dados.carteirinha}
            disabled={somenteLeitura}
            onChange={(evento) => {
              aoMudar({ carteirinha: evento.target.value })
            }}
            erro={erros.campos.get('carteirinha')}
          />
        ) : null}
        {regua.visivel('carteirinha_validade') ? (
          <CampoTexto
            rotulo="Validade da carteirinha"
            type="date"
            obrigatorio={regua.obrigatorio('carteirinha_validade')}
            value={dados.carteirinha_validade}
            disabled={somenteLeitura}
            onChange={(evento) => {
              aoMudar({ carteirinha_validade: evento.target.value })
            }}
            erro={erros.campos.get('carteirinha_validade')}
          />
        ) : null}
      </div>
    </fieldset>
  )
}

export function SecaoOutros({ dados, aoMudar, erros, somenteLeitura, regua }: SecaoProps<DadosDeOutros>) {
  if (!regua.secaoVisivel('outros')) return null

  return (
    <fieldset className="flex flex-col gap-4">
      <legend className="text-subtitulo font-semibold text-texto">Outros</legend>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {regua.visivel('estado_civil') ? (
          <CampoTexto
            rotulo="Estado civil"
            limite={regua.limite('estado_civil')}
            obrigatorio={regua.obrigatorio('estado_civil')}
            value={dados.estado_civil}
            disabled={somenteLeitura}
            onChange={(evento) => {
              aoMudar({ estado_civil: evento.target.value })
            }}
            erro={erros.campos.get('estado_civil')}
          />
        ) : null}
        {regua.visivel('profissao') ? (
          <CampoTexto
            rotulo="Profissão"
            limite={regua.limite('profissao')}
            obrigatorio={regua.obrigatorio('profissao')}
            value={dados.profissao}
            disabled={somenteLeitura}
            onChange={(evento) => {
              aoMudar({ profissao: evento.target.value })
            }}
            erro={erros.campos.get('profissao')}
          />
        ) : null}
      </div>

      {regua.visivel('obs') ? (
        <CampoTextoLongo
          rotulo="Observação"
          obrigatorio={regua.obrigatorio('obs')}
          value={dados.obs}
          limite={regua.limite('obs')}
          disabled={somenteLeitura}
          onChange={(evento) => {
            aoMudar({ obs: evento.target.value })
          }}
          erro={erros.campos.get('obs')}
        />
      ) : null}
    </fieldset>
  )
}
