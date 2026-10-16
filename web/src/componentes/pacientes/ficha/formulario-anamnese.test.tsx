import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { FormularioAnamnese } from '@/componentes/pacientes/ficha/formulario-anamnese'
import { semErros, type ErrosDoServidor } from '@/lib/erros'
import { modeloFicticio } from '@/test/dados-anamnese'
import type { AnamneseModelo, RespostasAnamnese, TipoDeCampoAnamnese } from '@/tipos'

function renderizar(
  modelo: AnamneseModelo,
  {
    valoresIniciais,
    erros = semErros(),
    aoSalvar = vi.fn(),
  }: { valoresIniciais?: RespostasAnamnese; erros?: ErrosDoServidor; aoSalvar?: (r: RespostasAnamnese) => void } = {},
) {
  render(
    <>
      <FormularioAnamnese
        modelo={modelo}
        formId="form-anamnese-teste"
        valoresIniciais={valoresIniciais}
        erros={erros}
        aoSalvar={aoSalvar}
      />
      <button type="submit" form="form-anamnese-teste">
        Salvar
      </button>
    </>,
  )
  return { aoSalvar }
}

describe('Formulário de anamnese — um controle do DS por tipo', () => {
  it('deve renderizar um controle por campo, com o rótulo do modelo', () => {
    // ARRANGE + ACT
    renderizar(modeloFicticio())

    // ASSERT — texto, número, opções, data e booleano, cada um pelo seu rótulo
    expect(screen.getByLabelText(/Queixa principal/)).toBeInTheDocument()
    expect(screen.getByLabelText(/Idade em meses/)).toBeInTheDocument()
    expect(screen.getByLabelText(/Turno/)).toBeInTheDocument()
    expect(screen.getByLabelText(/Início dos sintomas/)).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /Veio acompanhado/ })).toBeInTheDocument()
  })

  it('deve barrar o envio sem o campo obrigatório, citando o RÓTULO e nunca o valor (SEC-ANM-08)', async () => {
    // ARRANGE — só a queixa, obrigatória
    const usuario = userEvent.setup()
    const modelo = modeloFicticio({
      campos_json: [{ id: 'queixa', tipo: 'texto', rotulo: 'Queixa principal', obrigatorio: true }],
    })
    const { aoSalvar } = renderizar(modelo)

    // ACT — envia vazio
    await usuario.click(screen.getByRole('button', { name: 'Salvar' }))

    // ASSERT — mensagem cita o rótulo; o envio não acontece
    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent(/Queixa principal/)
    expect(aoSalvar).not.toHaveBeenCalled()
  })

  it('deve montar respostas com valores JSON-TIPADOS: number e bool, não strings (SEC-ANM-09)', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    const { aoSalvar } = renderizar(modeloFicticio())

    // ACT — preenche queixa (obrigatória), número, opção e marca o booleano
    await usuario.type(screen.getByLabelText(/Queixa principal/), 'Fala fictícia')
    await usuario.type(screen.getByLabelText(/Idade em meses/), '24')
    await usuario.selectOptions(screen.getByLabelText(/Turno/), 'Manhã')
    await usuario.click(screen.getByRole('checkbox', { name: /Veio acompanhado/ }))
    await usuario.click(screen.getByRole('button', { name: 'Salvar' }))

    // ASSERT — number é number, bool é bool; o campo de data vazio é omitido
    expect(aoSalvar).toHaveBeenCalledTimes(1)
    expect(aoSalvar).toHaveBeenCalledWith({
      queixa: 'Fala fictícia',
      idade_meses: 24,
      turno: 'Manhã',
      acompanhado: true,
    })
  })

  it('deve mover o foco ao 1º campo inválido no erro de validação-cliente (3.3.1)', async () => {
    // ARRANGE — quem usa teclado/leitor não pode perder o campo que rolou fora do corpo
    const usuario = userEvent.setup()
    const modelo = modeloFicticio({
      campos_json: [{ id: 'queixa', tipo: 'texto', rotulo: 'Queixa principal', obrigatorio: true }],
    })
    renderizar(modelo)

    // ACT — envia vazio
    await usuario.click(screen.getByRole('button', { name: 'Salvar' }))

    // ASSERT — o foco pousa no campo inválido
    await waitFor(() => expect(screen.getByLabelText(/Queixa principal/)).toHaveFocus())
  })

  it('deve NÃO exigir a marcação num checkbox, mesmo com o campo obrigatório no modelo (3.3.2)', () => {
    // ARRANGE — `false` é resposta válida; "(obrigatório)" no checkbox enganaria a AT
    const modelo = modeloFicticio({
      campos_json: [{ id: 'ok', tipo: 'booleano', rotulo: 'Concordo', obrigatorio: true }],
    })

    // ACT
    renderizar(modelo)

    // ASSERT — o checkbox existe sem o sufixo "(obrigatório)" no nome acessível
    expect(screen.getByRole('checkbox', { name: 'Concordo' })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: /obrigatório/ })).not.toBeInTheDocument()
  })

  it('deve pousar o 422 do servidor no campo respostas_json.{id}', async () => {
    // ARRANGE — recusa do servidor por campo (sem ecoar valor)
    const erros: ErrosDoServidor = {
      campos: new Map([['respostas_json.queixa', 'Resposta inválida para o campo “Queixa principal”.']]),
      gerais: [],
    }

    // ACT
    renderizar(modeloFicticio(), { erros })

    // ASSERT — a mensagem do servidor aparece junto ao campo
    expect(await screen.findByText(/Resposta inválida para o campo/)).toBeInTheDocument()
  })
})

