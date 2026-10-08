import { describe, expect, it } from 'vitest'
import { buildAdminProfilePatch, cpfHint, formatCpf, isMaskedCpf, isValidCpf } from './student-profile-form'

describe('formatCpf', () => {
  it('mascara progressivamente enquanto digita', () => {
    expect(formatCpf('529')).toBe('529')
    expect(formatCpf('5299')).toBe('529.9')
    expect(formatCpf('5299822')).toBe('529.982.2')
    expect(formatCpf('52998224725')).toBe('529.982.247-25')
  })
  it('ignora o que não é dígito e corta em 11', () => {
    expect(formatCpf('529.982.247-25x99')).toBe('529.982.247-25')
  })
})

describe('isValidCpf', () => {
  it('aceita CPF com dígitos verificadores corretos, com ou sem máscara', () => {
    expect(isValidCpf('529.982.247-25')).toBe(true)
    expect(isValidCpf('12345678909')).toBe(true)
  })
  it('recusa dígito verificador errado, sequência repetida e tamanho errado', () => {
    expect(isValidCpf('123.456.789-00')).toBe(false)
    expect(isValidCpf('111.111.111-11')).toBe(false)
    expect(isValidCpf('5299822472')).toBe(false)
  })
})

describe('buildAdminProfilePatch', () => {
  const original = { displayName: 'Ana Souza', cpf: '52998224725' }

  it('sem mudança → nada para salvar', () => {
    expect(buildAdminProfilePatch(original, { nome: ' Ana  Souza ', cpf: '529.982.247-25' })).toEqual({ ok: false, error: null })
  })

  it('só o nome mudou → patch só com displayName normalizado', () => {
    expect(buildAdminProfilePatch(original, { nome: '  Ana  Maria Souza ', cpf: '529.982.247-25' })).toEqual({
      ok: true, patch: { displayName: 'Ana Maria Souza' },
    })
  })

  it('só o CPF mudou → patch só com os dígitos do CPF', () => {
    expect(buildAdminProfilePatch(original, { nome: 'Ana Souza', cpf: '123.456.789-09' })).toEqual({
      ok: true, patch: { cpf: '12345678909' },
    })
  })

  it('aluno sem CPF pode receber um (campo vazio antes)', () => {
    expect(buildAdminProfilePatch({ displayName: 'Ana Souza', cpf: null }, { nome: 'Ana Souza', cpf: '12345678909' })).toEqual({
      ok: true, patch: { cpf: '12345678909' },
    })
  })

  it('apagar o CPF não é permitido: vazio com CPF já gravado é "sem mudança" no CPF', () => {
    expect(buildAdminProfilePatch(original, { nome: 'Ana Souza', cpf: '' })).toEqual({ ok: false, error: null })
  })

  it('nome que é e-mail → erro', () => {
    const r = buildAdminProfilePatch(original, { nome: 'ana@x.com', cpf: '' })
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.error).toMatch(/nome/i)
  })

  it('CPF ainda incompleto → sem erro e sem salvar (o aviso só vem com 11 dígitos errados)', () => {
    expect(buildAdminProfilePatch(original, { nome: 'Ana Souza', cpf: '088.49' })).toEqual({ ok: false, error: null })
    // Mesmo com o nome corrigido: não salva pela metade enquanto o CPF está sendo digitado.
    expect(buildAdminProfilePatch(original, { nome: 'Ana Maria Souza', cpf: '088.49' })).toEqual({ ok: false, error: null })
  })

  it('CPF inválido → erro, mesmo com nome válido junto', () => {
    const r = buildAdminProfilePatch(original, { nome: 'Ana Maria Souza', cpf: '123.456.789-00' })
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.error).toMatch(/CPF/)
  })
})

describe('isMaskedCpf', () => {
  it('reconhece a máscara que o servidor manda para pessoa ligada a outro polo', () => {
    expect(isMaskedCpf('***.***.***-**')).toBe(true)
    expect(isMaskedCpf('***.123.456-**')).toBe(true)
  })
  it('CPF de verdade (só dígitos ou formatado), vazio e ausente não são máscara', () => {
    expect(isMaskedCpf('52998224725')).toBe(false)
    expect(isMaskedCpf('529.982.247-25')).toBe(false)
    expect(isMaskedCpf('')).toBe(false)
    expect(isMaskedCpf(null)).toBe(false)
    expect(isMaskedCpf(undefined)).toBe(false)
  })
})

describe('buildAdminProfilePatch com CPF mascarado (pessoa ligada a outro polo)', () => {
  const mascarado = { displayName: 'Ana Souza', cpf: '***.***.***-**' }

  it('o CPF mascarado não volta no patch, nem se o campo vier alterado', () => {
    expect(buildAdminProfilePatch(mascarado, { nome: 'Ana Souza', cpf: '***.***.***-**' })).toEqual({ ok: false, error: null })
    expect(buildAdminProfilePatch(mascarado, { nome: 'Ana Souza', cpf: '529.982.247-25' })).toEqual({ ok: false, error: null })
    expect(buildAdminProfilePatch(mascarado, { nome: 'Ana Souza', cpf: '123.456.789-00' })).toEqual({ ok: false, error: null })
  })

  it('o nome segue valendo, e o patch sai sem CPF', () => {
    expect(buildAdminProfilePatch(mascarado, { nome: 'Ana Maria Souza', cpf: '***.***.***-**' })).toEqual({
      ok: true, patch: { displayName: 'Ana Maria Souza' },
    })
  })
})

describe('cpfHint', () => {
  it('CPF mascarado: explica que só o Studio Pilari o vê', () => {
    expect(cpfHint('***.***.***-**', false)).toBe('CPF visível só para o Studio Pilari: esta pessoa também está ligada a outro polo.')
    expect(cpfHint('***.***.***-**', true)).toBe('CPF visível só para o Studio Pilari: esta pessoa também está ligada a outro polo.')
  })
  it('CPF gravado: pode corrigir e fica no log', () => {
    expect(cpfHint('52998224725', true)).toBe('Já cadastrado. Você pode corrigir; a alteração fica registrada no log.')
  })
  it('sem CPF onde se vende: a cópia de sempre, com o carnê', () => {
    expect(cpfHint(null, true)).toBe('Ainda não informado. Necessário para emitir certificado e comprar no carnê.')
  })
  it('sem CPF no polo sem venda: só o certificado', () => {
    expect(cpfHint(null, false)).toBe('Ainda não informado. Necessário para emitir certificado.')
    expect(cpfHint('', false)).toBe('Ainda não informado. Necessário para emitir certificado.')
  })
})
