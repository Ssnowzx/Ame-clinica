import { useQuery } from '@tanstack/react-query'
import { Pencil } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { AvisoDePreRequisito } from '@/componentes/ui/aviso-de-pre-requisito'
import { Botao } from '@/componentes/ui/botao'
import { EstadoErro } from '@/componentes/ui/estado-erro'
import { Skeleton } from '@/componentes/ui/skeleton'
import { CAMINHOS } from '@/lib/caminhos-dos-cadastros'
import { chaves } from '@/lib/chaves-query'
import { cn } from '@/lib/cn'
import { dataHoraLegivel as dataHoraDoInstante } from '@/lib/pacientes'
import { buscarPaciente } from '@/servicos/pacientes'
import { termos } from '@/servicos/termos'
import { useAuthStore } from '@/stores/auth-store'
import type { ConsentimentoDoPaciente } from '@/tipos'

interface SecaoTermoProps {
  pacienteId: number
}

const ROTULO_DA_FORMA: Record<string, string> = {
  papel: 'assinado em papel',
  digital: 'aceite digital',
}

function descreverForma(forma: string | undefined): string | null {
  return forma === undefined ? null : (ROTULO_DA_FORMA[forma] ?? forma)
}

/**
 * Seção Contrato/Termo da ficha (§15 · change aceite-do-regulamento, FA-08).
 *
 * Responde à pergunta que a clínica faz olhando a criança: **esta família aceitou o
 * Regulamento que está valendo?** — e mostra o histórico, incluindo aceites de versões
 * anteriores, que continuam sendo prova do que foi aceito na época.
 *
 * É seção de LEITURA. Registrar o aceite continua sendo edição do cadastro (é lá que
 * o RBAC de `pacientes.editar` já vive): um mesmo registro colhido por duas portas
 * seria duas regras para manter e uma para esquecer.
 */
export function SecaoTermo({ pacienteId }: SecaoTermoProps) {
  const navigate = useNavigate()
  const podeEditar = useAuthStore((estado) => estado.temPermissao('pacientes.editar'))

  const consulta = useQuery({
    queryKey: chaves.paciente(pacienteId),
    queryFn: () => buscarPaciente(pacienteId),
    // chave de DETALHE (contrato CHAVE-DETALHE): o formulário de edição hidrata
    // `useState` desta mesma chave, então TODA leitura dela declara gcTime: 0
    gcTime: 0,
  })

  const consultaDoTermo = useQuery({ queryKey: chaves.termoVigente(), queryFn: termos.vigente })

  if (consulta.isPending || consultaDoTermo.isPending) {
    return (
      <div aria-busy className="flex flex-col gap-3">
        <Skeleton className="h-4 w-64" />
        <Skeleton className="h-16 w-full" />
      </div>
    )
  }

  if (consulta.isError || consultaDoTermo.isError) {
    return (
      <EstadoErro
        mensagem="Não foi possível carregar o termo deste paciente."
        aoTentarNovamente={() => {
          void consulta.refetch()
          void consultaDoTermo.refetch()
        }}
      />
    )
  }

  const vigente = consultaDoTermo.data
  const aceites = consulta.data.consentimentos_json ?? []
  // o aceite da versão EM VIGOR — os demais são histórico (prova do que valia antes)
  const doVigente = vigente === null ? undefined : aceites.find((aceite) => aceite.termo_id === vigente.id)

  const irParaCadastro = (): void => {
    void navigate(`/pacientes/${String(pacienteId)}/editar`)
  }

  return (
    <div className="flex flex-col gap-6">
      {/*
        Sem versão em vigor a situação é "nada a cobrar" — mas o HISTÓRICO continua:
        esconder os aceites que existem seria a seção deixar de fazer a única coisa que
        ela faz, num estado em que a prova segue valendo (achado CR-4 do gate).
      */}
      <section
        className={cn(
          'rounded-superficie border p-4',
          vigente !== null && doVigente === undefined
            ? 'border-alerta-texto bg-alerta-suave'
            : 'border-linha-forte',
        )}
      >
        {vigente === null ? (
          <>
            <h3 className="text-rotulo font-semibold text-texto-suave">Nenhum termo em vigor</h3>
            {/* o caminho para publicar, ou a quem pedir, no fim da MESMA frase (change
                o-sistema-avisa-o-que-falta): numa linha à parte, ele repetia o "não há aceite a cobrar"
                do parágrafo (gate DQA-AVI-05). Aqui o link existe: na ficha, nada digitado se perde */}
            <p className="mt-1 text-corpo text-texto-suave">
              <AvisoDePreRequisito
                para={CAMINHOS.termo}
                oQueFalta="A clínica ainda não publicou o contrato terapêutico. Enquanto não houver versão em vigor, não há aceite a cobrar — os aceites abaixo continuam válidos como prova do que foi aceito."
              />
            </p>
          </>
        ) : (
          <>
            <h3 className="text-rotulo font-semibold text-texto-suave">
              {vigente.titulo} — v{vigente.versao}
            </h3>
            {doVigente === undefined ? (
              <>
                <p className="mt-1 text-corpo text-texto">Aceite pendente.</p>
                <p className="mt-1 text-meta text-texto-suave">
                  Nenhum responsável registrou o aceite da versão em vigor. O registro é feito na edição do
                  cadastro, depois de colher a assinatura.
                </p>
                {podeEditar ? (
                  <Botao variante="secundario" tamanho="sm" className="mt-3" onClick={irParaCadastro}>
                    <Pencil aria-hidden="true" className="size-3.5" />
                    Registrar no cadastro
                  </Botao>
                ) : null}
              </>
            ) : (
              <p className="mt-1 text-corpo text-texto">
                Aceito por {doVigente.responsavel} em {dataHoraDoInstante(doVigente.aceito_em)}
                {descreverForma(doVigente.forma) === null ? '' : ` · ${descreverForma(doVigente.forma)}`}
              </p>
            )}
          </>
        )}
      </section>

      <section>
        <h3 className="text-rotulo font-semibold text-texto-suave">Histórico de aceites</h3>
        {aceites.length === 0 ? (
          <p className="mt-2 text-corpo text-texto-suave">Nenhum aceite registrado.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1.5">
            {aceites.map((aceite: ConsentimentoDoPaciente, indice: number) => (
              <li key={indice} className="text-corpo text-texto">
                {aceite.termo}
                {aceite.versao === undefined ? '' : ` — v${String(aceite.versao)}`}
                <span className="text-texto-suave">
                  {' '}
                  · {aceite.responsavel} · {dataHoraDoInstante(aceite.aceito_em)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
