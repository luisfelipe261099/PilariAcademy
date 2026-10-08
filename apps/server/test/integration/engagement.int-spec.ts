import { randomUUID } from 'node:crypto'
import { bootTestApp, type TestApp } from './helpers/app'
import { createTestDatabase, type TestDatabase } from './helpers/db'
import { bearer, seedCourse, seedMember, seedTwoPolos, seedUser, type TwoPolos } from './helpers/seed'

describe('anúncios, anotações e avaliações por polo', () => {
  let t: TestDatabase
  let app: TestApp
  let w: TwoPolos

  beforeAll(async () => {
    t = await createTestDatabase()
    app = await bootTestApp(t.url)
    w = await seedTwoPolos(t)
    for (const [courseId, uid, rating] of [[w.courses.a.id, w.u.studentA, 5], [w.courses.b.id, w.u.studentB, 2]] as const) {
      await t.pool.query('INSERT INTO course_reviews (id, course_id, user_id, rating, comment) VALUES (?, ?, ?, ?, ?)', [randomUUID(), courseId, uid, rating, null])
    }
  })
  afterAll(async () => {
    try {
      await app?.close()
    } finally {
      await t?.drop()
    }
  })

  it('as avaliações públicas do mesmo slug são as do polo do endereço', async () => {
    expect((await app.http().get('/api/courses/excel-basico/reviews').set('Host', w.a.host)).body.average).toBe(5)
    expect((await app.http().get('/api/courses/excel-basico/reviews').set('Host', w.b.host)).body.average).toBe(2)
  })

  it('anotação em aula de outro polo responde 404', async () => {
    const r = await app.http().post(`/api/me/lessons/${w.courses.a.lessonId}/notes`).set('Host', w.b.host).set('Authorization', bearer(w.u.shared)).send({ atSec: 10, body: 'oi' })
    expect(r.status).toBe(404)
  })

  it('anúncio em curso de outro polo responde 404', async () => {
    const r = await app.http().post(`/api/instructor/courses/${w.courses.b.id}/announcements`).set('Host', w.a.host).set('Authorization', bearer(w.u.adminA)).send({ title: 'x', body: 'y' })
    expect(r.status).toBe(404)
  })

  it('o aluno lê os anúncios do curso do polo do endereço', async () => {
    await app.http().post(`/api/instructor/courses/${w.courses.a.id}/announcements`).set('Host', w.a.host).set('Authorization', bearer(w.u.teacherA)).send({ title: 'Aula extra', body: 'Sexta' })
    const a = await app.http().get('/api/me/courses/excel-basico/announcements').set('Host', w.a.host).set('Authorization', bearer(w.u.shared))
    const b = await app.http().get('/api/me/courses/excel-basico/announcements').set('Host', w.b.host).set('Authorization', bearer(w.u.shared))
    expect((a.body.announcements as Array<{ title: string }>).map((x) => x.title)).toEqual(['Aula extra'])
    expect(b.body.announcements).toEqual([])
  })

  // Os quatro testes de cima são os do enunciado e dependem do estado semeado (a média das avaliações,
  // os anúncios do curso A). Os de baixo gravam por cima disso, por isso vêm depois.

  const como = (host: string, uid: string) => ({ Host: host, Authorization: bearer(uid) })
  const contar = async (tabela: string, onde: string, valores: string[]): Promise<number> => {
    const [rows] = await t.pool.query(`SELECT COUNT(*) AS n FROM ${tabela} WHERE ${onde}`, valores)
    return Number((rows as Array<{ n: number }>)[0].n)
  }

  describe('anotações', () => {
    it('a anotação nasce no curso da aula e só aparece e só se apaga pelo endereço do polo dele', async () => {
      const criada = await app.http().post(`/api/me/lessons/${w.courses.a.lessonId}/notes`).set(como(w.a.host, w.u.shared)).send({ atSec: 42, body: 'anotação do polo A' })
      expect(criada.status).toBe(201)
      const noteId = criada.body.note.id as string

      const noA = await app.http().get('/api/me/courses/excel-basico/notes').set(como(w.a.host, w.u.shared))
      const noB = await app.http().get('/api/me/courses/excel-basico/notes').set(como(w.b.host, w.u.shared))
      expect((noA.body.notes as Array<{ body: string }>).map((n) => n.body)).toEqual(['anotação do polo A'])
      expect(noB.body.notes).toEqual([])

      const foraDoPolo = await app.http().delete(`/api/me/notes/${noteId}`).set(como(w.b.host, w.u.shared))
      expect(foraDoPolo.status).toBe(404)
      expect(await contar('lesson_notes', 'id = ?', [noteId])).toBe(1)

      const doPolo = await app.http().delete(`/api/me/notes/${noteId}`).set(como(w.a.host, w.u.shared))
      expect(doPolo.status).toBe(200)
      expect(await contar('lesson_notes', 'id = ?', [noteId])).toBe(0)
    })

    it('a anotação de outro aluno continua inalcançável, mesmo no polo certo', async () => {
      const criada = await app.http().post(`/api/me/lessons/${w.courses.a.lessonId}/notes`).set(como(w.a.host, w.u.studentA)).send({ atSec: 5, body: 'só minha' })
      const noteId = criada.body.note.id as string
      const alheia = await app.http().delete(`/api/me/notes/${noteId}`).set(como(w.a.host, w.u.shared))
      expect(alheia.status).toBe(404)
      expect(await contar('lesson_notes', 'id = ?', [noteId])).toBe(1)
    })
  })

  describe('anúncios', () => {
    it('anúncio do polo B: o admin do polo A recebe 404 ao listar e apagar por id, e os do B conseguem', async () => {
      const criado = await app.http().post(`/api/instructor/courses/${w.courses.b.id}/announcements`).set(como(w.b.host, w.u.teacherB)).send({ title: 'Aviso do B', body: 'Segunda' })
      expect(criado.status).toBe(201)
      const id = criado.body.announcement.id as string

      expect((await app.http().get(`/api/instructor/courses/${w.courses.b.id}/announcements`).set(como(w.a.host, w.u.adminA))).status).toBe(404)
      const noB = await app.http().get(`/api/instructor/courses/${w.courses.b.id}/announcements`).set(como(w.b.host, w.u.adminB))
      expect((noB.body.announcements as Array<{ id: string }>).map((x) => x.id)).toEqual([id])

      expect((await app.http().delete(`/api/instructor/announcements/${id}`).set(como(w.a.host, w.u.adminA))).status).toBe(404)
      expect(await contar('course_announcements', 'id = ?', [id])).toBe(1)

      expect((await app.http().delete(`/api/instructor/announcements/${id}`).set(como(w.b.host, w.u.adminB))).status).toBe(200)
      expect(await contar('course_announcements', 'id = ?', [id])).toBe(0)
    })

    it('o admin da plataforma anuncia no curso do polo do endereço, e só nele', async () => {
      const corpo = { title: 'Da plataforma', body: 'Aviso geral' }
      const noA = await app.http().post(`/api/instructor/courses/${w.courses.a.id}/announcements`).set(como(w.a.host, w.u.platform)).send(corpo)
      expect(noA.status).toBe(201)
      const noBPeloA = await app.http().post(`/api/instructor/courses/${w.courses.b.id}/announcements`).set(como(w.a.host, w.u.platform)).send(corpo)
      expect(noBPeloA.status).toBe(404)
    })

    it('anúncio de colega do mesmo polo: o instrutor recebe 403 e o admin do polo cria', async () => {
      const colega = 'u-prof-a-colega'
      await seedUser(t, { uid: colega })
      await seedMember(t, w.a.id, colega, ['teacher'])
      const corpo = { title: 'Do colega', body: 'não é meu curso' }
      expect((await app.http().post(`/api/instructor/courses/${w.courses.a.id}/announcements`).set(como(w.a.host, colega)).send(corpo)).status).toBe(403)
      expect((await app.http().post(`/api/instructor/courses/${w.courses.a.id}/announcements`).set(como(w.a.host, w.u.adminA)).send(corpo)).status).toBe(201)
    })
  })

  describe('avaliações', () => {
    it('o aluno compartilhado avalia o curso do polo do endereço, e só ele', async () => {
      const r = await app.http().put('/api/me/courses/excel-basico/reviews').set(como(w.a.host, w.u.shared)).send({ rating: 4, comment: 'bom' })
      expect(r.status).toBe(200)
      expect(await contar('course_reviews', 'course_id = ? AND user_id = ?', [w.courses.a.id, w.u.shared])).toBe(1)
      expect(await contar('course_reviews', 'course_id = ? AND user_id = ?', [w.courses.b.id, w.u.shared])).toBe(0)

      const noA = await app.http().get('/api/me/courses/excel-basico/reviews').set(como(w.a.host, w.u.shared))
      const noB = await app.http().get('/api/me/courses/excel-basico/reviews').set(como(w.b.host, w.u.shared))
      expect(noA.body.mine.rating).toBe(4)
      expect(noB.body.mine).toBeNull()
    })

    it('aluno de um polo não avalia, pelo endereço do outro, o curso de mesmo slug', async () => {
      const r = await app.http().put('/api/me/courses/excel-basico/reviews').set(como(w.b.host, w.u.studentA)).send({ rating: 1, comment: null })
      expect(r.status).toBe(403)
      expect(await contar('course_reviews', 'course_id = ? AND user_id = ?', [w.courses.b.id, w.u.studentA])).toBe(0)
    })
  })

  describe('avaliações públicas só de curso publicado', () => {
    it('curso fora do ar (rascunho, em análise, arquivado) responde 404 e não expõe o nome de quem avaliou', async () => {
      for (const situacao of ['draft', 'in_review', 'archived'] as const) {
        const c = await seedCourse(t, { tenantId: w.a.id, slug: `avaliado-${situacao}`, title: `Avaliado ${situacao}`, instructorId: w.u.teacherA, status: situacao, approved: true })
        await t.pool.query('INSERT INTO course_reviews (id, course_id, user_id, rating, comment) VALUES (?, ?, ?, ?, ?)', [randomUUID(), c.id, w.u.studentA, 4, 'bom'])
        const r = await app.http().get(`/api/courses/${c.slug}/reviews`).set('Host', w.a.host)
        expect([situacao, r.status, r.body.message]).toEqual([situacao, 404, 'Curso não encontrado.'])
        expect(JSON.stringify(r.body)).not.toContain('Usuário u-aluno-a')
        // logado também não: nem quem avaliou, nem outro aluno do polo
        for (const uid of [w.u.studentA, w.u.shared]) {
          const logado = await app.http().get(`/api/me/courses/${c.slug}/reviews`).set(como(w.a.host, uid))
          expect([situacao, uid, logado.status, logado.body.message]).toEqual([situacao, uid, 404, 'Curso não encontrado.'])
          expect(JSON.stringify(logado.body)).not.toContain('Usuário u-aluno-a')
        }
      }
      // o curso publicado continua com as avaliações públicas e com "a minha" para quem está logado
      expect((await app.http().get('/api/courses/excel-basico/reviews').set('Host', w.a.host)).status).toBe(200)
      expect((await app.http().get('/api/me/courses/excel-basico/reviews').set(como(w.a.host, w.u.studentA))).status).toBe(200)
    })
  })

  describe('slug que só existe em outro polo', () => {
    it('responde 404 nas leituras e escritas por slug, e 200 no polo dono', async () => {
      await seedCourse(t, { tenantId: w.b.id, slug: 'so-no-b', title: 'Só no B', instructorId: w.u.teacherB })
      const get = (host: string, caminho: string) => app.http().get(caminho).set(como(host, w.u.shared))

      expect((await app.http().get('/api/courses/so-no-b/reviews').set('Host', w.a.host)).status).toBe(404)
      expect((await app.http().get('/api/courses/so-no-b/reviews').set('Host', w.b.host)).status).toBe(200)
      expect((await get(w.a.host, '/api/me/courses/so-no-b/reviews')).status).toBe(404)
      expect((await get(w.a.host, '/api/me/courses/so-no-b/notes')).status).toBe(404)
      expect((await get(w.a.host, '/api/me/courses/so-no-b/announcements')).status).toBe(404)
      expect((await app.http().put('/api/me/courses/so-no-b/reviews').set(como(w.a.host, w.u.shared)).send({ rating: 5 })).status).toBe(404)
      // No B o aluno compartilhado não está matriculado nesse curso: o curso existe, o acesso é que falta.
      expect((await get(w.b.host, '/api/me/courses/so-no-b/announcements')).status).toBe(403)
    })
  })
})