describe('Formulário de anamnese — integridade clínica', () => {
  it('deve renderizar tipo desconhecido como fail-safe, fora do payload', async () => {
    // ARRANGE — modelo malformado: um tipo que o servidor não conhece não pode quebrar o render
    const usuario = userEvent.setup()
    const modelo = modeloFicticio({
      campos_json: [
        { id: 'queixa', tipo: 'texto', rotulo: 'Queixa principal', obrigatorio: true },
        { id: 'assina', tipo: 'assinatura' as TipoDeCampoAnamnese, rotulo: 'Assinatura', obrigatorio: false },
      ],
    })
    const { aoSalvar } = renderizar(modelo)

    // ASSERT 1 — o aviso de fail-safe aparece, o render não quebra
    expect(screen.getByText(/Tipo de campo não suportado/)).toBeInTheDocument()

    // ACT — preenche o que dá e envia
    await usuario.type(screen.getByLabelText(/Queixa principal/), 'Fala fictícia')
    await usuario.click(screen.getByRole('button', { name: 'Salvar' }))

    // ASSERT 2 — o campo desconhecido NÃO entra no payload
    expect(aoSalvar).toHaveBeenCalledTimes(1)
    const enviado = (aoSalvar as ReturnType<typeof vi.fn>).mock.calls[0][0] as RespostasAnamnese
    expect(enviado).not.toHaveProperty('assina')
    expect(enviado).toEqual({ queixa: 'Fala fictícia' })
  })

  it('deve preservar resposta órfã na edição, com aviso e nunca ocultada (SEC-ANM-05)', async () => {
    // ARRANGE — modelo perdeu o campo `antigo`, mas a anamnese tem resposta dele
    const usuario = userEvent.setup()
    const modelo = modeloFicticio({
      campos_json: [{ id: 'queixa', tipo: 'texto', rotulo: 'Queixa principal', obrigatorio: true }],
    })
    const { aoSalvar } = renderizar(modelo, {
      valoresIniciais: { queixa: 'Fala fictícia', antigo: 'Resposta órfã fictícia' },
    })

    // ASSERT 1 — a órfã aparece sob id cru + aviso, nunca some
    expect(screen.getByText('antigo')).toBeInTheDocument()
    expect(screen.getByText(/campo removido do modelo/)).toBeInTheDocument()
    expect(screen.getByText('Resposta órfã fictícia')).toBeInTheDocument()

    // ACT — salva sem tocar na órfã
    await usuario.click(screen.getByRole('button', { name: 'Salvar' }))

    // ASSERT 2 — a órfã VOLTA no payload, preservada
    expect(aoSalvar).toHaveBeenCalledWith(
      expect.objectContaining({ queixa: 'Fala fictícia', antigo: 'Resposta órfã fictícia' }),
    )
  })
})
