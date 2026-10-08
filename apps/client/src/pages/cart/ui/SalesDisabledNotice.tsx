import { Link } from 'react-router-dom'
import { ShoppingCart } from 'lucide-react'
import { enrollChannels, useTenant } from '@/entities/tenant'

const botao = 'max-w-full break-all rounded-full bg-brand px-6 py-3 font-bold text-white transition-colors hover:bg-brand-dark'

/** O polo ainda não vende online: o carrinho explica e oferece todos os contatos que o polo cadastrou. */
export function SalesDisabledNotice() {
  const { branding, name, isMatriz } = useTenant()
  const canais = enrollChannels(branding)
  return (
    <div className="mx-auto max-w-2xl px-4 py-24 text-center sm:px-6">
      <ShoppingCart className="mx-auto size-12 text-muted" aria-hidden="true" />
      <h1 className="mt-4 text-2xl font-bold text-ink">{isMatriz ? 'Matrículas pelo WhatsApp' : 'Matrículas pelo polo'}</h1>
      <p className="mt-2 text-muted">
        {isMatriz ? `As matrículas de ${name} são feitas pelo nosso atendimento.` : `As matrículas de ${name} são feitas pela secretaria do polo.`}{' '}
        {canais.length > 0
          ? 'Escolha o curso e fale com a gente.'
          : 'O polo ainda não cadastrou um contato no site: procure o polo pessoalmente para se matricular.'}
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        {canais.map((c) =>
          c.href ? (
            <a
              key={c.kind}
              href={c.href}
              target={c.external ? '_blank' : undefined}
              rel={c.external ? 'noopener noreferrer' : undefined}
              className={botao}
            >
              {c.label}
            </a>
          ) : null
        )}
        <Link to="/#cursos" className="rounded-full border border-brand px-6 py-3 font-bold text-brand transition-colors hover:bg-brand-soft">
          Ver cursos
        </Link>
      </div>
      {/* O telefone é texto livre: sem um número só para discar, aparece como o polo o digitou, sem link. */}
      {canais.map((c) => (c.href ? null : <p key={c.kind} className="mt-4 text-sm text-muted">{c.label}</p>))}
    </div>
  )
}
