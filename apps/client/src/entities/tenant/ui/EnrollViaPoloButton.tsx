import { ArrowUpRight } from 'lucide-react'
import { enrollContact } from '../lib/contact'
import { useTenant } from '../queries'

/** Polo sem venda online: o botão de compra vira contato com a secretaria do polo. */
export function EnrollViaPoloButton({ courseTitle }: { courseTitle: string }) {
  const { branding, name } = useTenant()
  const contato = enrollContact(branding, courseTitle)
  if (!contato) {
    return (
      <p className="rounded-lg bg-brand-soft px-3 py-2 text-sm font-medium text-brand">
        As matrículas são feitas pela secretaria de {name}. Procure o polo para se matricular.
      </p>
    )
  }
  return (
    <a
      href={contato.href}
      target={contato.external ? '_blank' : undefined}
      rel={contato.external ? 'noopener noreferrer' : undefined}
      className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-brand px-6 py-3 font-bold text-white shadow-lg transition-colors hover:bg-brand-dark"
    >
      Quero me matricular {contato.external && <ArrowUpRight className="size-5" aria-hidden="true" />}
    </a>
  )
}
