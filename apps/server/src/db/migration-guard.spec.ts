import { migrationsPendentes, shouldRunMigrations, ultimaMigrationDoJournal } from './migration-guard'

const REMOTO = 'mysql://u:p@203.0.113.10:3306/pilari_academy'

describe('shouldRunMigrations', () => {
  it('produção sempre aplica', () => {
    expect(shouldRunMigrations({ NODE_ENV: 'production', DATABASE_URL: REMOTO }).run).toBe(true)
  })

  it('dev com banco remoto NÃO aplica', () => {
    const r = shouldRunMigrations({ NODE_ENV: 'development', DATABASE_URL: REMOTO })
    expect(r.run).toBe(false)
    expect(r.reason).toContain('203.0.113.10')
  })

  it('sem NODE_ENV e banco remoto NÃO aplica', () => {
    expect(shouldRunMigrations({ DATABASE_URL: REMOTO }).run).toBe(false)
  })

  it.each(['127.0.0.1', 'localhost', '[::1]'])('dev com banco local (%s) aplica', (host) => {
    expect(shouldRunMigrations({ NODE_ENV: 'development', DATABASE_URL: `mysql://root@${host}:3306/x` }).run).toBe(true)
  })

  it('ALLOW_REMOTE_MIGRATIONS=1 libera banco remoto', () => {
    expect(shouldRunMigrations({ NODE_ENV: 'development', DATABASE_URL: REMOTO, ALLOW_REMOTE_MIGRATIONS: '1' }).run).toBe(true)
  })

  it('URL ausente ou inválida não aplica', () => {
    expect(shouldRunMigrations({ NODE_ENV: 'development' }).run).toBe(false)
    expect(shouldRunMigrations({ NODE_ENV: 'development', DATABASE_URL: 'nao é url' }).run).toBe(false)
  })
})

describe('migrations pendentes (trava de subida em produção)', () => {
  it('a última migration do journal é o maior when', () => {
    expect(ultimaMigrationDoJournal({ entries: [{ when: 10 }, { when: 30 }, { when: 20 }] })).toBe(30)
    expect(() => ultimaMigrationDoJournal({ entries: [] })).toThrow()
  })
  it('banco atrás do código está pendente; igual ou à frente não', () => {
    expect(migrationsPendentes(30, 20)).toBe(true)
    expect(migrationsPendentes(30, null)).toBe(true)
    expect(migrationsPendentes(30, undefined)).toBe(true)
    expect(migrationsPendentes(30, 30)).toBe(false)
    expect(migrationsPendentes(30, '30')).toBe(false)
    expect(migrationsPendentes(30, 31)).toBe(false)
  })
})
