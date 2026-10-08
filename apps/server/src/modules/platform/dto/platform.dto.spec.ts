/// <reference types="jest" />
import 'reflect-metadata'
import { plainToInstance, type ClassConstructor } from 'class-transformer'
import { getMetadataStorage, validate } from 'class-validator'
import { AddDomainDto, AddTenantAdminDto, ApproveCourseDto, CreateTenantDto, ReviewNoteDto, UpdateTenantDto } from './platform.dto'

// Mesmas opções do ValidationPipe global (configure-app.ts:34). O pipe converte o corpo com `transformOptions` antes de
// validar e valida com o resto: com a conversão implícita, 42 num campo de texto chega como "42". O teste faz igual.
const OPCOES = { whitelist: true, forbidNonWhitelisted: true, transformOptions: { enableImplicitConversion: true } } as const
const { transformOptions: CONVERSAO, ...VALIDACAO } = OPCOES

/** O corpo como o pipe o entrega à validação (e ao controller). */
function recebido<T extends object>(classe: ClassConstructor<T>, corpo: unknown): T {
  return plainToInstance(classe, corpo, CONVERSAO) as T
}

async function camposInvalidos(dto: object): Promise<string[]> {
  return (await validate(dto, VALIDACAO)).map((e) => e.property).sort()
}

const criar = (over: Record<string, unknown> = {}) =>
  recebido(CreateTenantDto, {
    slug: 'polo-novo', name: 'Polo Novo', firstAdminEmail: 'Diretora@Polo-Novo.com.br', firstAdminName: 'Diretora do Polo', ...over,
  })

describe('CreateTenantDto', () => {
  it('aceita o corpo completo, com ou sem marca', async () => {
    expect(await camposInvalidos(criar())).toEqual([])
    expect(await camposInvalidos(criar({ branding: { primaryColor: '#0a7d3b', whatsapp: '5541911112222' } }))).toEqual([])
  })

  it.each(['polo-a', 'abc', 'a-b', 'polo123', '123', 'a'.repeat(40)])('aceita o endereço %s', async (slug) => {
    expect(await camposInvalidos(criar({ slug }))).toEqual([])
  })

  it.each(['ab', 'Polo A', 'Polo', 'polo_a', 'polo a', 'polo.a', 'pólo', '', 'a'.repeat(41)])('recusa o endereço %p e explica em português', async (slug) => {
    const erros = await validate(criar({ slug }), VALIDACAO)
    expect(erros.map((e) => e.property)).toEqual(['slug'])
    expect(Object.values(erros[0].constraints ?? {})).toContain('Endereço do polo: use de 3 a 40 letras minúsculas, números e hífen.')
  })

  it('recusa nome curto demais (1 caractere) ou longo demais', async () => {
    expect(await camposInvalidos(criar({ name: 'X' }))).toEqual(['name'])
    expect(await camposInvalidos(criar({ name: '' }))).toEqual(['name'])
    expect(await camposInvalidos(criar({ name: 'a'.repeat(161) }))).toEqual(['name'])
    expect(await camposInvalidos(criar({ name: 'a'.repeat(160) }))).toEqual([])
  })

  it.each(['', 'sem-arroba', 'a@', '@b.com', 'a b@c.com', 'x@x'])('recusa o e-mail %p do admin', async (firstAdminEmail) => {
    const erros = await validate(criar({ firstAdminEmail }), VALIDACAO)
    expect(erros.map((e) => e.property)).toEqual(['firstAdminEmail'])
    expect(Object.values(erros[0].constraints ?? {})).toContain('E-mail do admin inválido.')
  })

  it('recusa nome do admin curto demais ou ausente', async () => {
    expect(await camposInvalidos(criar({ firstAdminName: 'X' }))).toEqual(['firstAdminName'])
    expect(await camposInvalidos(criar({ firstAdminName: undefined }))).toEqual(['firstAdminName'])
    expect(await camposInvalidos(criar({ firstAdminName: 'a'.repeat(121) }))).toEqual(['firstAdminName'])
  })

  it.each(['azul', ['logoUrl'], 7])('recusa marca que não é objeto: %p', async (branding) => {
    expect(await camposInvalidos(criar({ branding }))).toEqual(['branding'])
  })

  it('marca nula vale como sem marca (o controller entrega {} ao serviço)', async () => {
    expect(await camposInvalidos(criar({ branding: null }))).toEqual([])
  })

  it('recusa campo a mais: não dá para criar a matriz nem escolher o id, o status ou o domínio pelo corpo', async () => {
    expect(await camposInvalidos(criar({ isMatriz: true }))).toEqual(['isMatriz'])
    expect(await camposInvalidos(criar({ id: 'accbdc75-009f-4aa2-9fd3-e92d11f3b06d', status: 'suspended', domains: ['x.com'] }))).toEqual(['domains', 'id', 'status'])
  })
})

