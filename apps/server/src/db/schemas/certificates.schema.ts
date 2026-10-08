import { mysqlTable, varchar, timestamp, index, unique, int, mysqlEnum } from 'drizzle-orm/mysql-core'

/**
 * Certificado emitido ao concluir 100% do curso + aprovação em todas as provas.
 * Os campos de snapshot (studentName/courseTitle/hours) são congelados na emissão:
 * o documento é imutável, independente de edições posteriores no curso/usuário.
 */
export const certificates = mysqlTable(
  'certificates',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    userId: varchar('user_id', { length: 128 }).notNull(),
    courseId: varchar('course_id', { length: 36 }).notNull(),
    code: varchar('code', { length: 36 }).notNull().unique(),
    // Snapshot dos dados exibidos, congelados no momento da emissão.
    studentName: varchar('student_name', { length: 255 }),
    courseTitle: varchar('course_title', { length: 255 }),
    hours: int('hours'),
    cpf: varchar('cpf', { length: 14 }),
    /**
     * Coordenador CONGELADO na emissão, como studentName/courseTitle. Trocar o
     * coordenador do curso não pode reescrever quem assinou um documento já emitido.
     */
    coordinatorName: varchar('coordinator_name', { length: 120 }),
    coordinatorRole: varchar('coordinator_role', { length: 120 }),
    /** Congelado como o nome: trocar a rubrica do curso não reassina documento emitido. */
    coordinatorSignaturePath: varchar('coordinator_signature_path', { length: 1024 }),
    status: mysqlEnum('status', ['issued', 'revoked']).notNull().default('issued'),
    // Caminho do PDF no GCS (certificates/<id>/<code>.pdf); null enquanto não gerado.
    pdfPath: varchar('pdf_path', { length: 512 }),
    issuedAt: timestamp('issued_at', { mode: 'date', fsp: 3 }).defaultNow(),
  },
  (t) => ({
    userCourseUnq: unique('certificates_user_course_unq').on(t.userId, t.courseId),
    codeIdx: index('certificates_code_idx').on(t.code),
  })
)
