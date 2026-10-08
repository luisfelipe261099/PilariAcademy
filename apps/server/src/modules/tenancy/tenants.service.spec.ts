import { BadRequestException, ConflictException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createDrizzleMock, withQueryResults, type DrizzleMock } from '../../__test-utils__/drizzle-mock'
import { allWheres } from '../../__test-utils__/sql'
import { HOST_CACHE_CAP, TenantsService } from './tenants.service'
import { EMPTY_BRANDING } from './branding'
import { MATRIZ_TENANT_ID } from './tenancy.constants'

const row = (over: Record<string, unknown> = {}) => ({
  id: 't-a', slug: 'polo-a', name: 'Polo A', status: 'active', isMatriz: false,
  branding: EMPTY_BRANDING, createdAt: new Date(), updatedAt: new Date(1000), ...over,
})

function make(env: Record<string, string> = {}): { svc: TenantsService; db: DrizzleMock } {
  const db = createDrizzleMock()
  const config = { get: (k: string) => env[k] } as unknown as ConfigService
  return { svc: new TenantsService(db as never, config), db }
}

describe('TenantsService.resolveHost', () => {
  it('acha pelo domínio cadastrado, normalizando o header', async () => {
    const { svc, db } = make()
    withQueryResults(db, [{ t: row() }])
    const t = await svc.resolveHost('Polo-A.Cursos.StudioPilari.com.br.:443')
    expect(t?.id).toBe('t-a')
    expect(allWheres(db.where)[0].params).toEqual(['polo-a.cursos.studiopilari.com.br'])
  })

  it('cai no slug do subdomínio quando o domínio não está cadastrado', async () => {
    const { svc, db } = make()
    withQueryResults(db, [], [row()])
    expect((await svc.resolveHost('polo-a.cursos.studiopilari.com.br'))?.slug).toBe('polo-a')
    expect(allWheres(db.where)[1].params).toEqual(['polo-a'])
  })

  it('URL do Cloud Run resolve a matriz', async () => {
    const { svc, db } = make()
    withQueryResults(db, [], [row({ id: MATRIZ_TENANT_ID, slug: 'pilari', isMatriz: true })])
    expect((await svc.resolveHost('pilari-academy-abc-uc.a.run.app'))?.isMatriz).toBe(true)
  })

  it('host desconhecido devolve null e fica em cache negativo por 10 s', async () => {
    const { svc, db } = make()
    withQueryResults(db, [])
    expect(await svc.resolveHost('evil.com', 0)).toBeNull()
    expect(await svc.resolveHost('evil.com', 5_000)).toBeNull()
    expect(db.select).toHaveBeenCalledTimes(1)
  })

  it('cache negativo expira: passado o TTL a entrada velha não é servida, busca de novo', async () => {
    const { svc, db } = make()
    withQueryResults(db, [])
    expect(await svc.resolveHost('evil.com', 0)).toBeNull()
    expect(db.select).toHaveBeenCalledTimes(1)
    // 10_001: passou do TTL de 10 s do cache negativo. Se a entrada expirada fosse servida,
    // db.select não seria chamado de novo.
    withQueryResults(db, [])
    expect(await svc.resolveHost('evil.com', 10_001)).toBeNull()
    expect(db.select).toHaveBeenCalledTimes(2)
  })

  it('host conhecido fica em cache por 60 s', async () => {
    const { svc, db } = make()
    withQueryResults(db, [{ t: row() }], [{ t: row({ name: 'Polo A renomeado' }) }])
    await svc.resolveHost('polo-a.cursos.studiopilari.com.br', 0)
    expect((await svc.resolveHost('polo-a.cursos.studiopilari.com.br', 59_000))?.name).toBe('Polo A')
    expect((await svc.resolveHost('polo-a.cursos.studiopilari.com.br', 61_000))?.name).toBe('Polo A renomeado')
  })

  it('invalidateCache força nova leitura', async () => {
    const { svc, db } = make()
    withQueryResults(db, [{ t: row() }], [{ t: row({ name: 'Novo' }) }])
    await svc.resolveHost('polo-a.cursos.studiopilari.com.br', 0)
    svc.invalidateCache()
    expect((await svc.resolveHost('polo-a.cursos.studiopilari.com.br', 1))?.name).toBe('Novo')
  })
})

describe('TenantsService cache de host: limite de tamanho', () => {
  it('nunca deixa o mapa crescer além de HOST_CACHE_CAP', async () => {
    const { svc, db } = make()
    const cache = (svc as unknown as { cache: Map<string, { value: unknown; expires: number }> }).cache
    // Pré-popula o Map direto (sem 10 mil round-trips pelo mock — ficaria lento à toa) simulando
    // o efeito de uma varredura de hosts aleatórios. `expires` no futuro: nenhuma entrada está
    // expirada, então só o TETO de tamanho (não o expurgo de expiradas) pode forçar o descarte
    // das mais antigas — prova o item (2) do achado isolado do item (1).
    for (let i = 0; i < HOST_CACHE_CAP + 25; i++) {
      cache.set(`desconhecido-${i}.evil.com`, { value: null, expires: 999_999 })
    }
    expect(cache.size).toBe(HOST_CACHE_CAP + 25)
    withQueryResults(db, [])
    await svc.resolveHost('mais-um.evil.com', 0)
    expect(cache.size).toBeGreaterThan(0)
    expect(cache.size).toBeLessThanOrEqual(HOST_CACHE_CAP)
  })
})

