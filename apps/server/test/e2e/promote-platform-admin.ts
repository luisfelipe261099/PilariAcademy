// Marca um usuário do banco do ensaio como admin da plataforma. Recusa qualquer banco fora de 127.0.0.1.
import { createConnection } from 'mysql2/promise'

async function main(): Promise<void> {
  const [url, email] = [process.env.DATABASE_URL ?? '', process.argv[2] ?? '']
  if (!/^mysql:\/\/[^@]+@127\.0\.0\.1:\d+\//.test(url)) throw new Error('Só roda contra o MySQL local do ensaio (127.0.0.1).')
  if (!email) throw new Error('Informe o e-mail: tsx test/e2e/promote-platform-admin.ts <email>')
  const conn = await createConnection(url)
  const [r] = await conn.query('UPDATE users SET is_platform_admin = 1 WHERE email = ?', [email.toLowerCase()])
  console.log(`Linhas atualizadas: ${(r as { affectedRows: number }).affectedRows}`)
  await conn.end()
}

void main().catch((e: Error) => {
  console.error(e.message)
  process.exit(1)
})
