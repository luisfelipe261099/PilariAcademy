import { mysqlTable, varchar, int, text, boolean, timestamp, index, unique } from 'drizzle-orm/mysql-core'
import type { CourseKind, CourseStatus } from '@pilari/types'

/** Categoria gerenciada pelo admin. */
export const categories = mysqlTable(
  'categories',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 36 }).notNull(),
    name: varchar('name', { length: 120 }).notNull(),
    slug: varchar('slug', { length: 140 }).notNull(),
    createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'date', fsp: 3 }).defaultNow(),
  },
  (t) => ({ tenantSlugUnq: unique('categories_tenant_slug_unq').on(t.tenantId, t.slug) })
)

/** Curso. `instructorId` referencia users.uid; `kind` decide online vs externo. */
export const courses = mysqlTable(
  'courses',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 36 }).notNull(),
    slug: varchar('slug', { length: 180 }).notNull(),
    instructorId: varchar('instructor_id', { length: 128 }).notNull(),
    categoryId: varchar('category_id', { length: 36 }),
    kind: varchar('kind', { length: 16 }).$type<CourseKind>().notNull(),
    title: varchar('title', { length: 200 }).notNull(),
    subtitle: varchar('subtitle', { length: 300 }),
    description: text('description'),
    priceInCents: int('price_in_cents').notNull().default(0),
    /** Preço promocional (campanha). Quando setado e < preço, vira o preço cobrado. */
    promoPriceInCents: int('promo_price_in_cents'),
    /** Fim da promoção (opcional). Após esta data a promoção expira. null = sem prazo. */
    promoEndsAt: timestamp('promo_ends_at', { mode: 'date', fsp: 3 }),
    commissionPercent: int('commission_percent').notNull().default(50),
    coverImageUrl: varchar('cover_image_url', { length: 1024 }),
    /** Enquadramento da capa (CSS object-position, ex.: "50% 30%"). null = center. */
    coverFocus: varchar('cover_focus', { length: 20 }),
    /**
     * Coordenador do curso, impresso como 2a assinatura no certificado (a 1a é a
     * Diretora, que está gravada na ARTE de fundo e vale para todos). É dado do CURSO
     * porque cada curso tem o seu — no template global, um coordenador assinaria os
     * certificados de todos os outros cursos. Vazio = certificado só com a Diretora.
     */
    /**
     * Carga horária IMPRESSA no certificado, em horas. Quando null, cai na soma da duração
     * das aulas — que é como sempre funcionou, e continua valendo para curso que ninguém
     * configurou. Existe porque a carga declarada raramente é igual ao tempo de vídeo:
     * 180h de curso não são 180h de aula gravada.
     */
    workloadHours: int('workload_hours'),
    coordinatorName: varchar('coordinator_name', { length: 120 }),
    coordinatorRole: varchar('coordinator_role', { length: 120 }),
    /** Template do certificado. null = usa o marcado como padrão. */
    certificateTemplateId: varchar('certificate_template_id', { length: 36 }),
    /**
     * Caminho no GCS da IMAGEM da assinatura do coordenador (a rubrica escaneada).
     * Guarda o caminho, não a imagem: o PDF é renderizado com a imagem embutida como
     * data URI, mas manter o binário no banco engordaria toda leitura de curso.
     */
    coordinatorSignaturePath: varchar('coordinator_signature_path', { length: 1024 }),
    status: varchar('status', { length: 16 }).$type<CourseStatus>().notNull().default('draft'),
    externalUrl: varchar('external_url', { length: 1024 }),
    publishedAt: timestamp('published_at', { mode: 'date', fsp: 3 }),
    /** Pré-venda: se no futuro, o curso é comprável mas o conteúdo só abre nesta data. */
    availableAt: timestamp('available_at', { mode: 'date', fsp: 3 }),
    /** Envio para a análise (draft → in_review). */
    submittedAt: timestamp('submitted_at', { mode: 'date', fsp: 3 }),
    /** Primeira aprovação. Depois dela, os dados impressos no certificado travam para o polo. */
    approvedAt: timestamp('approved_at', { mode: 'date', fsp: 3 }),
    approvedBy: varchar('approved_by', { length: 128 }),
    /** Motivo da devolução ou da retirada do ar, escrito pela plataforma. */
    reviewNote: varchar('review_note', { length: 1000 }),
    /** Tutor de voz com IA na sala de aula. Só admin liga: cada pergunta tem custo no Vertex AI. */
    tutorEnabled: boolean('tutor_enabled').notNull().default(false),
    createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'date', fsp: 3 }).defaultNow(),
  },
  (t) => ({
    statusIdx: index('courses_status_idx').on(t.status),
    categoryIdx: index('courses_category_idx').on(t.categoryId),
    instructorIdx: index('courses_instructor_idx').on(t.instructorId),
    tenantSlugUnq: unique('courses_tenant_slug_unq').on(t.tenantId, t.slug),
  })
)

/** Módulo (só p/ cursos online). `order` mapeado p/ coluna `sort_order` (evita reservada). */
export const modules = mysqlTable(
  'modules',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    courseId: varchar('course_id', { length: 36 }).notNull(),
    title: varchar('title', { length: 200 }).notNull(),
    order: int('sort_order').notNull().default(0),
    /** Gotejamento (drip): se no futuro, o módulo fica bloqueado até esta data. */
    availableAt: timestamp('available_at', { mode: 'date', fsp: 3 }),
    createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'date', fsp: 3 }).defaultNow(),
  },
  (t) => ({ courseIdx: index('modules_course_idx').on(t.courseId) })
)

/** Aula = vídeo + texto. */
export const lessons = mysqlTable(
  'lessons',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    moduleId: varchar('module_id', { length: 36 }).notNull(),
    title: varchar('title', { length: 200 }).notNull(),
    description: text('description'),
    videoUrl: varchar('video_url', { length: 1024 }),
    durationSec: int('duration_sec').notNull().default(0),
    order: int('sort_order').notNull().default(0),
    isFreePreview: boolean('is_free_preview').notNull().default(false),
    createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'date', fsp: 3 }).defaultNow(),
  },
  (t) => ({ moduleIdx: index('lessons_module_idx').on(t.moduleId) })
)

/** Materiais para download (modelados agora; expostos na fatia de consumo). */
export const lessonAttachments = mysqlTable(
  'lesson_attachments',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    lessonId: varchar('lesson_id', { length: 36 }).notNull(),
    fileName: varchar('file_name', { length: 255 }).notNull(),
    fileUrl: varchar('file_url', { length: 1024 }).notNull(),
    sizeBytes: int('size_bytes'),
    createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).defaultNow(),
  },
  (t) => ({ lessonIdx: index('lesson_attachments_lesson_idx').on(t.lessonId) })
)
