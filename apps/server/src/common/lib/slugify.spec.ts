import { slugify } from './slugify'

describe('slugify', () => {
  it('minúsculas e hifeniza espaços', () => {
    expect(slugify('Marketing Digital')).toBe('marketing-digital')
  })
  it('remove acentos', () => {
    expect(slugify('Gestão de Compras')).toBe('gestao-de-compras')
  })
  it('remove caracteres especiais e colapsa hifens', () => {
    expect(slugify('Excel  Avançado!! (2024)')).toBe('excel-avancado-2024')
  })
  it('apara hifens das pontas', () => {
    expect(slugify('  Olá  ')).toBe('ola')
  })
})
