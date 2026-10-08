import { isAllowedBrandingUrl } from './branding'
import { brandingObjectPath, brandingUploadTicket } from './branding-upload'

describe('brandingObjectPath', () => {
  it('fica na pasta da marca do polo e passa na validação da marca', () => {
    const p = brandingObjectPath('t-a', 'logo', '../minha logo.png', 'id1')
    expect(p).toBe('polos/t-a/marca/logo-id1-._minha_logo.png')
    expect(isAllowedBrandingUrl(p, 't-a')).toBe(true)
    expect(isAllowedBrandingUrl(p, 't-b')).toBe(false)
  })
})

describe('brandingUploadTicket', () => {
  it('pede a URL assinada para o caminho do polo', async () => {
    const gcs = { signedUploadUrl: jest.fn().mockResolvedValue('https://upload') }
    const t = await brandingUploadTicket(gcs, 't-a', { kind: 'favicon', fileName: 'f.png', contentType: 'image/png' })
    expect(t.uploadUrl).toBe('https://upload')
    expect(t.objectPath).toMatch(/^polos\/t-a\/marca\/favicon-/)
    expect(gcs.signedUploadUrl).toHaveBeenCalledWith(t.objectPath, 'image/png')
  })

  it('sem bucket configurado responde 404 com explicação', async () => {
    const gcs = { signedUploadUrl: jest.fn().mockResolvedValue(null) }
    await expect(brandingUploadTicket(gcs, 't-a', { kind: 'logo', fileName: 'l.png', contentType: 'image/png' })).rejects.toThrow('Upload indisponível')
  })
})
