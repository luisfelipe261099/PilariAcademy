import { describe, expect, it } from 'vitest'
import { heroCopy, loginTagline, preSaleLead, profileCopy } from './brand-copy'

const polo = { isMatriz: false, name: 'Polo A', heroTitle: null, heroSubtitle: null }

// A frase que nenhum site pode dizer (os cursos são livres): "reconhecido pelo MEC" ou "certificado pelo MEC" (ou "pelo Ministério"),
// no singular, no plural e no feminino, com qualquer espaço entre as palavras (inclusive quebra de linha e espaço sem
// quebra). O grupo é o que faz o "pelo MEC" valer para as duas palavras: sem ele, o "|" separaria "reconhecid[o|a|os|as]"
// sozinho de "certificad[o|a|os|as] pelo MEC", e qualquer "reconhecido" soaria o alarme.
const PROIBIDO = /(?:reconhecid|certificad)[oa]s?\s+pel[oa]s?\s+(?:MEC|Minist[eé]rio)/i

describe('a varredura da frase proibida', () => {
  it('pega o singular, o plural, o feminino e os espaços estranhos', () => {
    for (const frase of [
      'reconhecido pelo MEC',
      'Reconhecida pelo MEC',
      'reconhecidos pelo MEC',
      'reconhecidas pelo MEC',
      'certificado pelo MEC',
      'certificada  pelo   MEC',
      'certificados\npelo MEC',
      'certificado pelo MEC',
      'reconhecido pelo Ministério da Educação',
    ]) {
      expect(frase).toMatch(PROIBIDO)
    }
  })
  it('deixa passar o que não atribui o curso ao MEC', () => {
    for (const frase of [
      'Certificado de conclusão',
      'Certificado emitido pelo Studio Pilari',
      'Consulte o código no QR do certificado',
    ]) {
      expect(frase).not.toMatch(PROIBIDO)
    }
  })
  it('só a frase inteira é proibida: reconhecido ou certificado por outra coisa que não o MEC passa', () => {
    for (const frase of ['professores reconhecidos pelo mercado', 'Reconhecida pela comunidade', 'certificado pelo próprio polo']) {
      expect(frase).not.toMatch(PROIBIDO)
    }
  })
  it('a cópia da matriz também não diz isso', () => {
    const c = heroCopy({ ...polo, isMatriz: true }, 3)
    expect([c.badge, c.title, c.highlight ?? '', c.subtitle, ...c.trust, loginTagline(true)].join(' ')).not.toMatch(PROIBIDO)
  })
})

