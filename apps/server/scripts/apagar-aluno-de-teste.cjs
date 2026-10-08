/**
 * Apaga um aluno de teste e tudo que pende dele, no banco apontado por DATABASE_URL.
 *
 * Sem --confirm ele só INSPECIONA e sai. É de propósito: isto roda contra PRODUÇÃO e
 * apagar o aluno errado não tem desfazer.
 *
 *   node scripts/apagar-aluno-de-teste.cjs aluno@gmail.com            # só mostra
 *   node scripts/apagar-aluno-de-teste.cjs aluno@gmail.com --confirm  # apaga
 *
 * As tabelas afetadas são DESCOBERTAS no information_schema (qualquer coluna que
 * referencie usuário), não listadas à mão — uma tabela nova não passa despercebida.
 *
 * NÃO apaga `audit_logs`: a trilha de auditoria registra o que foi feito e apagá-la
 * junto destruiria justamente o registro desta limpeza.
 */
require('dotenv').config()
const mysql = require('mysql2/promise')

const email = process.argv[2]
const confirmar = process.argv.includes('--confirm')
if (!email) {
  console.error('uso: node scripts/apagar-aluno-de-teste.cjs <email do aluno> [--confirm]')
  process.exit(1)
}

/** Colunas que apontam para um usuário. `uid` é a PK de `users`. */
const COLS_USUARIO = ['user_id', 'student_id', 'sender_id', 'uid']
/** Trilha de auditoria: fica. */
const NAO_APAGAR = new Set(['audit_logs'])

const u = new URL(process.env.DATABASE_URL)
// Mesmo bucket que o servidor usa; vem do .env para não mentir se a config mudar.
const BUCKET = process.env.GCS_BUCKET || '<GCS_BUCKET não definido no .env>'

async function main() {
  const c = await mysql.createConnection({
    host: u.hostname,
    port: u.port || 3306,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.slice(1),
  })
  const schema = u.pathname.slice(1)
  console.log('banco:', schema, '@', u.hostname)

  const [users] = await c.query('SELECT uid, email, display_name, cpf, created_at FROM users WHERE email = ?', [email])
  if (users.length === 0) {
    console.log('nenhum usuário com esse e-mail. Nada a fazer.')
    await c.end()
    return
  }
  if (users.length > 1) {
    console.log('MAIS DE UM usuário com esse e-mail — resolva à mão, não vou adivinhar qual.')
    console.table(users)
    await c.end()
    return
  }
  const uid = users[0].uid
  console.log('\n--- aluno ---')
  console.table(users)

  // Descobre onde esse uid aparece.
  const [cols] = await c.query(
    `SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = ? AND column_name IN (?)
      ORDER BY table_name`,
    [schema, COLS_USUARIO]
  )

  const alvos = []
  console.log('\n--- o que pende desse aluno ---')
  for (const { TABLE_NAME: t, COLUMN_NAME: col } of cols) {
    const [[{ n }]] = await c.query(`SELECT COUNT(*) n FROM \`${t}\` WHERE \`${col}\` = ?`, [uid])
    if (n === 0) continue
    const nota = NAO_APAGAR.has(t) ? '  ← PRESERVADO (trilha de auditoria)' : ''
    console.log(`  ${t}.${col}: ${n}${nota}`)
    if (!NAO_APAGAR.has(t)) alvos.push({ t, col, n })
  }
  if (alvos.length === 0) {
    console.log('  (nada)')
  }

  // Trava: dinheiro de verdade não se apaga por engano.
  const [pedidos] = await c.query(
    "SELECT id, status, total_in_cents, asaas_payment_link_id, asaas_installment_id, paid_at, settled_at FROM orders WHERE user_id = ?",
    [uid]
  )
  if (pedidos.length > 0) {
    console.log('\n--- pedidos ---')
    console.table(pedidos)
    const comDinheiro = pedidos.filter(
      (p) => p.paid_at || p.settled_at || p.asaas_payment_link_id || p.asaas_installment_id
    )
    if (comDinheiro.length > 0) {
      console.log(
        `\nABORTADO: ${comDinheiro.length} pedido(s) com pagamento ou cobrança no Asaas.`,
        '\nIsto não parece semente de teste. Resolva à mão se for mesmo para apagar.'
      )
      await c.end()
      return
    }
  }

  console.log('\n--- PDFs no GCS (apagados à parte) ---')
  const [certs] = await c.query('SELECT id, code FROM certificates WHERE user_id = ?', [uid])
  if (certs.length === 0) console.log('  (nenhum)')
  for (const ce of certs) {
    console.log(`  gsutil rm "gs://${BUCKET}/certificates/${ce.id}/*"   # ${ce.code}`)
  }

  if (!confirmar) {
    console.log('\nMODO INSPEÇÃO. Nada foi apagado. Repita com --confirm para apagar.')
    await c.end()
    return
  }

  // Filhos antes de `users`, senão sobra órfão apontando para um uid inexistente.
  const ordem = [...alvos.filter((a) => a.t !== 'users'), ...alvos.filter((a) => a.t === 'users')]
  console.log('\n--- apagando ---')
  let total = 0
  for (const { t, col } of ordem) {
    const [res] = await c.query(`DELETE FROM \`${t}\` WHERE \`${col}\` = ?`, [uid])
    console.log(`  ${t}: ${res.affectedRows} linha(s)`)
    total += res.affectedRows
  }
  console.log('total:', total)

  // Conferência: relê tudo e exige zero.
  console.log('\n--- conferência ---')
  let sobrou = 0
  for (const { TABLE_NAME: t, COLUMN_NAME: col } of cols) {
    if (NAO_APAGAR.has(t)) continue
    const [[{ n }]] = await c.query(`SELECT COUNT(*) n FROM \`${t}\` WHERE \`${col}\` = ?`, [uid])
    if (n > 0) {
      console.log(`  SOBROU ${t}.${col}: ${n}`)
      sobrou += n
    }
  }
  console.log(sobrou === 0 ? '  limpo.' : `  ATENÇÃO: ${sobrou} linha(s) resistiram.`)
  await c.end()
}

main().catch((e) => {
  console.error('ERRO:', e.code || e.message)
  process.exitCode = 1
})
