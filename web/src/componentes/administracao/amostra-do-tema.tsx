/**
 * Uma miniatura do sistema DESENHADA no tema (change tema-da-clinica): o menu com o item ativo,
 * o botão principal e a linha do agora — exatamente os papéis que o tema troca. A amostra usa os
 * tokens de verdade sob o próprio `data-tema`, então o que a administradora vê aqui é o que a
 * tela vai ser, e não um desenho à parte que envelhece.
 *
 * Decorativa para a árvore de acessibilidade: quem não a vê recebe o nome e a descrição do tema
 * pelo rótulo da opção.
 */
export function AmostraDoTema({ tema }: { tema: string }) {
  return (
    <div
      data-tema={tema}
      aria-hidden="true"
      // `font-texto`: a fonte é resolvida NO elemento, e não herdada do `<html>` — senão a amostra do
      // Padrão sairia na fonte do tema quando a tela já está nele
      className="flex h-24 w-full overflow-hidden rounded-controle border border-linha bg-fundo text-left font-texto [font-weight:var(--peso-texto)]"
    >
      <div className="flex w-2/5 flex-col gap-0.5 border-r border-moldura-linha bg-moldura p-1.5">
        <span className="relative truncate rounded-controle bg-moldura-ativo px-2 py-1 text-meta font-semibold text-acento before:absolute before:bottom-1 before:left-recuo-fio before:top-1 before:w-[3px] before:rounded-pilula before:bg-destaque before:content-['']">
          Agenda
        </span>
        <span className="truncate px-2 pt-1 text-meta font-semibold uppercase text-rotulo-de-grupo">Gestão</span>
        <span className="truncate px-2 py-0.5 text-meta text-texto-suave">Pacientes</span>
      </div>
      <div className="flex flex-1 flex-col justify-between p-2">
        {/* o losango do botão principal (change tema-xclinicas) também na miniatura: no Padrão o
            papel não cria o pseudo-elemento */}
        <span className="inline-flex items-center gap-1 self-end rounded-botao bg-botao-primario px-2.5 py-0.5 text-meta font-semibold text-sobre-botao-primario shadow-botao-primario after:size-1.5 after:rotate-45 after:bg-losango after:content-(--botao-primario-losango)">
          Agendar
        </span>
        <div className="flex items-center gap-1.5">
          <span className="text-meta font-semibold tabular-nums text-acento">14:20</span>
          <span className="relative h-px flex-1 bg-destaque before:absolute before:left-0 before:top-1/2 before:size-1.5 before:-translate-y-1/2 before:rounded-pilula before:bg-destaque before:content-['']" />
        </div>
      </div>
    </div>
  )
}
