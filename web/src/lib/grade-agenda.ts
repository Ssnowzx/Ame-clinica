import type {
  CardAgendamento,
  ConfiguracaoAgenda,
  FeriadoDaAgenda,
  ProfissionalDaAgenda,
  VisaoAgenda,
} from '@/tipos'

/**
 * Modelo da grade (design D4) — cálculo PURO: toda a regra de exibição do §6
 * (granularidade, janela do profissional, janela padrão da clínica, fim de
 * semana, feriado recorrente) vive aqui e é testada sem DOM. A renderização é
 * burra, e é isso que mantém o piso §16 sob controle.
 */

/**
 * O card segura o horário?
 *
 * É a MESMA frase do servidor (`VerificadorDeConflitos::ocupantes()`), que conta como ocupante
 * quem é bloqueio OU tem `status.ocupa_horario = true`. Enquanto a grade tinha frase própria
 * ("tem card ⇒ ocupado"), as duas discordavam: o servidor aceitava marcar de novo num horário
 * que a tela continuava recusando — que é o caso do desmarque do profissional.
 *
 * Sem a flag e sem situação, OCUPA. É a posição segura: oferecer um horário que o servidor
 * recusaria erra na direção pior, e o payload pode ser o anterior num deploy fora de ordem.
 */
export function ocupaOHorario(card: CardAgendamento): boolean {
  if (card.tipo === 'bloqueio') {
    return true
  }

  return card.status?.ocupa_horario ?? true
}

/**
 * Quantos atendimentos o profissional sustenta ao mesmo tempo (change atendimento-em-grupo).
 *
 * Ausente ⇒ 1, e não é detalhe: quem administra a fila recebe o profissional sem o campo, e um
 * deploy fora de ordem serve o payload anterior. 1 é a posição segura — a célula toma o horário
 * no primeiro card, como sempre tomou. Valor absurdo vindo de payload adulterado não abre a
 * agenda: o servidor decide de novo, e é ele quem recusa.
 */
export function capacidadeDe(profissional: ProfissionalDaAgenda | undefined): number {
  const declarada = profissional?.atendimentos_simultaneos
  return typeof declarada === 'number' && Number.isFinite(declarada) && declarada >= 1
    ? Math.floor(declarada)
    : 1
}

/**
 * A célula está LOTADA? — a mesma frase do servidor (`VerificadorDeConflitos::lotado`).
 *
 * Enquanto a grade dizia "tem card que ocupa ⇒ ocupado" e o servidor dizia "os ocupantes
 * encheram o teto", a recepção marcava a primeira criança do grupo e ficava sem onde clicar
 * para marcar a segunda — num horário que a API aceitaria. É a divergência de 11/09 outra vez,
 * e cada lado passa sozinho no seu teste.
 *
 * BLOQUEIO toma a célula inteira, qualquer que seja o teto: ele marca ausência, e ausência não
 * divide vaga com ninguém.
 */
export function celulaLotada(ocupantes: CardAgendamento[], capacidade: number): boolean {
  if (ocupantes.some((card) => card.tipo === 'bloqueio')) {
    return true
  }

  return ocupantes.length >= Math.max(1, capacidade)
}

/** Uma coluna da grade: um profissional (Dia/Geral) ou um dia (Semana). */
export interface ColunaDaGrade {
  chave: string
  rotulo: string
  /** Presente quando a coluna é um dia (visão Semana) — "Y-m-d" */
  data?: string
  /** Presente quando a coluna é um profissional */
  profissionalId?: number
  /** versão da foto do profissional da coluna (visão geral); `null` = iniciais */
  fotoVersao?: string | null
  /** cor da especialidade principal do profissional da coluna — o anel do avatar */
  cor?: string | null
  /** Nome do feriado que cai nesta coluna (só em coluna-dia) */
  feriado?: string
  /** O profissional não atende neste dia da semana — a coluna inteira fica indisponível */
  naoAtende?: boolean
}

