import { Mail, MapPin, MessageCircle, Phone } from 'lucide-react'
import { BrandLogo, mailtoHref, mapsHref, phoneContact, useTenant, whatsappHref } from '@/entities/tenant'

const link = 'inline-flex items-center gap-2 transition-colors hover:text-accent'
const semLink = 'inline-flex items-center gap-2'

/** Rodapé do site de polo: contatos do polo e como conferir os certificados. */
export function PoloFooter() {
  const t = useTenant()
  const b = t.branding
  const phone = phoneContact(b.phone)
  const wa = whatsappHref(b.whatsapp)
  return (
    <footer className="border-t border-border bg-surface">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:px-6 lg:grid-cols-2">
        <div>
          <BrandLogo className="h-12 w-auto" />
          {b.description && <p className="mt-4 max-w-md text-sm text-muted">{b.description}</p>}
          <ul className="mt-6 space-y-2 text-sm text-muted">
            {phone && (
              <li>
                {/* O telefone é texto livre: aparece sempre, e só vira link quando é um número só. */}
                {phone.href ? (
                  <a href={phone.href} className={link}>
                    <Phone className="size-4 text-accent" aria-hidden="true" /> {phone.text}
                  </a>
                ) : (
                  <span className={semLink}>
                    <Phone className="size-4 text-accent" aria-hidden="true" /> {phone.text}
                  </span>
                )}
              </li>
            )}
            {wa && (
              <li>
                <a href={wa} target="_blank" rel="noopener noreferrer" className={link}>
                  <MessageCircle className="size-4 text-accent" aria-hidden="true" /> WhatsApp
                </a>
              </li>
            )}
            {b.email && (
              <li>
                <a href={mailtoHref(b.email)} className={link}>
                  <Mail className="size-4 text-accent" aria-hidden="true" /> {b.email}
                </a>
              </li>
            )}
            {b.address && (
              <li>
                <a href={mapsHref(b.address)} target="_blank" rel="noopener noreferrer" className={link}>
                  <MapPin className="size-4 shrink-0 text-accent" aria-hidden="true" /> {b.address}
                </a>
              </li>
            )}
          </ul>
        </div>
        <div className="rounded-2xl border border-border bg-card p-6">
          <p className="text-sm font-bold text-ink">Certificado de conclusão com código de verificação.</p>
          <p className="mt-2 text-sm text-muted">Cada certificado traz um código que pode ser conferido pelo QR impresso nele.</p>
        </div>
      </div>
      <div className="bg-brand py-4 text-center text-sm font-medium text-white dark:bg-card">
        © {new Date().getFullYear()} {t.name} · Todos os direitos reservados
      </div>
    </footer>
  )
}
