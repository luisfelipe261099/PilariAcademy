import type { CourseStatus } from '@pilari/types'
import { decideStatusChange, lockedFieldChanges, lockedFieldsMessage, type StatusChangeInput } from './course-status-policy'

const base = { approvedAt: null as Date | null, reviewNote: null as string | null, isTenantAdmin: false, isPlatformAdmin: false, isMatriz: false }
const aprovado = new Date('2026-09-01T00:00:00Z')
/** Decisão positiva sem nenhuma marca: cada teste liga só a que é o ponto dele. */
const livre = { ok: true, markSubmitted: false, markApproved: false, clearReviewNote: false } as const

describe('decideStatusChange', () => {
  it('instrutor envia rascunho para análise', () => {
    expect(decideStatusChange({ ...base, from: 'draft', to: 'in_review' })).toEqual({ ...livre, markSubmitted: true })
  })
  it('só rascunho vai para análise', () => {
    expect(decideStatusChange({ ...base, from: 'published', to: 'in_review' })).toMatchObject({ ok: false, code: 'INVALID_TRANSITION' })
  })
  it('quem enviou pode desistir da análise', () => {
    expect(decideStatusChange({ ...base, from: 'in_review', to: 'draft' })).toMatchObject({ ok: true })
  })
  it('curso já em análise: quem não aprova é avisado para aguardar, não para enviar de novo', () => {
    for (const quem of [{}, { isTenantAdmin: true }, { isTenantAdmin: true, approvedAt: aprovado }, { reviewNote: 'Falta a ementa.' }]) {
      const d = decideStatusChange({ ...base, ...quem, from: 'in_review', to: 'published' })
      expect(d).toEqual({ ok: false, status: 403, code: 'APPROVAL_REQUIRED', message: 'Este curso está em análise pelo Studio Pilari. Aguarde a aprovação.' })
    }
    // fora da análise a orientação continua a de antes
    const rascunho = decideStatusChange({ ...base, isTenantAdmin: true, from: 'draft', to: 'published' })
    expect(rascunho.ok ? '' : rascunho.message).toBe('A publicação deste curso depende da aprovação do Studio Pilari. Envie o curso para análise.')
  })
  it('admin de polo não aprova a primeira publicação', () => {
    expect(decideStatusChange({ ...base, isTenantAdmin: true, from: 'in_review', to: 'published' })).toMatchObject({ ok: false, code: 'APPROVAL_REQUIRED' })
    expect(decideStatusChange({ ...base, isTenantAdmin: true, from: 'draft', to: 'published' })).toMatchObject({ ok: false, code: 'APPROVAL_REQUIRED' })
  })
  it('admin da plataforma aprova e marca a aprovação', () => {
    expect(decideStatusChange({ ...base, isPlatformAdmin: true, isTenantAdmin: true, from: 'in_review', to: 'published' })).toEqual({ ...livre, markApproved: true, clearReviewNote: true })
  })
  it('admin da matriz publica direto', () => {
    expect(decideStatusChange({ ...base, isMatriz: true, isTenantAdmin: true, from: 'draft', to: 'published' })).toEqual({ ...livre, markApproved: true, clearReviewNote: true })
  })
  it('admin de polo republica curso já aprovado sem nova análise', () => {
    expect(decideStatusChange({ ...base, approvedAt: aprovado, isTenantAdmin: true, from: 'draft', to: 'published' })).toEqual(livre)
  })
  it('curso devolvido ou tirado do ar pelo Studio Pilari só volta ao ar com nova análise', () => {
    const d = decideStatusChange({ ...base, approvedAt: aprovado, reviewNote: 'Aula 3 sem áudio.', isTenantAdmin: true, from: 'draft', to: 'published' })
    expect(d).toMatchObject({ ok: false, code: 'APPROVAL_REQUIRED' })
    expect(d.ok ? '' : d.message).toContain('O Studio Pilari pediu ajustes')
  })
  it('instrutor não publica nem arquiva', () => {
    expect(decideStatusChange({ ...base, approvedAt: aprovado, from: 'draft', to: 'published' })).toMatchObject({ ok: false, code: 'APPROVAL_REQUIRED' })
    expect(decideStatusChange({ ...base, approvedAt: aprovado, from: 'published', to: 'archived' })).toMatchObject({ ok: false, code: 'FORBIDDEN' })
  })
  it('instrutor dono tira o próprio curso do ar, como hoje na matriz', () => {
    expect(decideStatusChange({ ...base, approvedAt: aprovado, from: 'published', to: 'draft' })).toMatchObject({ ok: true })
  })
  it('admin do polo tira do ar e arquiva', () => {
    expect(decideStatusChange({ ...base, approvedAt: aprovado, isTenantAdmin: true, from: 'published', to: 'draft' })).toMatchObject({ ok: true })
    expect(decideStatusChange({ ...base, approvedAt: aprovado, isTenantAdmin: true, from: 'published', to: 'archived' })).toMatchObject({ ok: true })
  })
  it('mesmo status é no-op', () => {
    expect(decideStatusChange({ ...base, from: 'draft', to: 'draft' })).toEqual(livre)
  })
})

