import { ForbiddenException, NotFoundException, type ExecutionContext } from '@nestjs/common'
import { PanelSalesEnabledGuard, SalesEnabledGuard, StorefrontOpenGuard } from './storefront.guards'
import { salesEnabled, storefrontOpen } from './sales'

const ctx = (tenant?: { isMatriz: boolean; status: 'active' | 'suspended' }) =>
  ({ switchToHttp: () => ({ getRequest: () => ({ tenant }) }) }) as unknown as ExecutionContext

describe('regras de loja e venda', () => {
  it('etapa 1: só a matriz vende', () => {
    expect(salesEnabled({ isMatriz: true, status: 'active' })).toBe(true)
    expect(salesEnabled({ isMatriz: false, status: 'active' })).toBe(false)
  })
  it('polo suspenso fecha a loja', () => {
    expect(storefrontOpen({ status: 'active' })).toBe(true)
    expect(storefrontOpen({ status: 'suspended' })).toBe(false)
  })
})

describe('StorefrontOpenGuard', () => {
  it('libera polo ativo', () => {
    expect(new StorefrontOpenGuard().canActivate(ctx({ isMatriz: false, status: 'active' }))).toBe(true)
  })
  it('polo suspenso responde 403 TENANT_SUSPENDED', () => {
    try {
      new StorefrontOpenGuard().canActivate(ctx({ isMatriz: false, status: 'suspended' }))
      throw new Error('deveria ter falhado')
    } catch (e) {
      expect(e).toBeInstanceOf(ForbiddenException)
      expect((e as ForbiddenException).getResponse()).toMatchObject({ code: 'TENANT_SUSPENDED' })
    }
  })
  it('sem polo responde 404', () => {
    expect(() => new StorefrontOpenGuard().canActivate(ctx())).toThrow(NotFoundException)
  })
})

describe('SalesEnabledGuard', () => {
  it('libera a matriz', () => {
    expect(new SalesEnabledGuard().canActivate(ctx({ isMatriz: true, status: 'active' }))).toBe(true)
  })
  it('polo sem venda responde 403 TENANT_SALES_DISABLED, com a mensagem do aluno na loja', () => {
    try {
      new SalesEnabledGuard().canActivate(ctx({ isMatriz: false, status: 'active' }))
      throw new Error('deveria ter falhado')
    } catch (e) {
      expect((e as ForbiddenException).getResponse()).toEqual({
        statusCode: 403,
        code: 'TENANT_SALES_DISABLED',
        message: 'As matrículas pelo site deste polo ainda estão em configuração. Fale com o polo para se matricular.',
      })
    }
  })
})

describe('PanelSalesEnabledGuard (pedidos e cobranças no painel, B5)', () => {
  it('libera a matriz', () => {
    expect(new PanelSalesEnabledGuard().canActivate(ctx({ isMatriz: true, status: 'active' }))).toBe(true)
  })
  it('polo sem venda: o mesmo code, com a mensagem para quem administra', () => {
    expect(() => new PanelSalesEnabledGuard().canActivate(ctx({ isMatriz: false, status: 'active' }))).toThrow(ForbiddenException)
    try {
      new PanelSalesEnabledGuard().canActivate(ctx({ isMatriz: false, status: 'active' }))
    } catch (e) {
      expect((e as ForbiddenException).getResponse()).toEqual({
        statusCode: 403,
        code: 'TENANT_SALES_DISABLED',
        message: 'Este polo ainda não vende pela plataforma.',
      })
    }
  })
  it('sem polo responde 404', () => {
    expect(() => new PanelSalesEnabledGuard().canActivate(ctx())).toThrow(NotFoundException)
  })
})
