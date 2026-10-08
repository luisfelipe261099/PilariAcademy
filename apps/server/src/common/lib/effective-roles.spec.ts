/// <reference types="jest" />
import { Role } from '@pilari/types'
import { effectiveRoles, isEffectivePlatformAdmin } from './effective-roles'
import { actorOf } from '../types/actor.type'

describe('isEffectivePlatformAdmin (B10: poder de plataforma pela tela da matriz)', () => {
  it('o sinal do cadastro basta, com ou sem vínculo com a matriz', () => {
    expect(isEffectivePlatformAdmin(true, null)).toBe(true)
    expect(isEffectivePlatformAdmin(true, [Role.student])).toBe(true)
  })
  it('admin da matriz é da plataforma, sem o sinal', () => {
    expect(isEffectivePlatformAdmin(false, [Role.admin])).toBe(true)
    expect(isEffectivePlatformAdmin(null, [Role.teacher, Role.admin])).toBe(true)
  })
  it('professor ou aluno da matriz não é, nem quem não tem vínculo com ela', () => {
    expect(isEffectivePlatformAdmin(false, [Role.teacher, Role.student])).toBe(false)
    expect(isEffectivePlatformAdmin(false, [])).toBe(false)
    expect(isEffectivePlatformAdmin(false, null)).toBe(false)
    expect(isEffectivePlatformAdmin(undefined, undefined)).toBe(false)
  })
})

describe('effectiveRoles', () => {
  it('sem vínculo e sem plataforma, nenhum papel', () => {
    expect(effectiveRoles([], false)).toEqual([])
  })
  it('mantém os papéis do polo', () => {
    expect(effectiveRoles([Role.teacher, Role.student], false).sort()).toEqual([Role.student, Role.teacher])
  })
  it('admin da plataforma ganha admin em qualquer polo', () => {
    expect(effectiveRoles([], true)).toEqual([Role.admin])
    expect(effectiveRoles([Role.admin], true)).toEqual([Role.admin])
  })
  it('descarta valores desconhecidos', () => {
    expect(effectiveRoles(['root' as Role, Role.student], false)).toEqual([Role.student])
  })
})

describe('actorOf', () => {
  it('monta o ator a partir do usuário e do polo', () => {
    expect(actorOf({ uid: 'u1', roles: [Role.admin], isPlatformAdmin: false }, { id: 't-a', isMatriz: false })).toEqual({
      uid: 'u1', tenantId: 't-a', isMatriz: false, isAdmin: true, isPlatformAdmin: false,
    })
    expect(actorOf({ uid: 'u2' }, { id: 't-m', isMatriz: true })).toMatchObject({ isAdmin: false, isPlatformAdmin: false, isMatriz: true })
  })
})
