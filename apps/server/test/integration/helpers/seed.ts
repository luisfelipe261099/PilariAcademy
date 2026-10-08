import { randomUUID } from 'node:crypto'
import type { CourseStatus } from '@pilari/types'
import {
  categories, coupons, courses, enrollments, lessons, modules, orders, tenantDomains, tenantMembers, tenants, users,
} from '../../../src/db/schema'
import { EMPTY_BRANDING } from '../../../src/modules/tenancy/branding'
import { MATRIZ_TENANT_ID } from '../../../src/modules/tenancy/tenancy.constants'
import type { TestDatabase } from './db'

export const BASE = 'cursos.studiopilari.com.br'
export const HOST_MATRIZ = BASE
export const hostOf = (slug: string): string => `${slug}.${BASE}`
export const bearer = (uid: string): string => `Bearer test:${uid}`

export interface SeededTenant { id: string; slug: string; host: string; name: string }
export interface SeededCourse { id: string; slug: string; moduleId: string; lessonId: string }

export async function seedTenant(
  t: TestDatabase,
  input: { slug: string; name: string; id?: string; status?: 'active' | 'suspended' }
): Promise<SeededTenant> {
  const id = input.id ?? randomUUID()
  await t.db.insert(tenants).values({
    id, slug: input.slug, name: input.name, status: input.status ?? 'active', isMatriz: false,
    branding: { ...EMPTY_BRANDING, primaryColor: '#0055aa', accentColor: '#ff6600', whatsapp: '5541900000000' },
  })
  await t.db.insert(tenantDomains).values({ host: hostOf(input.slug), tenantId: id, isPrimary: true })
  return { id, slug: input.slug, host: hostOf(input.slug), name: input.name }
}

export async function seedUser(t: TestDatabase, input: { uid: string; name?: string; cpf?: string | null; isPlatformAdmin?: boolean }): Promise<void> {
  await t.db.insert(users).values({
    uid: input.uid, email: `${input.uid}@teste.local`, displayName: input.name ?? `Usuário ${input.uid}`,
    roles: ['student'], cpf: input.cpf ?? null, isPlatformAdmin: input.isPlatformAdmin ?? false,
  })
}

export async function seedMember(t: TestDatabase, tenantId: string, uid: string, roles: string[]): Promise<void> {
  await t.db.insert(tenantMembers).values({ tenantId, userUid: uid, roles })
}

export async function seedCategory(t: TestDatabase, input: { tenantId: string; name: string; slug: string }): Promise<string> {
  const id = randomUUID()
  await t.db.insert(categories).values({ id, tenantId: input.tenantId, name: input.name, slug: input.slug })
  return id
}

/** Curso com um módulo e uma aula. Publicado e aprovado, salvo indicação. */
export async function seedCourse(
  t: TestDatabase,
  input: {
    tenantId: string; slug: string; title: string; instructorId: string; status?: CourseStatus
    priceInCents?: number; categoryId?: string | null; approved?: boolean; workloadHours?: number | null
  }
): Promise<SeededCourse> {
  const id = randomUUID()
  const moduleId = randomUUID()
  const lessonId = randomUUID()
  const status = input.status ?? 'published'
  const now = new Date()
  const aprovado = input.approved ?? status === 'published'
  await t.db.insert(courses).values({
    id, tenantId: input.tenantId, slug: input.slug, instructorId: input.instructorId, categoryId: input.categoryId ?? null,
    kind: 'online', title: input.title, priceInCents: input.priceInCents ?? 10000, status,
    publishedAt: status === 'published' ? now : null, approvedAt: aprovado ? now : null,
    workloadHours: input.workloadHours ?? null,
  })
  await t.db.insert(modules).values({ id: moduleId, courseId: id, title: 'Módulo 1', order: 0 })
  await t.db.insert(lessons).values({ id: lessonId, moduleId, title: 'Aula 1', durationSec: 600, order: 0, isFreePreview: false })
  return { id, slug: input.slug, moduleId, lessonId }
}

export async function seedEnrollment(
  t: TestDatabase,
  input: { userId: string; courseId: string; status?: 'pending' | 'active' | 'canceled'; source?: 'purchase' | 'free'; orderId?: string | null }
): Promise<string> {
  const id = randomUUID()
  const status = input.status ?? 'active'
  await t.db.insert(enrollments).values({
    id, userId: input.userId, courseId: input.courseId, status, source: input.source ?? 'free',
    orderId: input.orderId ?? null, activatedAt: status === 'active' ? new Date() : null,
  })
  return id
}

