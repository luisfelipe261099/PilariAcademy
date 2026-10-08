import { describe, expect, it } from 'vitest'
import { adminCourseActions, canDeleteCourse, canTakedownCourse, courseStatusUi, type StatusUiInput } from './status-ui'

const base: StatusUiInput = { status: 'draft', approvedAt: null, reviewNote: null, isTenantAdmin: false, isPlatformAdmin: false, isMatriz: false }
const matriz = { ...base, isMatriz: true }
const aprovado = '2026-09-01T00:00:00.000Z'

describe('courseStatusUi na matriz (igual a antes)', () => {
  it('admin publica direto', () => {
    expect(courseStatusUi({ ...matriz, isTenantAdmin: true })).toEqual({
      action: { to: 'published', label: 'Publicar', primary: true },
      hint: ['Rascunho não aparece no catálogo. Clique em ', { strong: 'Publicar' }, ' quando o curso estiver pronto.'],
    })
  })
  it('instrutor envia para revisão', () => {
    expect(courseStatusUi(matriz)).toEqual({
      action: { to: 'in_review', label: 'Enviar para revisão', primary: true },
      hint: ['Rascunho não aparece no catálogo. Quando o curso estiver pronto, clique em ', { strong: 'Enviar para revisão' }, ' — um admin aprova a publicação.'],
    })
  })
  it('em revisão cancela; publicado despublica', () => {
    expect(courseStatusUi({ ...matriz, status: 'in_review' })).toEqual({
      action: { to: 'draft', label: 'Cancelar revisão', primary: false },
      hint: ['Aguardando aprovação de um admin para ser publicado.'],
    })
    expect(courseStatusUi({ ...matriz, status: 'published' })).toEqual({ action: { to: 'draft', label: 'Despublicar', primary: false }, hint: null })
  })
  it('admin despublica curso publicado', () => {
    expect(courseStatusUi({ ...matriz, isTenantAdmin: true, status: 'published' }).action.to).toBe('draft')
  })
  it('admin republica curso arquivado, sem dica', () => {
    expect(courseStatusUi({ ...matriz, isTenantAdmin: true, status: 'archived' }).action.to).toBe('published')
    expect(courseStatusUi({ ...matriz, isTenantAdmin: true, status: 'archived' })).toEqual({ action: { to: 'published', label: 'Publicar', primary: true }, hint: null })
  })
  it('curso já aprovado não muda nada para o admin: a dica é a de sempre, não a da republicação do polo', () => {
    expect(courseStatusUi({ ...matriz, isTenantAdmin: true, approvedAt: aprovado }).hint).toEqual([
      'Rascunho não aparece no catálogo. Clique em ', { strong: 'Publicar' }, ' quando o curso estiver pronto.',
    ])
  })
})

describe('courseStatusUi no polo', () => {
  it('curso nunca aprovado vai para a análise do Studio Pilari, mesmo pelo admin do polo', () => {
    const ui = courseStatusUi({ ...base, isTenantAdmin: true })
    expect(ui.action).toEqual({ to: 'in_review', label: 'Enviar para revisão', primary: true })
    expect(ui.hint).toEqual(['Rascunho não aparece no catálogo. Quando o curso estiver pronto, clique em ', { strong: 'Enviar para revisão' }, ': a equipe do Studio Pilari aprova a publicação.'])
  })
  it('admin do polo republica curso aprovado sem nota pendente', () => {
    expect(courseStatusUi({ ...base, isTenantAdmin: true, approvedAt: aprovado }).action).toEqual({ to: 'published', label: 'Publicar', primary: true })
  })
  it('com nota do Studio Pilari, só nova análise', () => {
    expect(courseStatusUi({ ...base, isTenantAdmin: true, approvedAt: aprovado, reviewNote: 'Aula 3 sem áudio.' }).action.to).toBe('in_review')
  })
  it('em análise espera o Studio Pilari', () => {
    expect(courseStatusUi({ ...base, status: 'in_review' }).hint).toEqual(['Aguardando a aprovação do Studio Pilari.'])
  })
  it('a plataforma publica direto em qualquer polo', () => {
    expect(courseStatusUi({ ...base, isTenantAdmin: true, isPlatformAdmin: true }).action.to).toBe('published')
  })
  it('arquivado sem permissão de publicar volta para rascunho', () => {
    expect(courseStatusUi({ ...base, status: 'archived' }).action).toEqual({ to: 'draft', label: 'Voltar para rascunho', primary: false })
  })
  it('quem não é admin do polo envia para análise, mesmo com o curso já aprovado e sem nota', () => {
    expect(courseStatusUi({ ...base, approvedAt: aprovado }).action.to).toBe('in_review')
  })
  it('admin do polo despublica curso publicado, aprovado ou não', () => {
    expect(courseStatusUi({ ...base, isTenantAdmin: true, status: 'published', approvedAt: aprovado }).action.to).toBe('draft')
    expect(courseStatusUi({ ...base, isTenantAdmin: true, status: 'published' }).action.to).toBe('draft')
  })
  it('a plataforma despublica curso publicado em qualquer polo', () => {
    expect(courseStatusUi({ ...base, isTenantAdmin: true, isPlatformAdmin: true, status: 'published', approvedAt: aprovado }).action.to).toBe('draft')
  })
  it('republicação pelo admin do polo: a dica diz que o Studio Pilari já aprovou, e só no rascunho', () => {
    const adm = { ...base, isTenantAdmin: true, approvedAt: aprovado }
    expect(courseStatusUi(adm)).toEqual({
      action: { to: 'published', label: 'Publicar', primary: true },
      hint: ['Rascunho não aparece no catálogo. Este curso já foi aprovado pelo Studio Pilari: clique em ', { strong: 'Publicar' }, ' para colocá-lo de volta no ar.'],
    })
    expect(courseStatusUi({ ...adm, status: 'archived' })).toEqual({ action: { to: 'published', label: 'Publicar', primary: true }, hint: null })
  })
  it('a plataforma, mesmo com o curso já aprovado, recebe a dica de sempre e não a da republicação', () => {
    expect(courseStatusUi({ ...base, isTenantAdmin: true, isPlatformAdmin: true, approvedAt: aprovado }).hint).toEqual([
      'Rascunho não aparece no catálogo. Clique em ', { strong: 'Publicar' }, ' quando o curso estiver pronto.',
    ])
  })
})

