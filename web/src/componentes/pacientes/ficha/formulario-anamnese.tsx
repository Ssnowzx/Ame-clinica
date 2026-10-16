import { TriangleAlert } from 'lucide-react'
import { useEffect, useState } from 'react'

import { CampoCheckbox } from '@/componentes/ui/campo-checkbox'
import { CampoSelect } from '@/componentes/ui/campo-select'
import { CampoTexto } from '@/componentes/ui/campo-texto'
import { CampoTextoLongo } from '@/componentes/ui/campo-texto-longo'
import type { ErrosDoServidor } from '@/lib/erros'
import { TETO_TEXTO_ANAMNESE, valorCruLegivel } from '@/lib/anamnese'
import type { AnamneseModelo, CampoDeModelo, RespostasAnamnese } from '@/tipos'

/** Estado de UM controle: booleano é `boolean`; todo o resto é `string` de exibição. */
type ValorDeControle = string | boolean

interface FormularioAnamneseProps {
  modelo: AnamneseModelo
  /** id do `<form>` — o "Salvar" do rodapé fixo do diálogo o aciona por `form={formId}`. */
  formId: string
  /** Respostas já carregadas (edição). Ausente/vazio na criação. */
  valoresIniciais?: RespostasAnamnese
  /** Recusas do servidor já distribuídas (chaves `respostas_json.{id}` e `respostas_json`). */
  erros: ErrosDoServidor
  /** Recebe o `respostas_json` com valores JSON-TIPADOS (number/bool/Y-m-d string). */
  aoSalvar: (respostas: RespostasAnamnese) => void
}

/** Só os tipos que o servidor conhece produzem um controle; o resto é fail-safe. */
const TIPOS_CONHECIDOS = new Set<string>(['texto', 'numero', 'opcoes', 'data', 'booleano'])

/** O valor de exibição inicial de um campo, a partir do que veio do detalhe. */
function valorInicialDeControle(campo: CampoDeModelo, bruto: unknown): ValorDeControle {
  if (campo.tipo === 'booleano') {
    return bruto === true
  }
  if (bruto === undefined || bruto === null) {
    return ''
  }
  return String(bruto)
}

/**
 * Converte o valor de exibição no valor JSON-TIPADO do payload (SEC-ANM-09):
 * `numero`→number, `booleano`→bool, `data`→`Y-m-d` string. `undefined` = ausente
 * (não entra no payload); tipo desconhecido nunca entra.
 */
function tiparValor(campo: CampoDeModelo, valor: ValorDeControle): unknown {
  switch (campo.tipo) {
    case 'booleano':
      return valor === true
    case 'numero': {
      if (typeof valor !== 'string' || valor.trim() === '') {
        return undefined
      }
      const numero = Number(valor)
      return Number.isFinite(numero) ? numero : undefined
    }
    case 'texto':
    case 'opcoes':
    case 'data':
      return typeof valor === 'string' && valor !== '' ? valor : undefined
    default:
      return undefined
  }
}

/** O aviso sóbrio (órfã e fail-safe compartilham a mesma linguagem — ícone + texto, 1.4.1). */
function AvisoDeCampo({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-1.5 text-meta text-alerta-texto">
      <TriangleAlert aria-hidden="true" className="size-3.5 shrink-0" />
      {children}
    </p>
  )
}

/**
 * O formulário DINÂMICO da anamnese — percorre `modelo.campos_json` e mapeia cada
 * tipo para um controle do Design System. Serve à criação e à edição:
 *
 * - **Hidrata de PROP** (`valoresIniciais`), nunca de um `useQuery` de detalhe — o
 *   `useState` inicializa UMA vez do detalhe já carregado (desarma CHAVE-DETALHE).
 * - **Valores JSON-TIPADOS** no `respostas_json` (SEC-ANM-09); a validação-cliente cita
 *   o RÓTULO, nunca o valor digitado (SEC-ANM-08).
 * - **Órfã preservada:** uma resposta cuja chave saiu do `campos_json` aparece como bloco
 *   somente-leitura e VOLTA no payload — nunca é descartada em silêncio (SEC-ANM-05).
 * - **Fail-safe:** tipo desconhecido não quebra o render, não é editável, não entra no payload.
 *
 * Escaping por JSX children em rótulo/opções/valor — nunca em atributo.
 */
