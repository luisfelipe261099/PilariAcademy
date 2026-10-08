import { Body, Controller, Get, Param, Post, Query, Res, UseGuards } from '@nestjs/common'
import type { Response } from 'express'
import type { CertificateVerification, MyCertificate, OrderSettlement } from '@pilari/types'
import { FirebaseAuthGuard } from '../../common/guards/firebase-auth.guard'
import { Public } from '../../common/decorators/public.decorator'
import { Authenticated } from '../../common/decorators/authenticated.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RolesGuard } from '../../common/guards/roles.guard'
import { PlatformAdmin } from '../../common/decorators/platform-admin.decorator'
import { AuditService } from '../audit/audit.service'
import type { DecodedFirebaseUser } from '../../common/types/user.type'
import { CurrentTenant } from '../tenancy/current-tenant.decorator'
import type { TenantContext } from '../tenancy/tenant-context'
import { CertificateService } from './certificate.service'
import { IssueCertificateAsAdminDto } from './dto/issue-certificate.dto'

@Controller()
export class CertificateController {
  constructor(
    private readonly cert: CertificateService,
    private readonly audit: AuditService
  ) {}

  /** Lista os certificados do próprio aluno, só de cursos do polo do endereço (o filtro mora no serviço). */
  @UseGuards(FirebaseAuthGuard)
  @Authenticated()
  @Get('me/certificates')
  async mine(@CurrentUser() u: DecodedFirebaseUser, @CurrentTenant() tenant: TenantContext): Promise<MyCertificate[]> {
    return this.cert.listMine(tenant.id, u.uid)
  }

  @UseGuards(FirebaseAuthGuard)
  @Authenticated()
  @Get('me/courses/:slug/certificate')
  async download(
    @CurrentUser() u: DecodedFirebaseUser,
    @CurrentTenant() tenant: TenantContext,
    @Param('slug') slug: string,
    @Query('cpf') cpf: string | undefined,
    @Query('nome') nome: string | undefined,
    @Res() res: Response
  ): Promise<void> {
    const pdf = await this.cert.issueOrGet(tenant, u.uid, slug, cpf, nome)
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="certificado.pdf"' })
    res.send(pdf)
  }

  // Endpoint SEPARADO do download: o cliente baixa o PDF com `responseType: 'blob'`, então
  // um 403 com corpo JSON chegaria ao axios como Blob — a tela não leria "faltam X de N
  // parcelas" dali. Este endpoint devolve JSON puro para a tela de certificado bloqueado.
  @UseGuards(FirebaseAuthGuard)
  @Authenticated()
  @Get('me/courses/:slug/certificate/status')
  async certificateStatus(
    @CurrentUser() user: DecodedFirebaseUser,
    @CurrentTenant() tenant: TenantContext,
    @Param('slug') slug: string
  ): Promise<OrderSettlement> {
    return this.cert.settlementFor(tenant, user.uid, slug)
  }

  // Proxy: o paymentBook do Asaas exige a chave de API e não pode ir para o navegador.
  // `carneFor` confere a posse do pedido E o polo do endereço antes de chamar o Asaas (evita IDOR).
  @UseGuards(FirebaseAuthGuard)
  @Authenticated()
  @Get('me/orders/:id/carne')
  async carne(
    @CurrentUser() user: DecodedFirebaseUser,
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string,
    @Res() res: Response
  ): Promise<void> {
    const pdf = await this.cert.carneFor(tenant.id, user.uid, id)
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="carne.pdf"' })
    res.send(pdf)
  }

  @Public()
  @Get('certificates/:code/verify')
  async verify(@Param('code') code: string): Promise<CertificateVerification> {
    return this.cert.verify(code)
  }

  @Public()
  @Get('certificates/:code/document')
  async document(@Param('code') code: string, @Query('download') download: string | undefined, @Res() res: Response): Promise<void> {
    const { buffer, fileName } = await this.cert.getDocumentByCode(code)
    const disposition = download ? `attachment; filename="${fileName}"` : `inline; filename="${fileName}"`
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': disposition })
    res.send(buffer)
  }

  /**
   * Emissão SEM REQUISITOS, na tela de alunos: pula as travas de progresso e de carnê e devolve
   * o PDF direto, para baixar no mesmo clique. É só da PLATAFORMA: o certificado é do
   * Studio Pilari, que decide certificar alguém que o sistema barraria — o admin de um polo não decide
   * isso. O curso é o do polo do endereço. Auditado sempre, com dono e data.
   */
  @Post('admin/students/:uid/courses/:courseId/certificate')
  @UseGuards(FirebaseAuthGuard, RolesGuard)
  @PlatformAdmin()
  async emitirComoAdmin(
    @CurrentUser() admin: DecodedFirebaseUser,
    @CurrentTenant() tenant: TenantContext,
    @Param('uid') uid: string,
    @Param('courseId') courseId: string,
    @Body() dto: IssueCertificateAsAdminDto,
    @Res() res: Response
  ): Promise<void> {
    const slug = await this.cert.slugOf(tenant.id, courseId)
    const pdf = await this.cert.issueOrGet(tenant, uid, slug, dto.cpf, dto.nome, true)
    await this.audit.log({
      tenantId: tenant.id,
      actorUid: admin.uid,
      actorEmail: admin.email ?? null,
      action: 'certificate.issue_admin',
      targetType: 'user',
      targetId: uid,
      summary: `Certificado emitido pelo admin para ${uid} no curso ${courseId} (travas de progresso ignoradas)`,
    })
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="certificado.pdf"` })
    res.send(pdf)
  }
}
