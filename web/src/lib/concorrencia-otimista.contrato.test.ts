import { readFileSync, readdirSync } from 'node:fs'
import { extname, join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * GUARDA DE IDIOMA da concorrência otimista no FRONT (EX-05 · SEC-OCC) — o par da
 * `ConcorrenciaOtimistaPorPadraoTest` da API.
 *
 * O contrato: **toda edição versionada sai pelos helpers** (`putComVersao`/`patchComVersao`, os
 * únicos lugares que montam o `If-Match`, com o token VERBATIM da leitura). Um `http.put(` ou
 * `http.patch(` fora da lista de exceções é uma tela nova prestes a nascer sem versão — ela
 * levaria 428 do servidor em produção, mas o 428 é o sinal TARDIO; esta guarda é o sinal no commit.
 *
 * O PATCH entrou na guarda com o primeiro PATCH-com-versão do front (`PATCH .../situacao`, change
 * `faxina-de-gatilhos`): antes dele a rede só olhava PUT, e o verbo novo teria nascido sem vigia.
 *
 * Exceções classificadas (espelham as da API, por caminho de arquivo):
 * - `lib/http.ts` — o próprio helper.
 * - `servicos/configuracoes.ts` — upsert chave-a-chave (`PUT /configuracoes`), fora do regime.
 * - `servicos/usuarios.ts` — contém `atribuirNivel` (intenção única, fora do regime); o
 *   `atualizarUsuario` do MESMO arquivo já usa `putComVersao`, e a asserção de contagem
 *   abaixo impede um segundo `http.put` de se esconder atrás da exceção.
 */
const RAIZ = join(process.cwd(), 'src')

const EXCECOES: ReadonlyMap<string, number> = new Map([
  ['lib/http.ts', 1], // a implementação do putComVersao
  ['servicos/configuracoes.ts', 1], // PUT /configuracoes — exceção do regime
  ['servicos/usuarios.ts', 1], // atribuirNivel — exceção do regime (intenção única)
  // gravarConexao (PUT /api/mensagens/conexao) — espelho da exceção por URI da API
  // (mensageria-whatsapp): intenção ÚNICA e indivisível ("esta é a credencial"), com os
  // cinco campos obrigatórios em todo envio — não existe edição parcial a perder. E
  // gravar sempre devolve o estado a `nao_conectado`, então dois admins simultâneos
  // terminam num estado consistente; quem decide a verdade é o "Testar conexão" seguinte.
  ['servicos/mensageria.ts', 1],
  // salvarReguaDoCadastro (PUT /api/campos-cadastro/{formulario}) — espelho da exceção por
  // URI da API (campos-do-cadastro-configuraveis, D9): a régua é PARAMETRIZAÇÃO gravada
  // campo a campo, irmã de `PUT /configuracoes`, e não há "registro lido" único a
  // versionar. Dois administradores só se atropelam mexendo no MESMO campo, e o residual
  // é auditado com o campo e o diff da chave.
  ['servicos/campos-cadastro.ts', 1],
])

/** Mesma régua para o PATCH: só o helper pode chamar `http.patch` cru. */
const EXCECOES_PATCH: ReadonlyMap<string, number> = new Map([
  ['lib/http.ts', 1], // a implementação do patchComVersao
  // reordenarTarefas (PATCH /api/tarefas/ordem) — espelho da exceção por URI da API
  // (SEC-OCC-06, kanban-da-equipe D4): lote de posições do arrasto, sem "registro
  // lido" único a versionar; o servidor reindexa denso em transação. Os PATCHes de
  // EDIÇÃO do mesmo arquivo (tarefa, comentário) saem pelo patchComVersao — a
  // contagem exata impede um segundo patch cru de se esconder atrás desta exceção.
  ['servicos/tarefas.ts', 1],
])

function arquivosFonte(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entrada) => {
    const caminho = join(dir, entrada.name)
    if (entrada.isDirectory()) {
      return arquivosFonte(caminho)
    }
    if (!['.ts', '.tsx'].includes(extname(entrada.name)) || entrada.name.includes('.test.')) {
      return []
    }
    return [caminho]
  })
}

describe('concorrência otimista — contrato do front', () => {
  it('deve fazer TODO PUT de edição pelo putComVersao — http.put cru só nas exceções classificadas', () => {
    const violacoes: string[] = []

    for (const caminho of arquivosFonte(RAIZ)) {
      const relativo = caminho.slice(RAIZ.length + 1)
      const fonte = readFileSync(caminho, 'utf8')
      const usos = (fonte.match(/http\.put[<(]/g) ?? []).length
      const permitidos = EXCECOES.get(relativo) ?? 0
      // arquivo SEM uso e SEM exceção não interessa; arquivo de exceção é comparado
      // MESMO com zero usos — exceção 100% migrada é permissão órfã (lista podre)
      if (usos === 0 && permitidos === 0) {
        continue
      }
      // contagem EXATA: acima = tela nova sem versão; abaixo = exceção órfã (a
      // permissão sobraria viva para o próximo http.put se esconder atrás dela)
      if (usos !== permitidos) {
        violacoes.push(`${relativo}: ${usos} http.put (permitidos: ${permitidos})`)
      }
    }

    expect(violacoes).toEqual([])
  })

  it('deve fazer TODO PATCH de edição pelo patchComVersao — http.patch cru só no helper', () => {
    const violacoes: string[] = []

    for (const caminho of arquivosFonte(RAIZ)) {
      const relativo = caminho.slice(RAIZ.length + 1)
      const usos = (readFileSync(caminho, 'utf8').match(/http\.patch[<(]/g) ?? []).length
      const permitidos = EXCECOES_PATCH.get(relativo) ?? 0
      if (usos === 0 && permitidos === 0) {
        continue
      }
      if (usos !== permitidos) {
        violacoes.push(`${relativo}: ${usos} http.patch (permitidos: ${permitidos})`)
      }
    }

    expect(violacoes).toEqual([])
  })

  it('deve manter as exceções VIVAS: arquivo classificado que sumir denuncia a lista podre', () => {
    for (const [relativo] of EXCECOES) {
      expect(() => readFileSync(join(RAIZ, relativo), 'utf8')).not.toThrow()
    }
  })
})
