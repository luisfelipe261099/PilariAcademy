/// <reference types="jest" />
import 'reflect-metadata'
import { plainToInstance } from 'class-transformer'
import { getMetadataStorage, validate } from 'class-validator'
import { BrandingUploadDto, UpdateMyTenantDto } from './tenant-site.dto'

// Mesmas opções do ValidationPipe global (configure-app.ts).
const OPCOES = { whitelist: true, forbidNonWhitelisted: true } as const

async function camposInvalidos(dto: object): Promise<string[]> {
  return (await validate(dto, OPCOES)).map((e) => e.property).sort()
}

const upload = (over: Record<string, unknown> = {}) =>
  plainToInstance(BrandingUploadDto, { kind: 'logo', fileName: 'logo.png', contentType: 'image/png', ...over })

describe('BrandingUploadDto', () => {
  it.each(['logo', 'logo-light', 'favicon'])('aceita o tipo %s', async (kind) => {
    expect(await camposInvalidos(upload({ kind }))).toEqual([])
  })

  it.each(['image/png', 'image/jpeg', 'image/webp'])('aceita %s', async (contentType) => {
    expect(await camposInvalidos(upload({ contentType }))).toEqual([])
  })

  it.each(['image/svg+xml', 'text/html', 'image/gif', 'image/avif', 'application/pdf', 'application/octet-stream', 'IMAGE/PNG', ''])(
    'recusa %p e explica em português',
    async (contentType) => {
      const erros = await validate(upload({ contentType }), OPCOES)
      expect(erros.map((e) => e.property)).toEqual(['contentType'])
      expect(Object.values(erros[0].constraints ?? {})).toContain('Envie a imagem em PNG, JPEG ou WebP.')
    }
  )

  it('recusa tipo de imagem desconhecido, nome vazio ou longo demais e campo a mais', async () => {
    expect(await camposInvalidos(upload({ kind: 'banner' }))).toEqual(['kind'])
    expect(await camposInvalidos(upload({ fileName: '' }))).toEqual(['fileName'])
    expect(await camposInvalidos(upload({ fileName: 'a'.repeat(201) + '.png' }))).toEqual(['fileName'])
    expect(await camposInvalidos(upload({ tenantId: 'outro-polo' }))).toEqual(['tenantId'])
  })
})

describe('UpdateMyTenantDto', () => {
  const patch = (body: unknown) => plainToInstance(UpdateMyTenantDto, body)

  it('aceita um objeto de marca, mesmo vazio', async () => {
    expect(await camposInvalidos(patch({ branding: {} }))).toEqual([])
    expect(await camposInvalidos(patch({ branding: { heroTitle: 'Olá', primaryColor: '#112233' } }))).toEqual([])
  })

  it.each([{}, { branding: null }, { branding: 'azul' }, { branding: ['heroTitle'] }, { branding: 7 }])('recusa %p', async (body) => {
    expect(await camposInvalidos(patch(body))).toEqual(['branding'])
  })

  it('recusa campo a mais fora da marca', async () => {
    expect(await camposInvalidos(patch({ branding: {}, name: 'Outro nome' }))).toEqual(['name'])
  })
})

describe('mensagens em português na Minha escola (B5)', () => {
  // Guarda estrutural: a regra nova sem `message` quebra aqui, em vez de vazar "kind must be one of the following values".
  it.each([UpdateMyTenantDto, BrandingUploadDto].map((dto) => [dto.name, dto] as const))('toda regra de %s declara a própria mensagem', (_nome, dto) => {
    const regras = getMetadataStorage().getTargetValidationMetadatas(dto, '', true, false).filter((m) => m.type === 'customValidation')
    expect(regras.length).toBeGreaterThan(0)
    expect(regras.filter((m) => typeof m.message !== 'string' || m.message.trim() === '').map((m) => m.propertyName)).toEqual([])
  })

  const mensagens = async (dto: object): Promise<Record<string, string[]>> =>
    Object.fromEntries((await validate(dto, OPCOES)).map((e) => [e.property, Object.values(e.constraints ?? {}).sort()]))

  it('marca que não é objeto', async () => {
    expect(await mensagens(plainToInstance(UpdateMyTenantDto, { branding: 'azul' }))).toEqual({ branding: ['Marca do polo inválida.'] })
  })

  it('upload: tipo de imagem, nome do arquivo e formato', async () => {
    expect(await mensagens(upload({ kind: 'banner' }))).toEqual({ kind: ['Tipo de imagem inválido: use logo, logo-light ou favicon.'] })
    expect(await mensagens(upload({ fileName: '' }))).toEqual({ fileName: ['Informe o nome do arquivo (1 a 200 caracteres).'] })
    expect(await mensagens(upload({ fileName: 'a'.repeat(201) }))).toEqual({ fileName: ['Informe o nome do arquivo (1 a 200 caracteres).'] })
    expect(await mensagens(plainToInstance(BrandingUploadDto, {}))).toEqual({
      kind: ['Tipo de imagem inválido: use logo, logo-light ou favicon.'],
      fileName: ['Informe o nome do arquivo (1 a 200 caracteres).', 'Informe o nome do arquivo.'],
      contentType: ['Envie a imagem em PNG, JPEG ou WebP.'],
    })
  })
})
