/**
 * Sobe UM servidor MySQL 8 descartável para toda a suíte. Cada arquivo de teste cria o
 * próprio banco dentro dele (helpers/db.ts). O binário fica em cache após o primeiro download.
 */
const { createDB } = require('mysql-memory-server')

module.exports = async () => {
  const db = await createDB({ version: '8.0.x', dbName: 'bootstrap', logLevel: 'ERROR' })
  globalThis.__MYSQL_TEST__ = db
  process.env.MYSQL_TEST_PORT = String(db.port)
  process.env.MYSQL_TEST_USER = db.username
}
