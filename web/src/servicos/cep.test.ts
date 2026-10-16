import { afterEach, describe, expect, it, vi } from 'vitest'

import { consultarCep } from '@/servicos/cep'

/** A resposta do ViaCEP, na língua dele (medida em 2026-09-04). */
const RESPOSTA_REAL = {
  cep: '88501-050',
  logradouro: 'Rua Fictícia das Acácias',
  complemento: 'de 100 a 200',
  unidade: '',
  bairro: 'Centro Fictício',
  localidade: 'Lages',
  uf: 'SC',
  estado: 'Santa Catarina',
  ibge: '4209300',
}

function responder(corpo: unknown, status = 200): typeof fetch {
  return vi.fn(() =>
    Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(corpo) }),
  ) as unknown as typeof fetch
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('consultarCep', () => {
  it('deve traduzir a resposta do serviço para o formato do produto', async () => {
    // ARRANGE
    vi.stubGlobal('fetch', responder(RESPOSTA_REAL))

    // ACT
    const resultado = await consultarCep('88501-050')

    // ASSERT — `localidade` é a cidade: o nome do provedor não é o nosso
    expect(resultado).toEqual({
      tipo: 'encontrado',
      endereco: {
        logradouro: 'Rua Fictícia das Acácias',
        bairro: 'Centro Fictício',
        cidade: 'Lages',
        uf: 'SC',
      },
    })
  })

  it('deve DESCARTAR o complemento que o serviço devolve', async () => {
    // ARRANGE — a capability proíbe a consulta de tocar em complemento; descartar na tradução
    // fecha a porta por dentro, e nenhum consumidor consegue usar o que não existe no tipo
    vi.stubGlobal('fetch', responder(RESPOSTA_REAL))

    // ACT
    const resultado = await consultarCep('88501050')

    // ASSERT
    expect(JSON.stringify(resultado)).not.toContain('de 100 a 200')
    expect(resultado).not.toHaveProperty('endereco.complemento')
  })

  it('deve mandar SÓ o CEP: sem credencial, sem CSRF, sem cabeçalho nosso', async () => {
    // ARRANGE — a fronteira de privacidade desta integração. O `@/lib/http` acrescentaria o
    // token anti-CSRF da clínica a qualquer host para onde fosse apontado; aqui não passa nada.
    const espia = responder(RESPOSTA_REAL)
    vi.stubGlobal('fetch', espia)

    // ACT
    await consultarCep('88501050')

    // ASSERT
    const [url, opcoes] = vi.mocked(espia).mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://viacep.com.br/ws/88501050/json/')
    expect(opcoes.credentials).toBe('omit')
    expect(opcoes.headers).toBeUndefined()
  })

  it('deve EXIGIR referrerPolicy e no-store na requisição ao terceiro', async () => {
    /*
     * ARRANGE — este teste nasceu de um defeito do PRÓPRIO teste (parecer SEC-CEP-01).
     *
     * A versão anterior fechava com `expect(Object.keys(opcoes)).toEqual(['credentials',
     * 'signal'])`, o que **congelava a ausência da defesa**: acrescentar `referrerPolicy` o
     * faria falhar, e um teste que reprova o conserto é pior que teste nenhum. A régua certa
     * é exigir o que tem de estar lá, nunca proibir o que ainda não está.
     *
     * `referrerPolicy` protege o slug do link público, que é o único segredo daquela porta.
     * `no-store` mantém a lista de CEPs consultados fora do disco da máquina compartilhada.
     */
    const espia = responder(RESPOSTA_REAL)
    vi.stubGlobal('fetch', espia)

    // ACT
    await consultarCep('88501050')

    // ASSERT
    const [, opcoes] = vi.mocked(espia).mock.calls[0] as [string, RequestInit]
    expect(opcoes.referrerPolicy).toBe('no-referrer')
    expect(opcoes.cache).toBe('no-store')
    // lista de PERMISSÃO, não de proibição: continua pegando um `headers`/`body` futuro e
    // custa uma linha quando uma defesa nova entrar — que era o defeito da versão anterior
    expect(Object.keys(opcoes).sort()).toEqual(['cache', 'credentials', 'referrerPolicy', 'signal'])
  })

  it('deve recusar resposta VAZIA em vez de apagar o endereço gravado', async () => {
    /*
     * ARRANGE — parecer SEC-CEP-03, o achado mais grave do gate.
     *
     * `{"erro":"true"}` estava tratado; `200` com `{}` não estava, e virava "encontrado" com
     * os quatro campos em branco — que o preenchimento então ESCREVIA por cima do endereço da
     * criança, com a tela dizendo "preenchido com sucesso".
     *
     * O caminho provável é manutenção, não ataque: a substituta declarada no ADR-0005 usa
     * `street`/`neighborhood`/`city`/`state`.
     */
    vi.stubGlobal('fetch', responder({}))

    // ACT + ASSERT
    await expect(consultarCep('88501050')).resolves.toEqual({ tipo: 'nao_encontrado' })
  })

  it('deve tratar resposta com o formato de OUTRO provedor como não encontrada', async () => {
    // ARRANGE — o formato da BrasilAPI, substituta declarada no ADR-0005
    vi.stubGlobal('fetch', responder({ street: 'Rua X', neighborhood: 'Centro', city: 'Lages', state: 'SC' }))

    // ACT + ASSERT
    await expect(consultarCep('88501050')).resolves.toEqual({ tipo: 'nao_encontrado' })
  })

  it('deve recusar campo que não é texto', async () => {
    // ARRANGE — `as RespostaDoServico` é promessa de tipo, não checagem
    vi.stubGlobal('fetch', responder({ ...RESPOSTA_REAL, bairro: 42, cidade: ['a'] }))

    // ACT + ASSERT
    await expect(consultarCep('88501050')).resolves.toEqual({ tipo: 'indisponivel' })
  })

  it('deve recusar campo absurdamente longo', async () => {
    // ARRANGE — sem isto, o 422 do servidor culpava quem NÃO digitou
    vi.stubGlobal('fetch', responder({ ...RESPOSTA_REAL, logradouro: 'a'.repeat(100000) }))

    // ACT + ASSERT
    await expect(consultarCep('88501050')).resolves.toEqual({ tipo: 'indisponivel' })
  })

  it('deve recusar UF fora das 27', async () => {
    // ARRANGE — UF inválida deixa o select sem seleção visível e o cadastro é recusado sem
    // que a tela diga por quê
    vi.stubGlobal('fetch', responder({ ...RESPOSTA_REAL, uf: 'ZZ' }))

    // ACT + ASSERT
    await expect(consultarCep('88501050')).resolves.toEqual({ tipo: 'indisponivel' })
  })

  it('deve limpar caracteres de controle do texto do provedor', async () => {
    // ARRANGE — nunca fazem parte de um endereço, e são o que a guarda de texto hostil do
    // servidor recusa (com a família levando a culpa)
    vi.stubGlobal('fetch', responder({ ...RESPOSTA_REAL, logradouro: 'Rua \u202egnalb Fictícia' }))

    // ACT
    const resultado = await consultarCep('88501050')

    // ASSERT
    expect(resultado).toEqual({
      tipo: 'encontrado',
      endereco: expect.objectContaining({ logradouro: 'Rua gnalb Fictícia' }),
    })
  })

  it('deve tratar o "erro" que chega com HTTP 200 como não encontrado', async () => {
    // ARRANGE — a armadilha do provedor: CEP inexistente responde 200 com {"erro":"true"}.
    // Conferir só o status daria por bom um endereço que não existe.
    vi.stubGlobal('fetch', responder({ erro: 'true' }, 200))

    // ACT
    const resultado = await consultarCep('99999999')

    // ASSERT
    expect(resultado).toEqual({ tipo: 'nao_encontrado' })
  })

  it('deve tratar CEP malformado (400) como não encontrado', async () => {
    // ARRANGE
    vi.stubGlobal('fetch', responder({}, 400))

    // ACT + ASSERT
    await expect(consultarCep('123')).resolves.toEqual({ tipo: 'nao_encontrado' })
  })

  it('deve tratar falha de rede como serviço indisponível', async () => {
    // ARRANGE — "confira o número que você digitou" e "não é você, é o serviço" são frases
    // diferentes; um desfecho só obrigaria a tela a errar metade dos casos
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))))

    // ACT + ASSERT
    await expect(consultarCep('88501050')).resolves.toEqual({ tipo: 'indisponivel' })
  })

  it('deve tratar erro do servidor do provedor como indisponível', async () => {
    // ARRANGE
    vi.stubGlobal('fetch', responder({}, 503))

    // ACT + ASSERT
    await expect(consultarCep('88501050')).resolves.toEqual({ tipo: 'indisponivel' })
  })

  it('deve aceitar CEP genérico de cidade grande como sucesso PARCIAL', async () => {
    // ARRANGE — CEP de cidade volta sem logradouro e sem bairro. É preenchimento parcial
    // correto, não falha: acender "não encontrado" mandaria a pessoa procurar um erro que
    // não existe.
    vi.stubGlobal('fetch', responder({ logradouro: '', bairro: '', localidade: 'São Paulo', uf: 'SP' }))

    // ACT
    const resultado = await consultarCep('01000000')

    // ASSERT
    expect(resultado).toEqual({
      tipo: 'encontrado',
      endereco: { logradouro: '', bairro: '', cidade: 'São Paulo', uf: 'SP' },
    })
  })

  it('deve funcionar em navegador SEM AbortSignal.any', async () => {
    /*
     * ARRANGE — parecer SEC-CEP-09: defeito que o CONSERTO da rodada 1 criou.
     *
     * `AbortSignal.any` só existe a partir de Chrome 116 / Safari 17.4 / Firefox 124, e este
     * projeto não declara `browserslist` — o alvo do Vite inclui Safari 16.4–17.3. O Vite
     * transpila sintaxe, nunca faz polyfill de API de runtime.
     *
     * O efeito era o pior possível: a consulta NUNCA funcionava no celular antigo da família
     * — o mesmo público que a política de referenciador protege — e a tela dizia "não foi
     * possível buscar agora", mandando todo mundo procurar problema de rede na clínica.
     */
    const semApiNova = {} as unknown as typeof AbortSignal
    vi.stubGlobal('AbortSignal', semApiNova)
    vi.stubGlobal('fetch', responder(RESPOSTA_REAL))

    // ACT — com sinal externo, que é como o hook sempre chama
    const resultado = await consultarCep('88501050', new AbortController().signal)

    // ASSERT
    expect(resultado).toEqual({
      tipo: 'encontrado',
      endereco: expect.objectContaining({ cidade: 'Lages', uf: 'SC' }),
    })
  })

  it('NÃO deve grudar palavras ao limpar quebra de linha do provedor', async () => {
    // ARRANGE — parecer SEC-CEP-10: `\n` e `\t` são categoria Cc. Removê-los antes de
    // colapsar espaço corrompia o dado em vez de limpá-lo, e o resultado ia para a ficha
    vi.stubGlobal('fetch', responder({ ...RESPOSTA_REAL, logradouro: 'Rua das Flores\nfundos', bairro: 'Centro\tSul' }))

    // ACT
    const resultado = await consultarCep('88501050')

    // ASSERT
    expect(resultado).toEqual({
      tipo: 'encontrado',
      endereco: expect.objectContaining({ logradouro: 'Rua das Flores fundos', bairro: 'Centro Sul' }),
    })
  })

  it('deve deixar o ABORTO passar, para não virar "serviço indisponível"', async () => {
    // ARRANGE — aborto não é falha do serviço: é a consulta mais nova mandando esta calar a
    // boca. Sem a distinção, trocar de CEP acenderia erro na tela.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new DOMException('Aborted', 'AbortError'))),
    )

    // ACT + ASSERT
    await expect(consultarCep('88501050')).rejects.toThrow('Aborted')
  })
})