describe('decideStatusChange: a nota do Studio Pilari (reviewNote)', () => {
  const comNota = { ...base, approvedAt: aprovado, reviewNote: 'Aula 3 sem áudio.' }
  const instrutor = {}
  const adminDoPolo = { isTenantAdmin: true }
  const plataforma = { isPlatformAdmin: true, isTenantAdmin: true }
  const adminDaMatriz = { isMatriz: true, isTenantAdmin: true }

  it('só a aprovação apaga a nota: plataforma, e admin da matriz na matriz', () => {
    for (const quem of [plataforma, adminDaMatriz]) {
      expect(decideStatusChange({ ...comNota, ...quem, from: 'draft', to: 'published' })).toEqual({ ...livre, clearReviewNote: true })
      expect(decideStatusChange({ ...comNota, ...quem, from: 'in_review', to: 'published' })).toEqual({ ...livre, clearReviewNote: true })
    }
  })

  it('curso devolvido antes da primeira aprovação: a plataforma aprova, marca a aprovação e apaga a nota', () => {
    const d = decideStatusChange({ ...base, reviewNote: 'Falta a ementa.', ...plataforma, from: 'in_review', to: 'published' })
    expect(d).toEqual({ ...livre, markApproved: true, clearReviewNote: true })
  })

  it('enviar para análise e desistir NÃO apagam a nota, seja quem for', () => {
    for (const quem of [instrutor, adminDoPolo, plataforma, adminDaMatriz]) {
      expect(decideStatusChange({ ...comNota, ...quem, from: 'draft', to: 'in_review' })).toEqual({ ...livre, markSubmitted: true })
      expect(decideStatusChange({ ...comNota, ...quem, from: 'in_review', to: 'draft' })).toEqual(livre)
    }
  })

  it('tirar do ar e arquivar também não apagam', () => {
    expect(decideStatusChange({ ...comNota, ...instrutor, from: 'published', to: 'draft' })).toEqual(livre)
    expect(decideStatusChange({ ...comNota, ...adminDoPolo, from: 'published', to: 'archived' })).toEqual(livre)
  })

  it('o admin do polo que republica curso aprovado e sem nota não mexe em nota nenhuma', () => {
    expect(decideStatusChange({ ...base, approvedAt: aprovado, ...adminDoPolo, from: 'draft', to: 'published' })).toEqual(livre)
  })

  it('a cadeia análise → desistência → republicação não devolve o curso ao ar sem a plataforma', () => {
    // Era o furo: enviar para análise apagava a nota e desistir era livre; com a nota apagada, o
    // admin do polo republicava um curso que o Studio Pilari tinha tirado do ar. Aqui o estado
    // evolui pela política (a nota só some quando `clearReviewNote` vem ligado).
    type Estado = { status: CourseStatus; reviewNote: string | null }
    const aplica = (estado: Estado, quem: Partial<StatusChangeInput>, para: CourseStatus) => {
      const d = decideStatusChange({ ...base, approvedAt: aprovado, ...quem, from: estado.status, to: para, reviewNote: estado.reviewNote })
      const proximo: Estado = d.ok ? { status: para, reviewNote: d.clearReviewNote ? null : estado.reviewNote } : estado
      return { d, proximo }
    }
    let estado: Estado = { status: 'draft', reviewNote: 'Aula 3 sem áudio.' } // tirado do ar pela plataforma

    const envio = aplica(estado, instrutor, 'in_review')
    expect(envio.d.ok).toBe(true)
    estado = envio.proximo
    expect(estado).toEqual({ status: 'in_review', reviewNote: 'Aula 3 sem áudio.' })

    const desistencia = aplica(estado, instrutor, 'draft')
    expect(desistencia.d.ok).toBe(true)
    estado = desistencia.proximo
    expect(estado).toEqual({ status: 'draft', reviewNote: 'Aula 3 sem áudio.' })

    const polo = aplica(estado, adminDoPolo, 'published')
    expect(polo.d).toMatchObject({ ok: false, code: 'APPROVAL_REQUIRED' })
    expect(polo.d.ok ? '' : polo.d.message).toContain('O Studio Pilari pediu ajustes')

    const aprovacao = aplica(estado, plataforma, 'published')
    expect(aprovacao.d.ok).toBe(true)
    expect(aprovacao.proximo).toEqual({ status: 'published', reviewNote: null })
  })
})

