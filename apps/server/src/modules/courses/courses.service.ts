import { Inject, Injectable, NotFoundException } from '@nestjs/common'
import { and, eq, asc } from 'drizzle-orm'
import type { CourseDetail, CourseKind, CourseSummary, Module } from '@pilari/types'
import { categories, courses, lessons, modules, users } from '../../db/schema'
import type { Database } from '../../db/types'
import { GcsService, MAX_IMAGE_BYTES } from '../classroom/gcs.service'
import { coverUrl } from '../../common/lib/cover-url'
import { effectivePriceCents, listPriceCents, promoActive } from '../../common/lib/pricing'

type CourseRow = typeof courses.$inferSelect
type CategoryRow = typeof categories.$inferSelect
type JoinedRow = { course: CourseRow; category: CategoryRow | null; instructorName: string | null }

@Injectable()
export class CoursesService {
  constructor(
    @Inject('DB_CLIENT') private readonly db: Database,
    private readonly gcs: GcsService
  ) {}

  private toSummary(row: JoinedRow): CourseSummary {
    const c = row.course
    return {
      id: c.id,
      slug: c.slug,
      title: c.title,
      subtitle: c.subtitle,
      kind: c.kind,
      priceInCents: effectivePriceCents(c),
      listPriceInCents: listPriceCents(c),
      promoEndsAt: c.promoEndsAt && promoActive(c) ? c.promoEndsAt.toISOString() : null,
      coverImageUrl: coverUrl(c.id, c.coverImageUrl),
      coverFocus: c.coverFocus ?? null,
      category: row.category ? { id: row.category.id, name: row.category.name, slug: row.category.slug } : null,
      instructorName: row.instructorName,
      availableAt: c.availableAt ? c.availableAt.toISOString() : null,
    }
  }

  /** Proxy de capa: redireciona se for URL externa; serve os bytes (cacheável) se for objeto do GCS. */
  async coverImage(tenantId: string, courseId: string): Promise<{ kind: 'redirect'; url: string } | { kind: 'image'; buffer: Buffer; contentType: string } | null> {
    const rows = await this.db
      .select({ cover: courses.coverImageUrl })
      .from(courses)
      .where(and(eq(courses.tenantId, tenantId), eq(courses.id, courseId)))
      .limit(1)
    const cover = rows[0]?.cover
    if (!cover) return null
    if (/^https?:\/\//i.test(cover)) return { kind: 'redirect', url: cover }
    // Teto de imagem: um arquivo gigante gravado como capa não é carregado na memória (vira "sem capa").
    const obj = await this.gcs.readObject(cover, { maxBytes: MAX_IMAGE_BYTES })
    return obj ? { kind: 'image', buffer: obj.buffer, contentType: obj.contentType } : null
  }

  async listPublished(tenantId: string, filters: { category?: string; kind?: CourseKind } = {}): Promise<CourseSummary[]> {
    const conds = [eq(courses.tenantId, tenantId), eq(courses.status, 'published')]
    if (filters.kind) conds.push(eq(courses.kind, filters.kind))
    if (filters.category) conds.push(eq(categories.slug, filters.category))

    const rows = (await this.db
      .select({ course: courses, category: categories, instructorName: users.displayName })
      .from(courses)
      .leftJoin(categories, eq(courses.categoryId, categories.id))
      .leftJoin(users, eq(courses.instructorId, users.uid))
      .where(and(...conds))
      .orderBy(asc(courses.title))) as JoinedRow[]

    return rows.map((r) => this.toSummary(r))
  }

  async getPublishedBySlug(tenantId: string, slug: string): Promise<CourseDetail> {
    const rows = (await this.db
      .select({
        course: courses,
        category: categories,
        instructorName: users.displayName,
        instructorPhoto: users.photoUrl,
        instructorHeadline: users.headline,
        instructorBio: users.bio,
      })
      .from(courses)
      .leftJoin(categories, eq(courses.categoryId, categories.id))
      .leftJoin(users, eq(courses.instructorId, users.uid))
      .where(and(eq(courses.tenantId, tenantId), eq(courses.slug, slug), eq(courses.status, 'published')))
      .limit(1)) as Array<JoinedRow & { instructorPhoto: string | null; instructorHeadline: string | null; instructorBio: string | null }>

    if (rows.length === 0) throw new NotFoundException('Curso não encontrado.')
    const row = rows[0]
    const summary = this.toSummary(row)
    const c = row.course

    const courseModules = c.kind === 'online' ? await this.loadModules(c.id) : []

    const hasInstructor = !!(row.instructorName || row.instructorPhoto || row.instructorHeadline || row.instructorBio)
    const instructor = hasInstructor
      ? { name: row.instructorName, photoUrl: row.instructorPhoto, headline: row.instructorHeadline, bio: row.instructorBio }
      : null

    return {
      ...summary,
      description: c.description,
      status: c.status,
      externalUrl: c.externalUrl,
      modules: courseModules,
      instructor,
    }
  }

  private async loadModules(courseId: string): Promise<Module[]> {
    const mods = await this.db
      .select()
      .from(modules)
      .where(eq(modules.courseId, courseId))
      .orderBy(asc(modules.order))

    const result: Module[] = []
    for (const m of mods) {
      const ls = await this.db
        .select()
        .from(lessons)
        .where(eq(lessons.moduleId, m.id))
        .orderBy(asc(lessons.order))
      const builtLessons = []
      for (const l of ls) {
        // Endpoint público: só a aula de prévia grátis expõe um vídeo tocável.
        // Aulas pagas NUNCA vazam o video_url (caminho do GCS / link direto).
        const videoUrl = l.isFreePreview ? await this.gcs.playableUrl(l.videoUrl) : null
        builtLessons.push({
          id: l.id,
          title: l.title,
          description: l.description,
          videoUrl,
          durationSec: l.durationSec,
          order: l.order,
          isFreePreview: l.isFreePreview,
        })
      }
      result.push({ id: m.id, title: m.title, order: m.order, lessons: builtLessons })
    }
    return result
  }
}
