import { Inject, Injectable, Logger } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { desc, eq } from 'drizzle-orm'
import type { AuditLog, PlatformAuditLog } from '@pilari/types'
import { auditLogs, tenants } from '../../db/schema'
import type { Database } from '../../db/types'

export interface AuditInput {
  /** Polo onde a ação aconteceu. null = ação da plataforma, fora de qualquer polo. */
  tenantId: string | null
  actorUid?: string | null
  actorEmail?: string | null
  action: string
  summary: string
  targetType?: string | null
  targetId?: string | null
}

/** Trilha de auditoria. `log()` é fire-and-forget (não derruba a ação principal). */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name)
  constructor(@Inject('DB_CLIENT') private readonly db: Database) {}

  log(input: AuditInput): void {
    void (async () => {
      try {
        await this.db.insert(auditLogs).values({
          id: randomUUID(),
          tenantId: input.tenantId,
          actorUid: input.actorUid ?? null,
          actorEmail: input.actorEmail ?? null,
          action: input.action,
          summary: input.summary,
          targetType: input.targetType ?? null,
          targetId: input.targetId ?? null,
          createdAt: new Date(),
        })
      } catch (err) {
        // Nível error (não warn): uma falha aqui é um BURACO na trilha de auditoria — a ação
        // auditada aconteceu mas não ficou registrada. Precisa aparecer no alerting.
        this.logger.error(
          `FALHA ao gravar audit log (action=${input.action}, actor=${input.actorUid ?? '-'}, target=${input.targetType ?? '-'}:${input.targetId ?? '-'}): ${err instanceof Error ? err.message : String(err)}`
        )
      }
    })()
  }

  /** Logs do polo; com `null`, de toda a plataforma, sem o nome do polo (o console do Studio Pilari usa `listPlatform`). */
  async list(tenantId: string | null, limit = 100): Promise<AuditLog[]> {
    const base = this.db.select().from(auditLogs)
    const filtrada = tenantId === null ? base : base.where(eq(auditLogs.tenantId, tenantId))
    const rows = await filtrada.orderBy(desc(auditLogs.createdAt)).limit(limit)
    return rows.map((r) => ({
      id: r.id, actorEmail: r.actorEmail, action: r.action, summary: r.summary,
      targetType: r.targetType, targetId: r.targetId, createdAt: r.createdAt?.toISOString() ?? '',
    }))
  }

  /** Logs de toda a rede com o polo de origem (id e nome) de cada registro; `null` nos dois para ação da plataforma. */
  async listPlatform(limit = 300): Promise<PlatformAuditLog[]> {
    const rows = (await this.db
      .select({ log: auditLogs, tenantName: tenants.name })
      .from(auditLogs)
      .leftJoin(tenants, eq(tenants.id, auditLogs.tenantId))
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit)) as Array<{ log: typeof auditLogs.$inferSelect; tenantName: string | null }>
    return rows.map((r) => ({
      id: r.log.id,
      actorEmail: r.log.actorEmail,
      action: r.log.action,
      summary: r.log.summary,
      targetType: r.log.targetType,
      targetId: r.log.targetId,
      createdAt: r.log.createdAt?.toISOString() ?? '',
      tenantId: r.log.tenantId ?? null,
      tenantName: r.tenantName ?? null,
    }))
  }
}
