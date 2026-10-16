import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { TriangleAlert } from 'lucide-react'
import { useState, type FormEvent } from 'react'

import { GradeDePermissoes } from '@/componentes/administracao/grade-de-permissoes'
import { AvisoErro } from '@/componentes/ui/aviso-erro'
import { Botao } from '@/componentes/ui/botao'
import { CampoCheckbox } from '@/componentes/ui/campo-checkbox'
import { CampoTexto } from '@/componentes/ui/campo-texto'
import { Realce } from '@/componentes/ui/realce'
import { Skeleton } from '@/componentes/ui/skeleton'
import { usarErrosDoServidor } from '@/hooks/usar-erros-do-servidor'
import { ehConflitoDeEdicao } from '@/lib/conflito'
import { chaves } from '@/lib/chaves-query'
import { EXPLICACAO_DAS_FLAGS, FLAGS_DE_ESCOPO, precisaDaFlagOperacional } from '@/lib/permissoes-rotulos'
import {
  atualizarNivelPermissao,
  criarNivelPermissao,
  listarCatalogoPermissoes,
} from '@/servicos/niveis-permissao'
import { useAuthStore } from '@/stores/auth-store'
import type { NivelPermissao } from '@/tipos'

const CAMPOS_DO_NIVEL = new Set(['nome', 'permissoes'])

/** O aviso do nível de balcão sem a flag operacional (SEC-VP-37): informativo, nunca bloqueante. */
const AVISO_SEM_FLAG_OPERACIONAL =
  'Sem "Operar a agenda e os pacotes de toda a clínica", este nível só funciona para usuários ' +
  'vinculados a um profissional. Um usuário sem vínculo neste nível não verá pacote nenhum, não ' +
  'faturará sessões e não verá presença — é a proteção contra vínculo perdido. Se este nível é de ' +
  'recepção ou faturamento, marque a caixa.'

/** O aviso ao marcar a flag clínica (SEC-VP-25): a "saída intuitiva" que abre o prontuário inteiro. */
const AVISO_FLAG_CLINICA =
  'Este nível passa a ler o prontuário de todas as crianças. Se a intenção é deixar um terapeuta ' +
  'marcar horários ou cadastrar pacote para colegas, esta caixa não resolve isso — e abre o ' +
  'prontuário inteiro. Veja "Quem atende e também marca para os colegas" no manual.'

interface FormularioNivelProps {
  /** `null` = criação; o registro (do item da lista) hidrata a edição por prop. */
  nivel: NivelPermissao | null
  aoConcluir: () => void
  aoCancelar: () => void
}

/**
 * Criação/edição de nível de permissão (§12). O conjunto de permissões é montado do
 * catálogo COMPLETO e enviado inteiro (round-trip integral — SEC-ADM-08): toda permissão
 * aparece exatamente uma vez (grade OU seção de escopo) e round-tripa, então salvar sem
 * tocar preserva o conjunto — nada é removido em silêncio. Flags de escopo (D11) nascem
 * desmarcadas (fail-closed).
 */
