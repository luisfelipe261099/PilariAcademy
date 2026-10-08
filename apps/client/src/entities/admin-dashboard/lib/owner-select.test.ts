import { describe, expect, it } from 'vitest'
import { OWNER_PLACEHOLDER, ownerSelect } from './owner-select'

const opcoes = ['u1', 'u2']

describe('ownerSelect', () => {
  // Com o nome também na opção vazia, o mesmo nome aparecia duas vezes na lista: uma como "vazio" e outra como a opção dele.
  it('dono que está nas opções: seleciona a opção dele e a vazia só convida a escolher', () => {
    expect(ownerSelect({ instructorId: 'u1', instructorName: 'Ana' }, opcoes)).toEqual({ value: 'u1', emptyLabel: '— escolher parceiro —' })
    expect(OWNER_PLACEHOLDER).toBe('— escolher parceiro —')
  })
  it('dono fora das opções (perdeu o papel de parceiro): a opção vazia leva o nome atual', () => {
    expect(ownerSelect({ instructorId: 'u9', instructorName: 'Beto' }, opcoes)).toEqual({ value: '', emptyLabel: 'Beto' })
  })
  it('lista de opções ainda carregando: o nome do dono aparece na opção vazia', () => {
    expect(ownerSelect({ instructorId: 'u1', instructorName: 'Ana' }, [])).toEqual({ value: '', emptyLabel: 'Ana' })
  })
  it('curso sem dono, ou dono fora das opções e sem nome: convida a escolher', () => {
    expect(ownerSelect({ instructorId: null, instructorName: null }, opcoes)).toEqual({ value: '', emptyLabel: '— escolher parceiro —' })
    expect(ownerSelect({ instructorId: 'u9', instructorName: null }, opcoes)).toEqual({ value: '', emptyLabel: '— escolher parceiro —' })
  })
})
