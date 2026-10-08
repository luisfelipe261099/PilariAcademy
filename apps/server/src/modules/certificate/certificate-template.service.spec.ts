/// <reference types="jest" />
import { BadRequestException } from '@nestjs/common'
import { createDrizzleMock, withQueryResults, type DrizzleMock } from '../../__test-utils__/drizzle-mock'
import { CertificateTemplateService } from './certificate-template.service'

function make() {
  const db: DrizzleMock = createDrizzleMock()
  return { db, service: new CertificateTemplateService(db as never) }
}

describe('CertificateTemplateService', () => {
  it('getActiveHtml devolve o HTML salvo', async () => {
    const { db, service } = make()
    withQueryResults(db, [{ html: '<html>salvo</html>' }])
    expect(await service.getActiveHtml()).toBe('<html>salvo</html>')
  })

  it('getActiveHtml devolve null quando não há registro', async () => {
    const { db, service } = make()
    withQueryResults(db, [])
    expect(await service.getActiveHtml()).toBeNull()
  })

  it('getEditableHtml cai no HTML de fábrica quando o banco está vazio', async () => {
    const { db, service } = make()
    withQueryResults(db, [])
    const html = await service.getEditableHtml()
    expect(html).toContain('{{ studentName }}')
  })

  it('create recusa template com referência externa (ID-10) e nada é gravado', async () => {
    const { db, service } = make()
    await expect(service.create('Mau', '<img src="https://evil.example/x.png">', 'admin1')).rejects.toBeInstanceOf(BadRequestException)
    expect(db.insert).not.toHaveBeenCalled()
  })

  it('o PRIMEIRO template criado já nasce padrão', async () => {
    // Sem padrão nenhum, todo curso cairia no HTML de fábrica e o admin não veria por quê.
    const { db, service } = make()
    withQueryResults(db, [{ n: 0 }])
    await service.create('Padrão', '<html>a</html>', 'admin1')
    expect(db.values).toHaveBeenCalledWith(expect.objectContaining({ name: 'Padrão', isDefault: true }))
  })

  it('o SEGUNDO não vira padrão sozinho', async () => {
    const { db, service } = make()
    withQueryResults(db, [{ n: 1 }])
    await service.create('Sem assinatura', '<html>b</html>', 'admin1')
    expect(db.values).toHaveBeenCalledWith(expect.objectContaining({ isDefault: false }))
  })

  it('apagar o padrão é recusado', async () => {
    // Apagar o padrão deixaria TODO curso sem template próprio caindo no HTML de fábrica
    // de uma vez, sem aviso.
    const { db, service } = make()
    withQueryResults(db, [{ id: 't1', name: 'Padrão', html: '<html>', isDefault: 1 }])
    await expect(service.remove('t1')).rejects.toBeInstanceOf(BadRequestException)
    expect(db.delete).not.toHaveBeenCalled()
  })

  it('apagar um NÃO-padrão devolve os cursos dele ao padrão antes de apagar', async () => {
    // Sem isso os cursos ficariam apontando para um id morto.
    const { db, service } = make()
    withQueryResults(db, [{ id: 't2', name: 'Outro', html: '<html>', isDefault: 0 }], [{ affectedRows: 3 }], undefined)
    const r = await service.remove('t2')
    expect(db.set).toHaveBeenCalledWith(expect.objectContaining({ certificateTemplateId: null }))
    expect(db.delete).toHaveBeenCalled()
    expect(r).toEqual({ cursosLiberados: 3, name: 'Outro' })
  })

  it('assign devolve, para o log, os cursos que existem (com o polo) e o nome do modelo', async () => {
    const { db, service } = make()
    withQueryResults<unknown>(db, [{ id: 't2', name: 'Com assinatura', html: '<html>', isDefault: 0 }], [{ affectedRows: 1 }], [{ id: 'c1', title: 'Excel', tenantId: 't-a' }])
    expect(await service.assign('t2', ['c1', 'nao-existe'])).toEqual({ atualizados: 1, cursos: [{ id: 'c1', title: 'Excel', tenantId: 't-a' }], modelo: 'Com assinatura' })
  })

  it('assign sem modelo (volta ao padrão) não consulta modelo e devolve modelo nulo', async () => {
    const { db, service } = make()
    withQueryResults<unknown>(db, [{ affectedRows: 1 }], [{ id: 'c1', title: 'Excel', tenantId: 't-a' }])
    expect(await service.assign(null, ['c1'])).toEqual({ atualizados: 1, cursos: [{ id: 'c1', title: 'Excel', tenantId: 't-a' }], modelo: null })
    expect(db.select).toHaveBeenCalledTimes(1)
  })

  it('update e setDefault devolvem o nome com que o modelo ficou', async () => {
    const a = make()
    withQueryResults<unknown>(a.db, [{ id: 't2', name: 'Antigo', html: '<html>', isDefault: 0 }], undefined)
    expect(await a.service.update('t2', { name: 'Novo nome' }, 'u1')).toEqual({ name: 'Novo nome' })
    const b = make()
    withQueryResults<unknown>(b.db, [{ id: 't2', name: 'Antigo', html: '<html>', isDefault: 0 }], undefined)
    expect(await b.service.update('t2', { html: '<html>x</html>' }, 'u1')).toEqual({ name: 'Antigo' })
    const c = make()
    withQueryResults<unknown>(c.db, [{ id: 't2', name: 'Antigo', html: '<html>', isDefault: 0 }], undefined, undefined)
    expect(await c.service.setDefault('t2')).toEqual({ name: 'Antigo' })
  })

  describe('getActiveHtmlWithFingerprint', () => {
    it('sem registro no banco → usa o de fábrica e devolve um fingerprint estável', async () => {
      const { db, service } = make()
      withQueryResults(db, [])
      const a = await service.getActiveHtmlWithFingerprint()
      withQueryResults(db, [])
      const b = await service.getActiveHtmlWithFingerprint()
      expect(a.html).toContain('<html')
      expect(a.fingerprint).toHaveLength(12)
      // Estável: mesmo template, mesmo fingerprint — senão o cache nunca acertaria.
      expect(a.fingerprint).toBe(b.fingerprint)
    })

    it('registro no banco VENCE o arquivo, e o fingerprint acompanha', async () => {
      const { db, service } = make()
      withQueryResults(db, [])
      const fabrica = await service.getActiveHtmlWithFingerprint()
      withQueryResults(db, [{ html: '<html>salvo pelo admin</html>' }])
      const salvo = await service.getActiveHtmlWithFingerprint()
      expect(salvo.html).toBe('<html>salvo pelo admin</html>')
      // HTML diferente → fingerprint diferente → o PDF cacheado deixa de ser servido.
      expect(salvo.fingerprint).not.toBe(fabrica.fingerprint)
    })
  })
})
