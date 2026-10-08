import { Inject, Injectable, Logger } from '@nestjs/common'
import { createHash } from 'node:crypto'
import { asc, eq, inArray } from 'drizzle-orm'
import { lessonAttachments, lessons, tutorMaterialCache } from '../../db/schema'
import type { Database } from '../../db/types'
import { GcsService } from '../classroom/gcs.service'
import { limparTextoPdf, montarMaterial } from './lib/material-text'
import { extrairTextoPdf } from './pdf-extract'

/** PDF de material maior que isso não é lido (apostila típica: 0,5 a 1 MB). */
const MAX_PDF_BYTES = 25 * 1024 * 1024

interface FontePdf {
  nome: string
  fileUrl: string
}

/** Material de apoio de um módulo para o tutor: texto dos PDFs anexados às aulas, extraído uma vez e guardado. */
@Injectable()
export class TutorMaterialService {
  private readonly logger = new Logger(TutorMaterialService.name)

  constructor(
    @Inject('DB_CLIENT') private readonly db: Database,
    private readonly gcs: GcsService
  ) {}

  /** PDFs do módulo, sem repetir o mesmo objeto, na ordem das aulas. Só objetos do GCS (link externo fica de fora). */
  async fontes(moduleIds: string[]): Promise<Map<string, FontePdf[]>> {
    const porModulo = new Map<string, FontePdf[]>()
    if (!moduleIds.length) return porModulo
    const aulas = await this.db
      .select({ id: lessons.id, moduleId: lessons.moduleId })
      .from(lessons)
      .where(inArray(lessons.moduleId, moduleIds))
      .orderBy(asc(lessons.order))
    if (!aulas.length) return porModulo
    const anexos = await this.db
      .select({ lessonId: lessonAttachments.lessonId, fileName: lessonAttachments.fileName, fileUrl: lessonAttachments.fileUrl, createdAt: lessonAttachments.createdAt })
      .from(lessonAttachments)
      .where(inArray(lessonAttachments.lessonId, aulas.map((a) => a.id)))
    const posicao = new Map(aulas.map((a, i) => [a.id, i]))
    const moduloDaAula = new Map(aulas.map((a) => [a.id, a.moduleId]))
    anexos.sort((a, b) => (posicao.get(a.lessonId) ?? 0) - (posicao.get(b.lessonId) ?? 0) || (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0))
    for (const a of anexos) {
      if (!a.fileUrl || /^https?:\/\//i.test(a.fileUrl) || !/\.pdf$/i.test(a.fileName)) continue
      const mod = moduloDaAula.get(a.lessonId)
      if (!mod) continue
      const lista = porModulo.get(mod) ?? []
      if (!lista.some((f) => f.fileUrl === a.fileUrl)) lista.push({ nome: a.fileName, fileUrl: a.fileUrl })
      porModulo.set(mod, lista)
    }
    return porModulo
  }

  /** Texto do material do módulo, pronto para o contexto (com teto). Vazio se o módulo não tem PDF legível. */
  async doModulo(moduleId: string): Promise<string> {
    const fontes = (await this.fontes([moduleId])).get(moduleId) ?? []
    const textos: Array<{ nome: string; texto: string }> = []
    for (const f of fontes) {
      const texto = await this.textoDe(f.fileUrl)
      if (texto) textos.push({ nome: f.nome, texto })
    }
    return montarMaterial(textos)
  }

  private async textoDe(fileUrl: string): Promise<string | null> {
    const sourceHash = createHash('sha256').update(fileUrl).digest('hex')
    const guardado = await this.db.select({ text: tutorMaterialCache.text }).from(tutorMaterialCache).where(eq(tutorMaterialCache.sourceHash, sourceHash)).limit(1)
    if (guardado[0]) return guardado[0].text
    const obj = await this.gcs.readObject(fileUrl, { maxBytes: MAX_PDF_BYTES })
    if (!obj || obj.buffer.subarray(0, 5).toString('latin1') !== '%PDF-') return null
    let texto: string
    try {
      texto = limparTextoPdf(await extrairTextoPdf(obj.buffer))
    } catch (err) {
      this.logger.warn(`Não foi possível extrair o texto de "${fileUrl}": ${(err as Error).message}`)
      return null
    }
    // Corrida de duas perguntas extraindo o mesmo PDF: a segunda gravação vira no-op.
    await this.db
      .insert(tutorMaterialCache)
      .values({ sourceHash, fileUrl, text: texto, chars: texto.length })
      .onDuplicateKeyUpdate({ set: { sourceHash } })
    return texto
  }
}