describe('TenantsService.create', () => {
  it('recusa slug reservado ou fora do padrão', async () => {
    const { svc } = make()
    await expect(svc.create({ slug: 'cursos', name: 'Polo', branding: {} })).rejects.toThrow(BadRequestException)
    await expect(svc.create({ slug: 'Polo A', name: 'Polo', branding: {} })).rejects.toThrow(BadRequestException)
  })

  it('recusa slug já usado', async () => {
    const { svc, db } = make()
    withQueryResults(db, [row()])
    await expect(svc.create({ slug: 'polo-a', name: 'Polo A', branding: {} })).rejects.toThrow(ConflictException)
  })

  it('cria o polo e o domínio primário <slug>.<base>', async () => {
    const { svc, db } = make()
    withQueryResults(db, [], undefined, undefined, [row({ slug: 'polo-novo', name: 'Polo Novo' })])
    const t = await svc.create({ slug: 'polo-novo', name: 'Polo Novo', branding: { primaryColor: '#112233' } })
    expect(t.slug).toBe('polo-novo')
    const valores = db.values.mock.calls.map((c: unknown[]) => c[0]) as Array<Record<string, unknown>>
    expect(valores[0]).toMatchObject({ slug: 'polo-novo', name: 'Polo Novo', isMatriz: false, status: 'active' })
    expect((valores[0].branding as { primaryColor: string }).primaryColor).toBe('#112233')
    expect(valores[1]).toMatchObject({ host: 'polo-novo.cursos.studiopilari.com.br', isPrimary: true })
    // Polo e domínio primário entram juntos ou nenhum dos dois entra.
    expect(db.transaction).toHaveBeenCalledTimes(1)
  })
})

describe('TenantsService.create: duplicata do banco', () => {
  const dup = () => Object.assign(new Error('Duplicate entry'), { code: 'ER_DUP_ENTRY', errno: 1062 })
  const novo = { slug: 'polo-novo', name: 'Polo Novo', branding: {} }

  it('criação concorrente: o pré-check não viu o slug e o insert do polo bate na unique, responde 409 e não 500', async () => {
    const { svc, db } = make()
    withQueryResults(db, [])
    db.values.mockImplementationOnce(() => {
      throw dup()
    })
    const erro = await svc.create(novo).catch((e: unknown) => e)
    expect(erro).toBeInstanceOf(ConflictException)
    expect((erro as ConflictException).message).toBe('Já existe um polo com este endereço.')
  })

  it('o domínio primário já cadastrado também responde 409, e o insert do domínio roda na mesma transação do polo', async () => {
    const { svc, db } = make()
    withQueryResults(db, [])
    db.values.mockImplementationOnce(() => ({})).mockImplementationOnce(() => {
      throw dup()
    })
    const erro = await svc.create(novo).catch((e: unknown) => e)
    expect(erro).toBeInstanceOf(ConflictException)
    expect((erro as ConflictException).message).toBe('Já existe um polo com este endereço.')
    expect(db.values).toHaveBeenCalledTimes(2)
    expect(db.transaction).toHaveBeenCalledTimes(1)
  })

  it('reconhece a duplicata embrulhada em DrizzleQueryError (o erro do MySQL vem em `cause`)', async () => {
    const { svc, db } = make()
    withQueryResults(db, [])
    db.values.mockImplementationOnce(() => {
      throw Object.assign(new Error('Failed query: insert into `tenants`'), { cause: dup() })
    })
    await expect(svc.create(novo)).rejects.toThrow(ConflictException)
  })

  it('erro de banco que não é duplicata sobe como está', async () => {
    const { svc, db } = make()
    withQueryResults(db, [])
    db.values.mockImplementationOnce(() => {
      throw Object.assign(new Error('conexão perdida'), { code: 'PROTOCOL_CONNECTION_LOST' })
    })
    const erro = await svc.create(novo).catch((e: unknown) => e)
    expect(erro).not.toBeInstanceOf(ConflictException)
    expect((erro as Error).message).toBe('conexão perdida')
  })
})

