import { describe, expect, it } from 'vitest'
import { metaFormKey, omitLockedFields } from './locked-fields'

const patch = { title: 'Excel', workloadHours: 40, coordinatorName: 'Ana', coordinatorRole: 'Coord.', coordinatorSignaturePath: 'x.png', priceInCents: 4990, description: 'd' }

describe('omitLockedFields', () => {
  it('curso travado não manda os campos do certificado', () => {
    expect(omitLockedFields(patch, true)).toEqual({ priceInCents: 4990, description: 'd' })
  })
  it('curso livre manda tudo', () => {
    expect(omitLockedFields(patch, false)).toEqual(patch)
  })
  it('não altera o objeto de entrada', () => {
    const entrada = { title: 'Excel', workloadHours: 40, priceInCents: 4990 }
    omitLockedFields(entrada, true)
    expect(entrada).toEqual({ title: 'Excel', workloadHours: 40, priceInCents: 4990 })
  })
})

describe('metaFormKey', () => {
  const curso = { id: 'curso-1', approvedAt: null }
  const aprovado = '2026-09-01T00:00:00.000Z'

  it('muda quando o curso é aprovado: o formulário relê a carga congelada pela aprovação e a trava', () => {
    expect(metaFormKey({ ...curso, approvedAt: aprovado })).not.toBe(metaFormKey(curso))
  })
  it('não muda enquanto a aprovação é a mesma: o que a pessoa digitou fica entre um refetch e outro', () => {
    expect(metaFormKey({ ...curso, approvedAt: aprovado })).toBe(metaFormKey({ ...curso, approvedAt: aprovado }))
    expect(metaFormKey(curso)).toBe(metaFormKey({ ...curso }))
  })
  it('muda de um curso para outro', () => {
    expect(metaFormKey({ id: 'curso-2', approvedAt: null })).not.toBe(metaFormKey(curso))
  })
  it('id e aprovação não se confundem entre si', () => {
    expect(metaFormKey({ id: 'a', approvedAt: '1' })).not.toBe(metaFormKey({ id: 'a1', approvedAt: null }))
  })
})
