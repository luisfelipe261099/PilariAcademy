import 'dotenv/config'
import process from 'node:process'
import { randomUUID } from 'node:crypto'
import { createPool } from 'mysql2/promise'
import { drizzle } from 'drizzle-orm/mysql2'
import { eq } from 'drizzle-orm'
import * as schema from '../db/schema'
import { categories, courses, modules, lessons, users } from '../db/schema'
import { slugify } from '../common/lib/slugify'
import { MATRIZ_TENANT_ID } from '../modules/tenancy/tenancy.constants'

const CATEGORY_NAMES = ['Pilates Solo', 'Pilates com Aparelhos', 'Fisioterapia']

/** Fotos do próprio studio (site studiopilari.vercel.app), usadas só como capa dos cursos de demonstração. */
const FOTO = (nome: string): string => `https://studiopilari.vercel.app/studio/${nome}.jpg`

// Cursos compráveis na plataforma (kind='online' → preço + carrinho). Catálogo de DEMONSTRAÇÃO: troque pelos reais.
const CATALOG_COURSES: Array<{ title: string; category: string; priceInCents: number; cover: string }> = [
  { title: 'Pilates Solo para Iniciantes', category: 'Pilates Solo', priceInCents: 19700, cover: FOTO('sala-solo') },
  { title: 'Pilates com Aparelhos: Fundamentos', category: 'Pilates com Aparelhos', priceInCents: 29700, cover: FOTO('sala-aparelhos') },
  { title: 'Postura e Dor Lombar', category: 'Fisioterapia', priceInCents: 14700, cover: FOTO('manifesto') },
]

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    console.error('DATABASE_URL ausente no apps/server/.env')
    process.exit(1)
  }
  const pool = createPool(databaseUrl)
  const db = drizzle(pool, { schema, mode: 'default' })
  const now = new Date()

  // Instrutor: usa o primeiro usuário do banco (rode `seed:admin` antes).
  const someUser = await db.select().from(users).limit(1)
  if (someUser.length === 0) {
    console.error('Nenhum usuário no banco. Rode `pnpm --filter server seed:admin -- <email> <senha>` primeiro.')
    process.exit(1)
  }
  const instructorId = someUser[0].uid

  // 1) Categorias (idempotente por slug)
  const catIdBySlug = new Map<string, string>()
  for (const name of CATEGORY_NAMES) {
    const slug = slugify(name)
    const existing = await db.select().from(categories).where(eq(categories.slug, slug)).limit(1)
    if (existing.length > 0) {
      catIdBySlug.set(slug, existing[0].id)
    } else {
      const id = randomUUID()
      await db.insert(categories).values({ id, tenantId: MATRIZ_TENANT_ID, name, slug, createdAt: now, updatedAt: now })
      catIdBySlug.set(slug, id)
      console.log(`Categoria criada: ${name}`)
    }
  }

  // Normaliza cursos antigos: external (WhatsApp/Typeform) → online comprável.
  await db.update(courses).set({ kind: 'online', externalUrl: null, updatedAt: now }).where(eq(courses.kind, 'external'))

  // 2) Cursos do catálogo (online, compráveis; idempotente por slug)
  for (const c of CATALOG_COURSES) {
    const slug = slugify(c.title)
    const existing = await db.select().from(courses).where(eq(courses.slug, slug)).limit(1)
    if (existing.length > 0) continue
    await db.insert(courses).values({
      id: randomUUID(), tenantId: MATRIZ_TENANT_ID, slug, instructorId, categoryId: catIdBySlug.get(slugify(c.category)) ?? null,
      kind: 'online', title: c.title, subtitle: null, description: 'Curso online do Studio Pilari com a Dra. Mylena Sestream.',
      priceInCents: c.priceInCents, coverImageUrl: c.cover, status: 'published', externalUrl: null,
      publishedAt: now, createdAt: now, updatedAt: now,
    })
    console.log(`Curso criado: ${c.title}`)
  }

  // 3) Curso online de exemplo com 1 módulo e 2 aulas
  const onlineSlug = 'pilates-para-gestantes'
  const onlineExists = await db.select().from(courses).where(eq(courses.slug, onlineSlug)).limit(1)
  if (onlineExists.length === 0) {
    const courseId = randomUUID()
    await db.insert(courses).values({
      id: courseId, tenantId: MATRIZ_TENANT_ID, slug: onlineSlug, instructorId,
      categoryId: catIdBySlug.get(slugify('Fisioterapia')) ?? null,
      kind: 'online', title: 'Pilates para Gestantes', subtitle: 'Movimento seguro em cada trimestre',
      description: 'Exercícios conduzidos por fisioterapeuta para a gestação e o pós-parto.', priceInCents: 24700,
      coverImageUrl: FOTO('hero'),
      status: 'published', externalUrl: null, publishedAt: now, createdAt: now, updatedAt: now,
    })
    const moduleId = randomUUID()
    await db.insert(modules).values({ id: moduleId, courseId, title: 'Primeiro trimestre', order: 0, createdAt: now, updatedAt: now })
    await db.insert(lessons).values([
      { id: randomUUID(), moduleId, title: 'Respiração e assoalho pélvico', description: null, videoUrl: 'https://example.com/aula1', durationSec: 600, order: 0, isFreePreview: true, createdAt: now, updatedAt: now },
      { id: randomUUID(), moduleId, title: 'Mobilidade da coluna', description: null, videoUrl: 'https://example.com/aula2', durationSec: 720, order: 1, isFreePreview: false, createdAt: now, updatedAt: now },
    ])
    console.log('Curso online de exemplo criado.')
  }

  await pool.end()
  console.log('✅ Seed de cursos concluído.')
  process.exit(0)
}

main().catch((err) => {
  console.error('FALHOU:', err instanceof Error ? err.message : err)
  process.exit(1)
})
