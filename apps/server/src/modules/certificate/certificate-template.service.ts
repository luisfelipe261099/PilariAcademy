import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import { desc, eq, inArray, ne, sql } from 'drizzle-orm'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { certificateTemplates } from '../../db/schemas/certificate-templates.schema'
import { courses } from '../../db/schemas/courses.schema'
import { findTemplateNetworkViolation } from '../../common/lib/content-safety'
import type { CertificateTemplateSummary } from '@pilari/types'
import type { Database } from '../../db/types'

const FACTORY_HTML_PATH = join(__dirname, 'assets', 'certificate.html')

/**
 * Fonte do HTML do certificado.
 *
 * Resolução, nesta ordem: template do CURSO → template marcado como padrão → HTML de
 * fábrica embutido no repo. O último degrau é o que faz o certificado funcionar numa base
 * limpa, sem nenhum registro.
 */
@Injectable()
export class CertificateTemplateService {
  private factoryHtml?: string

  constructor(@Inject('DB_CLIENT') private readonly db: Database) {}

  /** HTML de fábrica embutido no repo (fallback e conteúdo inicial do editor). */
  private loadFactoryHtml(): string {
    if (this.factoryHtml === undefined) this.factoryHtml = readFileSync(FACTORY_HTML_PATH, 'utf8')
    return this.factoryHtml
  }

  /** Template marcado como padrão, ou null se nenhum foi marcado. */
  private async defaultHtml(): Promise<string | null> {
    const rows = await this.db
      .select({ html: certificateTemplates.html })
      .from(certificateTemplates)
      .where(eq(certificateTemplates.isDefault, true))
      .limit(1)
    return rows[0]?.html ?? null
  }

  /**
   * HTML que vale para um curso: o template dele, senão o padrão, senão null.
   *
   * O `courseId` é opcional porque o preview do editor não tem curso. Um curso que aponta
   * para um template APAGADO cai no padrão — a coluna não tem FK, então o id órfão é
   * possível e não pode virar erro na hora de emitir.
   */
  async getActiveHtml(courseId?: string): Promise<string | null> {
    if (courseId) {
      const rows = await this.db
        .select({ html: certificateTemplates.html })
        .from(courses)
        .innerJoin(certificateTemplates, eq(certificateTemplates.id, courses.certificateTemplateId))
        .where(eq(courses.id, courseId))
        .limit(1)
      if (rows[0]) return rows[0].html
    }
    return this.defaultHtml()
  }

  /** HTML para popular o editor: o salvo ou, na ausência dele, o de fábrica. */
  async getEditableHtml(courseId?: string): Promise<string> {
    return (await this.getActiveHtml(courseId)) ?? this.loadFactoryHtml()
  }

  /**
   * HTML que será REALMENTE renderizado + uma impressão digital dele.
   *
   * O hash existe para o cache de PDF no GCS: sem ele, o caminho do arquivo depende só do
   * certificado, então trocar o layout deixa todo PDF já gerado obsoleto PARA SEMPRE — o
   * `ensurePdf` devolve o objeto salvo e a correção nunca aparece. Aconteceu: o layout foi
   * corrigido no arquivo e publicado, mas o aluno continuou baixando o PDF antigo, porque
   * `invalidatePdfCache` só é chamado quando o admin salva pelo editor.
   *
   * Com o hash no caminho, qualquer mudança de template (do editor OU do arquivo, via
   * deploy) muda o caminho esperado e vira um cache miss natural. Nada a invalidar à mão.
   */
  async getActiveHtmlWithFingerprint(courseId?: string): Promise<{ html: string; fingerprint: string }> {
    const html = await this.getEditableHtml(courseId)
    // 12 hex bastam: o espaço de templates é ínfimo e o hash não é segredo, só um
    // discriminador de versão dentro de um caminho que já é único por certificado.
    const fingerprint = createHash('sha256').update(html).digest('hex').slice(0, 12)
    return { html, fingerprint }
  }

  /** Recusa template que puxaria recurso externo (ID-10). */
  private assertSeguro(html: string): void {
    // Sandbox de rede: recusa no save para o admin ver o motivo no editor.
    // O PdfService revalida na geração — esta checagem é a camada de UX, não a única.
    const violation = findTemplateNetworkViolation(html)
    if (violation) {
      throw new BadRequestException(`Template reprovado: ${violation}. Imagens/fontes devem ser data: URIs embutidas.`)
    }
  }

