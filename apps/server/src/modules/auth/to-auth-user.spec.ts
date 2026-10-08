/// <reference types="jest" />
import { Role } from '@pilari/types'
import { toAuthUser, toAdminUserDetail } from './to-auth-user'

describe('toAuthUser', () => {
  it('mapeia uma linha do banco para AuthUser usando os papéis informados', () => {
    const row = {
      uid: 'u1',
      email: 'a@x.com',
      displayName: 'A',
      photoUrl: null,
      roles: ['admin'],
      isPlatformAdmin: false,
      disabled: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never

    expect(toAuthUser(row, [Role.student], false)).toEqual({
      uid: 'u1',
      email: 'a@x.com',
      displayName: 'A',
      photoUrl: null,
      roles: [Role.student],
      isPlatformAdmin: false,
    })
  })

  it('normaliza roles ausente (dos papéis informados) para []', () => {
    const row = { uid: 'u2', email: 'b@x.com', displayName: null, photoUrl: null, roles: null, isPlatformAdmin: false } as never
    expect(toAuthUser(row, [], false).roles).toEqual([])
  })

  it('isPlatformAdmin é o EFETIVO (sinal ou admin da matriz), decidido por quem chama, não a coluna', () => {
    // Admin da matriz: a coluna diz não, mas ele é da plataforma (B10).
    const daMatriz = { uid: 'u3', email: 'c@x.com', displayName: null, photoUrl: null, roles: null, isPlatformAdmin: false } as never
    expect(toAuthUser(daMatriz, [Role.admin], true).isPlatformAdmin).toBe(true)
    const comSinal = { uid: 'u4', email: 'd@x.com', displayName: null, photoUrl: null, roles: null, isPlatformAdmin: true } as never
    expect(toAuthUser(comSinal, [Role.admin], true).isPlatformAdmin).toBe(true)
  })
})

describe('toAdminUserDetail', () => {
  it('inclui isPlatformAdmin junto com os campos de admin', () => {
    const row = {
      uid: 'u4',
      email: 'd@x.com',
      displayName: 'D',
      photoUrl: null,
      roles: ['student'],
      isPlatformAdmin: false,
      cpf: '123.456.789-09',
      disabled: false,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    } as never

    expect(toAdminUserDetail(row, [Role.student], false)).toEqual({
      uid: 'u4',
      email: 'd@x.com',
      displayName: 'D',
      photoUrl: null,
      roles: [Role.student],
      isPlatformAdmin: false,
      cpf: '12345678909',
      disabled: false,
      createdAt: '2026-01-01T00:00:00.000Z',
    })
  })

  it('com maskCpf, o CPF sai com a máscara do documento público; sem CPF continua null', () => {
    const row = { uid: 'u5', email: 'e@x.com', displayName: 'E', photoUrl: null, isPlatformAdmin: false, cpf: '529.982.247-25', disabled: false, createdAt: null } as never
    expect(toAdminUserDetail(row, [Role.student], false, { maskCpf: true }).cpf).toBe('***.***.***-**')
    const semCpf = { uid: 'u6', email: 'f@x.com', displayName: 'F', photoUrl: null, isPlatformAdmin: false, cpf: null, disabled: false, createdAt: null } as never
    expect(toAdminUserDetail(semCpf, [Role.student], false, { maskCpf: true }).cpf).toBeNull()
  })
})
