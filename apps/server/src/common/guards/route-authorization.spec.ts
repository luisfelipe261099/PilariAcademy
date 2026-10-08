/// <reference types="jest" />
// Rede de segurança do deny-by-default: os testes unitários chamam os controllers direto e
// contornam os guards, então NÃO pegariam uma rota que esqueceu de declarar acesso. Este teste
// reflete sobre TODOS os controllers e garante, estaticamente, que cada rota declara @Public(),
// @Authenticated() ou @Roles() — na classe ou no método. Uma rota nova sem declaração quebra aqui.
import { ForbiddenException, type ExecutionContext, type Type } from '@nestjs/common'
import { PATH_METADATA } from '@nestjs/common/constants'
import { Reflector } from '@nestjs/core'
import { Role } from '@pilari/types'
import { PUBLIC_KEY } from '../decorators/public.decorator'
import { AUTHENTICATED_KEY } from '../decorators/authenticated.decorator'
import { ROLES_KEY } from '../decorators/roles.decorator'
import { PLATFORM_ADMIN_KEY } from '../decorators/platform-admin.decorator'
import { RolesGuard } from './roles.guard'

import { AppController } from '../../app.controller'
import { AdminDashboardController } from '../../modules/admin/admin-dashboard.controller'
import { AdminUsersController } from '../../modules/admin/admin-users.controller'
import { AuthController } from '../../modules/auth/auth.controller'
import { InstructorController } from '../../modules/authoring/instructor.controller'
import { CertificateController } from '../../modules/certificate/certificate.controller'
import { CertificateTemplateController } from '../../modules/certificate/certificate-template.controller'
import { ClassroomController } from '../../modules/classroom/classroom.controller'
import { FileProxyController } from '../../modules/classroom/file-proxy.controller'
import { AdminCategoriesController } from '../../modules/courses/admin-categories.controller'
import { CoursesController } from '../../modules/courses/courses.controller'
import { StudentAnnouncementsController, InstructorAnnouncementsController } from '../../modules/engagement/announcements.controller'
import { NotesController } from '../../modules/engagement/notes.controller'
import { ReviewsController } from '../../modules/engagement/reviews.controller'
import { AdminBillingController } from '../../modules/enrollments/admin-billing.controller'
import { AdminCouponsController } from '../../modules/enrollments/admin-coupons.controller'
import { AdminOrdersController } from '../../modules/enrollments/admin-orders.controller'
import { AdminReconcileController } from '../../modules/enrollments/admin-reconcile.controller'
import { CheckoutController } from '../../modules/enrollments/checkout.controller'
import { WebhookController } from '../../modules/enrollments/webhook.controller'
import { AdminFinanceController } from '../../modules/finance/admin-finance.controller'
import { InstructorEarningsController } from '../../modules/finance/instructor-earnings.controller'
import { InstructorMessagesController } from '../../modules/messages/instructor-messages.controller'
import { StudentMessagesController } from '../../modules/messages/student-messages.controller'
import { PlatformReviewController } from '../../modules/platform/platform-review.controller'
import { PlatformTenantsController } from '../../modules/platform/platform-tenants.controller'
import { InstructorQuizController } from '../../modules/quiz/instructor-quiz.controller'
import { StudentQuizController } from '../../modules/quiz/student-quiz.controller'
import { AdminTenantController } from '../../modules/tenant-site/admin-tenant.controller'
import { TenantPublicController } from '../../modules/tenant-site/tenant-public.controller'

const CONTROLLERS: Type[] = [
  AppController, AdminDashboardController, AdminUsersController, AuthController, InstructorController,
  CertificateController, CertificateTemplateController, ClassroomController, FileProxyController,
  AdminCategoriesController, CoursesController, StudentAnnouncementsController, InstructorAnnouncementsController,
  NotesController, ReviewsController, AdminCouponsController, AdminOrdersController, AdminBillingController, AdminReconcileController,
  CheckoutController, WebhookController, AdminFinanceController, InstructorEarningsController,
  InstructorMessagesController, StudentMessagesController, InstructorQuizController, StudentQuizController,
  TenantPublicController, AdminTenantController, PlatformTenantsController, PlatformReviewController,
]

