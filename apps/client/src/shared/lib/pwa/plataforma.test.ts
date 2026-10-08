import { describe, expect, it } from 'vitest'
import { abertoComoApp, conviteDoApp, ehIos } from './plataforma'

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36'

describe('ehIos', () => {
  it('iPhone e iPad (que se apresenta como Mac, mas tem toque) contam; Mac de verdade e Android não', () => {
    expect(ehIos(IPHONE, 5)).toBe(true)
    expect(ehIos(IPAD, 5)).toBe(true)
    expect(ehIos(IPAD, 0)).toBe(false)
    expect(ehIos(ANDROID, 5)).toBe(false)
  })
})

describe('abertoComoApp', () => {
  it('display-mode standalone ou navigator.standalone do iOS', () => {
    expect(abertoComoApp(true, undefined)).toBe(true)
    expect(abertoComoApp(false, true)).toBe(true)
    expect(abertoComoApp(false, false)).toBe(false)
  })
})

describe('conviteDoApp', () => {
  const base = { podeInstalar: false, instalado: false, ios: false }

  it('o navegador ofereceu: botão; no iPhone sem oferta: instrução; computador sem oferta: nada', () => {
    expect(conviteDoApp({ ...base, podeInstalar: true }, false)).toBe('botao')
    expect(conviteDoApp({ ...base, ios: true }, false)).toBe('instrucao-ios')
    expect(conviteDoApp(base, false)).toBeNull()
  })

  it('já instalado ou dispensado pelo aluno: nada', () => {
    expect(conviteDoApp({ ...base, podeInstalar: true, instalado: true }, false)).toBeNull()
    expect(conviteDoApp({ ...base, ios: true }, true)).toBeNull()
  })
})
