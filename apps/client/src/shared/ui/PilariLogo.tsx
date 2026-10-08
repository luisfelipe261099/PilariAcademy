import { BRAND } from '@/shared/config/brand'

/** Símbolo do Studio Pilari (figura no círculo), o mesmo desenho do site do studio. */
export function PilariMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
      <circle
        cx="32"
        cy="31"
        r="19"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray="99 20"
        transform="rotate(28 32 31)"
        className="text-brand/85 dark:text-accent"
      />
      <path d="M21 47C26 38 32 28 39 14.5" stroke="#d99aa5" strokeWidth="3.2" strokeLinecap="round" />
      <path d="M25.5 14.5C29 26 34 36 41 47" stroke="#d99aa5" strokeWidth="3.2" strokeLinecap="round" />
      <ellipse cx="32" cy="11.5" rx="3.3" ry="4.3" fill="#d99aa5" transform="rotate(12 32 11.5)" />
      <g className="fill-brand dark:fill-accent">
        <circle cx="28" cy="30" r="1.15" />
        <circle cx="28.3" cy="34" r="1.15" />
        <circle cx="28.6" cy="38" r="1.15" />
        <circle cx="28.9" cy="42" r="1.15" />
      </g>
    </svg>
  )
}

/**
 * Logo completa: símbolo + "Studio Pilari" + "Pilates Internacional". O nome é texto (Inter), não imagem,
 * para sair nítido em qualquer tamanho e acompanhar o tema escuro. `size` muda a escala do conjunto.
 */
export function PilariLogo({ className = '', size = 'md' }: { className?: string; size?: 'md' | 'lg' }) {
  const grande = size === 'lg'
  return (
    <span className={`${className} inline-flex items-center gap-2.5`} role="img" aria-label={BRAND.name}>
      <PilariMark className={grande ? 'size-12 shrink-0' : 'size-9 shrink-0'} />
      <span className="flex flex-col leading-none">
        <span className={`${grande ? 'text-[22px]' : 'text-[17px]'} font-semibold tracking-[-0.02em] text-brand-dark dark:text-ink`}>
          {BRAND.name}
        </span>
        <span
          className={`${grande ? 'mt-1.5 text-[10px]' : 'mt-1 text-[8.5px]'} font-medium uppercase tracking-[0.22em] text-brand/60 dark:text-muted`}
        >
          {BRAND.tagline}
        </span>
      </span>
    </span>
  )
}
