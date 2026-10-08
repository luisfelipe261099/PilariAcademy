import { describe, expect, it } from 'vitest'
import { bytesParaBase64, codificarWav, pcm16ParaFloat, reduzirTaxa, rms } from './audio-codec'
import { criarDetector } from './silence-detector'
import { estadoInicial, faseApos, minutosRestantes, reduzirTutor, saldoDoTutor, textoDaFase, type EventoTutor } from './tutor-state'

describe('audio-codec', () => {
  it('reduzirTaxa de 48 kHz para 16 kHz divide o tamanho por 3 e mantém o nível', () => {
    const entrada = new Float32Array(4800).fill(0.5)
    const saida = reduzirTaxa(entrada, 48000, 16000)
    expect(saida.length).toBe(1600)
    expect(saida[100]).toBeCloseTo(0.5)
  })

  it('codificarWav gera cabeçalho RIFF/WAVE com a taxa e os bytes certos', () => {
    const wav = codificarWav(new Float32Array([0, 1, -1]), 16000)
    const v = new DataView(wav.buffer)
    expect(String.fromCharCode(...wav.subarray(0, 4))).toBe('RIFF')
    expect(String.fromCharCode(...wav.subarray(8, 12))).toBe('WAVE')
    expect(v.getUint32(24, true)).toBe(16000)
    expect(v.getUint32(40, true)).toBe(6)
    expect(v.getInt16(46, true)).toBe(0x7fff)
    expect(v.getInt16(48, true)).toBe(-0x8000)
  })

  it('bytesParaBase64 lida com buffers grandes', () => {
    const bytes = new Uint8Array(100000).fill(65)
    expect(bytesParaBase64(bytes).startsWith('QUFB')).toBe(true)
  })

  it('pcm16ParaFloat guarda o byte que sobra e o usa no próximo pedaço', () => {
    // amostra 0x4000 (= 0,5) quebrada entre dois pedaços
    const a = pcm16ParaFloat(new Uint8Array([0x00]), null)
    expect(a.amostras.length).toBe(0)
    expect(a.sobra).toEqual(new Uint8Array([0x00]))
    const b = pcm16ParaFloat(new Uint8Array([0x40, 0x00, 0xc0]), a.sobra)
    expect(Array.from(b.amostras)).toEqual([0.5, -0.5])
    expect(b.sobra).toBeNull()
  })

  it('rms de silêncio é 0 e de onda cheia é 1', () => {
    expect(rms(new Float32Array(10))).toBe(0)
    expect(rms(new Float32Array(10).fill(1))).toBe(1)
  })
})

describe('detector de silêncio', () => {
  const bloco = 85 // ms por bloco de 4096 amostras a 48 kHz
  function rodar(volumes: number[], opts = {}) {
    const d = criarDetector(opts)
    let t = 0
    for (const v of volumes) {
      const r = d.processar(v, t)
      if (r !== 'continua') return { r, t }
      t += bloco
    }
    return { r: 'continua' as const, t }
  }

  it('encerra depois do silêncio que vem após a fala', () => {
    const volumes = [...Array(10).fill(0.004), ...Array(20).fill(0.1), ...Array(30).fill(0.004)]
    const { r, t } = rodar(volumes)
    expect(r).toBe('fim')
    expect(t).toBeGreaterThanOrEqual((10 + 20) * bloco + 1300 - bloco)
  })

  it('desiste quando o aluno não fala nada', () => {
    expect(rodar(Array(200).fill(0.004)).r).toBe('sem-fala')
  })

  it('em sala barulhenta, o ruído constante não conta como fala', () => {
    const volumes = [...Array(30).fill(0.05), ...Array(15).fill(0.3), ...Array(30).fill(0.05)]
    expect(rodar(volumes).r).toBe('fim')
  })

  it('para no limite de duração', () => {
    expect(rodar(Array(2000).fill(0.2), { maxMs: 3000 }).r).toBe('limite')
  })
})

describe('estado do tutor', () => {
  it('ciclo completo: ouvir → pensar → responder → falou', () => {
    let s = reduzirTutor(estadoInicial, { tipo: 'ouvir' })
    expect(s.fase).toBe('ouvindo')
    s = reduzirTutor(s, { tipo: 'pensar' })
    s = reduzirTutor(s, { tipo: 'responder', pergunta: 'O que é turnover?', resposta: 'É a rotatividade.' })
    expect(s.fase).toBe('falando')
    expect(s.historico).toEqual([
      { role: 'aluno', text: 'O que é turnover?' },
      { role: 'tutor', text: 'É a rotatividade.' },
    ])
    expect(reduzirTutor(s, { tipo: 'falou' }).fase).toBe('pronto')
  })

  it('histórico guarda só as últimas falas', () => {
    let s = estadoInicial
    for (let i = 0; i < 20; i++) s = reduzirTutor(s, { tipo: 'responder', pergunta: `p${i}`, resposta: `r${i}` })
    expect(s.historico.length).toBe(12)
    expect(s.historico.at(-1)).toEqual({ role: 'tutor', text: 'r19' })
  })

  it('trocar de módulo zera a conversa', () => {
    const s = reduzirTutor(estadoInicial, { tipo: 'responder', pergunta: 'p', resposta: 'r' })
    expect(reduzirTutor(s, { tipo: 'trocarModulo' })).toEqual(estadoInicial)
  })

  it('erro mostra a mensagem do servidor', () => {
    const s = reduzirTutor(estadoInicial, { tipo: 'falhar', mensagem: 'Você já usou os 30 minutos de hoje do tutor.' })
    expect(textoDaFase(s.fase, s.erro)).toBe('Você já usou os 30 minutos de hoje do tutor.')
  })

  it('minutos restantes nunca ficam negativos', () => {
    expect(minutosRestantes(600, 1800)).toBe(20)
    expect(minutosRestantes(2000, 1800)).toBe(0)
  })

  it('saldo: manda o que acaba primeiro, o do dia ou a cota do mês', () => {
    const base = { limiteDia: 1800, limiteMes: 3600 }
    expect(saldoDoTutor({ ...base, usadosHoje: 600, usadosMes: 600 })).toEqual({ minutos: 20, rotulo: '20 min restantes hoje' })
    expect(saldoDoTutor({ ...base, usadosHoje: 0, usadosMes: 3000 })).toEqual({ minutos: 10, rotulo: '10 min restantes neste mês' })
    expect(saldoDoTutor({ ...base, usadosHoje: 0, usadosMes: 3600 })).toEqual({ minutos: 0, rotulo: 'Cota do mês atingida' })
    expect(saldoDoTutor({ ...base, usadosHoje: 1800, usadosMes: 1800 })).toEqual({ minutos: 0, rotulo: 'Limite de hoje atingido' })
  })

  it('faseApos bate com a fase que o reducer produz', () => {
    const eventos: EventoTutor[] = [
      { tipo: 'ouvir' },
      { tipo: 'pensar' },
      { tipo: 'responder', pergunta: 'p', resposta: 'r' },
      { tipo: 'falou' },
      { tipo: 'interromper' },
      { tipo: 'falhar', mensagem: 'x' },
      { tipo: 'trocarModulo' },
    ]
    for (const e of eventos) expect(faseApos(e)).toBe(reduzirTutor(estadoInicial, e).fase)
  })
})