describe('TenantsService domínios', () => {
  it('recusa domínio sob o domínio base (reservado aos slugs)', async () => {
    const { svc } = make()
    await expect(svc.addDomain('t-a', 'x.cursos.studiopilari.com.br')).rejects.toThrow(BadRequestException)
  })

  // Hosts que a resolução do polo trata de forma especial. Cadastrar a URL padrão do Cloud Run, por exemplo,
  // tiraria a matriz do fallback e a entregaria a um polo; um IP ou um nome de dev tomaria o lugar do fallback local.
  it.each([
    '127.0.0.1', '192.168.0.10', '10.1',
    '[::1]', '[2001:db8::1]:443', '::1',
    'pilari-academy-abc-uc.a.run.app', 'x.run.app', 'run.app', 'PILARI-ACADEMY-ABC-UC.A.RUN.APP.:443',
    'localhost', 'x.localhost', 'a.b.localhost',
    'polo.test', 'a.b.test',
  ])('recusa %s com "Domínio inválido." e não grava nada', async (host) => {
    const { svc, db } = make()
    const erro = await svc.addDomain('t-a', host).catch((e: unknown) => e)
    expect(erro).toBeInstanceOf(BadRequestException)
    expect((erro as BadRequestException).message).toBe('Domínio inválido.')
    expect(db.select).not.toHaveBeenCalled()
    expect(db.insert).not.toHaveBeenCalled()
  })

  it.each([
    ['cursos.poloa.com.br', 'cursos.poloa.com.br'],
    ['Cursos.PoloA.com.br.:443', 'cursos.poloa.com.br'],
    ['latest.com', 'latest.com'],
    ['localhost.com.br', 'localhost.com.br'],
    ['xrun.app', 'xrun.app'],
    ['1.2.3.com', '1.2.3.com'],
  ])('aceita %s e grava %s', async (entrada, gravado) => {
    const { svc, db } = make()
    withQueryResults(db, [])
    await svc.addDomain('t-a', entrada)
    expect(db.values).toHaveBeenCalledWith(expect.objectContaining({ host: gravado, tenantId: 't-a', isPrimary: false }))
  })

  it('os sufixos de dev configurados também são recusados fora de produção', async () => {
    const { svc, db } = make({ TENANT_DEV_SUFFIXES: 'local,dev', NODE_ENV: 'development' })
    await expect(svc.addDomain('t-a', 'minha-escola.dev')).rejects.toThrow('Domínio inválido.')
    expect(db.insert).not.toHaveBeenCalled()
  })

  it('recusa domínio já usado', async () => {
    const { svc, db } = make()
    withQueryResults(db, [{ host: 'cursos.polo.com.br', tenantId: 't-b' }])
    await expect(svc.addDomain('t-a', 'Cursos.Polo.com.br')).rejects.toThrow(ConflictException)
  })

  describe('duplicata do banco', () => {
    const dup = () => Object.assign(new Error('Duplicate entry'), { code: 'ER_DUP_ENTRY', errno: 1062 })

    it('cadastro simultâneo do mesmo domínio: o pré-check não viu, o insert bate na chave primária e responde 409, não 500', async () => {
      const { svc, db } = make()
      withQueryResults(db, [])
      db.values.mockImplementationOnce(() => {
        throw dup()
      })
      const erro = await svc.addDomain('t-a', 'cursos.polo.com.br').catch((e: unknown) => e)
      expect(erro).toBeInstanceOf(ConflictException)
      expect((erro as ConflictException).message).toBe('Este domínio já está em uso.')
    })

    it('reconhece a duplicata embrulhada em DrizzleQueryError (o erro do MySQL vem em `cause`)', async () => {
      const { svc, db } = make()
      withQueryResults(db, [])
      db.values.mockImplementationOnce(() => {
        throw Object.assign(new Error('Failed query: insert into `tenant_domains`'), { cause: dup() })
      })
      await expect(svc.addDomain('t-a', 'cursos.polo.com.br')).rejects.toThrow(ConflictException)
    })

    it('erro de banco que não é duplicata sobe como está', async () => {
      const { svc, db } = make()
      withQueryResults(db, [])
      db.values.mockImplementationOnce(() => {
        throw Object.assign(new Error('conexão perdida'), { code: 'PROTOCOL_CONNECTION_LOST' })
      })
      const erro = await svc.addDomain('t-a', 'cursos.polo.com.br').catch((e: unknown) => e)
      expect(erro).not.toBeInstanceOf(ConflictException)
      expect((erro as Error).message).toBe('conexão perdida')
    })
  })
  it('não remove o domínio primário', async () => {
    const { svc, db } = make()
    withQueryResults(db, [{ host: 'polo-a.cursos.studiopilari.com.br', tenantId: 't-a', isPrimary: true }])
    await expect(svc.removeDomain('t-a', 'polo-a.cursos.studiopilari.com.br')).rejects.toThrow(BadRequestException)
  })
})

describe('TenantsService.update: polo inexistente (B9)', () => {
  it('responde 404 com code TENANT_NOT_FOUND, sem gravar nada', async () => {
    const { svc, db } = make()
    withQueryResults(db, [])
    await expect(svc.update('nao-existe', { name: 'Fantasma' })).rejects.toMatchObject({
      response: { statusCode: 404, code: 'TENANT_NOT_FOUND', message: 'Polo não encontrado.' },
    })
    expect(db.update).not.toHaveBeenCalled()
  })
})
