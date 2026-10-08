/// <reference types="jest" />
import { ForbiddenException } from '@nestjs/common'
import { courseUnavailable } from './course-unavailable'

describe('courseUnavailable', () => {
  it('é um 403 com code estável', () => {
    const erro = courseUnavailable(false)
    expect(erro).toBeInstanceOf(ForbiddenException)
    expect(erro.getResponse()).toMatchObject({ statusCode: 403, code: 'COURSE_UNAVAILABLE' })
  })

  it('nos polos manda falar com o polo; na matriz, não', () => {
    expect(courseUnavailable(false).getResponse()).toMatchObject({ message: 'Este curso está indisponível no momento. Fale com o seu polo.' })
    expect(courseUnavailable(true).getResponse()).toMatchObject({ message: 'Este curso está indisponível no momento.' })
  })
})
