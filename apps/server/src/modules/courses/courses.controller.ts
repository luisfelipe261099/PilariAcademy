import { Controller, Get, Param, Query, Res, UseGuards } from '@nestjs/common'
import type { Response } from 'express'
import type { Category, CourseDetail, CourseKind, CourseSummary } from '@pilari/types'
import { Public } from '../../common/decorators/public.decorator'
import { resolveImageResponse } from '../../common/lib/content-safety'
import { CurrentTenant } from '../tenancy/current-tenant.decorator'
import type { TenantContext } from '../tenancy/tenant-context'
import { StorefrontOpenGuard } from '../tenancy/storefront.guards'
import { CoursesService } from './courses.service'
import { CategoriesService } from './categories.service'

@Controller()
export class CoursesController {
  constructor(
    private readonly coursesService: CoursesService,
    private readonly categoriesService: CategoriesService
  ) {}

  @Public()
  @UseGuards(StorefrontOpenGuard)
  @Get('courses')
  async list(
    @CurrentTenant() tenant: TenantContext,
    @Query('category') category?: string,
    @Query('kind') kind?: CourseKind
  ): Promise<{ courses: CourseSummary[] }> {
    return { courses: await this.coursesService.listPublished(tenant.id, { category, kind }) }
  }

  @Public()
  @UseGuards(StorefrontOpenGuard)
  @Get('courses/:slug')
  async detail(@CurrentTenant() tenant: TenantContext, @Param('slug') slug: string): Promise<{ course: CourseDetail }> {
    return { course: await this.coursesService.getPublishedBySlug(tenant.id, slug) }
  }

  /**
   * Proxy público da capa: URL externa → redireciona; objeto do GCS → serve os bytes com cache.
   * NÃO usa StorefrontOpenGuard: aparece no painel e na sala de aula do aluno matriculado mesmo
   * com o polo suspenso.
   */
  @Public()
  @Get('courses/:id/cover')
  async cover(@CurrentTenant() tenant: TenantContext, @Param('id') id: string, @Res() res: Response): Promise<void> {
    const r = await this.coursesService.coverImage(tenant.id, id)
    if (!r) {
      res.status(404).send('Sem capa')
      return
    }
    if (r.kind === 'redirect') {
      res.set('Cache-Control', 'public, max-age=3600')
      res.redirect(302, r.url)
      return
    }
    // Anti-XSS: endpoint público e na MESMA origem do app. O content-type vem do metadado do GCS,
    // que quem fez upload controla. Só servimos inline tipos de imagem inertes; qualquer outra coisa
    // (SVG, HTML) vira download (attachment) para não executar como página na origem confiável.
    const safe = resolveImageResponse(r.contentType)
    res.set('Content-Type', safe.contentType)
    if (!safe.inline) res.set('Content-Disposition', 'attachment')
    res.set('Cache-Control', 'public, max-age=86400')
    res.send(r.buffer)
  }

  /**
   * Categorias do polo do endereço. NÃO usa StorefrontOpenGuard: o painel do polo (filtros, editor de curso) lista as
   * categorias mesmo com o polo suspenso, e a lista não expõe nada do catálogo fechado.
   */
  @Public()
  @Get('categories')
  async categories(@CurrentTenant() tenant: TenantContext): Promise<{ categories: Category[] }> {
    return { categories: await this.categoriesService.list(tenant.id) }
  }
}
