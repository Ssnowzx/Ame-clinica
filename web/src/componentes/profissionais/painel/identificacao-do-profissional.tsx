import type { Profissional } from '@/tipos'

import { registroNoConselho } from '@/lib/conselho'
import { resumoDeHorarios } from '@/lib/horarios-profissional'

/** A IDENTIFICAÇÃO da ficha (mantida da change ficha-do-profissional): o cadastro, só leitura. */
export function IdentificacaoDoProfissional({ dados }: { dados: Profissional }) {
  return (
    <section aria-label="Identificação" className="rounded-superficie border border-linha bg-superficie p-4 print:break-inside-avoid">
      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <dt className="text-meta text-texto-suave">Especialidades</dt>
          <dd className="mt-0.5 text-corpo text-texto">
            {dados.especialidades.length > 0 ? dados.especialidades.map((especialidade) => especialidade.nome).join(', ') : '—'}
          </dd>
        </div>
        <div>
          <dt className="text-meta text-texto-suave">Conselho</dt>
          <dd className="mt-0.5 text-corpo text-texto">{registroNoConselho(dados) ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-meta text-texto-suave">Horários de atendimento</dt>
          <dd className="mt-0.5 text-corpo tabular-nums text-texto">{resumoDeHorarios(dados.horarios)}</dd>
        </div>
        {/* Só quando > 1 (change atendimento-em-grupo): capacidade 1 vale para quase todo
            mundo, e um dado que vale para todos não informa ninguém — vira ruído que
            esconde as linhas que importam. Aparece porque explica uma agenda com cards
            empilhados no mesmo horário. */}
        {(dados.atendimentos_simultaneos ?? 1) > 1 ? (
          <div>
            <dt className="text-meta text-texto-suave">Atendimentos ao mesmo tempo</dt>
            <dd className="mt-0.5 text-corpo tabular-nums text-texto">{dados.atendimentos_simultaneos} crianças no mesmo horário</dd>
          </div>
        ) : null}
        {/* Só quando DESLIGADO, pelo mesmo motivo da capacidade: ligado é o padrão de todos.
            Desligado explica por que as famílias deste profissional não recebem lembrete
            (change mensagens-automaticas-por-profissional) */}
        {dados.mensagens_automaticas === false ? (
          <div>
            <dt className="text-meta text-texto-suave">Mensagens automáticas às famílias</dt>
            <dd className="mt-0.5 text-corpo text-texto">Desligadas: o lembrete da véspera e a confirmação não saem</dd>
          </div>
        ) : null}
        {dados.obs !== null && dados.obs !== '' ? (
          <div className="sm:col-span-2 lg:col-span-1">
            <dt className="text-meta text-texto-suave">Observação</dt>
            <dd className="mt-0.5 text-corpo text-texto">{dados.obs}</dd>
          </div>
        ) : null}
      </dl>
    </section>
  )
}