export function FormularioAnamnese({
  modelo,
  formId,
  valoresIniciais,
  erros,
  aoSalvar,
}: FormularioAnamneseProps) {
  const idsDoModelo = new Set(modelo.campos_json.map((campo) => campo.id))
  const iniciais = valoresIniciais ?? {}

  const [valores, setValores] = useState<Record<string, ValorDeControle>>(() => {
    const estado: Record<string, ValorDeControle> = {}
    for (const campo of modelo.campos_json) {
      estado[campo.id] = valorInicialDeControle(campo, iniciais[campo.id])
    }
    return estado
  })
  const [errosCliente, setErrosCliente] = useState<Map<string, string>>(() => new Map())

  // Foco no 1º campo inválido no erro de validação-cliente (apoia WCAG 3.3.1): quem usa
  // teclado/leitor não perde o campo que rolou para fora do corpo do diálogo.
  useEffect(() => {
    if (errosCliente.size > 0) {
      document
        .getElementById(formId)
        ?.querySelector<HTMLElement>('[aria-invalid="true"]')
        ?.focus()
    }
  }, [errosCliente, formId])

  // órfãs: chaves do detalhe que o modelo atual não conhece mais (edição) — preservadas.
  const orfas = Object.entries(iniciais).filter(([id]) => !idsDoModelo.has(id))

  function definirValor(id: string, valor: ValorDeControle) {
    setValores((atual) => ({ ...atual, [id]: valor }))
  }

  function submeter(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault()

    const novosErros = new Map<string, string>()
    const respostas: RespostasAnamnese = {}

    // órfãs voltam ao payload sem alteração (nunca sumir com resposta de saúde de menor)
    for (const [id, valor] of orfas) {
      respostas[id] = valor
    }

    for (const campo of modelo.campos_json) {
      if (!TIPOS_CONHECIDOS.has(campo.tipo)) {
        continue // fail-safe: tipo desconhecido nunca entra no payload
      }
      const tipado = tiparValor(campo, valores[campo.id] ?? '')

      // booleano: `false` é resposta válida — obrigatório não se aplica
      if (campo.obrigatorio && campo.tipo !== 'booleano' && tipado === undefined) {
        // cita o RÓTULO, jamais o valor digitado (SEC-ANM-08)
        novosErros.set(campo.id, `Preencha o campo “${campo.rotulo}”.`)
        continue
      }
      if (tipado !== undefined) {
        respostas[campo.id] = tipado
      }
    }

    if (novosErros.size > 0) {
      setErrosCliente(novosErros)
      return
    }
    setErrosCliente(new Map())
    aoSalvar(respostas)
  }

  function erroDoCampo(id: string): string | undefined {
    // erro do cliente é imediato; o do servidor pousa em `respostas_json.{id}`
    return errosCliente.get(id) ?? erros.campos.get(`respostas_json.${id}`)
  }

  return (
    <form id={formId} onSubmit={submeter} noValidate className="flex flex-col gap-4">
      {modelo.campos_json.map((campo) => (
        <ControleDeCampo
          key={campo.id}
          campo={campo}
          valor={valores[campo.id] ?? ''}
          erro={erroDoCampo(campo.id)}
          aoMudar={(valor) => definirValor(campo.id, valor)}
        />
      ))}

      {orfas.length > 0 ? (
        <div className="flex flex-col gap-3 border-t border-linha pt-4">
          {orfas.map(([id, valor]) => (
            <div key={id} className="flex flex-col gap-1">
              <span className="text-rotulo text-texto-suave">{id}</span>
              <AvisoDeCampo>campo removido do modelo — a resposta é preservada</AvisoDeCampo>
              <span className="text-corpo text-texto whitespace-pre-wrap break-words">
                {valorCruLegivel(valor)}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </form>
  )
}

/** Um campo do modelo → o controle do DS do seu tipo (ou o fail-safe). */
function ControleDeCampo({
  campo,
  valor,
  erro,
  aoMudar,
}: {
  campo: CampoDeModelo
  valor: ValorDeControle
  erro: string | undefined
  aoMudar: (valor: ValorDeControle) => void
}) {
  switch (campo.tipo) {
    case 'texto':
      return (
        <CampoTextoLongo
          rotulo={campo.rotulo}
          obrigatorio={campo.obrigatorio}
          value={typeof valor === 'string' ? valor : ''}
          limite={TETO_TEXTO_ANAMNESE}
          linhas={4}
          erro={erro}
          onChange={(evento) => aoMudar(evento.target.value)}
          // dado clínico não sai da clínica pelo corretor do navegador
          spellCheck={false}
          autoComplete="off"
        />
      )
    case 'numero':
      return (
        <CampoTexto
          rotulo={campo.rotulo}
          obrigatorio={campo.obrigatorio}
          type="number"
          inputMode="numeric"
          value={typeof valor === 'string' ? valor : ''}
          erro={erro}
          onChange={(evento) => aoMudar(evento.target.value)}
        />
      )
    case 'opcoes':
      return (
        <CampoSelect
          rotulo={campo.rotulo}
          obrigatorio={campo.obrigatorio}
          placeholder="Selecione"
          opcoes={(campo.opcoes ?? []).map((opcao) => ({ valor: opcao, rotulo: opcao }))}
          value={typeof valor === 'string' ? valor : ''}
          erro={erro}
          onChange={(evento) => aoMudar(evento.target.value)}
        />
      )
    case 'data':
      return (
        <CampoTexto
          rotulo={campo.rotulo}
          obrigatorio={campo.obrigatorio}
          type="date"
          value={typeof valor === 'string' ? valor : ''}
          erro={erro}
          onChange={(evento) => aoMudar(evento.target.value)}
        />
      )
    case 'booleano':
      return (
        <CampoCheckbox
          rotulo={campo.rotulo}
          // `false` é resposta VÁLIDA (o servidor aceita `is_bool`): anunciar "(obrigatório)"
          // e exigir a marcação enganaria a AT (WCAG 3.3.2). A semântica do modelo não muda —
          // só a apresentação do checkbox não impõe a marcação.
          obrigatorio={false}
          marcado={valor === true}
          aoMudar={(marcado) => aoMudar(marcado)}
          erro={erro}
        />
      )
    default:
      // tipo desconhecido (modelo malformado): não quebra o render, não é editável
      return (
        <div className="flex flex-col gap-1">
          <span className="text-rotulo text-texto-suave">{campo.rotulo}</span>
          <AvisoDeCampo>
            Tipo de campo não suportado neste modelo — atualize o modelo.
          </AvisoDeCampo>
        </div>
      )
  }
}