export interface CelulaDaGrade {
  /** Fora da janela de atendimento da coluna — visivelmente indisponível */
  indisponivel: boolean
  /** Cards que COMEÇAM neste slot (um card pode ocupar vários slots) */
  cards: CardAgendamento[]
  /**
   * Algum card daqui SEGURA o horário? `false` com cards é o caso da situação que libera
   * (desmarque, falta justificada quando a clínica assim configurar): o histórico continua
   * desenhado e o slot volta a aceitar marcação.
   */
  ocupada: boolean
  /** Quantos slots a célula ocupa (vira `rowSpan` — sessão longa não deixa o slot seguinte parecer livre) */
  alturaEmSlots: number
  /** Coberta pelo card de uma célula acima — a renderização a OMITE */
  continuacao: boolean
}

export interface LinhaDaGrade {
  /** "HH:MM" — o cabeçalho de linha */
  horario: string
  celulas: CelulaDaGrade[]
}

export interface Grade {
  colunas: ColunaDaGrade[]
  linhas: LinhaDaGrade[]
  /** Nenhum card em nenhuma célula (estado vazio, sem perder o eixo) */
  vazia: boolean
  /**
   * O feriado do DIA da tela — nas visões Dia e Geral, onde as colunas são PROFISSIONAIS e não
   * dias, ele não tem coluna onde morar.
   *
   * Sem isto, o feriado só aparecia na visão SEMANA — e a visão padrão da clínica é **Dia**: a
   * recepção continuava marcando sessão no Natal, que é exatamente o dano que a change existe
   * para evitar. A promessa estava na spec e não na tela (re-review r10).
   */
  feriadoDoDiaVisivel: string | null
}

export interface ParametrosDaGrade {
  visao: VisaoAgenda
  /** Dia de referência — "Y-m-d" */
  data: string
  agendamentos: CardAgendamento[]
  profissionais: ProfissionalDaAgenda[]
  feriados: FeriadoDaAgenda[]
  config: ConfiguracaoAgenda
  /** cor por especialidade (catálogo da seleção) — o anel do avatar no cabeçalho da coluna */
  corPorEspecialidade?: ReadonlyMap<number, string>
}

const DIAS_DA_SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'] as const

// ── Datas: aritmética em "Y-m-d" puro, sem fuso (a API já entrega a parede da
// clínica; converter para Date com timezone só introduziria bug de virada) ────

const FORMATO_DATA = /^\d{4}-\d{2}-\d{2}$/

/**
 * Valida "Y-m-d" de calendário REAL — o round-trip barra 2026-02-30 e qualquer
 * lixo vindo da URL (SEC-R1: sem isto, `data=banana` derruba o render inteiro).
 * @param data - Valor não confiável (query string, storage, API)
 */
export function dataEhValida(data: unknown): data is string {
  if (typeof data !== 'string' || !FORMATO_DATA.test(data)) {
    return false
  }
  const { ano, mes, dia } = partes(data)
  const referencia = new Date(Date.UTC(ano, mes - 1, dia))
  return (
    referencia.getUTCFullYear() === ano &&
    referencia.getUTCMonth() === mes - 1 &&
    referencia.getUTCDate() === dia
  )
}

function partes(data: string): { ano: number; mes: number; dia: number } {
  const [ano, mes, dia] = data.split('-').map(Number)
  return { ano, mes, dia }
}

/** @returns 0 (domingo) a 6 (sábado) */
export function diaDaSemana(data: string): number {
  const { ano, mes, dia } = partes(data)
  return new Date(Date.UTC(ano, mes - 1, dia)).getUTCDay()
}

export function somarDias(data: string, dias: number): string {
  const { ano, mes, dia } = partes(data)
  const referencia = new Date(Date.UTC(ano, mes - 1, dia + dias))
  return referencia.toISOString().slice(0, 10)
}

/** Segunda-feira da semana que contém `data`. */
export function inicioDaSemana(data: string): string {
  const diaDaSemanaAtual = diaDaSemana(data)
  const recuo = diaDaSemanaAtual === 0 ? 6 : diaDaSemanaAtual - 1
  return somarDias(data, -recuo)
}

