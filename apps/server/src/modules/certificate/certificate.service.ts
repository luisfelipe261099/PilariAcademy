import { BadRequestException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import * as QRCode from 'qrcode'
import { and, count, desc, eq, isNotNull, sum } from 'drizzle-orm'
import type { CertificateVerification, EnrollmentSource, MyCertificate, OrderSettlement } from '@pilari/types'
import { courses, enrollments, lessons, modules, orders, tenants, users } from '../../db/schema'
import { lessonProgress } from '../../db/schemas/progress.schema'
import { certificates } from '../../db/schemas/certificates.schema'
import type { Database } from '../../db/types'
import { GcsService, MAX_IMAGE_BYTES, MAX_PDF_CACHE_BYTES } from '../classroom/gcs.service'
import { PdfService, type CertData } from './pdf.service'
import { CertificateTemplateService } from './certificate-template.service'
import { QuizService } from '../quiz/quiz.service'
import { InstallmentsService } from '../enrollments/installments.service'
import { AsaasService } from '../enrollments/asaas.service'
import { certificateWorkloadHours } from '../../common/lib/certificate-workload'
import { courseUnavailable } from '../../common/lib/course-unavailable'
import { CourseScopeService, type CourseRow } from '../tenancy/course-scope.service'
import type { TenantContext } from '../tenancy/tenant-context'

const DEFAULT_WEB_URL = 'https://cursos.studiopilari.com.br'

/**
 * Nome que vai impresso no certificado. NUNCA cai para o e-mail nem para um genérico:
 * o certificado é documento. O nome entra no snapshot na emissão e, na reemissão,
 * acompanha o cadastro (bloco `alvo` do issueOrGet) — mas o que sair errado hoje fica
 * no documento até alguém corrigir o cadastro e baixar de novo.
 * Sem nome cadastrado, é melhor barrar e pedir que o aluno complete o perfil.
 */
/**
 * Assinatura de um snapshot envenenado pelo fallback antigo (`displayName || email`).
 * Nome de pessoa não tem arroba, então isto não gera falso positivo — e é o único
 * marcador que sobrou para distinguir esses registros dos legítimos.
 */
function looksLikeEmail(nome: string | null): boolean {
  return !!nome && nome.includes('@')
}

function limpaNome(s: string | null | undefined): string {
  return (s ?? '').trim().replace(/\s+/g, ' ')
}

/**
 * Nome do CADASTRO em condição de ir para o documento; `null` quando vazio, curto demais
 * ou e-mail. Mesma régua do `requireStudentName`, sem o erro: na ressincronização,
 * cadastro sem nome válido significa "deixa o snapshot como está", não "barra".
 */
function nomeCadastradoValido(displayName: string | null | undefined): string | null {
  const nome = limpaNome(displayName)
  return !nome || looksLikeEmail(nome) || nome.length < 3 ? null : nome
}

/**
 * O nome do cadastro manda; o informado no ato do download é a SAÍDA DE EMERGÊNCIA.
 * Não existe tela de perfil para o aluno (só admin e instrutor editam nome), então
 * barrar quem não tem nome cadastrado sem aceitar o nome aqui é um beco sem saída:
 * o aluno não teria como se desbloquear. O cadastro vencer o informado impede que
 * quem já tem nome registrado imprima outro no documento.
 */
function requireStudentName(user: { displayName: string | null } | undefined, informado?: string): string {
  const cadastrado = limpaNome(user?.displayName)
  const nome = !cadastrado || looksLikeEmail(cadastrado) ? limpaNome(informado) : cadastrado
  if (!nome || looksLikeEmail(nome) || nome.length < 3) {
    throw new BadRequestException('Informe seu nome completo para emitir o certificado.')
  }
  return nome
}

function onlyDigits(s?: string | null): string { return (s ?? '').replace(/\D/g, '') }
function formatCpf(s?: string | null): string {
  const d = onlyDigits(s)
  return d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : ''
}
function maskCpf(s?: string | null): string { return onlyDigits(s).length === 11 ? '***.***.***-**' : '' }

@Injectable()
export class CertificateService {
  private readonly logger = new Logger(CertificateService.name)

  constructor(
    @Inject('DB_CLIENT') private readonly db: Database,
    private readonly pdf: PdfService,
    private readonly quiz: QuizService,
    private readonly gcs: GcsService,
    private readonly config: ConfigService,
    private readonly templates: CertificateTemplateService,
    private readonly installments: InstallmentsService,
    private readonly asaas: AsaasService,
    private readonly scope: CourseScopeService
  ) {}

  /**
   * URL de verificação impressa no PDF e no QR: `WEB_PUBLIC_URL` ou o domínio da matriz, NUNCA o endereço
   * do polo. O papel impresso tem que continuar verificável se o polo trocar de domínio ou for suspenso, e
   * a verificação é global pelo código.
   */
  private verifyUrl(code: string): string {
    const base = (this.config.get<string>('WEB_PUBLIC_URL') || DEFAULT_WEB_URL).replace(/\/+$/, '')
    return `${base}/certificado/${code}`
  }

  /** Renderiza o PDF a partir do snapshot congelado no registro do certificado. */
  private async renderPdf(
    cert: typeof certificates.$inferSelect,
    opts?: { maskCpf?: boolean },
    /** HTML já resolvido pelo chamador, junto do fingerprint que nomeia o cache. */
    html?: string
  ): Promise<Buffer> {
    const verifyUrl = this.verifyUrl(cert.code)
    const svg = await QRCode.toString(verifyUrl, { type: 'svg', margin: 1, width: 240 })
    const qrDataUri = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
    const data: CertData = {
      studentName: cert.studentName ?? 'Aluno',
      courseTitle: cert.courseTitle ?? '',
      hours: cert.hours ?? 1,
      issuedAt: cert.issuedAt ?? new Date(),
      code: cert.code,
      qrDataUri,
      verifyUrl,
      cpf: opts?.maskCpf ? maskCpf(cert.cpf) : formatCpf(cert.cpf),
      // Do SNAPSHOT, não do curso: quem assinou o documento emitido não muda depois.
      coordinatorName: cert.coordinatorName ?? undefined,
      coordinatorRole: cert.coordinatorRole ?? undefined,
      // Lida só do prefixo do curso DESTE certificado (vale também para o valor congelado no snapshot).
      coordinatorSignatureDataUri: await this.signatureDataUri(cert.coordinatorSignaturePath, cert.courseId),
    }
    // Passa o HTML RESOLVIDO (banco ou fábrica) em vez de deixar o PdfService cair no
    // fallback: só assim o fingerprint usado no caminho do cache corresponde exatamente
    // ao HTML que gerou este PDF. Resolvido UMA vez pelo chamador — resolver aqui também
    // faria duas consultas ao banco e dois hashes por PDF gerado.
    const resolvido = html ?? (await this.templates.getActiveHtmlWithFingerprint(cert.courseId)).html
    return this.pdf.generate(data, resolvido)
  }

  /**
   * Invalida o PDF cacheado de todos os certificados. O próximo download re-renderiza com o
   * template atual e regrava no GCS (path determinístico). Os dados do snapshot permanecem
   * congelados — só a apresentação (layout) acompanha.
   * Duas caches: o PDF autenticado (path no DB `pdfPath`) e o PDF público mascarado
   * (objeto determinístico no GCS `…-public.pdf`, sem coluna) — ambos são limpos aqui.
   */
  /**
   * Coordenador de um curso, para o preview do editor de template. Sem isto o preview usa
   * dados fictícios e o bloco da 2ª assinatura nunca aparece — o admin não teria como
   * conferir o layout que está editando.
   */
  /** Coordenador cadastrado HOJE no curso, para o caminho público, que não escreve. */
  private async coordenadorDoCurso(
    courseId: string
  ): Promise<{ name: string | null; role: string | null; signaturePath: string | null }> {
    const rows = await this.db
      .select({
        name: courses.coordinatorName,
        role: courses.coordinatorRole,
        signaturePath: courses.coordinatorSignaturePath,
      })
      .from(courses)
      .where(eq(courses.id, courseId))
      .limit(1)
    return rows[0] ?? { name: null, role: null, signaturePath: null }
  }

  /**
   * Lê a rubrica do GCS e devolve como data URI. `undefined` em qualquer falha (arquivo apagado,
   * GCS fora do ar): certificado sem assinatura é ruim, certificado que NÃO SAI é pior.
   *
   * Só lê objeto do prefixo do PRÓPRIO curso (`cursos/<id>/`). O caminho vem de um valor guardado — o
   * cadastro do curso, o snapshot congelado do certificado — e a leitura usa a service account, que
   * enxerga o bucket inteiro. A gravação já barra caminho alheio (autoria, Task 14), mas valor legado ou
   * congelado antes dessa trava não pode imprimir, no diploma ou no preview do modelo, o arquivo de outro
   * curso, ou de outro polo. Fora do prefixo o PDF sai com o nome do coordenador e sem a imagem.
   *
   * `courseId` é o curso do CERTIFICADO (ou o curso previsto, no preview), nunca o de quem pede.
   */
  private async signatureDataUri(path: string | null | undefined, courseId: string): Promise<string | undefined> {
    if (!path) return undefined
    if (!path.startsWith(`cursos/${courseId}/`)) {
      this.logger.warn(`Rubrica fora do prefixo do curso ${courseId} não foi lida: ${path}`)
      return undefined
    }
    const obj = await this.gcs.readObject(path, { maxBytes: MAX_IMAGE_BYTES })
    if (!obj) {
      this.logger.warn(`Rubrica do coordenador não encontrada no GCS (ou acima do limite de imagem): ${path}`)
      return undefined
    }
    return `data:${obj.contentType};base64,${obj.buffer.toString('base64')}`
  }

  /**
   * O curso do certificado, no polo do endereço (o mesmo slug existe em vários polos). Publicado: segue. Fora do ar
   * (rascunho, em análise, arquivado), o titular de um certificado JÁ emitido continua baixando o PDF e vendo o status,
   * porque o certificado é dele; a matrícula ativa continua sendo exigida adiante. Emitir um certificado NOVO exige o
   * curso no ar: o matriculado recebe o aviso `COURSE_UNAVAILABLE` e quem não tem matrícula, 404 (não revela rascunho).
   */
  private async cursoDoCertificado(tenant: Pick<TenantContext, 'id' | 'isMatriz'>, uid: string, slug: string): Promise<CourseRow> {
    const course = await this.scope.bySlug(tenant.id, slug)
    if (course.status === 'published') return course
    const emitido = await this.db
      .select({ id: certificates.id })
      .from(certificates)
      .where(and(eq(certificates.userId, uid), eq(certificates.courseId, course.id)))
      .limit(1)
    if (emitido.length > 0) return course
    const matricula = await this.db
      .select({ id: enrollments.id })
      .from(enrollments)
      .where(and(eq(enrollments.userId, uid), eq(enrollments.courseId, course.id), eq(enrollments.status, 'active')))
      .limit(1)
    if (matricula.length > 0) throw courseUnavailable(tenant.isMatriz)
    throw new NotFoundException('Curso não encontrado.')
  }

  /** Aulas do curso que o aluno concluiu. */
  private async aulasConcluidas(uid: string, courseId: string): Promise<number> {
    const rows = (await this.db
      .select({ n: count(lessonProgress.id) })
      .from(lessonProgress)
      .innerJoin(lessons, eq(lessonProgress.lessonId, lessons.id))
      .innerJoin(modules, eq(lessons.moduleId, modules.id))
      .where(and(eq(lessonProgress.userId, uid), eq(lessonProgress.completed, true), eq(modules.courseId, courseId)))) as Array<{ n: number }>
    return Number(rows[0]?.n) || 0
  }

  /**
   * Slug do curso a partir do id — a tela do admin tem o id, o issueOrGet resolve por slug. O id é
   * resolvido DENTRO do polo: curso de outro polo responde 404, como se não existisse.
   */
  async slugOf(tenantId: string, courseId: string): Promise<string> {
    return (await this.scope.byId(tenantId, courseId)).slug
  }

  async coordinatorOf(
    courseId: string
  ): Promise<{ name: string; role: string | null; signatureDataUri?: string } | null> {
    const rows = await this.db
      .select({
        name: courses.coordinatorName,
        role: courses.coordinatorRole,
        assinatura: courses.coordinatorSignaturePath,
      })
      .from(courses)
      .where(eq(courses.id, courseId))
      .limit(1)
    const c = rows[0]
    if (!c?.name) return null
    // A rubrica vem RESOLVIDA em data URI, igual à emissão. Devolver só o caminho faria o
    // preview mostrar nome e cargo sem a assinatura — que foi exatamente o bug.
    return { name: c.name, role: c.role, signatureDataUri: await this.signatureDataUri(c.assinatura, courseId) }
  }

  async invalidatePdfCache(): Promise<void> {
    await this.db.update(certificates).set({ pdfPath: null }).where(isNotNull(certificates.pdfPath))
    const rows = await this.db.select({ id: certificates.id, code: certificates.code }).from(certificates)
    await Promise.all(rows.map((r) => this.gcs.deleteObject(this.publicPdfPath(r.id, r.code))))
  }

  private publicPdfPath(id: string, code: string, fingerprint?: string): string {
    // Sem fingerprint = caminho LEGADO. Continua sendo gerado por `invalidatePdfCache`,
    // que apaga os objetos antigos; a leitura nova sempre pede o caminho com fingerprint.
    return fingerprint
      ? `certificates/${id}/${code}-public-${fingerprint}.pdf`
      : `certificates/${id}/${code}-public.pdf`
  }

  /** Caminho do PDF autenticado. O fingerprint do template faz parte da chave do cache. */
  private privatePdfPath(id: string, code: string, fingerprint: string): string {
    return `certificates/${id}/${code}-${fingerprint}.pdf`
  }

  /**
   * Gate do certificado: o acesso ao curso nunca é retirado, mas o CERTIFICADO fica preso
   * até o carnê quitar. `source === 'free'` é a cláusula que protege a cortesia do admin —
   * que reativa a matrícula sem zerar `orderId` (ao contrário do checkout) — por isso o
   * gate NÃO pode depender só de `orderId IS NULL`: um aluno com compra cancelada que
   * ganhou cortesia depois ficaria travado por um pedido velho e nunca quitado.
   */
  private assertCarneQuitado(enr: { source: EnrollmentSource; orderId: string | null; settledAt: Date | null }): void {
    const liberado = enr.source === 'free' || enr.orderId == null || enr.settledAt != null
    if (!liberado) throw new ForbiddenException('Certificado liberado após a quitação do carnê.')
  }

  /**
   * Resolve o nome que vai no documento e, quando ele veio do formulário, grava no
   * cadastro — assim o aluno informa uma vez só e o resto do sistema para de mostrar
   * o e-mail no lugar do nome.
   */
  private async persistName(
    uid: string,
    user: { displayName: string | null } | undefined,
    informado?: string
  ): Promise<string> {
    const nome = requireStudentName(user, informado)
    if (nome !== limpaNome(user?.displayName)) {
      await this.db.update(users).set({ displayName: nome, updatedAt: new Date() }).where(eq(users.uid, uid))
    }
    return nome
  }

  /** Gera (se preciso) e devolve o PDF, salvando no GCS. Não bloqueia se o GCS falhar. */
  private async ensurePdf(cert: typeof certificates.$inferSelect): Promise<Buffer> {
    // Pelo curso: o fingerprint tem que ser o do template QUE VAI RENDERIZAR, senão dois
    // cursos com templates diferentes compartilhariam a chave de cache e um serviria o
    // PDF do outro.
    const { html, fingerprint } = await this.templates.getActiveHtmlWithFingerprint(cert.courseId)
    const esperado = this.privatePdfPath(cert.id, cert.code, fingerprint)
    // Só serve o cache se ele foi gerado com o template ATUAL. Comparar o caminho é o que
    // torna a invalidação automática: mudou o layout, mudou o fingerprint, o caminho não
    // bate e o PDF é regerado. Antes, o caminho não dependia do template e um layout
    // corrigido nunca chegava a quem já tinha o PDF salvo.
    if (cert.pdfPath === esperado) {
      // Teto do cache: um objeto anormal no caminho do PDF não é carregado na memória; o PDF é regerado.
      const stored = await this.gcs.readObject(esperado, { maxBytes: MAX_PDF_CACHE_BYTES })
      if (stored) return stored.buffer
    }
    const buffer = await this.renderPdf(cert, undefined, html)
    const saved = await this.gcs.saveObject(esperado, buffer, 'application/pdf')
    if (saved) {
      await this.db.update(certificates).set({ pdfPath: esperado }).where(eq(certificates.id, cert.id))
      // O objeto da versão anterior não é mais alcançável por ninguém: apagar evita
      // acumular um PDF órfão por certificado a cada ajuste de layout.
      if (cert.pdfPath && cert.pdfPath !== esperado) await this.gcs.deleteObject(cert.pdfPath)
    }
    return buffer
  }

  /** Emite (ou recupera) o certificado e devolve o PDF. 403 se não concluiu / não passou nas provas. */
  /**
   * `comoAdmin` pula as travas de PROGRESSO (100% das aulas, provas aprovadas) e a de carnê
   * quitado — é a decisão da instituição de emitir mesmo assim, e existe porque o caso real
   * é o aluno ter concluído sem o sistema registrar. A matrícula ativa continua exigida: sem
   * ela não há o que certificar, e o admin pode conceder na mesma tela.
   *
   * Reaproveita este método de propósito, em vez de um caminho paralelo: o snapshot, a
   * sincronização do coordenador e o cache do PDF precisam ser exatamente os mesmos.
   *
   * O curso é o do POLO do endereço (`tenantId`): o mesmo slug existe em vários polos, e só o escopo
   * (404 fora do polo, só publicado) o resolve. Daqui para a frente tudo trabalha pelo id desse curso.
   */
  async issueOrGet(
    tenant: Pick<TenantContext, 'id' | 'isMatriz'>, uid: string, slug: string, cpf?: string, nome?: string, comoAdmin = false
  ): Promise<Buffer> {
    const course = await this.cursoDoCertificado(tenant, uid, slug)

    // Exige matrícula ATIVA no momento da emissão/baixa (não basta ter concluído no passado:
    // se o acesso foi revogado, o certificado não sai). O leftJoin com `orders` traz o que
    // falta para o gate de quitação do carnê, aplicado logo abaixo.
    const enr = await this.db
      .select({ id: enrollments.id, source: enrollments.source, orderId: enrollments.orderId, settledAt: orders.settledAt })
      .from(enrollments)
      .leftJoin(orders, eq(enrollments.orderId, orders.id))
      .where(and(eq(enrollments.userId, uid), eq(enrollments.courseId, course.id), eq(enrollments.status, 'active')))
      .limit(1)
    if (enr.length === 0) throw new ForbiddenException('Este aluno precisa ter matrícula ativa no curso.')
    if (!comoAdmin) this.assertCarneQuitado(enr[0])

    const agg = (await this.db
      .select({ total: count(lessons.id), dur: sum(lessons.durationSec) })
      .from(lessons)
      .innerJoin(modules, eq(lessons.moduleId, modules.id))
      .where(eq(modules.courseId, course.id))) as Array<{ total: number; dur: string | null }>
    const total = Number(agg[0]?.total) || 0
    const dur = Number(agg[0]?.dur) || 0

    // O que falta para emitir um certificado NOVO: aulas no curso, 100% delas concluídas e as provas aprovadas. A pendência
    // é apurada aqui e só cobrada depois de saber se o aluno já tem o certificado do curso: quem tem recebe o dele mesmo
    // que o curso tenha mudado depois (uma aula ou prova nova numa revisão durante a retirada do ar), porque concluiu o
    // curso que havia. A matrícula ativa e o carnê (acima) continuam valendo para todos.
    const completed = total === 0 ? 0 : await this.aulasConcluidas(uid, course.id)
    const pendencia =
      total === 0
        ? 'Curso sem aulas.'
        : !comoAdmin && completed < total
          ? 'Conclua 100% do curso para emitir o certificado.'
          : !comoAdmin && !(await this.quiz.allModuleQuizzesPassed(uid, course.id))
            ? 'Você precisa ser aprovado em todas as provas do curso.'
            : null

    const existing = await this.db.select().from(certificates).where(and(eq(certificates.userId, uid), eq(certificates.courseId, course.id))).limit(1)
    let cert = existing[0]
    if (!cert && pendencia) throw new ForbiddenException(pendencia)
    // Lido nos dois caminhos: na emissão, para congelar; na reemissão, para ressincronizar
    // o nome (bloco `alvo`) e reparar snapshot envenenado.
    const userRows = await this.db.select().from(users).where(eq(users.uid, uid)).limit(1)
    const user = userRows[0]

    if (!cert) {
      const providedCpf = onlyDigits(cpf)
      const effectiveCpf = providedCpf || onlyDigits(user?.cpf)
      if (!effectiveCpf) throw new BadRequestException('Informe o CPF para emitir o certificado.')
      const now = new Date()
      if (providedCpf && !onlyDigits(user?.cpf)) {
        await this.db.update(users).set({ cpf: providedCpf, updatedAt: now }).where(eq(users.uid, uid))
      }

      const id = randomUUID()
      const code = randomBytes(16).toString('hex').toUpperCase()
      const hours = certificateWorkloadHours(course.workloadHours, dur)
      const studentName = await this.persistName(uid, user, nome)
      const snapshot = {
        id,
        userId: uid,
        courseId: course.id,
        code,
        studentName,
        courseTitle: course.title,
        hours,
        cpf: effectiveCpf,
        coordinatorName: course.coordinatorName ?? null,
        coordinatorRole: course.coordinatorRole ?? null,
        coordinatorSignaturePath: course.coordinatorSignaturePath ?? null,
        status: 'issued' as const,
        pdfPath: null as string | null,
        issuedAt: now,
      }
      await this.db.insert(certificates).values(snapshot)
      cert = snapshot
    } else if (cert.studentName == null || cert.courseTitle == null || cert.hours == null || looksLikeEmail(cert.studentName)) {
      // Dois casos caem aqui:
      //  - Legado sem snapshot (linha criada antes de congelarmos os dados);
      //  - Snapshot ENVENENADO: emitido quando o código caía em `displayName || email`,
      //    então o e-mail do aluno virou o "nome" no documento. Reemitir tem que
      //    CORRIGIR, nunca repetir o erro — por isso `requireStudentName` roda aqui
      //    também e barra até o aluno preencher o nome no perfil.
      const patch: Record<string, unknown> = {
        studentName: await this.persistName(uid, user, nome),
        courseTitle: course.title,
        hours: certificateWorkloadHours(course.workloadHours, dur),
      }
      if (cert.cpf == null && user?.cpf) {
        patch.cpf = onlyDigits(user.cpf)
      }
      // O PDF cacheado foi renderizado com o nome errado: sem invalidar as duas caches
      // (a autenticada em `pdfPath` e a pública mascarada, que não tem coluna), o
      // download seguinte devolveria o arquivo antigo e a correção não apareceria.
      if (cert.pdfPath) patch.pdfPath = null
      await this.db.update(certificates).set(patch).where(eq(certificates.id, cert.id))
      await this.gcs.deleteObject(this.publicPdfPath(cert.id, cert.code))
      cert = { ...cert, ...patch } as typeof cert
    }

    // Certificado emitido ANTES de o curso ter coordenador: preenche o campo vazio uma
    // vez. Ramo próprio (e não junto do reparo de nome) porque a condição é outra — um
    // certificado com nome perfeito também precisa disso. Só preenche NULL: coordenador
    // já gravado nunca é reescrito, senão trocar o coordenador do curso reassinaria
    // documentos antigos. Invalida o PDF cacheado, senão o arquivo velho volta sem a
    // assinatura e a correção não aparece.
    // SINCRONIZA o coordenador com o curso, em vez de só preencher o que está vazio.
    //
    // O congelamento protege o documento de mudar sozinho, mas quem edita esse campo quase
    // sempre está CORRIGINDO (nome escrito errado, cargo trocado) — e correção que não chega
    // ao certificado do aluno não corrigiu nada. Mesmo critério que você escolheu para o
    // template: a versão atual vale, ao custo de o documento entregue poder mudar depois.
    //
    // Campo vazio no CURSO não apaga o que já está no certificado: remover o coordenador do
    // cadastro não deve desassinar diploma emitido.
    const alvo = {
      // O nome do aluno acompanha o CADASTRO — que só o admin edita, com auditoria — pelo
      // mesmo motivo do título. Caso real (09/09/2026): conta com o nome de outra pessoa na
      // primeira emissão, corrigida depois, e o documento nunca acompanhava a correção.
      // Cadastro sem nome válido não apaga o que já está no documento.
      studentName: nomeCadastradoValido(user?.displayName) ?? cert.studentName,
      // O título entra pelo mesmo motivo: renomear o curso é corrigir o documento, e o
      // certificado reemitido tem que sair com o nome atual (caso Grafologia, 04/09/2026).
      courseTitle: course.title ?? cert.courseTitle,
      // A carga entra na sincronização pelo mesmo motivo do nome do coordenador: quem mexe
      // nesse campo está corrigindo, e correção que não chega ao certificado não corrigiu
      // nada. Só quando DEFINIDA no curso — o valor calculado não sobrescreve o congelado.
      hours: course.workloadHours != null && course.workloadHours > 0 ? course.workloadHours : cert.hours,
      coordinatorName: course.coordinatorName ?? cert.coordinatorName,
      coordinatorRole: course.coordinatorName ? (course.coordinatorRole ?? null) : cert.coordinatorRole,
      coordinatorSignaturePath: course.coordinatorSignaturePath ?? cert.coordinatorSignaturePath,
    }
    const mudou =
      alvo.studentName !== cert.studentName ||
      alvo.courseTitle !== cert.courseTitle ||
      alvo.hours !== cert.hours ||
      alvo.coordinatorName !== cert.coordinatorName ||
      alvo.coordinatorRole !== cert.coordinatorRole ||
      alvo.coordinatorSignaturePath !== cert.coordinatorSignaturePath
    if (mudou) {
      // Invalida as duas caches: sem isto o PDF antigo volta e a correção não aparece.
      const patch = { ...alvo, ...(cert.pdfPath ? { pdfPath: null } : {}) }
      await this.db.update(certificates).set(patch).where(eq(certificates.id, cert.id))
      await this.gcs.deleteObject(this.publicPdfPath(cert.id, cert.code))
      cert = { ...cert, ...patch } as typeof cert
    }

    return this.ensurePdf(cert)
  }

  /**
   * Certificados já emitidos para o aluno (página Certificados). Lê só o snapshot — não
   * reprocessa progresso nem toca no gate do carnê: a lista mostra o que EXISTE, e a
   * emissão/reparo continua acontecendo no `issueOrGet`, no clique de baixar.
   *
   * Só os certificados de cursos do POLO do endereço: quem estuda em dois polos vê, em cada site, os do site.
   */
  async listMine(tenantId: string, uid: string): Promise<MyCertificate[]> {
    const rows = await this.db
      .select({
        code: certificates.code,
        courseTitle: certificates.courseTitle,
        hours: certificates.hours,
        issuedAt: certificates.issuedAt,
        status: certificates.status,
        slug: courses.slug,
        title: courses.title,
      })
      .from(certificates)
      .innerJoin(courses, eq(courses.id, certificates.courseId))
      .where(and(eq(certificates.userId, uid), eq(courses.tenantId, tenantId)))
      .orderBy(desc(certificates.issuedAt))
      .limit(100)

    return rows.map((r) => ({
      code: r.code,
      courseSlug: r.slug,
      // O snapshot manda: é o que está impresso no PDF. O título do curso pode ter mudado
      // depois da emissão, e mostrar o novo faria a lista discordar do documento.
      courseTitle: r.courseTitle ?? r.title,
      hours: r.hours ?? null,
      issuedAt: r.issuedAt ? r.issuedAt.toISOString() : null,
      status: r.status,
    }))
  }

  /** Serve o PDF pela chave pública (QR/validação). 404 se inexistente ou revogado. */
  async getDocumentByCode(code: string): Promise<{ buffer: Buffer; fileName: string }> {
    const rows = await this.db.select().from(certificates).where(eq(certificates.code, code.toUpperCase())).limit(1)
    const cert = rows[0]
    if (!cert || cert.status === 'revoked') throw new NotFoundException('Certificado não encontrado.')
    const fileName = `certificado-${cert.code}.pdf`
    // Endpoint PÚBLICO (QR): serve o PDF cacheado no GCS em vez de re-renderizar no Chrome a cada
    // acesso — senão vira amplificação de custo/DoS não-autenticado no pdfSynth. Versão mascarada.
    const { html, fingerprint } = await this.templates.getActiveHtmlWithFingerprint(cert.courseId)
    // Acompanha o cadastro do curso, com a MESMA regra do caminho autenticado — senão quem
    // valida pelo QR veria o nome antigo enquanto o aluno, baixando pela conta, veria o
    // corrigido: dois documentos para um código. Aqui só lê; quem grava é o issueOrGet.
    const atual = await this.coordenadorDoCurso(cert.courseId)
    const paraRenderizar = {
      ...cert,
      coordinatorName: atual.name ?? cert.coordinatorName,
      coordinatorRole: atual.name ? atual.role : cert.coordinatorRole,
      coordinatorSignaturePath: atual.signaturePath ?? cert.coordinatorSignaturePath,
    }
    // A chave inclui tudo que vai IMPRESSO e pode mudar depois da emissão (nome do aluno,
    // título, carga, coordenador e rubrica): o fingerprint cobre só o template, então uma
    // correção no snapshot não mudaria o caminho e o PDF antigo seria servido para sempre.
    const chave = createHash('sha256')
      .update(
        [
          fingerprint,
          cert.studentName ?? '',
          cert.courseTitle ?? '',
          cert.hours ?? '',
          paraRenderizar.coordinatorName ?? '',
          paraRenderizar.coordinatorRole ?? '',
          paraRenderizar.coordinatorSignaturePath ?? '',
        ].join('|')
      )
      .digest('hex')
      .slice(0, 12)
    const publicPath = this.publicPdfPath(cert.id, cert.code, chave)
    const cached = await this.gcs.readObject(publicPath, { maxBytes: MAX_PDF_CACHE_BYTES })
    if (cached) return { buffer: cached.buffer, fileName }
    const buffer = await this.renderPdf(paraRenderizar, { maskCpf: true }, html)
    await this.gcs.saveObject(publicPath, buffer, 'application/pdf')
    return { buffer, fileName }
  }

  /**
   * Verificação PÚBLICA e GLOBAL: o código do QR abre de qualquer endereço, então não há filtro de polo.
   * Devolve o polo que ofereceu o curso, para a página dizer quem o oferece — `null` quando é curso da
   * próprio Studio Pilari (matriz) ou quando o código não existe.
   */
  async verify(code: string): Promise<CertificateVerification> {
    const rows = (await this.db
      .select({
        cert: certificates,
        courseTitle: courses.title,
        studentName: users.displayName,
        poloName: tenants.name,
        poloIsMatriz: tenants.isMatriz,
      })
      .from(certificates)
      .innerJoin(courses, eq(certificates.courseId, courses.id))
      .leftJoin(users, eq(certificates.userId, users.uid))
      .leftJoin(tenants, eq(tenants.id, courses.tenantId))
      .where(eq(certificates.code, code.toUpperCase()))
      .limit(1)) as Array<{
      cert: typeof certificates.$inferSelect
      courseTitle: string
      studentName: string | null
      poloName: string | null
      poloIsMatriz: boolean | null
    }>
    if (rows.length === 0) return { valid: false, studentName: null, courseTitle: null, issuedAt: null, hasDocument: false, poloName: null }
    const r = rows[0]
    const valid = r.cert.status !== 'revoked'
    return {
      valid,
      // Prefere o snapshot; cai no dado vivo por retrocompatibilidade.
      studentName: r.cert.studentName ?? r.studentName,
      courseTitle: r.cert.courseTitle ?? r.courseTitle,
      issuedAt: r.cert.issuedAt?.toISOString() ?? null,
      hasDocument: valid,
      poloName: r.poloIsMatriz ? null : (r.poloName ?? null),
    }
  }

  /**
   * Estado de quitação do pedido do curso, para a tela "certificado bloqueado". Endpoint
   * SEPARADO do download porque o cliente consome o certificado com `responseType: 'blob'`
   * — um 403 com corpo JSON chegaria ao axios como Blob, não como objeto, e a tela nunca
   * conseguiria ler "faltam X de N parcelas" dali.
   */
  async settlementFor(tenant: Pick<TenantContext, 'id' | 'isMatriz'>, uid: string, slug: string): Promise<OrderSettlement> {
    const course = await this.cursoDoCertificado(tenant, uid, slug)

    const enrRows = await this.db
      .select({ source: enrollments.source, orderId: enrollments.orderId })
      .from(enrollments)
      .where(and(eq(enrollments.userId, uid), eq(enrollments.courseId, course.id), eq(enrollments.status, 'active')))
      .limit(1)
    const enr = enrRows[0]
    if (!enr) throw new ForbiddenException('Você precisa ter matrícula ativa no curso.')

    // Cortesia ou matrícula sem pedido: nunca existe carnê a quitar (mesmo que `orderId`
    // aponte para um pedido velho — ver assertCarneQuitado).
    if (enr.source === 'free' || enr.orderId == null) {
      return { settled: true, paidCount: 0, totalCount: 0, carneUrl: null }
    }

    const orderRows = await this.db
      .select({ settledAt: orders.settledAt, installmentCount: orders.installmentCount, asaasInstallmentId: orders.asaasInstallmentId })
      .from(orders)
      .where(eq(orders.id, enr.orderId))
      .limit(1)
    const order = orderRows[0]
    // Defensivo: `orderId` sem linha correspondente em `orders` não deveria existir, mas
    // não é motivo para travar o aluno — trata como se não houvesse carnê.
    if (!order) return { settled: true, paidCount: 0, totalCount: 0, carneUrl: null }

    if (!order.asaasInstallmentId) {
      // À vista/cartão: não há carnê a baixar. `settledAt` já decide sozinho.
      const paid = order.settledAt != null
      return { settled: paid, paidCount: paid ? 1 : 0, totalCount: 1, carneUrl: null }
    }

    const parcelas = await this.installments.listForOrder(enr.orderId)
    const paidCount = parcelas.filter((p) => p.status === 'paid').length
    const totalCount = order.installmentCount ?? parcelas.length
    return {
      settled: order.settledAt != null,
      paidCount,
      totalCount,
      carneUrl: `/me/orders/${enr.orderId}/carne`,
    }
  }

  /**
   * Proxy do carnê (PDF com todos os boletos) do Asaas. Verifica a POSSE do pedido ANTES
   * de chamar o Asaas: sem isto, qualquer aluno autenticado adivinhando um orderId
   * baixaria o carnê de outro aluno (IDOR). A chave de API do Asaas nunca vai ao navegador
   * — por isso este proxy existe em vez do cliente chamar o Asaas direto.
   *
   * O pedido também tem que ser do POLO do endereço: o aluno compartilhado tem pedidos em vários polos, e o
   * carnê de um não é aberto pelo site do outro.
   */
  async carneFor(tenantId: string, uid: string, orderId: string): Promise<Buffer> {
    const rows = await this.db
      .select({ userId: orders.userId, asaasInstallmentId: orders.asaasInstallmentId })
      .from(orders)
      .where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId)))
      .limit(1)
    const order = rows[0]
    // Mesma mensagem para "não existe", "é de outro aluno" e "é de outro polo": nunca dar pista de que
    // o id pertence a alguém.
    if (!order || order.userId !== uid) throw new NotFoundException('Pedido não encontrado.')
    if (!order.asaasInstallmentId) throw new NotFoundException('Este pedido não tem carnê.')
    return this.asaas.getPaymentBook(order.asaasInstallmentId)
  }
}