function hasAccessDecl(target: object): boolean {
  return (
    Reflect.hasMetadata(PUBLIC_KEY, target) ||
    Reflect.hasMetadata(AUTHENTICATED_KEY, target) ||
    Reflect.hasMetadata(ROLES_KEY, target) ||
    Reflect.hasMetadata(PLATFORM_ADMIN_KEY, target)
  )
}

function routeMethods(ctor: Type): string[] {
  const proto = ctor.prototype as Record<string, unknown>
  return Object.getOwnPropertyNames(proto).filter(
    (name) => name !== 'constructor' && Reflect.hasMetadata(PATH_METADATA, proto[name] as object)
  )
}

describe('Autorização de rotas (deny-by-default)', () => {
  for (const ctor of CONTROLLERS) {
    it(`${ctor.name}: toda rota declara @Public/@Authenticated/@Roles`, () => {
      const uncovered = routeMethods(ctor).filter(
        (m) => !hasAccessDecl(ctor) && !hasAccessDecl((ctor.prototype as Record<string, object>)[m])
      )
      expect(uncovered).toEqual([])
    })
  }
})

describe('Conciliação manual do Asaas: só a plataforma', () => {
  // A conta Asaas ainda é única (até a etapa 2): a conciliação mexe em pedidos de TODOS os polos, então o admin
  // de um polo não pode abri-la. Este teste usa o RolesGuard REAL sobre as decorators REAIS da rota.
  const handler = AdminReconcileController.prototype.reconcile as unknown as (...args: never[]) => unknown
  const guard = new RolesGuard(new Reflector())
  const contexto = (user: object): ExecutionContext =>
    ({
      getHandler: () => handler,
      getClass: () => AdminReconcileController,
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as unknown as ExecutionContext

  it('a varredura enxerga a rota (não pode passar vazia)', () => {
    expect(Reflect.hasMetadata(PATH_METADATA, handler)).toBe(true)
  })

  it('o admin do polo é negado e a plataforma passa', () => {
    expect(() => guard.canActivate(contexto({ uid: 'adm-polo', roles: [Role.admin], isPlatformAdmin: false }))).toThrow(ForbiddenException)
    expect(guard.canActivate(contexto({ uid: 'plat', roles: [Role.admin], isPlatformAdmin: true }))).toBe(true)
  })

  it('nem professor nem aluno passam', () => {
    for (const roles of [[Role.teacher], [Role.student]]) {
      expect(() => guard.canActivate(contexto({ uid: 'u', roles, isPlatformAdmin: false }))).toThrow(ForbiddenException)
    }
  })
})

describe.each([
  {
    nome: 'PlatformTenantsController',
    ctor: PlatformTenantsController as Type,
    esperadas: ['list', 'detail', 'create', 'update', 'addAdmin', 'addDomain', 'removeDomain', 'uploadUrl'],
  },
  {
    nome: 'PlatformReviewController',
    ctor: PlatformReviewController as Type,
    esperadas: ['queue', 'approve', 'returnToDraft', 'takedown', 'logs'],
  },
])('Console da plataforma: toda rota do $nome é só da plataforma', ({ ctor, esperadas }) => {
  // A varredura acima só exige ALGUMA declaração de acesso, e @Roles(admin) bastaria para passar. O console mexe em todos
  // os polos, então aqui o RolesGuard REAL sobre as decorators REAIS prova, rota a rota, que o admin de polo é barrado.
  const guard = new RolesGuard(new Reflector())
  const rotas = routeMethods(ctor)
  const contexto = (nome: string, user: object): ExecutionContext =>
    ({
      getHandler: () => (ctor.prototype as unknown as Record<string, object>)[nome],
      getClass: () => ctor,
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as unknown as ExecutionContext

  it('a varredura enxerga as rotas do console (não pode passar vazia nem perder uma)', () => {
    expect(rotas).toEqual(expect.arrayContaining(esperadas))
  })

  it.each(rotas)('%s: admin de polo, professor e aluno são negados; a plataforma passa', (nome) => {
    for (const roles of [[Role.admin], [Role.teacher], [Role.student]]) {
      expect(() => guard.canActivate(contexto(nome, { uid: 'u-polo', roles, isPlatformAdmin: false }))).toThrow(ForbiddenException)
    }
    expect(guard.canActivate(contexto(nome, { uid: 'u-plat', roles: [Role.admin], isPlatformAdmin: true }))).toBe(true)
  })
})
