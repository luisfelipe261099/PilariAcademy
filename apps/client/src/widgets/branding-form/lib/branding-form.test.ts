import { describe, expect, it } from 'vitest'
import type { TenantBranding } from '@pilari/types'
import { brandingFormErrors, brandingToForm, formToBrandingInput, previewFromSite } from './branding-form'

const marca: TenantBranding = {
  logoUrl: 'polos/t-a/marca/logo-1-a.png', logoLightUrl: null, faviconUrl: 'https://cdn.x/fav.png',
  primaryColor: '#0055aa', accentColor: '#ff6600', whatsapp: '5541900000000', phone: null, email: null,
  address: null, description: null, heroTitle: null, heroSubtitle: null,
}

describe('formulário da marca', () => {
  it('ida e volta: vazio vira null, WhatsApp só com dígitos, cor em minúsculas', () => {
    const f = { ...brandingToForm(marca), whatsapp: '+55 (41) 98888-7777', email: '  ', primaryColor: '#00AA55', heroTitle: ' Olá ' }
    expect(formToBrandingInput(f)).toMatchObject({
      whatsapp: '5541988887777', email: null, primaryColor: '#00aa55', heroTitle: 'Olá', logoUrl: 'polos/t-a/marca/logo-1-a.png',
    })
  })
  it('aponta os erros com as regras do servidor', () => {
    const f = { ...brandingToForm(marca), primaryColor: 'azul', whatsapp: '419999', email: 'sem-arroba', heroTitle: 'x'.repeat(121) }
    expect(brandingFormErrors(f)).toEqual([
      'Cor principal inválida. Use o formato #RRGGBB.',
      'WhatsApp inválido. Informe DDI, DDD e número, ex.: 5541999999999.',
      'E-mail inválido.',
      'O título da página inicial passa de 120 caracteres.',
    ])
    expect(brandingFormErrors(brandingToForm(marca))).toEqual([])
  })
  it('prévia de outro polo passa pelo proxy público do site dele', () => {
    const p = previewFromSite(marca, 'https://polo-a.cursos.studiopilari.com.br')
    expect(p.logoUrl).toBe('https://polo-a.cursos.studiopilari.com.br/api/tenant/assets/logo')
    expect(p.faviconUrl).toBe('https://cdn.x/fav.png')
    expect(p.logoLightUrl).toBeNull()
  })

  // Decisão da Minha escola: a "Cor dos botões de ação" não aparece na tela (nenhum componente usa os tokens laranja),
  // mas o formulário guarda o valor salvo e o devolve como veio, porque o servidor segue aceitando e exigindo o campo.
  it('sem mexer em nada, devolve a marca salva inteira, inclusive a cor dos botões que a tela não mostra', () => {
    expect(formToBrandingInput(brandingToForm(marca))).toEqual(marca)
    const f = { ...brandingToForm(marca), primaryColor: '#00AA55' }
    expect(formToBrandingInput(f).accentColor).toBe('#ff6600')
  })
  it('telefone e e-mail respeitam os limites do servidor (40 e 160 caracteres)', () => {
    const longoDemais = { ...brandingToForm(marca), phone: '9'.repeat(41), email: `${'a'.repeat(156)}@b.co` }
    expect(brandingFormErrors(longoDemais)).toEqual([
      'O telefone passa de 40 caracteres.',
      'O e-mail passa de 160 caracteres.',
    ])
    const noLimite = { ...brandingToForm(marca), phone: '9'.repeat(40), email: `${'a'.repeat(155)}@b.co` }
    expect(brandingFormErrors(noLimite)).toEqual([])
  })
  it('a prévia manda cada imagem para o próprio tipo do proxy', () => {
    const todas: TenantBranding = { ...marca, logoLightUrl: 'polos/t-a/marca/logo-light-2-b.png', faviconUrl: 'polos/t-a/marca/favicon-3-c.png' }
    const p = previewFromSite(todas, 'https://polo-a.cursos.studiopilari.com.br')
    expect(p.logoUrl).toBe('https://polo-a.cursos.studiopilari.com.br/api/tenant/assets/logo')
    expect(p.logoLightUrl).toBe('https://polo-a.cursos.studiopilari.com.br/api/tenant/assets/logo-light')
    expect(p.faviconUrl).toBe('https://polo-a.cursos.studiopilari.com.br/api/tenant/assets/favicon')
    expect(p.primaryColor).toBe('#0055aa')
  })
})
