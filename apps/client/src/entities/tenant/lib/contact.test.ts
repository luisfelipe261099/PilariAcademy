import { describe, expect, it } from 'vitest'
import { enrollChannels, enrollContact, mailtoHref, mapsHref, phoneContact, telHref, whatsappHref } from './contact'

describe('whatsappHref', () => {
  it('monta o wa.me só com dígitos e com a mensagem', () => {
    expect(whatsappHref('+55 (41) 99710-2441')).toBe('https://wa.me/5541997102441')
    expect(whatsappHref('5541997102441', 'Olá! Quero me matricular.')).toBe('https://wa.me/5541997102441?text=Ol%C3%A1!%20Quero%20me%20matricular.')
  })
  it('sem número válido devolve null (o botão some)', () => {
    expect(whatsappHref(null)).toBeNull()
    expect(whatsappHref('123')).toBeNull()
  })
})

describe('telHref', () => {
  it('número brasileiro ganha +55', () => {
    expect(telHref('(41) 99710-2441')).toBe('tel:+5541997102441')
    expect(telHref('5541997102441')).toBe('tel:+5541997102441')
    expect(telHref('(41) 3333-4444')).toBe('tel:+554133334444')
    expect(telHref('')).toBeNull()
  })
  it('com + o número já traz o país: não ganha +55', () => {
    expect(telHref('+55 (41) 99710-2441')).toBe('tel:+5541997102441')
    expect(telHref('+351 912 345 678')).toBe('tel:+351912345678')
  })
  it('descarta o zero do tronco antes do DDD', () => {
    expect(telHref('041 99710-2441')).toBe('tel:+5541997102441')
    expect(telHref('(041) 3333-4444')).toBe('tel:+554133334444')
    expect(telHref('0 41 3333-4444')).toBe('tel:+554133334444')
  })
  it('0800 e afins não ganham +55 nem perdem o zero', () => {
    expect(telHref('0800 123 4567')).toBe('tel:08001234567')
    expect(telHref('0800-123-4567')).toBe('tel:08001234567')
    expect(telHref('0300 313 1234')).toBe('tel:03003131234')
  })
  it('o campo é texto livre: dois números, ramal ou letras não viram link', () => {
    expect(telHref('(41) 3333-4444 / (41) 99999-8888')).toBeNull()
    expect(telHref('(41) 3333-4444 e (41) 99999-8888')).toBeNull()
    expect(telHref('(41) 3333-4444 ramal 12')).toBeNull()
    expect(telHref('ramal 12')).toBeNull()
    expect(telHref('41+3333-4444')).toBeNull()
  })
  it('número sem DDD ou que não parece telefone não vira link', () => {
    expect(telHref('3333-4444')).toBeNull()
    expect(telHref('99710-2441')).toBeNull()
    expect(telHref('0041 3333 4444')).toBeNull()
    expect(telHref('(41) 12345-6789')).toBeNull()
    expect(telHref('+55 3333-4444')).toBeNull()
    expect(telHref('123')).toBeNull()
  })
  it('vazio, só espaços ou ausente devolve null', () => {
    expect(telHref('   ')).toBeNull()
    expect(telHref(null)).toBeNull()
    expect(telHref(undefined)).toBeNull()
  })
})

describe('phoneContact', () => {
  it('o texto do telefone sempre aparece; só vira link quando é um número só', () => {
    expect(phoneContact('(41) 3333-4444')).toEqual({ text: '(41) 3333-4444', href: 'tel:+554133334444' })
    expect(phoneContact('3333-4444')).toEqual({ text: '3333-4444', href: null })
    expect(phoneContact(' (41) 3333-4444 / (41) 99999-8888 ')).toEqual({ text: '(41) 3333-4444 / (41) 99999-8888', href: null })
    expect(phoneContact('(41) 3333-4444 ramal 12')).toEqual({ text: '(41) 3333-4444 ramal 12', href: null })
  })
  it('sem texto não há telefone para mostrar', () => {
    expect(phoneContact('')).toBeNull()
    expect(phoneContact('   ')).toBeNull()
    expect(phoneContact(null)).toBeNull()
    expect(phoneContact(undefined)).toBeNull()
  })
})

describe('mailtoHref', () => {
  it('endereço comum fica como está, com o @', () => {
    expect(mailtoHref('secretaria@polo.com')).toBe('mailto:secretaria@polo.com')
    expect(mailtoHref('maria.silva_1@polo.com.br')).toBe('mailto:maria.silva_1@polo.com.br')
  })
  it('o + do endereço vai como %2B, que o programa de e-mail decodifica', () => {
    expect(mailtoHref('a.b+c@polo.com.br')).toBe('mailto:a.b%2Bc@polo.com.br')
  })
  it('o que quebraria o link (?, & e #, que a regex do servidor aceita) é codificado', () => {
    expect(mailtoHref('a?b&c#d@polo.com')).toBe('mailto:a%3Fb%26c%23d@polo.com')
  })
  it('com assunto, codifica o assunto à parte', () => {
    expect(mailtoHref('a@polo.com', 'Matrícula: Excel')).toBe('mailto:a@polo.com?subject=Matr%C3%ADcula%3A%20Excel')
  })
})

