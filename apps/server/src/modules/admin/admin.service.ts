import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { and, desc, eq, inArray, sum } from 'drizzle-orm'
import { Role } from '@pilari/types'
import type { AdminCourseRow, AdminEnrollment, AdminStats } from '@pilari/types'
import { courses, enrollments, orderInstallments, orders, tenantMembers, users } from '../../db/schema'
import type { Database } from '../../db/types'
import { CourseScopeService } from '../tenancy/course-scope.service'
import { TenantMembersService } from '../tenancy/tenant-members.service'

@Injectable()
export class AdminService {
  constructor(
    @Inject('DB_CLIENT') private readonly db: Database,
    private readonly members: TenantMembersService,
    private readonly scope: CourseScopeService
  ) {}

  /** Números do painel do polo: membros, cursos e pedidos do polo, nunca da rede inteira. */
  async stats(tenantId: string): Promise<AdminStats> {
    // Papéis valem por polo (tenant_members), não na linha global de `users`.
    const memberRows = (await this.db
      .select({ roles: tenantMembers.roles })
      .from(tenantMembers)
      .where(eq(tenantMembers.tenantId, tenantId))) as Array<{ roles: string[] | null }>
    const courseRows = (await this.db.select({ status: courses.status }).from(courses).where(eq(courses.tenantId, tenantId))) as Array<{ status: string }>
    const orderRows = (await this.db
      .select({ id: orders.id, status: orders.status, total: orders.totalInCents, asaasInstallmentId: orders.asaasInstallmentId })
      .from(orders)
      .where(eq(orders.tenantId, tenantId))) as Array<{ id: string; status: string; total: number; asaasInstallmentId: string | null }>

    const studentCount = memberRows.filter((m) => (m.roles ?? []).includes(Role.student)).length
    const teacherCount = memberRows.filter((m) => (m.roles ?? []).includes(Role.teacher)).length

    // paidOrderCount é métrica de VENDAS (acesso liberado), não de dinheiro: um carnê já libera
    // acesso na 1a parcela, então entra na contagem mesmo sem estar quitado.
    const paid = orderRows.filter((o) => o.status === 'paid')
    const aVista = paid.filter((o) => !o.asaasInstallmentId)
    const carnes = paid.filter((o) => o.asaasInstallmentId)

    // Receita REALIZADA: somar `total` de todo pedido `paid` contaria o carnê inteiro no dia da
    // 1a parcela (R$ 5.000 de "Receita" para R$ 1.000 recebido). O à-vista/cartão soma o total
    // do pedido (ele quita de uma vez); o carnê soma só o que as parcelas PAID já trouxeram.
    const carneOrderIds = carnes.map((o) => o.id)
    const installmentSumRows = carneOrderIds.length
      ? ((await this.db
          .select({ soma: sum(orderInstallments.valueInCents) })
          .from(orderInstallments)
          .where(and(inArray(orderInstallments.orderId, carneOrderIds), eq(orderInstallments.status, 'paid')))) as Array<{ soma: string | null }>)
      : []
    const recebidoEmCarnes = Number(installmentSumRows[0]?.soma) || 0
    const grossInCents = aVista.reduce((s, o) => s + o.total, 0) + recebidoEmCarnes

    return {
      studentCount,
      teacherCount,
      courseCount: courseRows.length,
      publishedCourseCount: courseRows.filter((c) => c.status === 'published').length,
      paidOrderCount: paid.length,
      grossInCents,
    }
  }

  /** Cursos do polo, com a primeira aprovação e a nota do Studio Pilari (devolução ou retirada do ar). */
  async listAllCourses(tenantId: string): Promise<AdminCourseRow[]> {
    const rows = (await this.db
      .select({ course: courses, instructorName: users.displayName })
      .from(courses)
      .leftJoin(users, eq(courses.instructorId, users.uid))
      .where(eq(courses.tenantId, tenantId))) as Array<{ course: typeof courses.$inferSelect; instructorName: string | null }>
    return rows.map((r) => ({
      id: r.course.id, title: r.course.title, slug: r.course.slug, status: r.course.status,
      kind: r.course.kind, priceInCents: r.course.priceInCents, commissionPercent: r.course.commissionPercent,
      instructorId: r.course.instructorId, instructorName: r.instructorName,
      certificateTemplateId: r.course.certificateTemplateId ?? null,
      approvedAt: r.course.approvedAt ? r.course.approvedAt.toISOString() : null,
      reviewNote: r.course.reviewNote ?? null,
    }))
  }