/**
 * Feriado do dia — recorrente vale para o mesmo dia e mês de QUALQUER ano
 * (o cadastro guarda o ano em que foi criado).
 * @returns Nome do feriado ativo, ou null
 */
export function feriadoDoDia(data: string, feriados: FeriadoDaAgenda[]): string | null {
  const alvo = data.slice(5) // "MM-DD"
  // Quem descarta o feriado DESATIVADO é o servidor (`/agenda/selecao` filtra) — e isso é provado
  // lá. O filtro que morava aqui (`if (!feriado.ativo)`) passou a receber `undefined` quando a
  // fonte mudou, e `!undefined` é `true`: a grade descartava TODOS os feriados e não pintava
  // nenhum dia. Filtro sobre campo que a API não manda não é defesa — é um apagador.
  const encontrado = feriados.find((feriado) =>
    feriado.recorrente ? feriado.data.slice(5) === alvo : feriado.data === data,
  )
  return encontrado?.nome ?? null
}

// ── Horários ────────────────────────────────────────────────────────────────

function paraMinutos(horario: string): number {
  const [hora, minuto] = horario.slice(0, 5).split(':').map(Number)
  return hora * 60 + minuto
}

function paraHorario(minutos: number): string {
  const hora = Math.floor(minutos / 60)
  const minuto = minutos % 60
  return `${String(hora).padStart(2, '0')}:${String(minuto).padStart(2, '0')}`
}

interface FaixaDeMinutos {
  inicio: number
  fim: number
}

/** O dia ISO (1=segunda…7=domingo) de uma data "Y-m-d" (JS 0=dom..6=sáb → ISO). */
function isoDaData(data: string): number {
  const js = diaDaSemana(data)
  return js === 0 ? 7 : js
}

/**
 * O profissional atende neste dia? `horarios` vazio/ausente = todos os dias abertos (retrocompat);
 * senão, atende só nos dias presentes no mapa (com ao menos um intervalo).
 */
function atendeNoDia(profissional: ProfissionalDaAgenda, data: string): boolean {
  const horarios = profissional.horarios
  if (horarios === undefined || Object.keys(horarios).length === 0) {
    return true
  }
  const intervalos = horarios[String(isoDaData(data))]
  return intervalos !== undefined && intervalos.length > 0
}

/**
 * Os intervalos de atendimento (em minutos) do profissional no dia de `data`. Sem `horarios`
 * (vazio/ausente) = a janela padrão da clínica em qualquer dia. Dia ausente = nenhum intervalo
 * (a coluna inteira fica indisponível).
 */
function intervalosDoDia(
  profissional: ProfissionalDaAgenda,
  data: string,
  config: ConfiguracaoAgenda,
): FaixaDeMinutos[] {
  const horarios = profissional.horarios
  if (horarios === undefined || Object.keys(horarios).length === 0) {
    return [{ inicio: paraMinutos(config.janelaPadraoInicio), fim: paraMinutos(config.janelaPadraoFim) }]
  }
  return (horarios[String(isoDaData(data))] ?? []).map((intervalo) => ({
    inicio: paraMinutos(intervalo.inicio),
    fim: paraMinutos(intervalo.fim),
  }))
}

/** O minuto cai em ALGUM intervalo? Fim exclusivo — paridade com o boundary do servidor. */
function dentroDeAlgumIntervalo(intervalos: FaixaDeMinutos[], minuto: number): boolean {
  return intervalos.some((intervalo) => minuto >= intervalo.inicio && minuto < intervalo.fim)
}

/** Dias exibidos na visão Semana, conforme a configuração de fim de semana. */
export function diasDaSemanaVisiveis(data: string, config: ConfiguracaoAgenda): string[] {
  const segunda = inicioDaSemana(data)
  const mostraSabado = config.fimDeSemana === 'sabado' || config.fimDeSemana === 'ambos'
  const mostraDomingo = config.fimDeSemana === 'domingo' || config.fimDeSemana === 'ambos'

  const dias: string[] = []
  for (let deslocamento = 0; deslocamento < 7; deslocamento++) {
    const dia = somarDias(segunda, deslocamento)
    const numeroDoDia = diaDaSemana(dia)
    if (numeroDoDia === 6 && !mostraSabado) {
      continue
    }
    if (numeroDoDia === 0 && !mostraDomingo) {
      continue
    }
    dias.push(dia)
  }
  return dias
}

