import { BadRequestException } from '@nestjs/common'
import { ASSET_FIELD_BY_KIND, EMPTY_BRANDING, isAllowedBrandingUrl, isBrandingAssetKind, mergeBranding, publicBranding } from './branding'
import { MATRIZ_TENANT_ID } from './tenancy.constants'

const T = 'tenant-1'

describe('mergeBranding', () => {
  it('parte da marca vazia com as cores padrão', () => {
    expect(mergeBranding(EMPTY_BRANDING, undefined, T)).toEqual(EMPTY_BRANDING)
    expect(EMPTY_BRANDING.primaryColor).toBe('#5c6e5a')
  })

  it('aplica só os campos enviados e normaliza', () => {
    const r = mergeBranding(EMPTY_BRANDING, { primaryColor: '#AABBCC', whatsapp: '+55 (41) 99999-8888', heroTitle: '  Olá  ' }, T)
    expect(r.primaryColor).toBe('#aabbcc')
    expect(r.whatsapp).toBe('5541999998888')
    expect(r.heroTitle).toBe('Olá')
    expect(r.accentColor).toBe(EMPTY_BRANDING.accentColor)
  })

  it('texto vazio vira null', () => {
    expect(mergeBranding({ ...EMPTY_BRANDING, phone: '41 3333-3333' }, { phone: '   ' }, T).phone).toBeNull()
  })

  it.each([
    [{ primaryColor: 'roxo' }, 'Cor principal inválida'],
    [{ accentColor: '#12345' }, 'Cor dos botões inválida'],
    [{ whatsapp: '999' }, 'WhatsApp inválido'],
    [{ email: 'sem-arroba' }, 'E-mail inválido'],
    [{ heroTitle: 'x'.repeat(121) }, 'título da página inicial'],
    [{ logoUrl: 'http://inseguro.com/logo.png' }, 'Endereço de imagem inválido'],
    [{ logoUrl: 'polos/outro-polo/marca/a.png' }, 'Endereço de imagem inválido'],
    [{ faviconUrl: 'javascript:alert(1)' }, 'Endereço de imagem inválido'],
  ])('recusa %p', (input, msg) => {
    expect(() => mergeBranding(EMPTY_BRANDING, input, T)).toThrow(BadRequestException)
    expect(() => mergeBranding(EMPTY_BRANDING, input, T)).toThrow(msg)
  })
})