describe('heroCopy', () => {
  it('a matriz é o Studio Pilari', () => {
    expect(heroCopy({ ...polo, isMatriz: true, name: 'Studio Pilari' }, 12)).toEqual({
      badge: 'Cursos online · Studio Pilari',
      title: 'Transforme sua vida através do ',
      highlight: 'movimento.',
      subtitle: '12 cursos online com a Dra. Mylena Sestream, fisioterapeuta. Aprenda no seu ritmo, com certificado de conclusão.',
      trust: ['Conduzido por fisioterapeuta', 'Certificado de conclusão', 'Assista quando quiser'],
    })
  })
  it('a matriz sem curso publicado não anuncia "0 cursos"', () => {
    expect(heroCopy({ ...polo, isMatriz: true }, 0).subtitle).toBe(
      'Cursos online com a Dra. Mylena Sestream, fisioterapeuta. Aprenda no seu ritmo, com certificado de conclusão.'
    )
    expect(heroCopy({ ...polo, isMatriz: true }, 1).subtitle).toMatch(/^1 curso online/)
  })
  it('polo sem texto próprio usa o genérico com o nome do polo', () => {
    const c = heroCopy(polo, 1)
    expect(c.highlight).toBe('movimento.')
    expect(c.subtitle).toBe('Polo A: 1 curso online com certificado de conclusão. Comece quando quiser.')
  })
  it('polo com vários cursos diz quantos', () => {
    expect(heroCopy(polo, 3).subtitle).toBe('Polo A: 3 cursos online com certificado de conclusão. Comece quando quiser.')
  })
  it('polo sem curso publicado não anuncia "0 cursos"', () => {
    const c = heroCopy(polo, 0)
    expect(c.subtitle).toBe('Polo A: cursos online com certificado de conclusão. Comece quando quiser.')
    expect(c.subtitle).not.toMatch(/\b0\b/)
  })
  it('polo com texto próprio usa o dele, sem destaque', () => {
    const c = heroCopy({ ...polo, heroTitle: 'Estude perto de casa', heroSubtitle: 'Turmas toda semana.' }, 3)
    expect(c).toMatchObject({ title: 'Estude perto de casa', highlight: null, subtitle: 'Turmas toda semana.' })
  })
  it('texto próprio com espaços nas pontas sai aparado', () => {
    const c = heroCopy({ ...polo, heroTitle: '  Estude perto de casa ', heroSubtitle: ' Turmas toda semana. ' }, 3)
    expect(c).toMatchObject({ title: 'Estude perto de casa', subtitle: 'Turmas toda semana.' })
  })
  it('título e subtítulo vazios (ou só espaços) valem como ausentes, os dois juntos', () => {
    for (const vazio of ['', '   ']) {
      const c = heroCopy({ ...polo, heroTitle: vazio, heroSubtitle: vazio }, 2)
      expect(c.title).toBe('Transforme sua vida através do ')
      expect(c.highlight).toBe('movimento.')
      expect(c.subtitle).toBe('Polo A: 2 cursos online com certificado de conclusão. Comece quando quiser.')
    }
  })
  it('só o título vazio: o genérico vem inteiro, com o destaque, e o subtítulo próprio fica', () => {
    const c = heroCopy({ ...polo, heroTitle: '', heroSubtitle: 'Turmas toda semana.' }, 2)
    expect(c).toMatchObject({ title: 'Transforme sua vida através do ', highlight: 'movimento.', subtitle: 'Turmas toda semana.' })
  })
  it('no polo, nenhuma frase atribui ao MEC o reconhecimento do curso', () => {
    for (const total of [0, 1, 3]) {
      const c = heroCopy(polo, total)
      const tudo = [c.badge, c.title, c.highlight ?? '', c.subtitle, ...c.trust, loginTagline(false)].join(' ')
      expect(tudo).not.toMatch(PROIBIDO)
    }
    expect(heroCopy(polo, 3).trust).toEqual(['Certificado de conclusão', 'Código de verificação no certificado', 'Assista quando quiser'])
  })
})

describe('loginTagline', () => {
  it('a matriz fala da professora; o polo, do certificado', () => {
    expect(loginTagline(true)).toBe('Seus cursos com a Dra. Mylena Sestream, no seu ritmo.')
    expect(loginTagline(false)).toBe('Aprenda no seu ritmo, com certificado de conclusão.')
  })
})

describe('preSaleLead', () => {
  it('onde se vende, o aviso de pré-venda convida a comprar (a cópia da matriz não muda)', () => {
    expect(preSaleLead(true)).toBe('Pré-venda — compre agora e o conteúdo libera em ')
  })
  it('no polo sem venda online, o aviso só informa a data', () => {
    expect(preSaleLead(false)).toBe('Pré-venda — o conteúdo libera em ')
    expect(preSaleLead(false)).not.toMatch(/compr/i)
  })
})

describe('profileCopy', () => {
  it('na matriz quem corrige é o Studio Pilari', () => {
    expect(profileCopy({ isMatriz: true, salesEnabled: true })).toEqual({
      cpfLocked: 'Já cadastrado. Para corrigir, fale com o Studio Pilari.',
      cpfOpen: 'Necessário para emitir certificado e para comprar no carnê. Depois de salvo, só o Studio Pilari altera.',
    })
  })
  it('polo sem venda: fale com o polo e nada de carnê', () => {
    expect(profileCopy({ isMatriz: false, salesEnabled: false })).toEqual({
      cpfLocked: 'Já cadastrado. Para corrigir, fale com o seu polo.',
      cpfOpen: 'Necessário para emitir certificado. Depois de salvo, só o seu polo ou o Studio Pilari alteram.',
    })
  })
  it('polo que vende: o carnê continua na explicação', () => {
    expect(profileCopy({ isMatriz: false, salesEnabled: true }).cpfOpen).toBe(
      'Necessário para emitir certificado e para comprar no carnê. Depois de salvo, só o seu polo ou o Studio Pilari alteram.'
    )
  })
  it('nenhuma frase do polo manda falar com a secretaria nem atribui o certificado ao MEC', () => {
    for (const salesEnabled of [false, true]) {
      const c = profileCopy({ isMatriz: false, salesEnabled })
      expect(`${c.cpfLocked} ${c.cpfOpen}`).not.toMatch(/secretaria/i)
      expect(`${c.cpfLocked} ${c.cpfOpen}`).not.toMatch(PROIBIDO)
    }
  })
})
