import 'dotenv/config'
import process from 'node:process'
import { createInterface } from 'node:readline'
import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { createPool } from 'mysql2/promise'
import { drizzle } from 'drizzle-orm/mysql2'
import { and, eq } from 'drizzle-orm'
import { Role } from '@pilari/types'
import * as schema from '../db/schema'
import { tenantMembers, users } from '../db/schema'
import { MATRIZ_TENANT_ID } from '../modules/tenancy/tenancy.constants'

/**
 * Bootstrap de usuário (identidade no Firebase + linha espelhada no banco + vínculo na matriz).
 * Os papéis valem pelo vínculo (`tenant_members`); admin da matriz é admin da plataforma.
 * Uso: pnpm --filter server seed:admin -- <email> [role...]   (role padrão: admin)
 *
 * A senha NUNCA vai por argumento (ficaria no histórico do shell e no process list — ID-09).
 * Fontes aceitas, nesta ordem:
 *   1) env efêmera SEED_ADMIN_PASSWORD (PowerShell):
 *        $env:SEED_ADMIN_PASSWORD='...'; pnpm --filter server seed:admin -- a@b.c; Remove-Item Env:SEED_ADMIN_PASSWORD
 *   2) prompt interativo com eco desligado (quando rodando num TTY).
 *
 * Idempotente: se o usuário já existe no Firebase, reusa o uid e atualiza a senha;
 * se a linha já existe no banco, atualiza os roles (legado) e o vínculo da matriz.
 * Requer apps/server/.env (FIREBASE_SERVICE_ACCOUNT_BASE64, DATABASE_URL) e o Cloud SQL Auth Proxy de pé.
 */
async function readPassword(): Promise<string> {
  const fromEnv = process.env.SEED_ADMIN_PASSWORD
  if (fromEnv) return fromEnv
  if (!process.stdin.isTTY) {
    console.error('Sem terminal interativo: defina a env efêmera SEED_ADMIN_PASSWORD.')
    process.exit(1)
  }
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true })
    process.stdout.write('Senha do usuário (não aparece ao digitar): ')
    // Desliga o eco do readline — a senha não fica visível nem no scrollback do terminal.
    ;(rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = () => {}
    rl.question('', (answer) => {
      rl.close()
      process.stdout.write('\n')
      resolve(answer)
    })
  })
}

async function main(): Promise<void> {
  // Ignora o token "--" que o pnpm (com --filter) repassa como argumento.
  const [email, ...roleArgs] = process.argv.slice(2).filter((a) => a !== '--')
  if (!email || !email.includes('@')) {
    console.error('Uso: pnpm --filter server seed:admin -- <email> [role...]  (role padrão: admin)')
    console.error('Senha: via env SEED_ADMIN_PASSWORD ou prompt — nunca por argumento.')
    process.exit(1)
  }

  const roles = (roleArgs.length > 0 ? roleArgs : ['admin']) as Role[]
  const validRoles = new Set<string>(Object.values(Role))
  for (const r of roles) {
    if (!validRoles.has(r)) {
      console.error(`Role inválida: "${r}". Válidas: ${[...validRoles].join(', ')}`)
      console.error('(A senha não é mais aceita por argumento — use SEED_ADMIN_PASSWORD ou o prompt.)')
      process.exit(1)
    }
  }

  const password = await readPassword()
  if (password.length < 8) {
    console.error('Senha muito curta: use ao menos 8 caracteres para contas de seed/admin.')
    process.exit(1)
  }

  const base64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64
  if (!base64) {
    console.error('FIREBASE_SERVICE_ACCOUNT_BASE64 ausente no apps/server/.env')
    process.exit(1)
  }
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    console.error('DATABASE_URL ausente no apps/server/.env')
    process.exit(1)
  }

  // 1) Firebase: cria ou reusa a identidade
  if (getApps().length === 0) {
    initializeApp({ credential: cert(JSON.parse(Buffer.from(base64, 'base64').toString('utf-8'))) })
  }
  const auth = getAuth()

  let uid: string
  try {
    const created = await auth.createUser({ email, password })
    uid = created.uid
    console.log(`Firebase: usuário criado (uid=${uid})`)
  } catch (err) {
    const code = (err as { code?: string }).code
    if (code === 'auth/email-already-exists') {
      const existing = await auth.getUserByEmail(email)
      uid = existing.uid
      await auth.updateUser(uid, { password })
      console.log(`Firebase: usuário já existia (uid=${uid}); senha atualizada`)
    } else {
      throw err
    }
  }

  // 2) Banco: espelha o usuário (users.roles fica só como legado para rollback)
  const pool = createPool(databaseUrl)
  const db = drizzle(pool, { schema, mode: 'default' })
  const now = new Date()
  const rows = await db.select().from(users).where(eq(users.uid, uid)).limit(1)
  if (rows.length === 0) {
    await db.insert(users).values({ uid, email, roles, disabled: false, createdAt: now, updatedAt: now })
    console.log('Banco: linha criada')
  } else {
    await db.update(users).set({ email, roles, updatedAt: now }).where(eq(users.uid, uid))
    console.log('Banco: linha atualizada')
  }
  // 3) Vínculo na matriz: é ele que autoriza (users.roles ficou só para rollback). Admin da matriz é da plataforma.
  const vinculo = await db.select().from(tenantMembers).where(and(eq(tenantMembers.tenantId, MATRIZ_TENANT_ID), eq(tenantMembers.userUid, uid))).limit(1)
  if (vinculo.length === 0) {
    await db.insert(tenantMembers).values({ tenantId: MATRIZ_TENANT_ID, userUid: uid, roles, createdAt: now, updatedAt: now })
    console.log('Banco: vínculo na matriz criado')
  } else {
    await db.update(tenantMembers).set({ roles, updatedAt: now }).where(and(eq(tenantMembers.tenantId, MATRIZ_TENANT_ID), eq(tenantMembers.userUid, uid)))
    console.log('Banco: vínculo na matriz atualizado')
  }
  await pool.end()

  console.log(`✅ Pronto: ${email} -> papéis na matriz=${JSON.stringify(roles)} (uid=${uid})`)
  process.exit(0)
}

main().catch((err) => {
  console.error('FALHOU:', err instanceof Error ? err.message : err)
  process.exit(1)
})
