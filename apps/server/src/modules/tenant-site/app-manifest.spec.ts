import { inicialDoPolo, montarManifesto, nomeCurtoDoApp, svgNoTamanho } from './app-manifest'

describe('nomeCurtoDoApp', () => {
  it('cabe em 12 caracteres sem cortar palavra no meio', () => {
    expect(nomeCurtoDoApp('Polo Centro')).toBe('Polo Centro')
    expect(nomeCurtoDoApp('Rat Academy Cursos Livres')).toBe('Rat Academy')
    expect(nomeCurtoDoApp('  Escola   Nova  ')).toBe('Escola Nova')
  })

  it('nome longo: tira a palavra genérica do começo ("Instituto", "Polo", "Escola de"…)', () => {
    expect(nomeCurtoDoApp('Instituto Horizonte')).toBe('Horizonte')
    expect(nomeCurtoDoApp('Escola de Beleza Moderna')).toBe('Beleza')
    expect(nomeCurtoDoApp('Polo Centro')).toBe('Polo Centro')
  })

  it('primeira palavra maior que o limite: corta a palavra', () => {
    expect(nomeCurtoDoApp('Profissionalizante Brasil')).toBe('Profissional')
  })
})

describe('montarManifesto', () => {
  const marca = { primaryColor: '#5c6e5a', description: null }

  it('matriz: app "Studio Pilari" com os ícones fixos do F', () => {
    const m = montarManifesto({ name: 'Studio Pilari', isMatriz: true, branding: marca }, '1') as { short_name: string; icons: Array<{ src: string; purpose: string }> }
    expect(m.short_name).toBe('Studio Pilari')
    expect(m.icons).toEqual([
      { src: '/icons/pilari-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/pilari-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/pilari-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ])
  })

  it('polo: descrição da marca quando existe, senão uma frase padrão', () => {
    expect(montarManifesto({ name: 'Polo A', isMatriz: false, branding: { ...marca, description: 'Cursos no Paraná' } }, '1')).toMatchObject({ description: 'Cursos no Paraná' })
    expect(montarManifesto({ name: 'Polo A', isMatriz: false, branding: marca }, '1')).toMatchObject({ description: expect.stringContaining('celular') })
  })
})

describe('svgNoTamanho', () => {
  it('troca width/height da raiz pelo lado pedido e mantém o viewBox', () => {
    const r = svgNoTamanho('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20" viewBox="0 0 40 20"><rect/></svg>', 300)
    expect(r).toBe('<svg width="300" height="300" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 20"><rect/></svg>')
  })

  it('sem viewBox: cria um a partir das medidas originais para a escala funcionar', () => {
    const r = svgNoTamanho("<svg width='40px' height='20'><rect/></svg>", 300)
    expect(r).toBe('<svg width="300" height="300" viewBox="0 0 40 20"><rect/></svg>')
  })

  it('não mexe em width/height de elementos internos', () => {
    const r = svgNoTamanho('<svg viewBox="0 0 10 10"><rect width="5" height="5"/></svg>', 100)
    expect(r).toContain('<rect width="5" height="5"/>')
  })
})

describe('inicialDoPolo', () => {
  it('primeira letra ou dígito, ignorando emoji e espaços', () => {
    expect(inicialDoPolo('🎓 escola nova')).toBe('E')
    expect(inicialDoPolo('  9 de Julho')).toBe('9')
    expect(inicialDoPolo('')).toBe('P')
  })
})