describe('mapsHref', () => {
  it('codifica o endereço', () => {
    expect(mapsHref('Rua A, 10 - Curitiba/PR')).toBe('https://www.google.com/maps/search/?api=1&query=Rua%20A%2C%2010%20-%20Curitiba%2FPR')
  })
})

describe('enrollContact', () => {
  const vazio = { whatsapp: null, email: null, phone: null }
  it('prefere o WhatsApp, com o nome do curso na mensagem', () => {
    const c = enrollContact({ ...vazio, whatsapp: '5541900000000', email: 'a@b.com' }, 'Excel Básico')
    expect(c).toEqual({ href: 'https://wa.me/5541900000000?text=Ol%C3%A1!%20Quero%20me%20matricular%20no%20curso%20Excel%20B%C3%A1sico.', external: true })
  })
  it('sem WhatsApp, usa e-mail; sem e-mail, telefone', () => {
    expect(enrollContact({ ...vazio, email: 'secretaria@polo.com' }, 'Excel')).toEqual({ href: 'mailto:secretaria@polo.com?subject=Matr%C3%ADcula%3A%20Excel', external: false })
    expect(enrollContact({ ...vazio, phone: '(41) 3333-4444' }, 'Excel')).toEqual({ href: 'tel:+554133334444', external: false })
  })
  it('com e-mail e telefone, o e-mail vem antes do telefone', () => {
    const c = enrollContact({ ...vazio, email: 'secretaria@polo.com', phone: '(41) 3333-4444' }, 'Excel')
    expect(c).toEqual({ href: 'mailto:secretaria@polo.com?subject=Matr%C3%ADcula%3A%20Excel', external: false })
  })
  it('o endereço do e-mail vai codificado no mailto', () => {
    const c = enrollContact({ ...vazio, email: 'a?b&c#d@polo.com' }, 'Excel')
    expect(c?.href).toBe('mailto:a%3Fb%26c%23d@polo.com?subject=Matr%C3%ADcula%3A%20Excel')
  })
  it('telefone que não é um número só não serve de contato de matrícula', () => {
    expect(enrollContact({ ...vazio, phone: '(41) 3333-4444 / (41) 99999-8888' }, 'Excel')).toBeNull()
  })
  it('sem contato nenhum devolve null', () => {
    expect(enrollContact(vazio, 'Excel')).toBeNull()
  })
})

describe('enrollChannels', () => {
  const vazio = { whatsapp: null, email: null, phone: null }

  it('oferece todos os canais do polo, na ordem WhatsApp, e-mail e telefone', () => {
    const c = enrollChannels({ whatsapp: '5541900000000', email: 'secretaria@polo.com', phone: '(41) 3333-4444' })
    expect(c).toEqual([
      { kind: 'whatsapp', label: 'Falar no WhatsApp', href: 'https://wa.me/5541900000000?text=Ol%C3%A1!%20Quero%20me%20matricular.', external: true },
      { kind: 'email', label: 'Escrever para secretaria@polo.com', href: 'mailto:secretaria@polo.com?subject=Matr%C3%ADcula', external: false },
      { kind: 'phone', label: 'Ligar para (41) 3333-4444', href: 'tel:+554133334444', external: false },
    ])
  })
  it('só o que o polo cadastrou: sem WhatsApp válido, sem e-mail em branco, sem telefone vazio', () => {
    expect(enrollChannels({ whatsapp: '123', email: '   ', phone: '  ' })).toEqual([])
    expect(enrollChannels({ ...vazio, email: 'secretaria@polo.com' }).map((c) => c.kind)).toEqual(['email'])
    expect(enrollChannels({ ...vazio, phone: '(41) 3333-4444' }).map((c) => c.kind)).toEqual(['phone'])
  })
  it('telefone que não é um número só aparece como texto, sem link (o campo é livre)', () => {
    expect(enrollChannels({ ...vazio, phone: '(41) 3333-4444 / (41) 99999-8888' })).toEqual([
      { kind: 'phone', label: 'Telefone: (41) 3333-4444 / (41) 99999-8888', href: null, external: false },
    ])
  })
  it('o e-mail vai codificado no mailto, como na página do curso', () => {
    expect(enrollChannels({ ...vazio, email: 'a?b&c#d@polo.com' })[0].href).toBe('mailto:a%3Fb%26c%23d@polo.com?subject=Matr%C3%ADcula')
  })
  it('sem canal nenhum a lista é vazia: a tela manda procurar o polo', () => {
    expect(enrollChannels(vazio)).toEqual([])
  })
})
