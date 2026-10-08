import { mysqlTable, varchar, int, text, timestamp, index, unique } from 'drizzle-orm/mysql-core'

/** Avaliação (review) de um curso por um aluno. Uma por (curso, aluno). */
export const courseReviews = mysqlTable(
  'course_reviews',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    courseId: varchar('course_id', { length: 36 }).notNull(),
    userId: varchar('user_id', { length: 128 }).notNull(),
    rating: int('rating').notNull(),
    comment: text('comment'),
    createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'date', fsp: 3 }).defaultNow(),
  },
  (t) => ({
    courseUserUnq: unique('course_reviews_course_user_unq').on(t.courseId, t.userId),
    courseIdx: index('course_reviews_course_idx').on(t.courseId),
  })
)

/** Observação (anotação) do aluno numa aula, ancorada num segundo do vídeo. */
export const lessonNotes = mysqlTable(
  'lesson_notes',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    userId: varchar('user_id', { length: 128 }).notNull(),
    courseId: varchar('course_id', { length: 36 }).notNull(),
    lessonId: varchar('lesson_id', { length: 36 }).notNull(),
    atSec: int('at_sec').notNull().default(0),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).defaultNow(),
  },
  (t) => ({ userCourseIdx: index('lesson_notes_user_course_idx').on(t.userId, t.courseId) })
)

/** Anúncio do instrutor para a turma de um curso. */
export const courseAnnouncements = mysqlTable(
  'course_announcements',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    courseId: varchar('course_id', { length: 36 }).notNull(),
    authorId: varchar('author_id', { length: 128 }).notNull(),
    title: varchar('title', { length: 255 }).notNull(),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).defaultNow(),
  },
  (t) => ({ courseIdx: index('course_announcements_course_idx').on(t.courseId) })
)
