import { Instagram, Mail, MapPin, MessageCircle } from 'lucide-react'
import { BRAND, whatsappUrl } from '@/shared/config'
import { PilariLogo } from '@/shared/ui'

interface FooterLink {
  label: string
  href: string
  external?: boolean
}

const columns: { title: string; links: FooterLink[] }[] = [
  {
    title: 'Studio',
    links: [
      { label: 'Conheça o Studio Pilari', href: BRAND.siteUrl, external: true },
      { label: 'Aula experimental', href: whatsappUrl('Olá! Quero agendar minha aula experimental.'), external: true },
    ],
  },
  {
    title: 'Cursos',
    links: [{ label: 'Todos os cursos', href: '/#cursos' }],
  },
]

export function Footer() {
  return (
    <footer className="border-t border-border bg-surface">
      <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div className="lg:col-span-2">
            <PilariLogo size="lg" />
            <p className="mt-4 max-w-sm text-sm text-muted">
              {BRAND.slogan} Cursos com a {BRAND.professional}, {BRAND.professionalRole.toLowerCase()}, para
              você aprender no seu ritmo.
            </p>
            <a
              href={BRAND.instagramUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-muted transition-colors hover:text-accent"
            >
              <Instagram className="size-4 text-accent" aria-hidden="true" /> @{BRAND.instagramHandle}
            </a>
          </div>

          {columns.map((col) => (
            <div key={col.title}>
              <h3 className="inline-block border-b-2 border-accent pb-1 text-sm font-bold text-accent">
                {col.title}
              </h3>
              <ul className="mt-4 space-y-2">
                {col.links.map((link) => (
                  <li key={link.label}>
                    <a
                      href={link.href}
                      target={link.external ? '_blank' : undefined}
                      rel={link.external ? 'noopener noreferrer' : undefined}
                      className="text-sm font-medium text-muted transition-colors hover:text-accent"
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-col gap-4 border-t border-border pt-6 text-sm text-muted sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <a
              href={whatsappUrl()}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 transition-colors hover:text-accent"
            >
              <MessageCircle className="size-4 text-accent" aria-hidden="true" />
              <span>
                <span className="font-semibold">WhatsApp</span> {BRAND.phoneLabel}
              </span>
            </a>
            <a
              href={`mailto:${BRAND.email}`}
              className="inline-flex items-center gap-2 transition-colors hover:text-accent"
            >
              <Mail className="size-4 text-accent" aria-hidden="true" /> {BRAND.email}
            </a>
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(BRAND.mapsQuery)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 transition-colors hover:text-accent"
            >
              <MapPin className="size-4 shrink-0 text-accent" aria-hidden="true" />
              {BRAND.address}
            </a>
          </div>
        </div>
      </div>

      <div className="bg-brand py-4 text-center text-sm font-medium text-white dark:bg-card">
        © {new Date().getFullYear()} {BRAND.name} · Todos os direitos reservados
      </div>
    </footer>
  )
}