export async function seedOrder(
  t: TestDatabase,
  input: { tenantId: string; userId: string; status?: 'pending' | 'paid' | 'canceled'; totalInCents?: number }
): Promise<string> {
  const id = randomUUID()
  const total = input.totalInCents ?? 10000
  const status = input.status ?? 'paid'
  await t.db.insert(orders).values({ id, tenantId: input.tenantId, userId: input.userId, status, subtotalInCents: total, totalInCents: total, paidAt: status === 'paid' ? new Date() : null })
  return id
}

export async function seedCoupon(t: TestDatabase, input: { tenantId: string; code: string; type?: 'percent' | 'fixed'; value: number }): Promise<string> {
  const id = randomUUID()
  await t.db.insert(coupons).values({ id, tenantId: input.tenantId, code: input.code, type: input.type ?? 'percent', value: input.value })
  return id
}

export interface TwoPolos {
  matriz: { id: string; host: string }
  a: SeededTenant
  b: SeededTenant
  u: {
    platform: string; adminMatriz: string; adminA: string; teacherA: string; studentA: string
    adminB: string; teacherB: string; studentB: string; shared: string
  }
  courses: { matriz: SeededCourse; a: SeededCourse; aDraft: SeededCourse; b: SeededCourse }
}

/**
 * Mundo padrão: matriz + polos A e B, um usuário de cada papel em cada polo, um aluno
 * compartilhado entre A e B, e o MESMO slug `excel-basico` na matriz, no A e no B.
 */
export async function seedTwoPolos(t: TestDatabase): Promise<TwoPolos> {
  const a = await seedTenant(t, { slug: 'polo-a', name: 'Polo A' })
  const b = await seedTenant(t, { slug: 'polo-b', name: 'Polo B' })
  const u = {
    platform: 'u-plat', adminMatriz: 'u-adm-m', adminA: 'u-adm-a', teacherA: 'u-prof-a', studentA: 'u-aluno-a',
    adminB: 'u-adm-b', teacherB: 'u-prof-b', studentB: 'u-aluno-b', shared: 'u-compartilhado',
  }
  await seedUser(t, { uid: u.platform, isPlatformAdmin: true })
  for (const uid of [u.adminMatriz, u.adminA, u.teacherA, u.studentA, u.adminB, u.teacherB, u.studentB, u.shared]) {
    await seedUser(t, { uid })
  }
  await seedMember(t, MATRIZ_TENANT_ID, u.adminMatriz, ['admin'])
  await seedMember(t, a.id, u.adminA, ['admin'])
  await seedMember(t, a.id, u.teacherA, ['teacher'])
  await seedMember(t, a.id, u.studentA, ['student'])
  await seedMember(t, b.id, u.adminB, ['admin'])
  await seedMember(t, b.id, u.teacherB, ['teacher'])
  await seedMember(t, b.id, u.studentB, ['student'])
  await seedMember(t, a.id, u.shared, ['student'])
  await seedMember(t, b.id, u.shared, ['student'])
  const cursos = {
    matriz: await seedCourse(t, { tenantId: MATRIZ_TENANT_ID, slug: 'excel-basico', title: 'Excel da Matriz', instructorId: u.adminMatriz }),
    a: await seedCourse(t, { tenantId: a.id, slug: 'excel-basico', title: 'Excel do Polo A', instructorId: u.teacherA }),
    aDraft: await seedCourse(t, { tenantId: a.id, slug: 'rascunho-a', title: 'Rascunho do Polo A', instructorId: u.teacherA, status: 'draft' }),
    b: await seedCourse(t, { tenantId: b.id, slug: 'excel-basico', title: 'Excel do Polo B', instructorId: u.teacherB }),
  }
  await seedEnrollment(t, { userId: u.studentA, courseId: cursos.a.id })
  await seedEnrollment(t, { userId: u.studentB, courseId: cursos.b.id })
  await seedEnrollment(t, { userId: u.shared, courseId: cursos.a.id })
  await seedEnrollment(t, { userId: u.shared, courseId: cursos.b.id })
  return { matriz: { id: MATRIZ_TENANT_ID, host: HOST_MATRIZ }, a, b, u, courses: cursos }
}
