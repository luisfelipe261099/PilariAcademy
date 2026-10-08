import { mysqlTable, varchar, int, decimal, text, json, boolean, timestamp, index } from 'drizzle-orm/mysql-core'

/** Questão de prova (múltipla escolha) ligada a um módulo. */
export const quizQuestions = mysqlTable(
  'quiz_questions',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    moduleId: varchar('module_id', { length: 36 }).notNull(),
    prompt: text('prompt').notNull(),
    options: json('options').$type<string[]>().notNull(),
    correctIndex: int('correct_index').notNull(),
    /** Peso da questão em pontos; a soma da prova deve dar 10. */
    points: decimal('points', { precision: 4, scale: 2 }).notNull().default('2.00'),
    order: int('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'date', fsp: 3 }).defaultNow(),
  },
  (t) => ({ moduleIdx: index('quiz_questions_module_idx').on(t.moduleId) })
)

/** Tentativa de prova do aluno num módulo. */
export const quizAttempts = mysqlTable(
  'quiz_attempts',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    userId: varchar('user_id', { length: 128 }).notNull(),
    moduleId: varchar('module_id', { length: 36 }).notNull(),
    score: int('score').notNull(),
    passed: boolean('passed').notNull(),
    createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).defaultNow(),
  },
  (t) => ({ userModuleIdx: index('quiz_attempts_user_module_idx').on(t.userId, t.moduleId) })
)
