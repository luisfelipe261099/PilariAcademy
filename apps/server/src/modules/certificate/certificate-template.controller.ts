import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Put, Query, Res, UseGuards } from '@nestjs/common'
import type { Response } from 'express'
import * as QRCode from 'qrcode'
import { FirebaseAuthGuard } from '../../common/guards/firebase-auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { PlatformAdmin } from '../../common/decorators/platform-admin.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { DecodedFirebaseUser } from '../../common/types/user.type'
import { AuditService } from '../audit/audit.service'
import { portugueseList } from '../authoring/course-status-policy'
import { CertificateTemplateService } from './certificate-template.service'
import { CertificateService } from './certificate.service'
import { PdfService, type CertData } from './pdf.service'
import { AssignTemplateDto, CreateTemplateDto, SaveTemplateDto, UpdateTemplateDto } from './dto/save-template.dto'
import type { CertificateTemplateSummary } from '@pilari/types'

/** Dados fictícios para o preview do template no editor. */
async function sampleData(
  coord: { name: string; role: string | null; signatureDataUri?: string } | null
): Promise<CertData> {
  const verifyUrl = 'https://cursos.studiopilari.com.br/certificado/EXEMPLO0000000000'
  const svg = await QRCode.toString(verifyUrl, { type: 'svg', margin: 1, width: 240 })
  return {
    studentName: 'Maria Aparecida da Silva',
    courseTitle: 'Introdução à Inteligência Artificial',
    hours: 40,
    issuedAt: new Date(),
    code: 'EXEMPLO0000000000',
    qrDataUri: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`,
    verifyUrl,
    cpf: '123.456.789-00',
    coordinatorName: coord?.name,
    coordinatorRole: coord?.role ?? undefined,
    coordinatorSignatureDataUri: coord?.signatureDataUri,
  }
}

/**
 * Modelos de certificado: GLOBAIS e só da plataforma. O certificado é do Studio Pilari em todos os
 * polos, então o modelo vale para todos — e `vincular` troca o modelo de cursos de qualquer polo, sem filtro
 * de polo. O admin de um polo não toca em nada aqui (o polo só define o coordenador do curso, na autoria).
 *
 * Toda mudança fica no log: criar, editar, marcar padrão e apagar vão para o log da rede (sem polo); vincular grava
 * uma entrada no polo de cada curso, que assim vê quando o modelo do certificado do seu curso mudou.
 */
@Controller('admin/certificate-template')
@UseGuards(FirebaseAuthGuard, RolesGuard)
@PlatformAdmin()
export class CertificateTemplateController {
  constructor(
    private readonly templates: CertificateTemplateService,
    private readonly certificates: CertificateService,
    private readonly pdf: PdfService,
    private readonly audit: AuditService
  ) {}

  /** Ação sobre o modelo em si: vale para a rede inteira, então o log não tem polo. */
  private registrarNaRede(u: DecodedFirebaseUser, action: string, templateId: string, summary: string): void {
    this.audit.log({ tenantId: null, actorUid: u.uid, actorEmail: u.email ?? null, action, summary, targetType: 'certificate-template', targetId: templateId })
  }

  /** Lista de templates, com quantos cursos usam cada um. */
  @Get()
  async list(): Promise<{ templates: CertificateTemplateSummary[] }> {
    return { templates: await this.templates.list() }
  }

  /**
   * HTML para abrir um template novo no editor: o do padrão, ou o de fábrica se não houver
   * nenhum. Serve para o admin partir de algo pronto em vez de uma caixa vazia.
   */
  @Get('novo')
  async novo(): Promise<{ html: string }> {
    return { html: await this.templates.getEditableHtml() }
  }

  @Get(':id')
  async getOne(@Param('id') id: string) {
    return this.templates.getOne(id)
  }

  /** Cursos que usam este template. */
  @Get(':id/cursos')
  async coursesOf(@Param('id') id: string): Promise<{ courses: { id: string; title: string }[] }> {
    return { courses: await this.templates.coursesOf(id) }
  }

  @Post()
  async create(@CurrentUser() u: DecodedFirebaseUser, @Body() dto: CreateTemplateDto): Promise<{ id: string }> {
    const r = await this.templates.create(dto.name, dto.html, u.uid)
    this.registrarNaRede(u, 'certificate-template.create', r.id, `Criou o modelo de certificado "${dto.name}"`)
    return r
  }

  @Put(':id')
  async update(
    @CurrentUser() u: DecodedFirebaseUser,
    @Param('id') id: string,
    @Body() dto: UpdateTemplateDto
  ): Promise<{ ok: true }> {
    const r = await this.templates.update(id, { name: dto.name, html: dto.html }, u.uid)
    const partes = [dto.name !== undefined ? 'o nome' : '', dto.html !== undefined ? 'o HTML' : ''].filter(Boolean)
    this.registrarNaRede(u, 'certificate-template.update', id, `Editou o modelo de certificado "${r.name}"${partes.length ? `: ${portugueseList(partes)}` : ''}`)
    return { ok: true }
  }

  @Put(':id/padrao')
  async setDefault(@CurrentUser() u: DecodedFirebaseUser, @Param('id') id: string): Promise<{ ok: true }> {
    const r = await this.templates.setDefault(id)
    this.registrarNaRede(u, 'certificate-template.default', id, `Marcou o modelo de certificado "${r.name}" como padrão`)
    return { ok: true }
  }

  @Delete(':id')
  async remove(@CurrentUser() u: DecodedFirebaseUser, @Param('id') id: string): Promise<{ cursosLiberados: number }> {
    const r = await this.templates.remove(id)
    const cursos = r.cursosLiberados === 1 ? '1 curso voltou' : `${r.cursosLiberados} cursos voltaram`
    this.registrarNaRede(u, 'certificate-template.delete', id, `Apagou o modelo de certificado "${r.name}" (${cursos} ao padrão)`)
    return { cursosLiberados: r.cursosLiberados }
  }

  /**
   * Vincula (ou desvincula, com templateId nulo) cursos a um template. Cada curso ganha uma entrada no log do PRÓPRIO
   * polo, com o título do curso e o nome do modelo.
   */
  @Post('vincular')
  async assign(@CurrentUser() u: DecodedFirebaseUser, @Body() dto: AssignTemplateDto): Promise<{ atualizados: number }> {
    const r = await this.templates.assign(dto.templateId ?? null, dto.courseIds)
    for (const c of r.cursos) {
      this.audit.log({
        tenantId: c.tenantId, actorUid: u.uid, actorEmail: u.email ?? null, action: 'certificate-template.assign', targetType: 'course', targetId: c.id,
        summary: r.modelo ? `Curso "${c.title}": modelo de certificado "${r.modelo}"` : `Curso "${c.title}": voltou ao modelo de certificado padrão`,
      })
    }
    return { atualizados: r.atualizados }
  }

  /**
   * Renderiza um preview (PDF) do HTML enviado, com dados fictícios + arte real.
   *
   * `courseId` opcional: com ele o preview usa o coordenador REAL daquele curso, que é o
   * único jeito de conferir a 2ª assinatura antes de salvar — com dados fictícios o bloco
   * nem apareceria.
   */
  @Post('preview')
  async preview(
    @Body() dto: SaveTemplateDto,
    @Query('courseId') courseId: string | undefined,
    @Res() res: Response
  ): Promise<void> {
    let pdf: Buffer
    try {
      pdf = await this.pdf.generate(await sampleData(courseId ? await this.certificates.coordinatorOf(courseId) : null), dto.html)
    } catch (err) {
      throw new BadRequestException(`Falha ao renderizar o preview: ${(err as Error).message}`)
    }
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="preview.pdf"' })
    res.send(pdf)
  }
}
