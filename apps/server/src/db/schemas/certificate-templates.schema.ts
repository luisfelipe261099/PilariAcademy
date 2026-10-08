import { mysqlTable, varchar, timestamp, boolean, customType } from 'drizzle-orm/mysql-core'

// LONGTEXT: o HTML do template (CSS + eventuais data URIs) pode passar de 64KB.
const longtext = customType<{ data: string }>({
  dataType() {
    return 'longtext'
  },
})

/**
 * Template (HTML) do certificado, editável pelo admin.
 *
 * São vários e REUTILIZÁVEIS: o curso aponta para um (`courses.certificate_template_id`)
 * e dezenas de cursos compartilham o mesmo — um "com 2ª assinatura" e um "sem" atendem
 * o catálogo inteiro, em vez de uma cópia do HTML por curso.
 *
 * Resolução na emissão: template do curso → o marcado como padrão → HTML de fábrica
 * embutido no repo (assets/certificate.html). Ou seja, o certificado funciona pronto
 * mesmo sem nenhum registro aqui.
 */
export const certificateTemplates = mysqlTable('certificate_templates', {
  id: varchar('id', { length: 36 }).primaryKey(),
  name: varchar('name', { length: 120 }).notNull(),
  html: longtext('html').notNull(),
  /** Usado por curso sem template próprio. Exatamente um registro deve ter `true`. */
  isDefault: boolean('is_default').notNull().default(false),
  updatedBy: varchar('updated_by', { length: 128 }),
  updatedAt: timestamp('updated_at', { mode: 'date', fsp: 3 }).defaultNow(),
})
