/**
 * Importa um pacote de curso (pasta com `curso.json`, capa e PDFs) para a matriz da plataforma.
 *
 * Uso:
 *   pnpm --filter server exec tsx src/scripts/importar-curso.ts <pasta> --instrutor=<email>
 *        [--base-url=<url>] [--publicar] [--substituir] [--producao]
 *
 * Arquivos (capa e anexos): com GCS_BUCKET, sobem para `cursos/<id>/...` no bucket; sem bucket, viram
 * `<base-url>/<caminho no pacote>` (ensaio local: sirva a pasta com `python3 -m http.server`).
 * Por segurança só roda contra MySQL em 127.0.0.1; `--producao` libera outro host, de propósito.
 *
 * `curso.json`: { slug, title, subtitle, description, category, priceInCents, workloadHours, cover,
 *   modules: [{ title, lessons: [{ title, minutes, description, freePreview?, videoUrl?, attachments?: [{ file, name }] }],
 *   quiz?: [{ prompt, options, correctIndex }] }] }
 */
import 'dotenv/config'
import process from 'node:process'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { basename, extname, join, resolve } from 'node:path'
import { createPool } from 'mysql2/promise'
import { drizzle } from 'drizzle-orm/mysql2'
import { and, eq, inArray } from 'drizzle-orm'
import * as schema from '../db/schema'
import { categories, courses, lessonAttachments, lessons, modules, quizQuestions, users } from '../db/schema'
import { slugify } from '../common/lib/slugify'
import { MATRIZ_TENANT_ID } from '../modules/tenancy/tenancy.constants'

interface PacoteAula {
  title: string
  minutes: number
  description?: string
  freePreview?: boolean
  videoUrl?: string
  attachments?: Array<{ file: string; name: string }>
}
interface PacoteQuestao {
  prompt: string
  options: string[]
  correctIndex: number
}
interface Pacote {
  slug: string
  title: string
  subtitle?: string
  description?: string
  category?: string
  priceInCents: number
  workloadHours: number
  coordinatorName?: string | null
  coordinatorRole?: string | null
  cover?: string
  modules: Array<{ title: string; lessons: PacoteAula[]; quiz?: PacoteQuestao[] }>
}

const args = process.argv.slice(2)
const flag = (nome: string): string | undefined => args.find((a) => a.startsWith(`--${nome}=`))?.split('=').slice(1).join('=')
const tem = (nome: string): boolean => args.includes(`--${nome}`)

/** Pesos que somam exatamente 10 (a nota da prova é pontos ganhos / pontos totais). */
export function pesosDaProva(n: number): string[] {
  const base = Math.floor(1000 / n)
  const sobra = 1000 - base * n
  return Array.from({ length: n }, (_, i) => ((base + (i < sobra ? 1 : 0)) / 100).toFixed(2))
}

/** Erros de conteúdo do pacote, antes de tocar no banco. Lista vazia = pacote válido. */
export function validarPacote(p: Pacote, pasta: string): string[] {
  const erros: string[] = []
  if (!p.slug || !p.title) erros.push('slug e title são obrigatórios')
  if (!Array.isArray(p.modules) || p.modules.length === 0) erros.push('o curso precisa de ao menos um módulo')
  const arquivo = (f: string, onde: string) => {
    if (!existsSync(join(pasta, f))) erros.push(`${onde}: arquivo não encontrado (${f})`)
  }
  if (p.cover) arquivo(p.cover, 'capa')
  p.modules?.forEach((m, i) => {
    if (!m.lessons?.length) erros.push(`módulo ${i + 1}: sem aulas`)
    m.lessons?.forEach((a, j) => a.attachments?.forEach((x) => arquivo(x.file, `aula ${i + 1}.${j + 1}`)))
    m.quiz?.forEach((q, k) => {
      if (q.options.length < 2) erros.push(`módulo ${i + 1}, questão ${k + 1}: menos de 2 alternativas`)
      if (q.correctIndex < 0 || q.correctIndex >= q.options.length) erros.push(`módulo ${i + 1}, questão ${k + 1}: correctIndex fora das alternativas`)
    })
  })
  return erros
}

