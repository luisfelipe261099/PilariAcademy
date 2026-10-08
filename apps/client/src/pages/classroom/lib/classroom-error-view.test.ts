import { describe, expect, it } from 'vitest'
import { classroomErrorView } from './classroom-error-view'

/** Erro no formato do axios: a resposta do servidor fica em `response`. */
const erro = (status: number, data: unknown) => ({ isAxiosError: true, message: 'Request failed', response: { status, data } })

const PADRAO = {
  title: 'Acesso indisponível',
  message: 'Você precisa ter este curso para acessar a sala de aula.',
  link: { to: '/curso/excel-basico', label: 'Ver o curso' },
}

describe('classroomErrorView', () => {
  it('curso fora do ar para o matriculado: mostra a mensagem do servidor e leva aos cursos do aluno', () => {
    const view = classroomErrorView(
      erro(403, { statusCode: 403, code: 'COURSE_UNAVAILABLE', message: 'Este curso está indisponível no momento. Fale com o seu polo.' }),
      'excel-basico'
    )
    expect(view).toEqual({
      title: 'Curso indisponível',
      message: 'Este curso está indisponível no momento. Fale com o seu polo.',
      link: { to: '/dashboard', label: 'Ver meus cursos' },
    })
  })

  it('sem mensagem no corpo, usa o aviso padrão', () => {
    expect(classroomErrorView(erro(403, { code: 'COURSE_UNAVAILABLE' }), 'x').message).toBe('Este curso está indisponível no momento.')
    expect(classroomErrorView(erro(403, { code: 'COURSE_UNAVAILABLE', message: '  ' }), 'x').message).toBe('Este curso está indisponível no momento.')
  })

  it('403 sem o code (sem matrícula no curso publicado) mantém a tela de sempre', () => {
    expect(classroomErrorView(erro(403, { statusCode: 403, message: 'Você não tem acesso a este curso.' }), 'excel-basico')).toEqual(PADRAO)
  })

  it('o code só vale com 403: outro status com o mesmo code não troca a tela', () => {
    expect(classroomErrorView(erro(404, { code: 'COURSE_UNAVAILABLE', message: 'x' }), 'excel-basico')).toEqual(PADRAO)
  })

  it('404, erro de rede (sem resposta) e erro vazio mantêm a tela de sempre', () => {
    expect(classroomErrorView(erro(404, { statusCode: 404, message: 'Curso não encontrado.' }), 'excel-basico')).toEqual(PADRAO)
    expect(classroomErrorView(new Error('Network Error'), 'excel-basico')).toEqual(PADRAO)
    expect(classroomErrorView(null, 'excel-basico')).toEqual(PADRAO)
    expect(classroomErrorView(undefined, 'excel-basico')).toEqual(PADRAO)
    expect(classroomErrorView(erro(403, 'texto cru'), 'excel-basico')).toEqual(PADRAO)
  })
})