describe('UpdateTenantDto', () => {
  const editar = (body: unknown) => recebido(UpdateTenantDto, body)

  it('todos os campos são opcionais', async () => {
    expect(await camposInvalidos(editar({}))).toEqual([])
    expect(await camposInvalidos(editar({ name: 'Polo Novo', status: 'suspended', branding: { heroTitle: 'Olá' } }))).toEqual([])
  })

  it.each(['active', 'suspended'])('aceita o status %s', async (status) => {
    expect(await camposInvalidos(editar({ status }))).toEqual([])
  })

  it.each(['deleted', 'ACTIVE', 'ativo', '', null, 1])('recusa o status %p', async (status) => {
    expect(await camposInvalidos(editar({ status }))).toEqual(['status'])
  })

  it('recusa nome curto demais e marca que não é objeto', async () => {
    expect(await camposInvalidos(editar({ name: 'X' }))).toEqual(['name'])
    expect(await camposInvalidos(editar({ branding: 'azul' }))).toEqual(['branding'])
  })

  // @IsOptional() deixaria o null passar: name null estoura no trim() do serviço e status null viraria NULL numa coluna NOT NULL.
  it('recusa null em nome, status e marca: campo ausente é omitido, não nulo', async () => {
    expect(await camposInvalidos(editar({ name: null }))).toEqual(['name'])
    expect(await camposInvalidos(editar({ branding: null }))).toEqual(['branding'])
    expect(await camposInvalidos(editar({ name: null, status: null, branding: null }))).toEqual(['branding', 'name', 'status'])
  })

  it('recusa campo a mais: o endereço (slug), o id e a condição de matriz não se alteram por aqui', async () => {
    expect(await camposInvalidos(editar({ slug: 'novo-endereco' }))).toEqual(['slug'])
    expect(await camposInvalidos(editar({ isMatriz: true, id: 'x' }))).toEqual(['id', 'isMatriz'])
  })
})

describe('AddTenantAdminDto', () => {
  const admin = (over: Record<string, unknown> = {}) => recebido(AddTenantAdminDto, { email: 'prof@x.com', name: 'Prof', ...over })

  it('aceita e-mail e nome', async () => {
    expect(await camposInvalidos(admin())).toEqual([])
  })

  it('recusa e-mail inválido, nome curto demais e campo a mais', async () => {
    const erros = await validate(admin({ email: 'prof' }), VALIDACAO)
    expect(erros.map((e) => e.property)).toEqual(['email'])
    expect(Object.values(erros[0].constraints ?? {})).toContain('E-mail inválido.')
    expect(await camposInvalidos(admin({ name: 'P' }))).toEqual(['name'])
    expect(await camposInvalidos(admin({ roles: ['admin'] }))).toEqual(['roles'])
  })
})

describe('AddDomainDto', () => {
  const dominio = (host: unknown, over: Record<string, unknown> = {}) => recebido(AddDomainDto, { host, ...over })

  it('aceita de 4 a 253 caracteres', async () => {
    expect(await camposInvalidos(dominio('a.bc'))).toEqual([])
    expect(await camposInvalidos(dominio('Cursos.PoloA.com.br'))).toEqual([])
    expect(await camposInvalidos(dominio('a'.repeat(253)))).toEqual([])
  })

  it('recusa host curto demais, longo demais, ausente ou que não é texto', async () => {
    expect(await camposInvalidos(dominio('a.b'))).toEqual(['host'])
    expect(await camposInvalidos(dominio('a'.repeat(254)))).toEqual(['host'])
    expect(await camposInvalidos(dominio(undefined))).toEqual(['host'])
    expect(await camposInvalidos(dominio(['a.com']))).toEqual(['host'])
  })

  it('recusa campo a mais: o polo vem da rota, nunca do corpo', async () => {
    expect(await camposInvalidos(dominio('cursos.polo.com.br', { tenantId: 'outro' }))).toEqual(['tenantId'])
  })
})