describe('lockedFieldChanges', () => {
  const atual = { approvedAt: aprovado, title: 'Excel', workloadHours: 40, coordinatorName: 'Ana', coordinatorRole: 'Coord.', coordinatorSignaturePath: 'cursos/c1/signature/a.png' }

  it('formulário inteiro sem mudança nos campos travados passa', () => {
    expect(lockedFieldChanges(atual, { title: 'Excel', workloadHours: 40, coordinatorName: 'Ana' }, false)).toEqual([])
  })
  it('mudar título ou carga horária depois da aprovação é barrado', () => {
    expect(lockedFieldChanges(atual, { title: 'Excel Avançado', workloadHours: 360 }, false)).toEqual(['title', 'workloadHours'])
  })
  it('null e ausente são equivalentes', () => {
    expect(lockedFieldChanges({ ...atual, coordinatorRole: null }, { coordinatorRole: null }, false)).toEqual([])
  })
  it('antes da aprovação, nada trava', () => {
    expect(lockedFieldChanges({ ...atual, approvedAt: null }, { title: 'Outro' }, false)).toEqual([])
  })
  it('admin da plataforma nunca é barrado', () => {
    expect(lockedFieldChanges(atual, { title: 'Outro' }, true)).toEqual([])
  })
})

describe('lockedFieldsMessage', () => {
  const FIM = 'pelo Studio Pilari. Peça a alteração ao Studio Pilari.'

  it('um campo: o verbo fica no singular', () => {
    expect(lockedFieldsMessage(['workloadHours'])).toBe(`Depois da aprovação, a carga horária só muda ${FIM}`)
    expect(lockedFieldsMessage(['title'])).toBe(`Depois da aprovação, o título só muda ${FIM}`)
  })
  it('dois campos: "a e b", verbo no plural', () => {
    expect(lockedFieldsMessage(['title', 'workloadHours'])).toBe(`Depois da aprovação, o título e a carga horária só mudam ${FIM}`)
  })
  it('três ou mais: "a, b e c", sem vírgula antes do "e"', () => {
    expect(lockedFieldsMessage(['coordinatorName', 'coordinatorRole', 'coordinatorSignaturePath'])).toBe(
      `Depois da aprovação, o coordenador, o cargo do coordenador e a assinatura do coordenador só mudam ${FIM}`
    )
    expect(lockedFieldsMessage(['title', 'workloadHours', 'coordinatorName', 'coordinatorRole', 'coordinatorSignaturePath'])).toBe(
      `Depois da aprovação, o título, a carga horária, o coordenador, o cargo do coordenador e a assinatura do coordenador só mudam ${FIM}`
    )
  })
})