// ── Montagem ────────────────────────────────────────────────────────────────

const horarioDoCard = (card: CardAgendamento): string => card.inicio.slice(11, 16)
const diaDoCard = (card: CardAgendamento): string => card.inicio.slice(0, 10)

/**
 * Monta a matriz da grade a partir dos dados brutos.
 * @param parametros - Visão, dia de referência, dados e configuração da clínica
 * @returns Colunas, linhas de horário e as células (com os cards posicionados)
 */
export function montarGrade({
  visao,
  data,
  agendamentos,
  profissionais,
  feriados,
  config,
  corPorEspecialidade,
}: ParametrosDaGrade): Grade {
  // A seleção da agenda já devolve SÓ os ativos (o servidor filtra) — não há filtro aqui.
  const ativos = profissionais

  // Colunas: profissionais (Dia/Geral) ou dias (Semana)
  const colunas: ColunaDaGrade[] =
    visao === 'semana'
      ? diasDaSemanaVisiveis(data, config).map((dia) => ({
          chave: dia,
          rotulo: `${DIAS_DA_SEMANA[diaDaSemana(dia)]} ${dia.slice(8, 10)}/${dia.slice(5, 7)}`,
          data: dia,
          feriado: feriadoDoDia(dia, feriados) ?? undefined,
          // Semana = um profissional × dias: o dia é indisponível quando ele não atende nele.
          naoAtende: ativos[0] !== undefined && !atendeNoDia(ativos[0], dia),
        }))
      : ativos.map((profissional) => ({
          chave: String(profissional.id),
          rotulo: profissional.nome,
          profissionalId: profissional.id,
          fotoVersao: profissional.foto_versao ?? null,
          cor: corPorEspecialidade?.get(profissional.especialidades[0]?.id ?? -1) ?? null,
          // Dia/Geral = profissionais × o dia da tela: a coluna do profissional que não atende
          // hoje fica indisponível.
          naoAtende: !atendeNoDia(profissional, data),
        }))

  // Cota do passo: granularidade ≤ 0 (config corrompida) faria o laço não
  // terminar. A função se defende sozinha — não depende da validação de quem chama.
  const passo = Math.max(1, Math.floor(config.granularidadeMin))

  // Eixo de horários: parte da união dos INTERVALOS exibidos (Semana = o único profissional
  // pelos dias visíveis; Dia/Geral = os profissionais no dia da tela)...
  const diasDoEixo =
    visao === 'semana'
      ? colunas.map((coluna) => coluna.data).filter((dia): dia is string => dia !== undefined)
      : [data]
  const profDaSemana = visao === 'semana' ? ativos[0] : undefined
  const intervalosDoEixo =
    visao === 'semana'
      ? profDaSemana !== undefined
        ? diasDoEixo.flatMap((dia) => intervalosDoDia(profDaSemana, dia, config))
        : []
      : ativos.flatMap((profissional) => intervalosDoDia(profissional, data, config))
  let inicioGrade =
    intervalosDoEixo.length > 0
      ? Math.min(...intervalosDoEixo.map((faixa) => faixa.inicio))
      : paraMinutos(config.janelaPadraoInicio)
  let fimGrade =
    intervalosDoEixo.length > 0
      ? Math.max(...intervalosDoEixo.map((faixa) => faixa.fim))
      : paraMinutos(config.janelaPadraoFim)

  // ...e ESTICA em passos inteiros para caber todo agendamento recebido.
  // A API não valida a janela do profissional na escrita: um encaixe às 07:30
  // é criável hoje pela recepção. Derivar o eixo da janela NÃO autoriza
  // descartar card — sem isto, o card sumia (e a grade se dizia vazia) ou caía
  // no último slot mentindo o horário. Os slots extras nascem `indisponivel`,
  // que é exatamente o tratamento visual de fora-da-janela.
  // Um card com horário corrompido daria NaN e desligaria o esticamento para
  // TODOS (NaN < x é falso) — o card válido das 07:30 sumiria de novo.
  const inicios = agendamentos
    .map((card) => paraMinutos(horarioDoCard(card)))
    .filter((minuto) => Number.isFinite(minuto))
  const finais = agendamentos
    .map((card) => paraMinutos(horarioDoCard(card)) + Math.max(1, card.duracao_minutos))
    .filter((minuto) => Number.isFinite(minuto))
  if (inicios.length > 0 && finais.length > 0) {
    const primeiroCard = Math.min(...inicios)
    const ultimoFim = Math.max(...finais)
    if (primeiroCard < inicioGrade) {
      inicioGrade -= Math.ceil((inicioGrade - primeiroCard) / passo) * passo
    }
    if (ultimoFim > fimGrade) {
      fimGrade += Math.ceil((ultimoFim - fimGrade) / passo) * passo
    }
  }

  const slots: number[] = []
  for (let minuto = inicioGrade; minuto < fimGrade; minuto += passo) {
    slots.push(minuto)
  }

  // Pré-computa os intervalos de cada coluna UMA vez (piso de performance §16): a célula só
  // consulta o mapa, em vez de recalcular por slot × coluna.
  const intervalosPorColuna = new Map<string, FaixaDeMinutos[]>()
  /**
   * Quantos atendimentos a coluna sustenta ao mesmo tempo (change atendimento-em-grupo).
   * Pré-computado na mesma passada dos intervalos: a célula só consulta o mapa.
   */
  const capacidadePorColuna = new Map<string, number>()
  for (const coluna of colunas) {
    // na visão Semana a coluna é um DIA, e o profissional é o único da grade
    const profissionalDaColuna =
      visao === 'semana' ? ativos[0] : ativos.find((item) => item.id === coluna.profissionalId)
    const diaDaColuna = coluna.data ?? data
    intervalosPorColuna.set(
      coluna.chave,
      profissionalDaColuna !== undefined
        ? intervalosDoDia(profissionalDaColuna, diaDaColuna, config)
        : [{ inicio: inicioGrade, fim: fimGrade }],
    )
    capacidadePorColuna.set(coluna.chave, capacidadeDe(profissionalDaColuna))
  }

  // Índice dos cards por (coluna, slot de início) — o card entra no slot que o
  // CONTÉM (encaixe às 08:15 numa grade de 40 min aparece no slot das 08:00)
  const porColunaEHorario = new Map<string, CardAgendamento[]>()
  /** Quem SEGURA cada slot — por sobreposição, a mesma conta do servidor. */
  const seguramPorColunaEHorario = new Map<string, CardAgendamento[]>()
  for (const card of agendamentos) {
    const chaveColuna = visao === 'semana' ? diaDoCard(card) : String(card.profissional_id)
    const minutoDoCard = paraMinutos(horarioDoCard(card))
    const slot = slots.findLast((minuto) => minuto <= minutoDoCard)
    if (slot === undefined) {
      continue // impossível após o esticamento; guarda de totalidade
    }
    const chave = `${chaveColuna}|${slot}`
    porColunaEHorario.set(chave, [...(porColunaEHorario.get(chave) ?? []), card])

    /*
     * Segundo índice: quem SEGURA cada slot, inclusive vindo de cima (achado ALTO da r1 do
     * gate). O índice acima guarda o slot de INÍCIO, e é ele que decide onde o card é
     * desenhado. Mas "está lotado?" é outra pergunta, e o servidor a responde por
     * SOBREPOSIÇÃO (`VerificadorDeConflitos::ocupantes` casa `inicio < fim && fim > inicio`).
     *
     * Com capacidade 1 as duas frases coincidiam por acidente — qualquer card já lotava. Com
     * capacidade > 1 elas divergem no sentido PERIGOSO: um card de 80 min mais um de 40 num
     * profissional de teto 2 deixavam a célula do meio parecendo livre, a tela convidava, e o
     * servidor devolvia 422. É a divergência de 11/09 com os papéis trocados — e essa direção
     * não tem saída pelo formulário.
     *
     * Também conserta o bloqueio cuja altura foi APARADA por um card próprio: a folga passa a
     * segurar todos os slots que cobre, não só aquele onde começa.
     */
    const fimDoCard = minutoDoCard + Math.max(1, card.duracao_minutos)
    for (const minuto of slots) {
      if (minuto < fimDoCard && minuto + passo > minutoDoCard) {
        const chaveDaFaixa = `${chaveColuna}|${minuto}`
        seguramPorColunaEHorario.set(chaveDaFaixa, [...(seguramPorColunaEHorario.get(chaveDaFaixa) ?? []), card])
      }
    }
  }

  let algumCard = false
  const linhas: LinhaDaGrade[] = slots.map((minuto) => ({
    horario: paraHorario(minuto),
    celulas: colunas.map((coluna) => {
      const cards = porColunaEHorario.get(`${coluna.chave}|${minuto}`) ?? []
      if (cards.length > 0) {
        algumCard = true
      }

      const intervalos = intervalosPorColuna.get(coluna.chave) ?? []
      // a altura conta SÓ quem ocupa: um card que não segura mais nada não tem por que reservar
      // os slots seguintes — com o rowSpan, o horário seguinte ficava sem `<td>` e inalcançável
      const ocupantes = cards.filter(ocupaOHorario)
      const duracaoMaxima = Math.max(0, ...ocupantes.map((card) => card.duracao_minutos))
      const capacidade = capacidadePorColuna.get(coluna.chave) ?? 1
      // a lotação conta quem SEGURA o slot (inclusive de cima); a altura, só quem começa aqui
      const seguram = (seguramPorColunaEHorario.get(`${coluna.chave}|${minuto}`) ?? []).filter(ocupaOHorario)

      // Indisponível = fora de TODOS os intervalos do dia (inclui o VAZIO entre turnos, ex.: almoço),
      // OU num dia em que o profissional não atende (a coluna inteira, via `coluna.naoAtende`). O slot
      // indisponível não oferece "marcar aqui" (grade-agenda.tsx: `livre = !indisponivel`) — o par,
      // na tela, da recusa do servidor.
      return {
        indisponivel: coluna.naoAtende === true || !dentroDeAlgumIntervalo(intervalos, minuto),
        cards,
        ocupada: celulaLotada(seguram, capacidade),
        alturaEmSlots: duracaoMaxima > 0 ? Math.max(1, Math.ceil(duracaoMaxima / passo)) : 1,
        continuacao: false,
      }
    }),
  }))

  // Um card de 80 min numa grade de 40 OCUPA dois slots: sem isto, o slot
  // seguinte parece livre para quem lê a grade. A célula coberta vira
  // `continuacao` (a renderização a omite; a de cima leva o rowSpan). A altura é
  // aparada no próximo slot que tenha card próprio — nunca sobrepõe.
  for (let coluna = 0; coluna < colunas.length; coluna++) {
    for (let linha = 0; linha < linhas.length; linha++) {
      const celula = linhas[linha].celulas[coluna]
      if (celula.cards.length === 0 || celula.continuacao) {
        continue
      }

      let altura = Math.min(celula.alturaEmSlots, linhas.length - linha)
      for (let adiante = 1; adiante < altura; adiante++) {
        if (linhas[linha + adiante].celulas[coluna].cards.length > 0) {
          altura = adiante
          break
        }
      }

      celula.alturaEmSlots = altura
      for (let adiante = 1; adiante < altura; adiante++) {
        linhas[linha + adiante].celulas[coluna].continuacao = true
      }
    }
  }

  return {
    colunas,
    linhas,
    vazia: !algumCard,
    // na Semana o feriado já vive no cabeçalho da coluna do dia; aqui é o aviso do dia da TELA
    feriadoDoDiaVisivel: visao === 'semana' ? null : feriadoDoDia(data, feriados),
  }
}
