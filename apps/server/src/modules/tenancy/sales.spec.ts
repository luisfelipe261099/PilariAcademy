import { salesEnabled, storefrontOpen } from './sales'

describe('salesEnabled', () => {
  it('só a matriz ativa vende', () => {
    expect(salesEnabled({ isMatriz: true, status: 'active' }, false)).toBe(true)
    expect(salesEnabled({ isMatriz: false, status: 'active' }, false)).toBe(false)
    expect(salesEnabled({ isMatriz: true, status: 'suspended' }, false)).toBe(false)
  })
  it('SALES_DISABLED desliga a venda também na matriz', () => {
    expect(salesEnabled({ isMatriz: true, status: 'active' }, true)).toBe(false)
  })
  it('padrão lê SALES_DISABLED do ambiente', () => {
    const antes = process.env.SALES_DISABLED
    process.env.SALES_DISABLED = '1'
    expect(salesEnabled({ isMatriz: true, status: 'active' })).toBe(false)
    process.env.SALES_DISABLED = '0'
    expect(salesEnabled({ isMatriz: true, status: 'active' })).toBe(true)
    if (antes === undefined) delete process.env.SALES_DISABLED
    else process.env.SALES_DISABLED = antes
  })
  it('loja fecha só com polo suspenso', () => {
    expect(storefrontOpen({ status: 'active' })).toBe(true)
    expect(storefrontOpen({ status: 'suspended' })).toBe(false)
  })
})
