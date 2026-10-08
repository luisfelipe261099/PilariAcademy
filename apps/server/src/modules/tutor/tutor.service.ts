import { BadRequestException, ForbiddenException, HttpException, HttpStatus, Inject, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { and, asc, eq, gte, sql } from 'drizzle-orm'
import type { TutorInfo, TutorResposta } from '@pilari/types'
import { enrollments, modules, tutorUsage } from '../../db/schema'
import type { Database } from '../../db/types'
import { CourseScopeService } from '../tenancy/course-scope.service'
import type { TenantContext } from '../tenancy/tenant-context'
import { TutorMaterialService } from './tutor-material.service'
import { VertexClient } from './vertex.client'
import { diaBrasilia, inicioDoMesBrasilia, lerResposta, montarPedido, textoParaFala, voltaDoTetoMensal, type TurnoTutor } from './lib/tutor-prompt'
import { wavInfo } from './lib/wav'

/** Pergunta digitada conta como 10 s de uso. */
const SEGUNDOS_PERGUNTA_DIGITADA = 10
const MAX_SEGUNDOS_PERGUNTA = 60
/** PCM 16 bits mono 24 kHz que o Gemini TTS devolve. */
const BYTES_POR_SEGUNDO_FALA = 48_000

type Curso = Awaited<ReturnType<CourseScopeService['bySlug']>>

export function limiteDiario(config: ConfigService): number {
  const v = Number(config.get<string>('TUTOR_DAILY_SECONDS'))
  return Number.isFinite(v) && v > 0 ? v : 1800
}

/**
 * Teto da plataforma inteira no mês (todos os alunos e polos somados), em segundos de conversa: trava de orçamento
 * contra gasto acidental. Padrão de 3.000 minutos (50 horas); muda pela env TUTOR_MONTHLY_MINUTES, sem deploy de código.
 */
export function tetoMensalSegundos(config: ConfigService): number {
  const v = Number(config.get<string>('TUTOR_MONTHLY_MINUTES'))
  return (Number.isFinite(v) && v > 0 ? v : 3000) * 60
}

/** Cota de cada aluno no mês, incluída no plano do polo: padrão de 60 minutos (TUTOR_STUDENT_MONTHLY_MINUTES). */
export function cotaMensalAlunoSegundos(config: ConfigService): number {
  const v = Number(config.get<string>('TUTOR_STUDENT_MONTHLY_MINUTES'))
  return (Number.isFinite(v) && v > 0 ? v : 60) * 60
}

/** "1 hora", "2 horas", "90 minutos": como a cota aparece na mensagem para o aluno. */
function tempoPorExtenso(segundos: number): string {
  const min = Math.round(segundos / 60)
  if (min % 60 === 0) return min === 60 ? '1 hora' : `${min / 60} horas`
  return `${min} minutos`
}

function recusa(code: string, message: string): HttpException {
  return new HttpException({ statusCode: HttpStatus.TOO_MANY_REQUESTS, code, message }, HttpStatus.TOO_MANY_REQUESTS)
}

@Injectable()
export class TutorService {
  private readonly logger = new Logger(TutorService.name)

  constructor(
    @Inject('DB_CLIENT') private readonly db: Database,
    private readonly scope: CourseScopeService,
    private readonly material: TutorMaterialService,
    private readonly vertex: VertexClient,
    private readonly config: ConfigService
  ) {}

  /**
   * Quem pode usar: matrícula ativa, curso publicado com o tutor ligado e polo ativo. Curso sem tutor responde 404
   * (o botão nem aparece); polo suspenso para o tutor porque cada pergunta tem custo para o Studio Pilari.
   */
  async acesso(tenant: Pick<TenantContext, 'id' | 'status'>, uid: string, slug: string): Promise<Curso> {
    const curso = await this.scope.bySlug(tenant.id, slug)
    if (curso.status !== 'published' || !curso.tutorEnabled) throw new NotFoundException('O tutor não está disponível neste curso.')
    if (tenant.status !== 'active') throw new ForbiddenException('O tutor está indisponível no momento. Fale com o seu polo.')
    const mat = await this.db
      .select({ id: enrollments.id })
      .from(enrollments)
      .where(and(eq(enrollments.userId, uid), eq(enrollments.courseId, curso.id), eq(enrollments.status, 'active')))
      .limit(1)
    if (!mat.length) throw new ForbiddenException('Você não tem acesso a este curso.')
    return curso
  }

  async usadosHoje(uid: string): Promise<number> {
    const r = await this.db.select({ s: tutorUsage.seconds }).from(tutorUsage).where(and(eq(tutorUsage.userUid, uid), eq(tutorUsage.day, diaBrasilia()))).limit(1)
    return r[0]?.s ?? 0
  }

  /** Ordem: limite do dia do aluno, cota do mês do aluno e, por último, o teto da plataforma inteira. */
  private async conferirLimite(uid: string): Promise<void> {
    const limite = limiteDiario(this.config)
    if ((await this.usadosHoje(uid)) >= limite) {
      throw recusa('TUTOR_LIMIT', `Você já usou os ${Math.round(limite / 60)} minutos de hoje do tutor. Volte amanhã!`)
    }
    const cota = cotaMensalAlunoSegundos(this.config)
    if ((await this.usadosNoMesPeloAluno(uid)) >= cota) {
      throw recusa('TUTOR_STUDENT_MONTHLY_LIMIT', `Você já usou a sua cota de ${tempoPorExtenso(cota)} do tutor neste mês. Ela renova no dia ${voltaDoTetoMensal()}.`)
    }
    const pausa = await this.pausaDoMes()
    if (pausa) {
      this.logger.warn('tutor: teto mensal da plataforma atingido (TUTOR_MONTHLY_MINUTES); perguntas recusadas até o dia 1º')
      throw recusa('TUTOR_MONTHLY_LIMIT', pausa)
    }
  }

  /** Segundos que o aluno usou no mês (a cota incluída no plano). */
  async usadosNoMesPeloAluno(uid: string): Promise<number> {
    const r = await this.db
      .select({ s: sql<string>`coalesce(sum(${tutorUsage.seconds}), 0)` })
      .from(tutorUsage)
      .where(and(eq(tutorUsage.userUid, uid), gte(tutorUsage.day, inicioDoMesBrasilia())))
    return Number(r[0]?.s ?? 0)
  }

  /** Segundos usados no mês por todos os alunos. `day` é texto YYYY-MM-DD, então comparar texto já compara datas. */
  private async usadosNoMes(): Promise<number> {
    const r = await this.db
      .select({ s: sql<string>`coalesce(sum(${tutorUsage.seconds}), 0)` })
      .from(tutorUsage)
      .where(gte(tutorUsage.day, inicioDoMesBrasilia()))
    // SUM volta como DECIMAL, que o mysql2 entrega em string.
    return Number(r[0]?.s ?? 0)
  }

  /** Mensagem para o aluno quando o teto do mês foi atingido; `null` enquanto houver saldo. */
  private async pausaDoMes(): Promise<string | null> {
    if ((await this.usadosNoMes()) < tetoMensalSegundos(this.config)) return null
    return `O tutor fez uma pausa e volta no dia ${voltaDoTetoMensal()}. As aulas e as apostilas continuam disponíveis.`
  }

  private async registrarUso(uid: string, segundos: number): Promise<void> {
    const s = Math.max(1, Math.ceil(segundos))
    await this.db
      .insert(tutorUsage)
      .values({ userUid: uid, day: diaBrasilia(), seconds: s, requests: 1 })
      .onDuplicateKeyUpdate({ set: { seconds: sql`${tutorUsage.seconds} + ${s}`, requests: sql`${tutorUsage.requests} + 1`, updatedAt: new Date() } })
  }

  private async modulosDoCurso(cursoId: string): Promise<Array<{ id: string; title: string }>> {
    return this.db.select({ id: modules.id, title: modules.title }).from(modules).where(eq(modules.courseId, cursoId)).orderBy(asc(modules.order))
  }

  async info(tenant: Pick<TenantContext, 'id' | 'status'>, uid: string, slug: string): Promise<TutorInfo> {
    const curso = await this.acesso(tenant, uid, slug)
    const mods = await this.modulosDoCurso(curso.id)
    const fontes = await this.material.fontes(mods.map((m) => m.id))
    return {
      cursoTitulo: curso.title,
      modulos: mods.map((m) => ({ id: m.id, titulo: m.title, temMaterial: (fontes.get(m.id)?.length ?? 0) > 0 })),
      limiteSegundos: limiteDiario(this.config),
      usadosHoje: await this.usadosHoje(uid),
      usadosNoMes: await this.usadosNoMesPeloAluno(uid),
      limiteMensalSegundos: cotaMensalAlunoSegundos(this.config),
      pausa: await this.pausaDoMes(),
    }
  }

  async perguntar(
    tenant: Pick<TenantContext, 'id' | 'status'>,
    uid: string,
    slug: string,
    entrada: { moduleId: string; audioWavBase64?: string; texto?: string; historico?: TurnoTutor[] }
  ): Promise<TutorResposta> {
    const curso = await this.acesso(tenant, uid, slug)
    await this.conferirLimite(uid)
    const mods = await this.modulosDoCurso(curso.id)
    const modulo = mods.find((m) => m.id === entrada.moduleId)
    if (!modulo) throw new BadRequestException('Módulo inválido para este curso.')

    let segundos = SEGUNDOS_PERGUNTA_DIGITADA
    const texto = entrada.texto?.trim()
    if (entrada.audioWavBase64) {
      const info = wavInfo(Buffer.from(entrada.audioWavBase64, 'base64'))
      if (!info) throw new BadRequestException('Não consegui ler o áudio. Tente gravar de novo.')
      if (info.seconds > MAX_SEGUNDOS_PERGUNTA) throw new BadRequestException('A pergunta ficou longa demais. Tente falar em até 1 minuto.')
      if (info.seconds < 0.4) throw new BadRequestException('Não ouvi nada. Toque na esfera e fale de novo.')
      segundos = info.seconds
    } else if (!texto) {
      throw new BadRequestException('Fale ou digite a sua pergunta.')
    }

    const material = await this.material.doModulo(modulo.id)
    const pedido = montarPedido(
      { cursoTitulo: curso.title, moduloTitulo: modulo.title, modulos: mods.map((m) => m.title), material },
      entrada.historico ?? [],
      entrada.audioWavBase64 ? { audioWavBase64: entrada.audioWavBase64 } : { texto }
    )
    const { texto: bruto, uso } = await this.vertex.gerar(pedido)
    const resposta = lerResposta(bruto)
    // Só números no log (custo): nada do que o aluno falou.
    this.logger.log(`tutor curso=${curso.id} modulo=${modulo.id} uso=${JSON.stringify(uso ?? {})}`)
    if (!resposta) throw new ServiceUnavailableException('Não consegui responder agora. Pode repetir a pergunta?')

    await this.registrarUso(uid, segundos)
    return {
      transcricao: resposta.transcricao || texto || '',
      resposta: resposta.resposta,
      usadosHoje: await this.usadosHoje(uid),
      limiteSegundos: limiteDiario(this.config),
      usadosNoMes: await this.usadosNoMesPeloAluno(uid),
      limiteMensalSegundos: cotaMensalAlunoSegundos(this.config),
    }
  }

  /**
   * Voz da resposta em fluxo: entrega cada pedaço de PCM a `escrever` assim que o Gemini gera e conta os segundos
   * efetivamente falados no uso do dia, mesmo se o aluno interromper no meio.
   */
  async falar(
    tenant: Pick<TenantContext, 'id' | 'status'>,
    uid: string,
    slug: string,
    texto: string,
    escrever: (pcm: Buffer) => void,
    signal: AbortSignal
  ): Promise<void> {
    await this.acesso(tenant, uid, slug)
    await this.conferirLimite(uid)
    let bytes = 0
    try {
      for await (const pcm of this.vertex.falar(textoParaFala(texto), signal)) {
        bytes += pcm.length
        escrever(pcm)
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') throw err
    } finally {
      if (bytes > 0) await this.registrarUso(uid, bytes / BYTES_POR_SEGUNDO_FALA)
    }
  }
}
