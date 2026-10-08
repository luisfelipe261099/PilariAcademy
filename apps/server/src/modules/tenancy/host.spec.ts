import {
  hostConfigFromEnv, isMatrizFallbackHost, isReservedHost, isValidTenantSlug, normalizeHost, slugFromHost, type HostConfig,
} from './host'

const PROD: HostConfig = { baseDomain: 'cursos.studiopilari.com.br', devSuffixes: ['localhost', 'test'], isProd: true }
const DEV: HostConfig = { ...PROD, isProd: false }

describe('normalizeHost', () => {
  it.each([
    ['Polo-A.Cursos.StudioPilari.com.br', 'polo-a.cursos.studiopilari.com.br'],
    ['polo-a.cursos.studiopilari.com.br:443', 'polo-a.cursos.studiopilari.com.br'],
    ['Polo-A.Cursos.StudioPilari.com.br.:443', 'polo-a.cursos.studiopilari.com.br'],
    ['localhost:5173', 'localhost'],
    ['[::1]:3000', '[::1]'],
  ])('%s vira %s', (raw, esperado) => {
    expect(normalizeHost(raw)).toBe(esperado)
  })

  it.each([undefined, null, '', '   ', 'a..b', 'com espaço', 'x/y', 'a:b:c', '[::1', '.run.app', '.example.com'])(
    'rejeita %p',
    (raw) => {
      expect(normalizeHost(raw as string | null | undefined)).toBeNull()
    }
  )
})

describe('slugFromHost', () => {
  it('lê o slug do subdomínio da plataforma', () => {
    expect(slugFromHost('polo-a.cursos.studiopilari.com.br', PROD)).toBe('polo-a')
  })
  it('não aceita dois rótulos antes do domínio base', () => {
    expect(slugFromHost('a.b.cursos.studiopilari.com.br', PROD)).toBeNull()
  })
  it('o domínio base sozinho não é slug', () => {
    expect(slugFromHost('cursos.studiopilari.com.br', PROD)).toBeNull()
  })
  it('sufixos de dev só valem fora de produção', () => {
    expect(slugFromHost('polo-a.localhost', PROD)).toBeNull()
    expect(slugFromHost('polo-a.localhost', DEV)).toBe('polo-a')
    expect(slugFromHost('polo-a.test', DEV)).toBe('polo-a')
  })
  it('domínio alheio não é slug', () => {
    expect(slugFromHost('polo-a.evil.com', DEV)).toBeNull()
  })
})

describe('isMatrizFallbackHost', () => {
  it('URL padrão do Cloud Run cai na matriz', () => {
    expect(isMatrizFallbackHost('pilari-academy-abc123xyz-uc.a.run.app', PROD)).toBe(true)
  })
  it('localhost cai na matriz só fora de produção', () => {
    expect(isMatrizFallbackHost('localhost', DEV)).toBe(true)
    expect(isMatrizFallbackHost('127.0.0.1', DEV)).toBe(true)
    expect(isMatrizFallbackHost('localhost', PROD)).toBe(false)
  })
  it('host desconhecido nunca cai na matriz', () => {
    expect(isMatrizFallbackHost('evil.com', DEV)).toBe(false)
  })
  it('rótulo vazio antes de .run.app nunca cai na matriz', () => {
    expect(isMatrizFallbackHost('.run.app', PROD)).toBe(false)
    expect(isMatrizFallbackHost('pilari-academy-abc-uc.a.run.app', PROD)).toBe(true)
  })
})

describe('isReservedHost', () => {
  it.each([
    '127.0.0.1', '0.0.0.0', '192.168.0.10', '8.8.8.8', '10.1',
    '[::1]', '[2001:db8::1]',
    'pilari-academy-abc-uc.a.run.app', 'x.run.app', 'run.app',
    'localhost', 'x.localhost', 'a.b.localhost',
    'test', 'polo.test', 'a.b.test',
  ])('reserva %s', (host) => {
    expect(isReservedHost(host, PROD)).toBe(true)
    expect(isReservedHost(host, DEV)).toBe(true)
  })

  it.each([
    'cursos.poloa.com.br', 'poloa.com', 'latest.com', 'localhost.com.br', 'meu.testes.org', 'app.run.app.br',
    'xrun.app', '1.2.3.com', 'polo-a.cursos.studiopilari.com.br',
  ])('não reserva %s', (host) => {
    expect(isReservedHost(host, PROD)).toBe(false)
    expect(isReservedHost(host, DEV)).toBe(false)
  })

  it('os sufixos de dev configurados são reservados fora de produção; em produção não valem nada', () => {
    const cfg: HostConfig = { baseDomain: 'cursos.studiopilari.com.br', devSuffixes: ['local', 'dev'], isProd: false }
    expect(isReservedHost('x.local', cfg)).toBe(true)
    expect(isReservedHost('minha-escola.dev', cfg)).toBe(true)
    expect(isReservedHost('minha-escola.dev', { ...cfg, isProd: true })).toBe(false)
    // localhost e test são nomes reservados pela IETF: seguem recusados mesmo se a configuração os omitir.
    expect(isReservedHost('x.localhost', cfg)).toBe(true)
    expect(isReservedHost('x.test', { ...cfg, isProd: true })).toBe(true)
  })
})

describe('isValidTenantSlug', () => {
  it.each(['polo-a', 'polo123', 'abc'])('aceita %s', (s) => expect(isValidTenantSlug(s)).toBe(true))
  it.each(['ab', 'Polo', '-polo', 'polo-', 'a--b', 'cursos', 'www', 'x'.repeat(41), 'polo_a'])('recusa %s', (s) =>
    expect(isValidTenantSlug(s)).toBe(false)
  )
})

describe('hostConfigFromEnv', () => {
  it('usa os padrões', () => {
    expect(hostConfigFromEnv({})).toEqual({ baseDomain: 'cursos.studiopilari.com.br', devSuffixes: ['localhost', 'test'], isProd: false })
  })
  it('lê as variáveis', () => {
    expect(hostConfigFromEnv({ TENANT_BASE_DOMAIN: 'Cursos.Exemplo.com', TENANT_DEV_SUFFIXES: ' local , dev ', NODE_ENV: 'production' })).toEqual({
      baseDomain: 'cursos.exemplo.com',
      devSuffixes: ['local', 'dev'],
      isProd: true,
    })
  })
})
