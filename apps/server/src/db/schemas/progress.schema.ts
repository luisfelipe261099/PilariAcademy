import { mysqlTable, varchar, boolean, timestamp, index, unique } from 'drizzle-orm/mysql-core'

/** Progresso do aluno por aula (alimenta o % do curso). */
export const lessonProgress = mysqlTable(
  'lesson_progress',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    userId: varchar('user_id', { length: 128 }).notNull(),
    lessonId: varchar('lesson_id', { length: 36 }).notNull(),
    completed: boolean('completed').notNull().default(false),
    completedAt: timestamp('completed_at', { mode: 'date', fsp: 3 }),
    createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'date', fsp: 3 }).defaultNow(),
  },
  (t) => ({
    userLessonUnq: unique('lesson_progress_user_lesson_unq').on(t.userId, t.lessonId),
    userIdx: index('lesson_progress_user_idx').on(t.userId),
  })
)
