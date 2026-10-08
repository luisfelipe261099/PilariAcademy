import { describe, expect, it } from 'vitest'
import { courseCoverSrc } from './cover-src'

describe('courseCoverSrc', () => {
  it('retorna null sem capa', () => {
    expect(courseCoverSrc('abc', null)).toBeNull()
    expect(courseCoverSrc('abc', '')).toBeNull()
    expect(courseCoverSrc('abc', undefined)).toBeNull()
  })

  it('usa URL http(s) colada direto', () => {
    expect(courseCoverSrc('abc', 'https://cdn.x/img.png')).toBe('https://cdn.x/img.png')
    expect(courseCoverSrc('abc', 'http://cdn.x/img.png')).toBe('http://cdn.x/img.png')
    expect(courseCoverSrc('abc', 'HTTPS://cdn.x/img.png')).toBe('HTTPS://cdn.x/img.png')
  })

  it('converte caminho de objeto GCS (upload) para a rota de proxy', () => {
    expect(courseCoverSrc('14e120fd', 'cursos/14e120fd/cover/uuid-banner.png')).toBe(
      '/api/courses/14e120fd/cover',
    )
  })
})