describe('mergeBranding: a cópia do MEC nos sites de polo (B7)', () => {
  const CORRETA = 'Curso livre com certificado de conclusão'
  const recusa = (termo: string) => `Use "${CORRETA}" em vez de "${termo} pelo MEC".`

  it.each([
    ['description', 'Curso reconhecido pelo MEC', 'reconhecido'],
    ['heroTitle', 'Curso RECONHECIDO PELO MEC', 'reconhecido'],
    ['heroSubtitle', 'Certificado pelo MEC, comece hoje', 'certificado'],
    ['description', 'certificado   pelo\t\tMEC', 'certificado'],
    ['heroTitle', 'Reconhecído pelo MÉC', 'reconhecido'],
    ['heroSubtitle', 'Cursos reconhecidos pelo MEC', 'reconhecidos'],
    ['description', 'Todos os cursos são certificados pelo Mec.', 'certificados'],
    // feminino e plural
    ['description', 'Pós-graduação reconhecida pelo MEC', 'reconhecida'],
    ['heroTitle', 'Formações reconhecidas pelo MEC', 'reconhecidas'],
    ['heroSubtitle', 'Especialização certificada pelo MEC', 'certificada'],
    ['description', 'Turmas certificadas pelo MEC', 'certificadas'],
    // hífens, travessões e espaços sobrando
    ['heroTitle', 'Curso reconhecido-pelo-MEC', 'reconhecido'],
    ['description', 'Curso reconhecido  -  pelo   MEC', 'reconhecido'],
    ['heroSubtitle', 'Curso certificado — pelo MEC', 'certificado'],
    ['description', 'Curso reconhecido\u00a0pelo\u00a0MEC', 'reconhecido'],
    // caracteres invisíveis no meio das palavras
    ['heroTitle', 'Curso recon\u200bhecido pelo MEC', 'reconhecido'],
    ['description', 'Curso certificado pelo\u200d MEC', 'certificado'],
    ['heroSubtitle', 'Curso reconhecido pelo M\u2060E\ufeffC', 'reconhecido'],
    ['description', 'Curso reconhe\u00adcido pelo MEC', 'reconhecido'],
  ])('recusa em %s: %p', (campo, texto, termo) => {
    let erro: unknown
    try {
      mergeBranding(EMPTY_BRANDING, { [campo]: texto }, T)
    } catch (e) {
      erro = e
    }
    expect(erro).toBeInstanceOf(BadRequestException)
    expect((erro as BadRequestException).message).toBe(recusa(termo))
  })

  it('aceita a frase correta e textos sem a expressão', () => {
    const r = mergeBranding(EMPTY_BRANDING, { description: CORRETA, heroTitle: 'Cursos com certificado do Studio Pilari', heroSubtitle: 'Consulte o código no QR do certificado' }, T)
    expect(r.description).toBe(CORRETA)
    expect(mergeBranding(EMPTY_BRANDING, { heroTitle: 'Certificados emitidos pelo Studio Pilari' }, T).heroTitle).toBe('Certificados emitidos pelo Studio Pilari')
  })

  it('só olha descrição, título e subtítulo (o endereço, por exemplo, passa)', () => {
    expect(mergeBranding(EMPTY_BRANDING, { address: 'Rua Reconhecido pelo MEC, 10' }, T).address).toBe('Rua Reconhecido pelo MEC, 10')
  })

  it('a matriz também é barrada: o Studio Pilari oferece cursos livres', () => {
    const daMatriz = 'Cursos do Studio Pilari com certificado reconhecido pelo MEC.'
    expect(() => mergeBranding(EMPTY_BRANDING, { description: daMatriz }, MATRIZ_TENANT_ID)).toThrow(BadRequestException)
  })
})

describe('isAllowedBrandingUrl', () => {
  it('aceita https e caminho do próprio polo', () => {
    expect(isAllowedBrandingUrl('https://cdn.polo.com/logo.png', T)).toBe(true)
    expect(isAllowedBrandingUrl(`polos/${T}/marca/abc-logo.png`, T)).toBe(true)
  })
  it('recusa travessia de diretório e aspas', () => {
    expect(isAllowedBrandingUrl(`polos/${T}/marca/../x.png`, T)).toBe(false)
    expect(isAllowedBrandingUrl('https://x.com/a"b.png', T)).toBe(false)
  })
})

describe('publicBranding', () => {
  it('troca caminho do bucket pela rota pública com versão e mantém https', () => {
    const r = publicBranding({ ...EMPTY_BRANDING, logoUrl: `polos/${T}/marca/a.png`, faviconUrl: 'https://x.com/f.png' }, 1700)
    expect(r.logoUrl).toBe('/api/tenant/assets/logo?v=1700')
    expect(r.faviconUrl).toBe('https://x.com/f.png')
    expect(r.logoLightUrl).toBeNull()
  })
})

describe('ASSET_FIELD_BY_KIND', () => {
  it('cada tipo aponta para o campo que o publicBranding serve por ele', () => {
    expect(Object.keys(ASSET_FIELD_BY_KIND).sort()).toEqual(['favicon', 'logo', 'logo-light'])
    for (const [kind, campo] of Object.entries(ASSET_FIELD_BY_KIND)) {
      const r = publicBranding({ ...EMPTY_BRANDING, [campo]: `polos/${T}/marca/a.png` }, 7)
      expect(r[campo as keyof typeof r]).toBe(`/api/tenant/assets/${kind}?v=7`)
    }
  })

  it('isBrandingAssetKind aceita só os três tipos', () => {
    for (const kind of ['logo', 'logo-light', 'favicon']) expect(isBrandingAssetKind(kind)).toBe(true)
    for (const outro of ['', 'qualquer', 'Logo', 'logo_light', 'toString', '__proto__', 'constructor']) {
      expect(isBrandingAssetKind(outro)).toBe(false)
    }
  })
})
