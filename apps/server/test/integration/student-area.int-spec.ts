import { randomUUID } from 'node:crypto'
import * as http from 'node:http'
import type { AddressInfo } from 'node:net'
import { Readable } from 'node:stream'
import type { CourseStatus } from '@pilari/types'
import { bootTestApp, type TestApp } from './helpers/app'
import { createTestDatabase, type TestDatabase } from './helpers/db'
import { bearer, seedCourse, seedEnrollment, seedOrder, seedTwoPolos, type TwoPolos } from './helpers/seed'
import { eventually } from './helpers/wait'

describe('área do aluno por polo', () => {
  let t: TestDatabase
  let app: TestApp
  let w: TwoPolos
  let pedidoA: string

  beforeAll(async () => {
    t = await createTestDatabase()
    app = await bootTestApp(t.url)
    w = await seedTwoPolos(t)
    await seedOrder(t, { tenantId: w.matriz.id, userId: w.u.shared })
    pedidoA = await seedOrder(t, { tenantId: w.a.id, userId: w.u.shared })
  })
  afterAll(async () => {
    try {
      await app?.close()
    } finally {
      await t?.drop()
    }
  })

  const comoCompartilhado = (host: string, path: string) =>
    app.http().get(path).set('Host', host).set('Authorization', bearer(w.u.shared))

  it('o aluno compartilhado vê em cada polo só as matrículas daquele polo', async () => {
    const a = await comoCompartilhado(w.a.host, '/api/me/enrollments')
    const b = await comoCompartilhado(w.b.host, '/api/me/enrollments')
    expect((a.body.enrollments as Array<{ course: { title: string } }>).map((e) => e.course.title)).toEqual(['Excel do Polo A'])
    expect((b.body.enrollments as Array<{ course: { title: string } }>).map((e) => e.course.title)).toEqual(['Excel do Polo B'])
  })

  it('o mesmo slug abre a sala de aula do polo do endereço', async () => {
    const noA = await app.http().get('/api/me/courses/excel-basico/classroom').set('Host', w.a.host).set('Authorization', bearer(w.u.studentA))
    expect(noA.status).toBe(200)
    expect(noA.body.courseId).toBe(w.courses.a.id)
    const noB = await app.http().get('/api/me/courses/excel-basico/classroom').set('Host', w.b.host).set('Authorization', bearer(w.u.studentA))
    expect(noB.status).toBe(403)
  })

  it('progresso em aula de outro polo responde 404', async () => {
    const path = `/api/me/lessons/${w.courses.a.lessonId}/progress`
    expect((await app.http().put(path).set('Host', w.b.host).set('Authorization', bearer(w.u.shared)).send({ completed: true })).status).toBe(404)
    expect((await app.http().put(path).set('Host', w.a.host).set('Authorization', bearer(w.u.shared)).send({ completed: true })).status).toBe(200)
  })

  it('os pedidos do aluno são os do polo do endereço', async () => {
    const r = await comoCompartilhado(w.a.host, '/api/me/orders')
    expect((r.body as Array<{ id: string }>).map((o) => o.id)).toEqual([pedidoA])
  })

  describe('PDF de anexo servido pelo domínio do app', () => {
    // O proxy confere a assinatura %PDF com um download de intervalo e repassa o objeto em stream: um PDF grande não é
    // carregado inteiro na memória, chega completo e sempre como application/pdf.
    const pdfGrande = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(200 * 1024, 0x61), Buffer.from('\n%%EOF')])
    /** Parser do supertest que junta o corpo binário (o padrão não guarda application/pdf). */
    const binario = (res: unknown, cb: (err: Error | null, body: Buffer) => void) => {
      const fluxo = res as NodeJS.ReadableStream
      const pedacos: Buffer[] = []
      fluxo.on('data', (c: Buffer) => pedacos.push(Buffer.from(c)))
      fluxo.on('end', () => cb(null, Buffer.concat(pedacos)))
    }
    const anexar = async (fileName: string, caminho: string, conteudo: Buffer) => {
      const id = randomUUID()
      await t.pool.query('INSERT INTO lesson_attachments (id, lesson_id, file_name, file_url) VALUES (?, ?, ?, ?)', [id, w.courses.a.lessonId, fileName, caminho])
      app.fakes.gcs.objects.set(caminho, { buffer: conteudo, contentType: 'text/html' }) // o tipo gravado no GCS não vale
      return id
    }
    /** A URL do proxy que a sala de aula entrega para o anexo. */
    const urlDoAnexo = async (id: string) => {
      const sala = await app.http().get('/api/me/courses/excel-basico/classroom').set('Host', w.a.host).set('Authorization', bearer(w.u.studentA))
      const anexos = (sala.body.modules as Array<{ lessons: Array<{ attachments: Array<{ id: string; url: string }> }> }>).flatMap((m) => m.lessons.flatMap((l) => l.attachments))
      return anexos.find((a) => a.id === id)?.url ?? ''
    }

    it('o PDF chega inteiro, como application/pdf e com o nome do arquivo', async () => {
      const caminho = `cursos/${w.courses.a.id}/attachment/apostila.pdf`
      const id = await anexar('Apostila "Excel".pdf', caminho, pdfGrande)
      app.fakes.gcs.objects.set(caminho, { buffer: pdfGrande, contentType: 'text/html', generation: '1700000000000007' })
      const url = await urlDoAnexo(id)
      expect(url).toMatch(new RegExp(`^/api/files/attachments/${id}/pdf\\?exp=\\d+&sig=`))
      const r = await app.http().get(url).set('Host', w.a.host).buffer(true).parse(binario)
      expect(r.status).toBe(200)
      expect(r.headers['content-type']).toBe('application/pdf')
      expect(r.headers['content-disposition']).toBe('inline; filename="Apostila Excel.pdf"')
      expect(Buffer.compare(r.body as Buffer, pdfGrande)).toBe(0)
      expect(app.fakes.gcs.headReads).toContain(caminho)
      expect(app.fakes.gcs.streams).toContain(caminho)
      expect(app.fakes.gcs.reads).not.toContain(caminho) // nunca baixado inteiro para a memória
      // a conferência do %PDF e o stream leram a geração que o metadado informou
      expect(app.fakes.gcs.pinnedReads.filter((l) => l.path === caminho)).toEqual([
        { op: 'head', path: caminho, generation: '1700000000000007' },
        { op: 'stream', path: caminho, generation: '1700000000000007' },
      ])
    })

    describe('falha e desistência no meio do stream', () => {
      // O stream do GCS pode falhar (objeto apagado, bucket fora) e quem pede pode desistir no meio. As requisições
      // abaixo são HTTP cru: só assim dá para ver o corpo truncado e derrubar a conexão no meio do download.
      interface Resposta { status: number; headers: http.IncomingHttpHeaders; completa: boolean; corpo: Buffer }
      const baixarCru = (caminho: string, aoReceber?: (req: http.ClientRequest) => void): Promise<Resposta> => {
        const servidor = app.app.getHttpServer() as http.Server
        const escutar = servidor.listening ? Promise.resolve() : new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', () => ok()))
        return escutar.then(
          () =>
            new Promise<Resposta>((ok, falha) => {
              const { port } = servidor.address() as AddressInfo
              const req = http.get({ host: '127.0.0.1', port, path: caminho, headers: { Host: w.a.host } }, (res) => {
                const pedacos: Buffer[] = []
                res.on('data', (c: Buffer) => {
                  pedacos.push(c)
                  aoReceber?.(req)
                })
                res.on('error', () => undefined) // conexão derrubada: o que importa é `complete`, conferido no close
                res.on('close', () => ok({ status: res.statusCode ?? 0, headers: res.headers, completa: res.complete, corpo: Buffer.concat(pedacos) }))
              })
              req.on('error', (e) => (aoReceber ? undefined : falha(e)))
            })
        )
      }
      /** Anexo com cabeçalho de PDF de verdade (a conferência passa) cujo stream é o que o teste mandar. */
      const anexoComStream = async (nome: string, fonte: Readable) => {
        const caminho = `cursos/${w.courses.a.id}/attachment/${nome}`
        const id = await anexar(nome, caminho, Buffer.from('%PDF-1.7\nconteúdo'))
        jest.spyOn(app.fakes.gcs, 'openReadStream').mockReturnValueOnce(fonte)
        return urlDoAnexo(id)
      }
      afterEach(() => jest.restoreAllMocks())

      it('falha depois de começar: a conexão cai (download falho), nunca um 200 completo com o PDF truncado', async () => {
        const fonte = new Readable({ read() {} })
        fonte.push(Buffer.from(`%PDF-1.7\n${'a'.repeat(32 * 1024)}`))
        const r = await baixarCru(await anexoComStream('quebra-no-meio.pdf', fonte), () => {
          if (!fonte.destroyed) fonte.destroy(new Error('GCS caiu no meio do download'))
        })
        expect(r.status).toBe(200)
        expect(r.completa).toBe(false)
      })

      it('falha antes do primeiro byte: 404 em texto e Cache-Control no-store (o navegador não guarda o erro)', async () => {
        const fonte = new Readable({ read() { this.destroy(new Error('objeto sumiu do bucket')) } })
        const r = await baixarCru(await anexoComStream('sumiu.pdf', fonte))
        expect([r.status, r.completa, r.corpo.toString()]).toEqual([404, true, 'PDF indisponível.'])
        expect(r.headers['cache-control']).toBe('no-store')
        expect(r.headers['content-type']).toContain('text/plain')
        expect(r.headers['content-disposition']).toBeUndefined()
      })

      it('quem desiste no meio derruba também o stream do GCS (a conexão com o bucket não fica aberta)', async () => {
        const fonte = new Readable({ read() {} }) // nunca termina sozinho: só fecha se alguém o destruir
        fonte.push(Buffer.from(`%PDF-1.7\n${'b'.repeat(64 * 1024)}`))
        await baixarCru(await anexoComStream('desistencia.pdf', fonte), (req) => req.destroy())
        expect(await eventually(async () => fonte.destroyed, (v) => v)).toBe(true)
      })
    })

    it('arquivo que não começa com %PDF (HTML disfarçado) dá 404 e nem chega a ser transmitido', async () => {
      const caminho = `cursos/${w.courses.a.id}/attachment/disfarcado.pdf`
      const id = await anexar('disfarcado.pdf', caminho, Buffer.from('<html><script>alert(1)</script></html>'))
      const r = await app.http().get(await urlDoAnexo(id)).set('Host', w.a.host)
      expect(r.status).toBe(404)
      expect(app.fakes.gcs.streams).not.toContain(caminho)
    })
  })

  describe('curso fora do ar para quem está matriculado', () => {
    // Quem comprou sabe que o curso existe: recebe o aviso (403 COURSE_UNAVAILABLE) em vez de um 404 que parece
    // erro do site. Quem não tem matrícula ativa continua no 404, que não revela rascunho.
    const NO_POLO = 'Este curso está indisponível no momento. Fale com o seu polo.'
    const NA_MATRIZ = 'Este curso está indisponível no momento.'
    let seq = 0
    const sala = (host: string, uid: string, slug: string) =>
      app.http().get(`/api/me/courses/${slug}/classroom`).set('Host', host).set('Authorization', bearer(uid))
    const cursoFora = async (tenantId: string, instructorId: string, status: CourseStatus, nota: string | null = null) => {
      seq += 1
      const c = await seedCourse(t, { tenantId, slug: `fora-do-ar-${seq}`, title: `Fora do Ar ${seq}`, instructorId, status, approved: true })
      if (nota) await t.pool.query('UPDATE courses SET review_note = ? WHERE id = ?', [nota, c.id])
      return c
    }

    it('no polo: rascunho (com ou sem nota), em análise e arquivado dão 403 COURSE_UNAVAILABLE ao matriculado e 404 a quem não é', async () => {
      const casos: Array<[CourseStatus, string | null]> = [['draft', null], ['draft', 'Aula 3 sem áudio.'], ['in_review', null], ['archived', null]]
      for (const [status, nota] of casos) {
        const c = await cursoFora(w.a.id, w.u.teacherA, status, nota)
        await seedEnrollment(t, { userId: w.u.studentA, courseId: c.id })
        const matriculado = await sala(w.a.host, w.u.studentA, c.slug)
        expect([status, nota, matriculado.status, matriculado.body]).toEqual([
          status, nota, 403, { statusCode: 403, code: 'COURSE_UNAVAILABLE', message: NO_POLO },
        ])
        // aluno do polo sem matrícula nesse curso: o rascunho não aparece
        const semMatricula = await sala(w.a.host, w.u.shared, c.slug)
        expect([status, semMatricula.status, semMatricula.body.code]).toEqual([status, 404, undefined])
      }
    })

    it('matrícula cancelada ou pendente não conta: 404 como quem não tem', async () => {
      for (const situacao of ['canceled', 'pending'] as const) {
        const c = await cursoFora(w.a.id, w.u.teacherA, 'draft')
        await seedEnrollment(t, { userId: w.u.studentA, courseId: c.id, status: situacao })
        expect([situacao, (await sala(w.a.host, w.u.studentA, c.slug)).status]).toEqual([situacao, 404])
      }
    })

    it('na matriz o aviso não manda falar com o polo', async () => {
      const c = await cursoFora(w.matriz.id, w.u.adminMatriz, 'draft')
      await seedEnrollment(t, { userId: w.u.studentA, courseId: c.id })
      const r = await sala(w.matriz.host, w.u.studentA, c.slug)
      expect([r.status, r.body.code, r.body.message]).toEqual([403, 'COURSE_UNAVAILABLE', NA_MATRIZ])
    })

    it('curso publicado segue como antes: matriculado entra, quem não é recebe 403 de acesso', async () => {
      expect((await sala(w.a.host, w.u.studentA, 'excel-basico')).status).toBe(200)
      const semAcesso = await sala(w.b.host, w.u.studentA, 'excel-basico')
      expect([semAcesso.status, semAcesso.body.code]).toEqual([403, undefined])
    })
  })
})
