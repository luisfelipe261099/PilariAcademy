import { Body, Controller, Delete, Get, Param, Post, Query, Res, UseGuards } from '@nestjs/common'
import type { Response } from 'express'
import { Role } from '@pilari/types'
import type { StudentFinance, StudentHit } from '@pilari/types'
import { FirebaseAuthGuard } from '../../common/guards/firebase-auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { Roles } from '../../common/decorators/roles.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { DecodedFirebaseUser } from '../../common/types/user.type'
import { AdminBillingService } from './admin-billing.service'
import { AuditService } from '../audit/audit.service'
import { CurrentTenant } from '../tenancy/current-tenant.decorator'
import type { TenantContext } from '../tenancy/tenant-context'
import { PanelSalesEnabledGuard } from '../tenancy/storefront.guards'
import { CreateChargeDto } from './dto/create-charge.dto'

/** Cobranças do admin: só em polo que vende, e só com alunos e pedidos do polo (o resto responde 404). */
@Controller('admin/billing')
@UseGuards(FirebaseAuthGuard, RolesGuard, PanelSalesEnabledGuard)
@Roles(Role.admin)
export class AdminBillingController {
  constructor(
    private readonly billing: AdminBillingService,
    private readonly audit: AuditService
  ) {}

  @Get('students')
  async students(@CurrentTenant() tenant: TenantContext, @Query('q') q: string | undefined): Promise<{ students: StudentHit[] }> {
    return { students: await this.billing.searchStudents(tenant.id, q ?? '') }
  }

  @Get('students/:uid')
  async finance(@CurrentTenant() tenant: TenantContext, @Param('uid') uid: string): Promise<StudentFinance> {
    return this.billing.financeOf(tenant.id, uid)
  }

  /**
   * Cria a cobrança. Emite boleto REAL no Asaas e o aluno recebe por e-mail.
   * Auditado sempre: é dinheiro, e precisa ficar registrado quem cobrou o quê de quem.
   */
  @Post('charges')
  async create(
    @CurrentUser() u: DecodedFirebaseUser,
    @CurrentTenant() tenant: TenantContext,
    @Body() dto: CreateChargeDto
  ): Promise<{ orderId: string; paymentUrl: string }> {
    const r = await this.billing.createCharge(tenant.id, u.uid, {
      userId: dto.userId,
      courseIds: dto.courseIds ?? [],
      description: dto.description,
      amountInCents: dto.amountInCents,
      installmentCount: dto.installmentCount ?? 1,
      cpf: dto.cpf,
      enrollNow: dto.enrollNow,
      dueDate: dto.dueDate,
    })
    const parcelas = dto.installmentCount ?? 1
    const oQue = (dto.courseIds ?? []).length > 0 ? `${(dto.courseIds ?? []).length} curso(s)` : dto.description
    await this.audit.log({
      tenantId: tenant.id,
      actorUid: u.uid,
      actorEmail: u.email ?? null,
      action: 'billing.charge.create',
      targetType: 'order',
      targetId: r.orderId,
      // O resumo tem que bastar sozinho: quem lê a trilha meses depois precisa saber quanto
      // foi cobrado de quem sem ter que cruzar com o pedido, que pode ter sido cancelado.
      summary: `Cobrança criada para ${dto.userId}: ${oQue} em ${parcelas}x, vence ${dto.dueDate ?? 'em 3 dias'}${dto.enrollNow ? ' (acesso liberado na hora)' : ''}`,
    })
    return r
  }

  /** Cancela a cobrança no Asaas e aqui. Auditado: some dinheiro da vista de alguém. */
  @Delete('orders/:id')
  async cancel(
    @CurrentUser() u: DecodedFirebaseUser,
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string
  ): Promise<{ jaEstavaCancelado: boolean }> {
    const r = await this.billing.cancelCharge(tenant.id, id)
    await this.audit.log({
      tenantId: tenant.id,
      actorUid: u.uid,
      actorEmail: u.email ?? null,
      action: 'billing.charge.cancel',
      targetType: 'order',
      targetId: id,
      summary: `Cobrança ${id} cancelada no Asaas e no sistema${r.jaEstavaCancelado ? ' (já estava cancelada)' : ''}`,
    })
    return r
  }

  /** Carnê em PDF, para o admin baixar e mandar ao aluno. */
  @Get('orders/:id/carne')
  async carne(@CurrentTenant() tenant: TenantContext, @Param('id') id: string, @Res() res: Response): Promise<void> {
    const pdf = await this.billing.boletoFor(tenant.id, id)
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="carne-${id}.pdf"` })
    res.send(pdf)
  }
}
