/**
 * Dados da marca Studio Pilari usados pelo site da matriz (rodapé, links de contato, textos fixos).
 * Fonte: site do studio (studiopilari.vercel.app). Trocar aqui atualiza todos os lugares que usam.
 */
export const BRAND = {
  name: 'Studio Pilari',
  tagline: 'Pilates Internacional',
  slogan: 'Aqui transformamos vidas através do movimento.',
  professional: 'Dra. Mylena Sestream',
  professionalRole: 'Fisioterapeuta e proprietária',
  siteUrl: 'https://studiopilari.vercel.app',
  instagramHandle: 'studio.pilari',
  instagramUrl: 'https://instagram.com/studio.pilari',
  whatsapp: '5541997102441',
  phoneLabel: '(41) 99710-2441',
  email: 'studiopilari@gmail.com',
  address: 'Rod. da Uva, 1299 — Jardim Osasco · Colombo/PR · CEP 83402-000',
  mapsQuery: 'Rod. da Uva, 1299, Jardim Osasco, Colombo, PR, 83402-000',
} as const

export const whatsappUrl = (texto?: string): string =>
  `https://wa.me/${BRAND.whatsapp}${texto ? `?text=${encodeURIComponent(texto)}` : ''}`
