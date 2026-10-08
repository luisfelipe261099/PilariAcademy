import { ehTiDB } from './database.module'

describe('ehTiDB', () => {
  it('reconhece o TiDB Cloud pelo host', () => {
    expect(ehTiDB('mysql://u:p@gateway01.us-east-1.prod.aws.tidbcloud.com:4000/pilari_academy?ssl={}', undefined)).toBe(true)
  })
  it('MySQL local ou Cloud SQL não é TiDB', () => {
    expect(ehTiDB('mysql://root@127.0.0.1:3306/x', undefined)).toBe(false)
    expect(ehTiDB('mysql://u:p@10.0.0.3:3306/x', undefined)).toBe(false)
    expect(ehTiDB('mysql://u:p@tidbcloud.com.evil.example:3306/x', undefined)).toBe(false)
  })
  it('DB_ENGINE=tidb força (TiDB em host próprio)', () => {
    expect(ehTiDB('mysql://u:p@db.interno:4000/x', 'tidb')).toBe(true)
  })
  it('URL inválida não quebra', () => {
    expect(ehTiDB('nao é url', undefined)).toBe(false)
  })
})
