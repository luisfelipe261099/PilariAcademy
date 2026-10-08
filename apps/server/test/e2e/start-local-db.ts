// MySQL 8 descartável para o ensaio local. Nunca aponta para produção: sobe um servidor novo em 127.0.0.1.
import { createDB } from 'mysql-memory-server'

async function main(): Promise<void> {
  const db = await createDB({ version: '8.0.x', dbName: 'ead_ensaio', port: 3399, logLevel: 'ERROR' })
  console.log(`MySQL do ensaio pronto: mysql://${db.username}@127.0.0.1:${db.port}/ead_ensaio`)
  const parar = async (): Promise<void> => {
    await db.stop()
    process.exit(0)
  }
  process.on('SIGINT', () => void parar())
  process.on('SIGTERM', () => void parar())
  await new Promise(() => undefined)
}

void main()
