import { describe, expect, it } from 'vitest'

import { distribuirErrosDoServidor, erroDaLista, erroDoItem } from '@/lib/erros'
import { ErroDeApi } from '@/lib/http'

const CAMPOS = new Set(['nome', 'cpf', 'responsaveis_json', 'contatos_json'])

function recusa(campos: Record<string, string[]>, mensagem = 'Dados inválidos.'): ErroDeApi {
  return new ErroDeApi('invalido', mensagem, campos)
}

describe('distribuirErrosDoServidor', () => {
  it('deve levar a recusa ao item certo da lista', () => {
    // ARRANGE — o servidor recusa POR ÍNDICE; um erro do 3º contato exibido
    // "no formulário" é um erro que ninguém consegue resolver
    const erro = recusa({ 'contatos_json.2.tipo': ['O tipo selecionado é inválido.'] })

    // ACT
    const erros = distribuirErrosDoServidor(erro, CAMPOS)

    // ASSERT
    expect(erroDoItem(erros, 'contatos_json', 2, 'tipo')).toBe('O tipo selecionado é inválido.')
    expect(erroDoItem(erros, 'contatos_json', 0, 'tipo')).toBeUndefined()
    expect(erros.gerais).toHaveLength(0)
  })

  it('deve levar a recusa da lista inteira à lista', () => {
    // ARRANGE — "menor exige responsável" é da LISTA, não de um item
    const erro = recusa({
      responsaveis_json: ['Paciente menor de idade exige pelo menos um responsável.'],
    })

    // ACT
    const erros = distribuirErrosDoServidor(erro, CAMPOS)

    // ASSERT
    expect(erroDaLista(erros, 'responsaveis_json')).toContain('exige pelo menos um responsável')
  })

  it('deve mandar chave desconhecida para o aviso geral', () => {
    // ARRANGE — fail-safe: o usuário vê o motivo mesmo que a tela não conheça o campo
    const erro = recusa({ campo_que_a_tela_nao_tem: ['Motivo fictício.'] })

    // ACT
    const erros = distribuirErrosDoServidor(erro, CAMPOS)

    // ASSERT
    expect(erros.gerais).toEqual(['Motivo fictício.'])
    expect(erros.campos.size).toBe(0)
  })

  it('não deve poluir o protótipo com chave vinda do servidor', () => {
    // ARRANGE — abuse case: as chaves vêm do servidor; num objeto literal,
    // `__proto__` reescreveria o protótipo (por isso o mapa é um Map)
    const erro = recusa({ '__proto__.poluido': ['x'], 'nome.__proto__': ['y'] })

    // ACT
    const erros = distribuirErrosDoServidor(erro, CAMPOS)

    // ASSERT
    expect(({} as Record<string, unknown>).poluido).toBeUndefined()
    expect(erros.campos.get('nome.__proto__')).toBe('y')
  })

  it('deve dar um motivo quando a recusa não tem campo', () => {
    // ARRANGE — 403, rede, 5xx: nenhuma escrita falha em silêncio
    const erro = new ErroDeApi('sem_acesso', 'Você não tem acesso a este recurso.')

    // ACT
    const erros = distribuirErrosDoServidor(erro, CAMPOS)

    // ASSERT
    expect(erros.gerais).toEqual(['Você não tem acesso a este recurso.'])
  })

  it('deve tratar exceção que não é da API', () => {
    // ARRANGE + ACT
    const erros = distribuirErrosDoServidor(new Error('boom'), CAMPOS)

    // ASSERT
    expect(erros.gerais[0]).toContain('Tente novamente')
  })
})
