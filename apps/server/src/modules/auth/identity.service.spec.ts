/// <reference types="jest" />
import { BadRequestException, ConflictException, InternalServerErrorException, Logger } from '@nestjs/common'

// O Admin SDK nunca é chamado de verdade: o `getAuth()` devolve este dublê, lido só na hora da
// chamada (por isso a fábrica não referencia as funções antes de elas existirem).
const mockAuth = { getUserByEmail: jest.fn(), createUser: jest.fn(), setCustomUserClaims: jest.fn(), getUser: jest.fn() }
jest.mock('firebase-admin/auth', () => ({ getAuth: () => mockAuth }))

import { IdentityService } from './identity.service'

function make(key?: string) {
  const config = { get: jest.fn(() => key) }
  return new IdentityService(config as never)
}

/** Erro do Admin SDK: um Error com `code`, como o Firebase devolve. */
const firebaseError = (code: string) => Object.assign(new Error(code), { code })

describe('IdentityService.sendPasswordResetEmail', () => {
  afterEach(() => jest.restoreAllMocks())

  it('pede ao Firebase o e-mail de reset (sendOobCode + PASSWORD_RESET) com a web API key', async () => {
    const fetchMock = jest.fn(async () => ({ ok: true, json: async () => ({}) }))
    global.fetch = fetchMock as never
    await make('k1').sendPasswordResetEmail('a@x.com')
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('accounts:sendOobCode')
    expect(url).toContain('key=k1')
    expect(JSON.parse(init.body as string)).toEqual({ requestType: 'PASSWORD_RESET', email: 'a@x.com' })
  })

  it('sem FIREBASE_WEB_API_KEY → 500 sem tocar a rede', async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    const fetchMock = jest.fn()
    global.fetch = fetchMock as never
    await expect(make(undefined).sendPasswordResetEmail('a@x.com')).rejects.toBeInstanceOf(InternalServerErrorException)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('erro do Firebase → 400 e log só com o código, sem o e-mail (PII)', async () => {
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    global.fetch = jest.fn(async () => ({ ok: false, status: 400, json: async () => ({ error: { message: 'EMAIL_NOT_FOUND' } }) })) as never
    await expect(make('k1').sendPasswordResetEmail('a@x.com')).rejects.toBeInstanceOf(BadRequestException)
    const logged = String(errorSpy.mock.calls[0][0])
    expect(logged).toContain('EMAIL_NOT_FOUND')
    expect(logged).not.toContain('a@x.com')
  })
})

describe('IdentityService.findUidByEmail', () => {
  beforeEach(() => {
    mockAuth.getUserByEmail.mockReset()
  })

  it('devolve o uid quando o Firebase acha a conta', async () => {
    mockAuth.getUserByEmail.mockResolvedValue({ uid: 'uid-1', email: 'a@x.com' })
    await expect(make().findUidByEmail('a@x.com')).resolves.toBe('uid-1')
    expect(mockAuth.getUserByEmail).toHaveBeenCalledWith('a@x.com')
  })

  it('devolve null quando não existe conta com o e-mail (auth/user-not-found)', async () => {
    mockAuth.getUserByEmail.mockRejectedValue(firebaseError('auth/user-not-found'))
    await expect(make().findUidByEmail('a@x.com')).resolves.toBeNull()
  })

  it('repassa qualquer outro erro do Firebase, sem confundir indisponibilidade com "não existe"', async () => {
    const erro = firebaseError('auth/internal-error')
    mockAuth.getUserByEmail.mockRejectedValue(erro)
    await expect(make().findUidByEmail('a@x.com')).rejects.toBe(erro)
  })

  it('e-mail malformado vira 400 em português, como no restante do serviço', async () => {
    mockAuth.getUserByEmail.mockRejectedValue(firebaseError('auth/invalid-email'))
    await expect(make().findUidByEmail('não-é-email')).rejects.toBeInstanceOf(BadRequestException)
  })
})

describe('IdentityService.createIdentity', () => {
  beforeEach(() => {
    mockAuth.createUser.mockReset()
    mockAuth.setCustomUserClaims.mockReset()
  })

  it('cria a conta com e-mail verificado e devolve o uid', async () => {
    mockAuth.createUser.mockResolvedValue({ uid: 'uid-novo' })
    await expect(make().createIdentity('a@x.com', 'Ana Souza', 'segredo123')).resolves.toBe('uid-novo')
    expect(mockAuth.createUser).toHaveBeenCalledWith({ email: 'a@x.com', displayName: 'Ana Souza', password: 'segredo123', emailVerified: true })
  })

  it('NÃO grava custom claims: papéis valem por polo e moram no banco', async () => {
    mockAuth.createUser.mockResolvedValue({ uid: 'uid-novo' })
    await make().createIdentity('a@x.com', 'Ana Souza', 'segredo123')
    expect(mockAuth.setCustomUserClaims).not.toHaveBeenCalled()
  })

  it('e-mail que já tem conta → 409 em português', async () => {
    mockAuth.createUser.mockRejectedValue(firebaseError('auth/email-already-exists'))
    await expect(make().createIdentity('a@x.com', 'Ana Souza', 'segredo123')).rejects.toBeInstanceOf(ConflictException)
  })

  it('senha fraca → 400', async () => {
    mockAuth.createUser.mockRejectedValue(firebaseError('auth/invalid-password'))
    await expect(make().createIdentity('a@x.com', 'Ana Souza', '123')).rejects.toBeInstanceOf(BadRequestException)
  })

  it('setCustomClaims deixou de existir (nada mais espelha papéis no token)', () => {
    expect('setCustomClaims' in make()).toBe(false)
  })
})

describe('IdentityService.hasSignedIn (B11: conta que nunca entrou)', () => {
  beforeEach(() => {
    mockAuth.getUser.mockReset()
  })

  it('com último login no Firebase, já entrou', async () => {
    mockAuth.getUser.mockResolvedValue({ uid: 'u1', metadata: { creationTime: 'Mon, 01 Sep 2026 10:00:00 GMT', lastSignInTime: 'Tue, 02 Sep 2026 10:00:00 GMT' } })
    await expect(make().hasSignedIn('u1')).resolves.toBe(true)
    expect(mockAuth.getUser).toHaveBeenCalledWith('u1')
  })

  it('sem último login (null ou ausente), nunca entrou', async () => {
    mockAuth.getUser.mockResolvedValueOnce({ uid: 'u1', metadata: { creationTime: 'Mon, 01 Sep 2026 10:00:00 GMT', lastSignInTime: null } })
    await expect(make().hasSignedIn('u1')).resolves.toBe(false)
    mockAuth.getUser.mockResolvedValueOnce({ uid: 'u1', metadata: {} })
    await expect(make().hasSignedIn('u1')).resolves.toBe(false)
  })

  it('erro do Firebase sobe (quem chama decide o que fazer na dúvida)', async () => {
    const erro = firebaseError('auth/internal-error')
    mockAuth.getUser.mockRejectedValue(erro)
    await expect(make().hasSignedIn('u1')).rejects.toBe(erro)
  })
})