  /** Lista para a tela do admin, com quantos cursos usam cada template. */
  async list(): Promise<CertificateTemplateSummary[]> {
    const rows = await this.db
      .select({
        id: certificateTemplates.id,
        name: certificateTemplates.name,
        isDefault: certificateTemplates.isDefault,
        updatedAt: certificateTemplates.updatedAt,
        courseCount: sql<number>`(SELECT COUNT(*) FROM ${courses} WHERE ${courses.certificateTemplateId} = ${certificateTemplates.id})`,
      })
      .from(certificateTemplates)
      .orderBy(desc(certificateTemplates.isDefault), certificateTemplates.name)
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      isDefault: Boolean(r.isDefault),
      updatedAt: r.updatedAt ? r.updatedAt.toISOString() : null,
      courseCount: Number(r.courseCount),
    }))
  }

  async getOne(id: string): Promise<{ id: string; name: string; html: string; isDefault: boolean }> {
    const rows = await this.db.select().from(certificateTemplates).where(eq(certificateTemplates.id, id)).limit(1)
    const t = rows[0]
    if (!t) throw new NotFoundException('Template não encontrado.')
    return { id: t.id, name: t.name, html: t.html, isDefault: Boolean(t.isDefault) }
  }

  /**
   * Cria um template. O PRIMEIRO vira padrão automaticamente: uma base sem nenhum padrão
   * emitiria tudo com o HTML de fábrica, e o admin não teria como perceber.
   */
  async create(name: string, html: string, uid: string): Promise<{ id: string }> {
    this.assertSeguro(html)
    const [{ n }] = await this.db.select({ n: sql<number>`COUNT(*)` }).from(certificateTemplates)
    const id = randomUUID()
    await this.db.insert(certificateTemplates).values({
      id,
      name,
      html,
      isDefault: Number(n) === 0,
      updatedBy: uid,
      updatedAt: new Date(),
    })
    return { id }
  }

  /** Salva o nome e/ou o HTML. Devolve o nome com que o modelo ficou (para o log). */
  async update(id: string, patch: { name?: string; html?: string }, uid: string): Promise<{ name: string }> {
    if (patch.html !== undefined) this.assertSeguro(patch.html)
    const atual = await this.getOne(id) // 404 antes de escrever
    await this.db
      .update(certificateTemplates)
      .set({ ...patch, updatedBy: uid, updatedAt: new Date() })
      .where(eq(certificateTemplates.id, id))
    return { name: patch.name ?? atual.name }
  }

  /** Marca como padrão e desmarca os outros — exatamente um padrão, sempre. Devolve o nome do modelo (para o log). */
  async setDefault(id: string): Promise<{ name: string }> {
    const t = await this.getOne(id)
    await this.db
      .update(certificateTemplates)
      .set({ isDefault: false })
      .where(ne(certificateTemplates.id, id))
    await this.db.update(certificateTemplates).set({ isDefault: true }).where(eq(certificateTemplates.id, id))
    return { name: t.name }
  }

  /**
   * Apaga um template. O padrão não pode ser apagado: sem padrão, todo curso sem template
   * próprio cairia no HTML de fábrica de uma vez. Os cursos que usavam voltam para o
   * padrão (`certificate_template_id = null`) — não os deixo apontando para um id morto.
   */
  async remove(id: string): Promise<{ cursosLiberados: number; name: string }> {
    const t = await this.getOne(id)
    if (t.isDefault) {
      throw new BadRequestException('Não dá para apagar o template padrão. Marque outro como padrão antes.')
    }
    const res = await this.db
      .update(courses)
      .set({ certificateTemplateId: null })
      .where(eq(courses.certificateTemplateId, id))
    await this.db.delete(certificateTemplates).where(eq(certificateTemplates.id, id))
    return { cursosLiberados: res[0].affectedRows ?? 0, name: t.name }
  }

  /** Cursos que usam este template (para a tela do admin). */
  async coursesOf(id: string): Promise<{ id: string; title: string }[]> {
    return this.db
      .select({ id: courses.id, title: courses.title })
      .from(courses)
      .where(eq(courses.certificateTemplateId, id))
      .orderBy(courses.title)
  }

  /**
   * Define (ou limpa, com `templateId` nulo) o template de um conjunto de cursos, de qualquer polo. Devolve, para o log,
   * os cursos que existem (com o polo de cada um) e o nome do modelo (`null` quando os cursos voltam ao padrão).
   */
  async assign(
    templateId: string | null,
    courseIds: string[]
  ): Promise<{ atualizados: number; cursos: Array<{ id: string; title: string; tenantId: string }>; modelo: string | null }> {
    if (courseIds.length === 0) return { atualizados: 0, cursos: [], modelo: null }
    const modelo = templateId ? (await this.getOne(templateId)).name : null // 404 antes de gravar id inexistente
    const res = await this.db
      .update(courses)
      .set({ certificateTemplateId: templateId })
      .where(inArray(courses.id, courseIds))
    const cursos = await this.db
      .select({ id: courses.id, title: courses.title, tenantId: courses.tenantId })
      .from(courses)
      .where(inArray(courses.id, courseIds))
    return { atualizados: res[0].affectedRows ?? 0, cursos, modelo }
  }
}
