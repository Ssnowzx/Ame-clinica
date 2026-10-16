import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'

import { CampoDoTelefone } from '@/componentes/pacientes/campo-do-telefone'
import { AvisoErro } from '@/componentes/ui/aviso-erro'
import { Botao } from '@/componentes/ui/botao'
import { CampoSelect } from '@/componentes/ui/campo-select'
import { CampoTexto } from '@/componentes/ui/campo-texto'
import { DialogConfirmacao } from '@/componentes/ui/dialog-confirmacao'
import { usarErrosDoServidor } from '@/hooks/usar-erros-do-servidor'
import { ROTULOS_DE_SEXO } from '@/lib/pacientes'
import { preCadastrarPaciente } from '@/servicos/pacientes'
import { usarReguaDoCadastro } from '@/hooks/usar-regua-do-cadastro'
import { SEXOS } from '@/tipos'

const CAMPOS = new Set(['nome', 'sexo', 'telefone'])

export interface CardPreCadastroProps {
  /** Recebe o criado para PRÉ-SELECIONAR na busca — o gesto continua "entrar na fila". */
  aoCriar: (paciente: { id: number; nome: string }) => void
  aoCancelar: () => void
}

/**
 * Pré-cadastro pelo balcão (spec lista-espera): o card ACIMA do formulário de
 * entrada, com o que a recepção tem ao telefone — nome, sexo e telefone. A ficha
 * completa fica para depois; a listagem de pacientes avisa o que falta.
 */
export function CardPreCadastro({ aoCriar, aoCancelar }: CardPreCadastroProps) {
  const [nome, setNome] = useState('')
  const [sexo, setSexo] = useState('')
  const [telefone, setTelefone] = useState('')
  const { erros, limparErros, aoFalhar, notificar } = usarErrosDoServidor(CAMPOS)

  /*
   * O balcão também obedece à régua (achado CR-B2).
   *
   * Enquanto o card mandava `sexo` incondicionalmente, esconder o campo tornava o
   * pré-cadastro IMPOSSÍVEL: escolher um valor dava 422 pela presença da chave, e deixar
   * vazio virava `null` no `ConvertEmptyStringsToNull` — chave presente, 422 igual. Não
   * havia caminho de criação, e a mensagem ainda era genérica ("O campo sexo não pode
   * estar presente").
   *
   * `nome` e `telefone` são sempre exigidos: são o mínimo para achar a criança depois.
   */
  const regua = usarReguaDoCadastro()
  const pedeSexo = regua.visivel('sexo')

  // Nome idêntico já existe: a recusa do servidor vira PERGUNTA, não erro. Duas crianças com o
  // mesmo nome existem (irmãos), então isto avisa e deixa confirmar — nunca proíbe.
  const [confirmandoHomonimo, setConfirmandoHomonimo] = useState(false)

  const criar = useMutation({
    retry: 0,
    mutationFn: (confirmarHomonimo: boolean) =>
      preCadastrarPaciente({ nome, telefone, confirmarHomonimo, ...(pedeSexo ? { sexo } : {}) }),
    onMutate: () => {
      limparErros()
    },
    onSuccess: (resultado) => {
      if (resultado.tipo === 'homonimo') {
        setConfirmandoHomonimo(true)
        return
      }
      notificar({
        tom: 'sucesso',
        titulo: 'Paciente pré-cadastrado.',
        descricao: 'Complete a ficha em Pacientes quando puder — a lista avisa o que falta.',
      })
      aoCriar({ id: resultado.paciente.id, nome: resultado.paciente.nome })
    },
    onError: aoFalhar,
  })

  return (
    <section
      aria-label="Novo paciente (pré-cadastro)"
      className="@container flex flex-col gap-3 rounded-superficie border border-acento bg-acento-suave/40 p-4"
    >
      <div>
        <h3 className="text-corpo-lg font-semibold text-texto">Novo paciente</h3>
        <p className="text-meta text-texto-suave">
          Só o essencial para entrar na fila — o restante da ficha se completa depois, em Pacientes.
        </p>
      </div>

      <AvisoErro mensagens={erros.gerais} />

      <CampoTexto
        rotulo="Nome do paciente"
        obrigatorio
        value={nome}
        onChange={(evento) => {
          setNome(evento.target.value)
        }}
        erro={erros.campos.get('nome')}
      />

      {/* as colunas seguem a largura do cartão: com o país antes do número, metade de um cartão
          estreito não cabia o telefone (change telefone-estrangeiro) */}
      <div className="grid grid-cols-1 gap-3 @min-[36rem]:grid-cols-2">
        {pedeSexo ? (
          <CampoSelect
            rotulo="Sexo"
            obrigatorio
            value={sexo}
            placeholder="Escolha…"
            onChange={(evento) => {
              setSexo(evento.target.value)
            }}
            opcoes={SEXOS.map((opcao) => ({ valor: opcao, rotulo: ROTULOS_DE_SEXO[opcao] }))}
            erro={erros.campos.get('sexo')}
          />
        ) : null}
        {/* diz se o número chega no WhatsApp e se já está em outro paciente (change
            telefone-que-chega-no-whatsapp) */}
        <CampoDoTelefone
          rotulo="Telefone de contato"
          obrigatorio
          type="tel"
          conferirRepetido
          value={telefone}
          aoMudar={setTelefone}
          erro={erros.campos.get('telefone')}
        />
      </div>

      <div className="flex justify-end gap-3">
        <Botao type="button" variante="secundario" onClick={aoCancelar} disabled={criar.isPending}>
          Cancelar
        </Botao>
        <Botao
          type="button"
          carregando={criar.isPending}
          onClick={() => {
            criar.mutate(false)
          }}
        >
          Criar e selecionar
        </Botao>
      </div>

      {/* A pergunta do homônimo. Não nomeia o paciente existente — quem digitou o nome já o
          conhece, e a resposta do servidor de propósito não conta nada além de "existe". */}
      <DialogConfirmacao
        aberto={confirmandoHomonimo}
        aoMudarAberto={setConfirmandoHomonimo}
        titulo={`Já existe um paciente chamado ${nome.trim()}. É outra criança?`}
        consequencia={
          'Se for a MESMA criança, cancele e use a busca acima para achá-la — dois cadastros para a '
          + 'mesma criança dividem histórico, sessões e financeiro. Se forem irmãos homônimos, confirme.'
        }
        rotuloConfirmar="Sim, é outra criança"
        tom="atencao"
        carregando={criar.isPending}
        // a recusa do reenvio tem de aparecer DENTRO do diálogo: o `AvisoErro` do card fica atrás
        // do scrim, e o toast passa — quem clicou "confirmar" veria "não aconteceu nada"
        erros={erros.gerais}
        aoConfirmar={() =>
          new Promise<void>((resolver, rejeitar) => {
            criar.mutate(true, {
              onSuccess: (resultado) => {
                // só resolve quando CRIOU: se o servidor devolvesse 409 outra vez, resolver aqui
                // fecharia o diálogo sem criar e sem aviso
                if (resultado.tipo !== 'criado') {
                  rejeitar(new Error('ainda em conflito'))
                  return
                }
                setConfirmandoHomonimo(false)
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