describe('ReviewNoteDto', () => {
  const nota = (over: Record<string, unknown> = { note: 'A aula 1 está sem áudio.' }) => recebido(ReviewNoteDto, over)

  it('aceita o motivo em texto', async () => {
    expect(await camposInvalidos(nota())).toEqual([])
  })

  it('o tamanho do motivo é conferido pelo serviço (400 em português); o DTO só exige texto', async () => {
    expect(await camposInvalidos(nota({ note: '' }))).toEqual([])
    expect(await camposInvalidos(nota({ note: 'a'.repeat(5000) }))).toEqual([])
  })

  it('recusa corpo sem o motivo, motivo nulo ou lista', async () => {
    expect(await camposInvalidos(nota({}))).toEqual(['note'])
    expect(await camposInvalidos(nota({ note: null }))).toEqual(['note'])
    expect(await camposInvalidos(nota({ note: ['a', 'b'] }))).toEqual(['note'])
  })

  it('número e objeto chegam como texto: a conversão implícita do pipe roda antes da validação', async () => {
    // Na API real (configure-app.ts:34) o class-transformer converte o valor para o tipo do campo antes do
    // class-validator: 12345 vira "12345" e um objeto vira "[object Object]". O DTO aceita; quem confere o tamanho do
    // motivo é o serviço.
    expect(await camposInvalidos(nota({ note: 12345 }))).toEqual([])
    expect(nota({ note: 12345 }).note).toBe('12345')
    expect(nota({ note: { texto: 'x' } }).note).toBe('[object Object]')
  })

  it('recusa campo a mais: o curso vem da rota e o status é decidido pela rota, nunca pelo corpo', async () => {
    expect(await camposInvalidos(nota({ note: 'Direitos autorais.', status: 'published' }))).toEqual(['status'])
    expect(await camposInvalidos(nota({ note: 'Direitos autorais.', tenantId: 'outro' }))).toEqual(['tenantId'])
  })
})

describe('ApproveCourseDto', () => {
  const aprovar = (corpo: unknown) => recebido(ApproveCourseDto, corpo)

  it('aceita o fingerprint que a fila mostrou', async () => {
    expect(await camposInvalidos(aprovar({ fingerprint: '0123456789abcdef' }))).toEqual([])
  })

  it('recusa corpo sem o fingerprint, vazio, nulo ou lista', async () => {
    for (const corpo of [{}, { fingerprint: '' }, { fingerprint: null }, { fingerprint: ['a'] }]) {
      expect(await camposInvalidos(aprovar(corpo))).toEqual(['fingerprint'])
    }
  })

  it('recusa campo a mais: o curso vem da rota e a aprovação não escolhe status nem carga', async () => {
    expect(await camposInvalidos(aprovar({ fingerprint: 'abc', status: 'published' }))).toEqual(['status'])
    expect(await camposInvalidos(aprovar({ fingerprint: 'abc', workloadHours: 10 }))).toEqual(['workloadHours'])
  })
})

describe('nome do admin: validado depois de aparado', () => {
  const NOME_INVALIDO = 'Informe o nome do admin (2 a 120 caracteres).'
  const casos = [
    { rotulo: 'CreateTenantDto.firstAdminName', campo: 'firstAdminName', montar: (nome: unknown) => criar({ firstAdminName: nome }) },
    { rotulo: 'AddTenantAdminDto.name', campo: 'name', montar: (nome: unknown) => recebido(AddTenantAdminDto, { email: 'prof@x.com', name: nome }) },
  ] as const

  describe.each(casos)('$rotulo', ({ campo, montar }) => {
    it.each(['', ' ', '   ', '\t\n', ' A ', '  x  ', 'a'.repeat(121), `  ${'a'.repeat(121)}  `])('recusa %p com a mensagem em português', async (nome) => {
      const erros = await validate(montar(nome), VALIDACAO)
      expect(erros.map((e) => e.property)).toEqual([campo])
      expect(Object.values(erros[0].constraints ?? {})).toEqual([NOME_INVALIDO])
    })

    it.each(['Jo', '  Jo  ', ' Maria da Silva ', 'a'.repeat(120), `  ${'a'.repeat(120)}  `])('aceita %p', async (nome) => {
      expect(await camposInvalidos(montar(nome))).toEqual([])
    })

    it('entrega o nome já aparado ao controller', () => {
      expect((montar('  Maria da Silva \n') as unknown as Record<string, string>)[campo]).toBe('Maria da Silva')
    })

    it('sem nome ou com nome nulo, as duas mensagens em português aparecem', async () => {
      for (const nome of [undefined, null]) {
        const erros = await validate(montar(nome), VALIDACAO)
        expect(erros.map((e) => e.property)).toEqual([campo])
        expect(Object.values(erros[0].constraints ?? {}).sort()).toEqual([NOME_INVALIDO, 'Informe o nome do admin.'].sort())
      }
    })

    it('número chega como texto (conversão implícita do pipe): 42 vale como o nome "42", e 7 recusa pelo tamanho', async () => {
      expect(await camposInvalidos(montar(42))).toEqual([])
      expect((montar(42) as unknown as Record<string, string>)[campo]).toBe('42')
      const erros = await validate(montar(7), VALIDACAO)
      expect(erros.map((e) => e.property)).toEqual([campo])
      expect(Object.values(erros[0].constraints ?? {})).toEqual([NOME_INVALIDO])
    })
  })
})

