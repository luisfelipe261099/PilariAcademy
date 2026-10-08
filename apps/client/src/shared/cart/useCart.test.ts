import { describe, it, expect } from 'vitest'
import { addId, removeId } from './useCart'

describe('cart helpers', () => {
  it('add evita duplicata', () => {
    expect(addId(['a'], 'a')).toEqual(['a'])
    expect(addId(['a'], 'b')).toEqual(['a', 'b'])
  })
  it('remove tira o id', () => {
    expect(removeId(['a', 'b'], 'a')).toEqual(['b'])
    expect(removeId(['a'], 'x')).toEqual(['a'])
  })
})
