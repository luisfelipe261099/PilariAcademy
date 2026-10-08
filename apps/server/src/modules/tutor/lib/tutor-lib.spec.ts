import { pcmToWav, wavInfo } from './wav'
import { limparTextoPdf, montarMaterial } from './material-text'
import { diaBrasilia, inicioDoMesBrasilia, instrucaoDoSistema, lerResposta, montarPedido, textoParaFala, voltaDoTetoMensal, MAX_TURNOS_HISTORICO } from './tutor-prompt'

describe('wav', () => {
  it('pcmToWav gera um WAV que wavInfo lê com a duração certa', () => {
    const pcm = Buffer.alloc(48000) // 1 s a 24 kHz, 16 bits mono
    const info = wavInfo(pcmToWav(pcm, 24000))
    expect(info).toEqual({ sampleRate: 24000, channels: 1, bitsPerSample: 16, dataBytes: 48000, seconds: 1 })
  })

  it('wavInfo pula chunks extras antes do data', () => {
    const wav = pcmToWav(Buffer.alloc(32000), 16000)
    const list = Buffer.concat([Buffer.from('LIST', 'ascii'), Buffer.from([4, 0, 0, 0]), Buffer.from('INFO', 'ascii')])
    const comExtra = Buffer.concat([wav.subarray(0, 36), list, wav.subarray(36)])
    expect(wavInfo(comExtra)?.seconds).toBe(1)
  })

  it('wavInfo recusa o que não é WAV PCM', () => {
    expect(wavInfo(Buffer.from('%PDF-1.7 qualquer coisa que não é áudio, com tamanho suficiente para o teste'))).toBeNull()
    expect(wavInfo(Buffer.alloc(10))).toBeNull()
  })
})

describe('material', () => {
  it('limparTextoPdf tira marcadores de página, rodapés numerados e linhas repetidas em todas as páginas', () => {
    const paginas = [1, 2, 3, 4].map((n) => `${n} / 4\tGestão de RH · Módulo 05\nConteúdo da página ${n}.\n\n-- ${n} of 4 --`).join('\n')
    const limpo = limparTextoPdf(`Capa\n${paginas}`)
    expect(limpo).not.toMatch(/of 4 --/)
    expect(limpo).not.toMatch(/\/ 4/)
    expect(limpo).toContain('Conteúdo da página 3.')
    expect(limpo.startsWith('Capa')).toBe(true)
  })

  it('montarMaterial respeita o teto sem cortar linha no meio', () => {
    const texto = Array.from({ length: 200 }, (_, i) => `Linha ${i} com algum conteúdo de estudo.`).join('\n')
    const m = montarMaterial([{ nome: 'Apostila.pdf', texto }], 1000)
    expect(m.length).toBeLessThanOrEqual(1000)
    expect(m.startsWith('### Apostila.pdf')).toBe(true)
    expect(m.split('\n').pop()).toMatch(/^Linha \d+ com algum conteúdo de estudo\.$/)
  })
})

describe('prompt', () => {
  const ctx = { cursoTitulo: 'Gestão de Recursos Humanos', moduloTitulo: 'Módulo 05', modulos: ['Módulo 01', 'Módulo 05'], material: 'Turnover é a rotatividade.' }

  it('põe o material antes da conversa e da pergunta (prefixo estável para o cache)', () => {
    const p = montarPedido(ctx, [{ role: 'aluno', text: 'oi' }], { texto: 'O que é turnover?' }) as { contents: Array<{ parts: Array<{ text?: string }> }> }
    const partes = p.contents[0].parts
    expect(partes[0].text).toContain('MATERIAL DE APOIO DO MÓDULO 05')
    expect(partes[0].text).toContain('Turnover é a rotatividade.')
    expect(partes[1].text).toContain('Aluno: oi')
    expect(partes[2].text).toContain('O que é turnover?')
  })

  it('manda o áudio como inlineData WAV', () => {
    const p = montarPedido(ctx, [], { audioWavBase64: 'AAAA' }) as { contents: Array<{ parts: Array<Record<string, unknown>> }> }
    expect(p.contents[0].parts.at(-1)).toEqual({ inlineData: { mimeType: 'audio/wav', data: 'AAAA' } })
  })

  it('limita o histórico às últimas falas', () => {
    const hist = Array.from({ length: 20 }, (_, i) => ({ role: 'aluno' as const, text: `fala ${i}` }))
    const p = montarPedido(ctx, hist, { texto: 'x' }) as { contents: Array<{ parts: Array<{ text?: string }> }> }
    const conversa = p.contents[0].parts[1].text ?? ''
    expect(conversa).toContain('fala 19')
    expect(conversa).not.toContain('fala 11')
    expect(conversa.split('\n').length - 1).toBe(MAX_TURNOS_HISTORICO)
  })

  it('a instrução proíbe resolver provas e pede fala curta, sem formatação', () => {
    const s = instrucaoDoSistema(ctx)
    expect(s).toMatch(/Não resolva nem dê as respostas das provas/)
    expect(s).toMatch(/sem listas/)
    expect(s).toContain('Studio Pilari')
    expect(s).toMatch(/Cumprimente só na primeira resposta/)
  })

  it('lerResposta aceita JSON puro, com cerca de código, e recusa resposta vazia', () => {
    expect(lerResposta('{"transcricao":"o que é turnover","resposta":"É a rotatividade."}')).toEqual({ transcricao: 'o que é turnover', resposta: 'É a rotatividade.' })
    expect(lerResposta('```json\n{"transcricao":"a","resposta":"b"}\n```')?.resposta).toBe('b')
    expect(lerResposta('{"transcricao":"a","resposta":"  "}')).toBeNull()
    expect(lerResposta('sem json nenhum')).toBeNull()
  })

  it('textoParaFala tira marcações e quebras de linha', () => {
    expect(textoParaFala('**Turnover** é\n\na rotatividade.  # fim')).toBe('Turnover é a rotatividade. fim')
  })

  it('diaBrasilia usa o fuso de Brasília', () => {
    expect(diaBrasilia(new Date('2026-10-07T02:30:00Z'))).toBe('2026-10-06')
    expect(diaBrasilia(new Date('2026-10-07T03:30:00Z'))).toBe('2026-10-07')
  })

  it('inicioDoMesBrasilia vira o mês à meia-noite de Brasília, não à meia-noite UTC', () => {
    expect(inicioDoMesBrasilia(new Date('2026-10-06T15:00:00Z'))).toBe('2026-10-01')
    expect(inicioDoMesBrasilia(new Date('2026-11-01T02:00:00Z'))).toBe('2026-10-01')
    expect(inicioDoMesBrasilia(new Date('2026-11-01T03:00:00Z'))).toBe('2026-11-01')
  })

  it('voltaDoTetoMensal diz o dia 1º do mês seguinte, inclusive na virada do ano', () => {
    expect(voltaDoTetoMensal(new Date('2026-10-06T15:00:00Z'))).toBe('1º de novembro')
    expect(voltaDoTetoMensal(new Date('2026-12-31T12:00:00Z'))).toBe('1º de janeiro')
  })
})
