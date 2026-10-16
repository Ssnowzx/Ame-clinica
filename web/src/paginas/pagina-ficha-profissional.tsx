import { useParams } from 'react-router-dom'

import {
  useAcessoDaFicha,
  useFichaDoProfissional,
  usePainelDoProfissional,
  useRelogioDaFicha,
} from '@/componentes/profissionais/painel/acesso-da-ficha'
import { EnderecoInvalido, FichaSemAcesso } from '@/componentes/profissionais/painel/estados-da-ficha'
import { FichaDoProfissional } from '@/componentes/profissionais/painel/ficha-do-profissional'

/**
 * A FICHA do profissional, que virou o PAINEL DO MÊS dele (change painel-do-profissional, D5): a
 * identificação, o dia, os números do mês com comparação, seis meses de tendência, a semana, onde a
 * agenda não rendeu, os pacientes, as pendências, os tratamentos e — só quando a API o devolve — o
 * financeiro próprio. O mês mora na URL (`?mes=`), e a página imprime em A4.
 *
 * As regras que vêm da ficha-do-profissional continuam valendo:
 * - abre para `profissionais.ver` OU para o PRÓPRIO profissional; sem nenhum, o acesso negado;
 * - número de leitura ESCOPADA só onde o recorte não mente: na ficha de colega, o dia, as evoluções e
 *   os tratamentos viram PORTA (um "0" fabricado pelo escopo mentiria). O painel do mês segue a mesma
 *   régua no servidor: bloco que quem olha não alcança não vem, e não alcançar nenhum é 403 — PORTA;
 * - bloco cuja chave não veio não deixa buraco: o componente dele nem monta.
 *
 * Os números de produção vêm do PAINEL — a mesma conta da linha do profissional nos Indicadores (D7) —,
 * e não mais da vista de produção por profissional: a mesma coisa de duas fontes acaba discordando.
 *
 * O cadastro e o painel são pedidos JUNTOS (sem cascata); os hooks rodam antes de qualquer retorno.
 */
export function PaginaFichaProfissional() {
  const { id } = useParams()
  const profissionalId = Number(id)
  const idValido = Number.isInteger(profissionalId) && profissionalId > 0
  const acesso = useAcessoDaFicha(profissionalId, idValido)
  const ficha = useFichaDoProfissional(profissionalId, idValido && acesso.podeVerCadastro)
  const relogio = useRelogioDaFicha(acesso.podeAgenda)
  const painel = usePainelDoProfissional(profissionalId, relogio.mes, acesso.podePainel)

  if (!idValido) {
    return <EnderecoInvalido texto="Este endereço de profissional não é válido." />
  }
  // esconder é experiência: o servidor continua decidindo (own-show + permissões)
  if (!acesso.podeVerCadastro) {
    return <FichaSemAcesso />
  }

  return <FichaDoProfissional profissionalId={profissionalId} acesso={acesso} ficha={ficha} painel={painel} relogio={relogio} />
}
