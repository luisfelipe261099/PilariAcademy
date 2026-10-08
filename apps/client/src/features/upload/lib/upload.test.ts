import { describe, it, expect } from 'vitest'
import { pctOf } from './upload'

describe('pctOf', () => {
  it('calcula porcentagem', () => {
    expect(pctOf(50, 200)).toBe(25)
    expect(pctOf(200, 200)).toBe(100)
  })
  it('total 0 → 0', () => {
    expect(pctOf(10, 0)).toBe(0)
  })
})
