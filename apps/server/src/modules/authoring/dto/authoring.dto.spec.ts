/// <reference types="jest" />
import 'reflect-metadata'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { UploadUrlDto } from './authoring.dto'

async function contentTypeErrors(contentType: string): Promise<boolean> {
  const dto = plainToInstance(UploadUrlDto, { kind: 'attachment', courseId: 'c1', fileName: 'a.pdf', contentType })
  const errors = await validate(dto)
  return errors.some((e) => e.property === 'contentType')
}

describe('UploadUrlDto.contentType', () => {
  it('aceita tipos legítimos', async () => {
    expect(await contentTypeErrors('application/pdf')).toBe(false)
    expect(await contentTypeErrors('image/png')).toBe(false)
    expect(await contentTypeErrors('video/mp4')).toBe(false)
  })

  it('rejeita text/html (anti-XSS no upload)', async () => {
    expect(await contentTypeErrors('text/html')).toBe(true)
  })

  it('rejeita image/svg+xml', async () => {
    expect(await contentTypeErrors('image/svg+xml')).toBe(true)
  })
})