describe('mensagens em português: nenhum texto padrão do class-validator chega ao console', () => {
  const DTOS = [CreateTenantDto, UpdateTenantDto, AddTenantAdminDto, AddDomainDto, ReviewNoteDto, ApproveCourseDto]

  // Guarda estrutural: a regra nova que alguém acrescentar sem `message` quebra aqui, em vez de vazar "slug must be a string".
  it.each(DTOS.map((dto) => [dto.name, dto] as const))('toda regra de %s declara a própria mensagem', (_nome, dto) => {
    const regras = getMetadataStorage().getTargetValidationMetadatas(dto, '', true, false).filter((m) => m.type === 'customValidation')
    expect(regras.length).toBeGreaterThan(0)
    const semMensagem = regras.filter((m) => typeof m.message !== 'string' || m.message.trim() === '').map((m) => m.propertyName)
    expect(semMensagem).toEqual([])
  })

  const mensagens = async (dto: object): Promise<Record<string, string[]>> =>
    Object.fromEntries((await validate(dto, VALIDACAO)).map((e) => [e.property, Object.values(e.constraints ?? {}).sort()]))
  const ordenar = (...textos: string[]) => textos.sort()

  it('CreateTenantDto: corpo vazio', async () => {
    expect(await mensagens(recebido(CreateTenantDto, {}))).toEqual({
      slug: ordenar('Informe o endereço do polo.', 'Endereço do polo: use de 3 a 40 letras minúsculas, números e hífen.'),
      name: ordenar('Informe o nome do polo.', 'Informe o nome do polo (2 a 160 caracteres).'),
      firstAdminEmail: ['E-mail do admin inválido.'],
      firstAdminName: ordenar('Informe o nome do admin.', 'Informe o nome do admin (2 a 120 caracteres).'),
    })
  })

  it('CreateTenantDto: marca que não é objeto', async () => {
    expect(await mensagens(criar({ branding: 'azul' }))).toEqual({ branding: ['Marca do polo inválida.'] })
  })

  it('UpdateTenantDto: valores inválidos', async () => {
    // name: 5 chega como "5" (conversão implícita do pipe): é texto, só curto demais.
    expect(await mensagens(recebido(UpdateTenantDto, { name: 5, status: 'apagado', branding: 'azul' }))).toEqual({
      name: ['Informe o nome do polo (2 a 160 caracteres).'],
      status: ['Situação do polo inválida: use "active" ou "suspended".'],
      branding: ['Marca do polo inválida.'],
    })
    expect(await mensagens(recebido(UpdateTenantDto, { name: null }))).toEqual({
      name: ordenar('Informe o nome do polo.', 'Informe o nome do polo (2 a 160 caracteres).'),
    })
  })

  it('ApproveCourseDto: sem o fingerprint', async () => {
    const RECARREGUE = 'Recarregue a fila de aprovação e confira o curso antes de aprovar.'
    expect(await mensagens(recebido(ApproveCourseDto, {}))).toEqual({ fingerprint: [RECARREGUE, RECARREGUE] })
    expect(await mensagens(recebido(ApproveCourseDto, { fingerprint: '' }))).toEqual({ fingerprint: [RECARREGUE] })
  })

  it('AddTenantAdminDto: corpo vazio', async () => {
    expect(await mensagens(recebido(AddTenantAdminDto, {}))).toEqual({
      email: ['E-mail inválido.'],
      name: ordenar('Informe o nome do admin.', 'Informe o nome do admin (2 a 120 caracteres).'),
    })
  })

  it('AddDomainDto: corpo vazio e domínio curto demais', async () => {
    expect(await mensagens(recebido(AddDomainDto, {}))).toEqual({
      host: ordenar('Informe o domínio.', 'Informe o domínio (4 a 253 caracteres).'),
    })
    expect(await mensagens(recebido(AddDomainDto, { host: 'a.b' }))).toEqual({ host: ['Informe o domínio (4 a 253 caracteres).'] })
  })

  it('ReviewNoteDto: sem o motivo', async () => {
    expect(await mensagens(recebido(ReviewNoteDto, {}))).toEqual({ note: ['Escreva o motivo (3 a 1000 caracteres).'] })
  })
})