async function main(): Promise<void> {
  const pasta = resolve(args.find((a) => !a.startsWith('--')) ?? '')
  const instrutor = flag('instrutor')
  const baseUrl = flag('base-url')?.replace(/\/+$/, '')
  const databaseUrl = process.env.DATABASE_URL ?? ''
  if (!existsSync(join(pasta, 'curso.json')) || !instrutor) {
    console.error('Uso: importar-curso.ts <pasta-com-curso.json> --instrutor=<email> [--base-url=URL] [--publicar] [--substituir] [--producao]')
    process.exit(1)
  }
  if (!/^mysql:\/\/[^@]*@127\.0\.0\.1:\d+\//.test(databaseUrl) && !tem('producao')) {
    console.error('DATABASE_URL não é o MySQL local (127.0.0.1). Para importar em outro banco, passe --producao de propósito.')
    process.exit(1)
  }
  const bucket = process.env.GCS_BUCKET
  if (!bucket && !baseUrl) {
    console.error('Sem GCS_BUCKET: informe --base-url para os arquivos (ex.: http://127.0.0.1:5181).')
    process.exit(1)
  }

  const pacote = JSON.parse(readFileSync(join(pasta, 'curso.json'), 'utf8')) as Pacote
  const erros = validarPacote(pacote, pasta)
  if (erros.length) {
    console.error(`Pacote inválido:\n- ${erros.join('\n- ')}`)
    process.exit(1)
  }

  const pool = createPool(databaseUrl)
  const db = drizzle(pool, { schema, mode: 'default' })
  const now = new Date()

  const [dono] = await db.select().from(users).where(eq(users.email, instrutor.toLowerCase())).limit(1)
  if (!dono) throw new Error(`Usuário ${instrutor} não existe no banco (faça login uma vez na plataforma).`)

  const [existente] = await db.select().from(courses).where(and(eq(courses.tenantId, MATRIZ_TENANT_ID), eq(courses.slug, pacote.slug))).limit(1)
  if (existente && !tem('substituir')) throw new Error(`Já existe o curso "${pacote.slug}". Use --substituir para recriar módulos, aulas e provas.`)
  const courseId = existente?.id ?? randomUUID()

  // Arquivo do pacote → URL/caminho gravado no banco.
  const { getStorage } = bucket ? await import('firebase-admin/storage') : { getStorage: null }
  if (bucket) {
    const { initializeApp, getApps, applicationDefault } = await import('firebase-admin/app')
    if (!getApps().length) initializeApp({ credential: applicationDefault() })
  }
  const publicar = async (arquivo: string, pastaDestino: string): Promise<string> => {
    if (!bucket || !getStorage) return `${baseUrl}/${arquivo.split('/').map(encodeURIComponent).join('/')}`
    const destino = `cursos/${courseId}/${pastaDestino}/${randomUUID()}${extname(arquivo)}`
    await getStorage().bucket(bucket).upload(join(pasta, arquivo), { destination: destino })
    return destino
  }

  let categoryId: string | null = null
  if (pacote.category) {
    const slugCat = slugify(pacote.category)
    const [cat] = await db.select().from(categories).where(and(eq(categories.tenantId, MATRIZ_TENANT_ID), eq(categories.slug, slugCat))).limit(1)
    categoryId = cat?.id ?? randomUUID()
    if (!cat) await db.insert(categories).values({ id: categoryId, tenantId: MATRIZ_TENANT_ID, name: pacote.category, slug: slugCat, createdAt: now, updatedAt: now })
  }

  const capa = pacote.cover ? await publicar(pacote.cover, 'capa') : null
  const status: 'published' | 'draft' = tem('publicar') ? 'published' : 'draft'
  const dados = {
    tenantId: MATRIZ_TENANT_ID, slug: pacote.slug, instructorId: dono.uid, categoryId, kind: 'online' as const,
    title: pacote.title, subtitle: pacote.subtitle ?? null, description: pacote.description ?? null,
    priceInCents: pacote.priceInCents, coverImageUrl: capa, workloadHours: pacote.workloadHours,
    coordinatorName: pacote.coordinatorName ?? null, coordinatorRole: pacote.coordinatorRole ?? null,
    status, publishedAt: status === 'published' ? now : null, updatedAt: now,
  }

  if (existente) {
    const antigos = await db.select({ id: modules.id }).from(modules).where(eq(modules.courseId, courseId))
    const idsModulos = antigos.map((m) => m.id)
    if (idsModulos.length) {
      const aulas = await db.select({ id: lessons.id }).from(lessons).where(inArray(lessons.moduleId, idsModulos))
      if (aulas.length) await db.delete(lessonAttachments).where(inArray(lessonAttachments.lessonId, aulas.map((a) => a.id)))
      await db.delete(lessons).where(inArray(lessons.moduleId, idsModulos))
      await db.delete(quizQuestions).where(inArray(quizQuestions.moduleId, idsModulos))
      await db.delete(modules).where(eq(modules.courseId, courseId))
    }
    await db.update(courses).set(dados).where(eq(courses.id, courseId))
  } else {
    await db.insert(courses).values({ id: courseId, ...dados, createdAt: now })
  }

  let totalAulas = 0
  let totalQuestoes = 0
  let totalAnexos = 0
  for (const [i, m] of pacote.modules.entries()) {
    const moduleId = randomUUID()
    await db.insert(modules).values({ id: moduleId, courseId, title: m.title, order: i, createdAt: now, updatedAt: now })
    for (const [j, a] of m.lessons.entries()) {
      const lessonId = randomUUID()
      await db.insert(lessons).values({
        id: lessonId, moduleId, title: a.title, description: a.description ?? null, videoUrl: a.videoUrl ?? null,
        durationSec: Math.round(a.minutes * 60), order: j, isFreePreview: !!a.freePreview, createdAt: now, updatedAt: now,
      })
      totalAulas++
      for (const anexo of a.attachments ?? []) {
        const fileUrl = await publicar(anexo.file, 'anexos')
        await db.insert(lessonAttachments).values({
          id: randomUUID(), lessonId, fileName: anexo.name || basename(anexo.file), fileUrl,
          sizeBytes: statSync(join(pasta, anexo.file)).size, createdAt: now,
        })
        totalAnexos++
      }
    }
    const pesos = pesosDaProva(m.quiz?.length ?? 0)
    for (const [k, q] of (m.quiz ?? []).entries()) {
      await db.insert(quizQuestions).values({
        id: randomUUID(), moduleId, prompt: q.prompt, options: q.options, correctIndex: q.correctIndex,
        points: pesos[k], order: k, createdAt: now, updatedAt: now,
      })
      totalQuestoes++
    }
  }

  await pool.end()
  console.log(`✅ ${pacote.title} (${status}) — ${pacote.modules.length} módulos, ${totalAulas} aulas, ${totalAnexos} anexos, ${totalQuestoes} questões. id=${courseId}`)
  process.exit(0)
}

if (require.main === module) {
  main().catch((err) => {
    console.error('FALHOU:', err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