  /** Vincula um dono ao curso: vendas futuras passam a render para ele. O dono precisa ser professor ou admin DESTE polo. */
  async setCourseOwner(tenantId: string, courseId: string, instructorId: string): Promise<{ instructorId: string; instructorName: string | null }> {
    const papeis = await this.members.rolesOf(tenantId, instructorId)
    if (!papeis) throw new NotFoundException('Usuário não encontrado neste polo.')
    if (!papeis.includes(Role.teacher) && !papeis.includes(Role.admin)) {
      throw new BadRequestException('O dono precisa ser professor ou admin deste polo.')
    }
    // Curso de outro polo responde 404, como se não existisse.
    await this.scope.byId(tenantId, courseId)
    const ownerRows = await this.db.select({ name: users.displayName }).from(users).where(eq(users.uid, instructorId)).limit(1)
    await this.db.update(courses).set({ instructorId, updatedAt: new Date() }).where(and(eq(courses.id, courseId), eq(courses.tenantId, tenantId)))
    return { instructorId, instructorName: ownerRows[0]?.name ?? null }
  }

  // ── Matrícula manual (admin dá/retira acesso a curso para um aluno) ──────────

  /** Matrículas do aluno (qualquer status) nos cursos DO POLO, para a tela de gestão. Matrícula em curso de outro polo não aparece. */
  async listUserEnrollments(tenantId: string, uid: string): Promise<AdminEnrollment[]> {
    const rows = (await this.db
      .select({ courseId: enrollments.courseId, status: enrollments.status, source: enrollments.source, title: courses.title, slug: courses.slug })
      .from(enrollments)
      .innerJoin(courses, eq(enrollments.courseId, courses.id))
      .where(and(eq(enrollments.userId, uid), eq(courses.tenantId, tenantId)))
      .orderBy(desc(enrollments.createdAt))) as Array<{
      courseId: string
      status: AdminEnrollment['status']
      source: AdminEnrollment['source']
      title: string
      slug: string
    }>
    return rows.map((r) => ({ courseId: r.courseId, courseTitle: r.title, courseSlug: r.slug, status: r.status, source: r.source }))
  }

  /**
   * Concede acesso (matrícula manual, `source: 'free'`) a um curso DO POLO; curso de outro polo
   * responde 404. Idempotente: reativa se cancelada. Quem ainda não era do polo ganha o vínculo
   * de aluno; quem já era mantém os papéis que tem.
   */
  async grantEnrollment(tenantId: string, uid: string, courseId: string): Promise<AdminEnrollment> {
    const userRows = await this.db.select({ uid: users.uid }).from(users).where(eq(users.uid, uid)).limit(1)
    if (userRows.length === 0) throw new NotFoundException('Usuário não encontrado.')
    const course = await this.scope.byId(tenantId, courseId)

    const existing = await this.db
      .select({ id: enrollments.id, status: enrollments.status })
      .from(enrollments)
      .where(and(eq(enrollments.userId, uid), eq(enrollments.courseId, courseId)))
      .limit(1)

    if (existing[0]) {
      if (existing[0].status === 'active') throw new BadRequestException('O aluno já tem acesso a este curso.')
      // NÃO zera orderId aqui (ao contrário do checkout no fluxo grátis): admin-orders.service.ts
      // e earnings.service.ts (captureForOrder) derivam os CURSOS de um pedido a partir de
      // enrollments.orderId — zerar apagaria o curso da lista do pedido no admin e zeraria o
      // repasse do instrutor se aquele pedido pago depois. Um orderId órfão apontando pra um
      // pedido cancelado é tolerado de propósito pelo gate do certificado (source='free' basta).
      await this.db
        .update(enrollments)
        .set({ status: 'active', source: 'free', activatedAt: new Date(), updatedAt: new Date() })
        .where(eq(enrollments.id, existing[0].id))
    } else {
      await this.db.insert(enrollments).values({
        id: randomUUID(),
        userId: uid,
        courseId,
        status: 'active',
        source: 'free',
        activatedAt: new Date(),
      })
    }
    await this.members.ensureStudent(tenantId, uid)
    return { courseId, courseTitle: course.title, courseSlug: course.slug, status: 'active', source: 'free' }
  }

  /** Retira o acesso: remove a matrícula (libera o par único p/ reconceder depois). Curso de outro polo responde 404. */
  /** Rótulo da pessoa para o log: nome do cadastro, senão o e-mail, senão o uid. */
  async personLabel(uid: string): Promise<string> {
    const [u] = await this.db.select({ displayName: users.displayName, email: users.email }).from(users).where(eq(users.uid, uid)).limit(1)
    return u?.displayName?.trim() || u?.email || uid
  }

  /** Título do curso do polo para o log (404 se o curso não é do polo). */
  async courseTitle(tenantId: string, courseId: string): Promise<string> {
    return (await this.scope.byId(tenantId, courseId)).title
  }

  async revokeEnrollment(tenantId: string, uid: string, courseId: string): Promise<{ ok: true }> {
    await this.scope.byId(tenantId, courseId)
    await this.db.delete(enrollments).where(and(eq(enrollments.userId, uid), eq(enrollments.courseId, courseId)))
    return { ok: true }
  }
}