export function FormularioNivel({ nivel, aoConcluir, aoCancelar }: FormularioNivelProps) {
  const queryClient = useQueryClient()
  const { erros, limparErros, aoFalhar, notificar } = usarErrosDoServidor(CAMPOS_DO_NIVEL)

  const editando = nivel !== null
  const [nome, setNome] = useState(nivel?.nome ?? '')
  // seed do conjunto completo do nível (por prop) — round-trip preserva o que a tela não desenha
  const [selecionadas, setSelecionadas] = useState<Set<string>>(() => new Set(nivel?.permissoes ?? []))

  const consultaCatalogo = useQuery({
    queryKey: chaves.catalogoPermissoes(),
    queryFn: listarCatalogoPermissoes,
  })
  // ninguém concede o que não tem (change `trava-de-usuarios-e-niveis`): a caixa da permissão que a
  // pessoa não tem fica travada — o servidor recusaria com 403
  const temPermissao = useAuthStore((estado) => estado.temPermissao)
  const algumaTravada = (consultaCatalogo.data ?? []).some((permissao) => !temPermissao(permissao))

  function alternar(permissao: string, marcada: boolean): void {
    setSelecionadas((anterior) => {
      const proximo = new Set(anterior)
      if (marcada) {
        proximo.add(permissao)
      } else {
        proximo.delete(permissao)
      }
      return proximo
    })
  }

  const mutacao = useMutation({
    retry: 0,
    mutationFn: async () => {
      const payload = { nome, permissoes: [...selecionadas] }
      if (editando) {
        return atualizarNivelPermissao(nivel.id, payload, nivel.updated_at)
      }
      // criação é direta mesmo com aprovação dupla (nível novo é inerte até ser atribuído)
      const criado = await criarNivelPermissao(payload)

      return { aplicado: true as const, dados: criado }
    },
    onMutate: limparErros,
    onSuccess: async (resultado) => {
      // maker-checker (AP-13): 202 = virou pendência — as permissões VIGENTES não
      // mudaram; avisar como aplicado mentiria para quem depende do nível hoje
      if (!resultado.aplicado) {
        await queryClient.invalidateQueries({ queryKey: chaves.aprovacoesDeAcesso() })
        notificar({
          tom: 'aviso',
          titulo: 'Mudança enviada para aprovação.',
          descricao: 'Outro administrador precisa aprovar antes de ela valer.',
        })
        aoConcluir()
        return
      }
      await queryClient.invalidateQueries({ queryKey: chaves.niveisPermissao() })
      notificar({ tom: 'sucesso', titulo: editando ? 'Nível salvo.' : 'Nível criado.' })
      aoConcluir()
    },
    onError: (erro) => {
      aoFalhar(erro)
      // conflito (EX-05/B1): a linha do painel que hidratou esta edição está velha —
      // invalidar garante que reabrir re-hidrate fresco, com o token novo
      if (ehConflitoDeEdicao(erro)) {
        void queryClient.invalidateQueries({ queryKey: chaves.niveisPermissao() })
      }
    },
  })

  // o nível tem permissão operacional mas não a flag: sem vínculo, nasce cego (SEC-VP-37)
  const semFlagOperacional =
    !selecionadas.has('agenda.ver_todos') && [...selecionadas].some(precisaDaFlagOperacional)

  function submeter(evento: FormEvent): void {
    evento.preventDefault()
    mutacao.mutate()
  }

  return (
    <form onSubmit={submeter} className="flex flex-col gap-5">
      <AvisoErro mensagens={erros.gerais} />

      <CampoTexto
        rotulo="Nome do nível"
        obrigatorio
        value={nome}
        erro={erros.campos.get('nome')}
        onChange={(evento) => {
          setNome(evento.target.value)
        }}
      />

      {/* `min-w-0`: o `fieldset` nasce com `min-inline-size: min-content` do navegador — sem
          isso ele fica do tamanho da grade e quem rola na horizontal é o CORPO do diálogo,
          não a grade (achado ao vivo em 390px, 2026-08-26) */}
      <fieldset className="flex min-w-0 flex-col gap-3">
        <legend className="text-corpo font-medium text-texto">Permissões por módulo</legend>
        {erros.campos.get('permissoes') !== undefined ? (
          <p role="alert" className="text-meta text-perigo-texto">
            {erros.campos.get('permissoes')}
          </p>
        ) : null}
        {consultaCatalogo.isPending ? (
          // mesma altura da grade cheia (max-h-96) — o catálogo real estoura o teto, então
          // trocar o esqueleto pela grade não move o rodapé do formulário
          <Skeleton className="h-96 w-full" />
        ) : consultaCatalogo.isError ? (
          <p className="text-corpo text-perigo-texto">Não foi possível carregar o catálogo de permissões.</p>
        ) : (
          <>
            {algumaTravada ? (
              <p className="text-meta text-texto-suave">
                As permissões que você não tem ficam travadas: ninguém concede o que não tem.
              </p>
            ) : null}
            <GradeDePermissoes
              catalogo={consultaCatalogo.data ?? []}
              selecionadas={selecionadas}
              aoAlternar={alternar}
              podeAlternar={temPermissao}
            />
          </>
        )}
      </fieldset>

      <fieldset className="flex flex-col gap-3 rounded-janela border border-linha p-4">
        <legend className="px-1 text-corpo font-medium text-texto">Escopo de visão</legend>
        <p className="text-meta text-texto-suave">
          Define até onde este nível alcança: a clínica inteira, só o profissional a que o usuário
          está vinculado, ou nada — quando não há vínculo nem a caixa marcada.
        </p>
        {FLAGS_DE_ESCOPO.map((flag) => (
          <CampoCheckbox
            key={flag}
            rotulo={EXPLICACAO_DAS_FLAGS[flag].rotulo}
            ajuda={EXPLICACAO_DAS_FLAGS[flag].ajuda}
            marcado={selecionadas.has(flag)}
            desabilitado={!temPermissao(flag)}
            aoMudar={(marcado) => {
              alternar(flag, marcado)
            }}
          />
        ))}
        {/* região viva SEMPRE montada, texto condicional dentro (achado A11Y-04): leitor de tela
            só observa mutação de região que já existia — inserir a região junto com o texto é o
            caso historicamente não confiável (re-review da rodada 4, CR4b-04) */}
        <div role="status" aria-live="polite" className="flex flex-col gap-3">
          {semFlagOperacional ? (
            <Realce
              tom="atencao"
              rotulo="Atenção"
              icone={<TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-alerta-texto" />}
              texto={AVISO_SEM_FLAG_OPERACIONAL}
            />
          ) : null}
          {selecionadas.has('clinico.ver_todos') ? (
            <Realce
              tom="atencao"
              rotulo="Atenção"
              icone={<TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-alerta-texto" />}
              texto={AVISO_FLAG_CLINICA}
            />
          ) : null}
        </div>
      </fieldset>

      <div className="mt-1 flex justify-end gap-3">
        <Botao
          type="button"
          variante="secundario"
          tamanho="lg"
          disabled={mutacao.isPending}
          onClick={aoCancelar}
        >
          Cancelar
        </Botao>
        <Botao type="submit" tamanho="lg" carregando={mutacao.isPending}>
          {editando ? 'Salvar' : 'Criar nível'}
        </Botao>
      </div>
    </form>
  )
}