describe('adminCourseActions', () => {
  it('matriz: as ações de antes', () => {
    const adm = { ...matriz, isTenantAdmin: true }
    expect(adminCourseActions({ ...adm, status: 'published' })).toEqual([{ to: 'draft', label: 'Despublicar', primary: true }])
    expect(adminCourseActions({ ...adm, status: 'in_review' })).toEqual([
      { to: 'published', label: 'Aprovar e publicar', primary: true },
      { to: 'draft', label: 'Devolver p/ rascunho', primary: false },
    ])
    expect(adminCourseActions(adm)).toEqual([{ to: 'published', label: 'Publicar', primary: true }])
  })
  it('polo: não aprova; republica só o já aprovado sem nota', () => {
    const adm = { ...base, isTenantAdmin: true }
    expect(adminCourseActions({ ...adm, status: 'in_review' })).toEqual([{ to: 'draft', label: 'Devolver p/ rascunho', primary: false }])
    expect(adminCourseActions(adm)).toEqual([])
    expect(adminCourseActions({ ...adm, approvedAt: aprovado })).toEqual([{ to: 'published', label: 'Publicar', primary: true }])
    expect(adminCourseActions({ ...adm, approvedAt: aprovado, reviewNote: 'x' })).toEqual([])
  })
  it('a plataforma, mesmo no endereço de um polo, aprova e publica como na matriz', () => {
    const plat = { ...base, isTenantAdmin: true, isPlatformAdmin: true }
    expect(adminCourseActions({ ...plat, status: 'in_review' })).toEqual([
      { to: 'published', label: 'Aprovar e publicar', primary: true },
      { to: 'draft', label: 'Devolver p/ rascunho', primary: false },
    ])
    expect(adminCourseActions({ ...plat, reviewNote: 'x' })).toEqual([{ to: 'published', label: 'Publicar', primary: true }])
  })
})

describe('canDeleteCourse', () => {
  it('curso nunca aprovado: o botão aparece para o admin do polo', () => {
    expect(canDeleteCourse({ approvedAt: null, isPlatformAdmin: false })).toBe(true)
  })
  it('curso já aprovado: o polo não vê o botão (o servidor recusaria com COURSE_HAS_HISTORY)', () => {
    expect(canDeleteCourse({ approvedAt: aprovado, isPlatformAdmin: false })).toBe(false)
  })
  it('a plataforma vê o botão em qualquer curso, aprovado ou não (matriz inclusive: seu admin é da plataforma)', () => {
    expect(canDeleteCourse({ approvedAt: aprovado, isPlatformAdmin: true })).toBe(true)
    expect(canDeleteCourse({ approvedAt: null, isPlatformAdmin: true })).toBe(true)
  })
  it('campo ausente (resposta de um servidor antigo) conta como nunca aprovado: quem decide é o servidor', () => {
    const semCampo = { isPlatformAdmin: false } as Pick<StatusUiInput, 'approvedAt' | 'isPlatformAdmin'>
    expect(canDeleteCourse(semCampo)).toBe(true)
  })
})

describe('canTakedownCourse', () => {
  const plataformaNoPolo = { status: 'published' as const, isPlatformAdmin: true, isMatriz: false }

  it('a plataforma, no endereço de um polo, tira do ar o curso publicado dele', () => {
    expect(canTakedownCourse(plataformaNoPolo)).toBe(true)
  })
  // Todo admin da matriz é da plataforma e já tem "Despublicar" no mesmo curso: o botão só apareceria em dobro.
  it('na matriz o botão não aparece, nem para o admin da plataforma', () => {
    expect(canTakedownCourse({ ...plataformaNoPolo, isMatriz: true })).toBe(false)
  })
  it('admin de polo que não é da plataforma não vê o botão', () => {
    expect(canTakedownCourse({ ...plataformaNoPolo, isPlatformAdmin: false })).toBe(false)
  })
  it.each(['draft', 'in_review', 'archived'] as const)('só curso publicado se tira do ar: %s não', (status) => {
    expect(canTakedownCourse({ ...plataformaNoPolo, status })).toBe(false)
  })
})
