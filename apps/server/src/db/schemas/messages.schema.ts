import { mysqlTable, varchar, text, timestamp, index } from 'drizzle-orm/mysql-core'

/**
 * Mensagem de uma conversa aluno↔instrutor de um curso.
 * A conversa é identificada por (courseId, studentId); `senderId` diz quem enviou
 * (se senderId === studentId, foi o aluno; senão, foi o instrutor/admin).
 */
export const messages = mysqlTable(
  'messages',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    courseId: varchar('course_id', { length: 36 }).notNull(),
    studentId: varchar('student_id', { length: 128 }).notNull(),
    senderId: varchar('sender_id', { length: 128 }).notNull(),
    body: text('body').notNull(),
    readAt: timestamp('read_at', { mode: 'date', fsp: 3 }),
    createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).defaultNow(),
  },
  (t) => ({ convoIdx: index('messages_convo_idx').on(t.courseId, t.studentId) })
)
