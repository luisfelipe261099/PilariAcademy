import { EMPTY_BRANDING } from './branding'
import { toPublicTenant } from './public-tenant'
import type { TenantContext } from './tenant-context'

const quando = new Date('2026-10-01T12:00:00Z')
const ctx = (over: Partial<TenantContext> = {}): TenantContext => ({
  id: 't-a', slug: 'polo-a', name: 'Polo A', isMatriz: false, status: 'active',
  branding: { ...EMPTY_BRANDING, primaryColor: '#0055aa', logoUrl: 'polos/t-a/marca/logo-1-a.png' }, updatedAt: quando, ...over,
})

describe('toPublicTenant', () => {
  it('polo: sem venda, com tema e com imagens pelo proxy versionado', () => {
    const p = toPublicTenant(ctx())
    expect(p).toMatchObject({ slug: 'polo-a', name: 'Polo A', isMatriz: false, status: 'active', salesEnabled: false })
    expect(p.themeCss).toContain('--color-brand:#0055aa')
    expect(p.branding.logoUrl).toBe(`/api/tenant/assets/logo?v=${quando.getTime()}`)
  })

  it('matriz: vende e não sobrescreve o tema', () => {
    const p = toPublicTenant(ctx({ isMatriz: true, slug: 'pilari', branding: { ...EMPTY_BRANDING, logoUrl: 'https://storage.googleapis.com/x/logo.svg' } }))
    expect(p.salesEnabled).toBe(true)
    expect(p.themeCss).toBeNull()
    expect(p.branding.logoUrl).toBe('https://storage.googleapis.com/x/logo.svg')
  })

  it('polo suspenso continua sem venda', () => {
    expect(toPublicTenant(ctx({ status: 'suspended' })).salesEnabled).toBe(false)
  })
})
