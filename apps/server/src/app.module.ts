import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { APP_GUARD } from '@nestjs/core'
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler'
import { ScheduleModule } from '@nestjs/schedule'
import { AppController } from './app.controller'
import { AppService } from './app.service'
import { DatabaseModule } from './db/database.module'
import { TenancyModule } from './modules/tenancy/tenancy.module'
import { FirebaseAuthGuard } from './common/guards/firebase-auth.guard'
import { RolesGuard } from './common/guards/roles.guard'
import { AuthModule } from './modules/auth/auth.module'
import { AdminModule } from './modules/admin/admin.module'
import { CoursesModule } from './modules/courses/courses.module'
import { EnrollmentsModule } from './modules/enrollments/enrollments.module'
import { ClassroomModule } from './modules/classroom/classroom.module'
import { AuthoringModule } from './modules/authoring/authoring.module'
import { FinanceModule } from './modules/finance/finance.module'
import { AuditModule } from './modules/audit/audit.module'
import { QuizModule } from './modules/quiz/quiz.module'
import { CertificateModule } from './modules/certificate/certificate.module'
import { MessagesModule } from './modules/messages/messages.module'
import { EngagementModule } from './modules/engagement/engagement.module'
import { TenantSiteModule } from './modules/tenant-site/tenant-site.module'
import { PlatformModule } from './modules/platform/platform.module'
import { TutorModule } from './modules/tutor/tutor.module'

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Habilita @Cron em toda a aplicação — usado pelo ReconcileCron (EnrollmentsModule) pra
    // rodar a reconciliação de carnês diariamente, sem depender de alguém clicar no painel.
    ScheduleModule.forRoot(),
    // Rate limiting global: 120 req / 60s por IP. Trava brute-force do token do webhook,
    // enumeração de cupons (/cart/summary) e de certificados, sem atrapalhar o uso normal.
    // skipIf: a suíte de integração faz dezenas de requisições por segundo do mesmo IP.
    // THROTTLE_DISABLED só é definida pelo harness de teste; produção nunca a define.
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 120 }],
      skipIf: () => process.env.THROTTLE_DISABLED === '1',
    }),
    DatabaseModule,
    TenancyModule,
    AuthModule,
    AdminModule,
    CoursesModule,
    EnrollmentsModule,
    ClassroomModule,
    AuthoringModule,
    FinanceModule,
    AuditModule,
    QuizModule,
    CertificateModule,
    MessagesModule,
    EngagementModule,
    TenantSiteModule,
    PlatformModule,
    TutorModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Guards globais (rodam nesta ordem). ThrottlerGuard limita a taxa; FirebaseAuthGuard exige
    // token em TODA rota por padrão (deny-by-default de AUTENTICAÇÃO) — endpoints públicos usam
    // @Public(). RolesGuard faz o deny-by-default de AUTORIZAÇÃO: uma rota é negada a menos que
    // declare @Public(), @Authenticated() (qualquer logado) ou @Roles(...). Assim um controller
    // novo que esqueça de declarar o acesso não nasce aberto a qualquer usuário autenticado.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useExisting: FirebaseAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
