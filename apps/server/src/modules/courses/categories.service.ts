import { Inject, Injectable, NotFoundException } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { and, asc, eq } from 'drizzle-orm'
import type { Category } from '@pilari/types'
import { categories } from '../../db/schema'
import type { Database } from '../../db/types'
import { slugify } from '../../common/lib/slugify'

type CategoryRow = typeof categories.$inferSelect

@Injectable()
export class CategoriesService {
  constructor(@Inject('DB_CLIENT') private readonly db: Database) {}

  private toCategory(row: CategoryRow): Category {
    return { id: row.id, name: row.name, slug: row.slug }
  }

  async list(tenantId: string): Promise<Category[]> {
    const rows = await this.db.select().from(categories).where(eq(categories.tenantId, tenantId)).orderBy(asc(categories.name))
    return rows.map((r) => this.toCategory(r))
  }

  /** Slug único DENTRO do polo (sufixo -2, -3… em caso de colisão). */
  private async uniqueSlug(tenantId: string, name: string): Promise<string> {
    const base = slugify(name) || 'categoria'
    let candidate = base
    let n = 2
    while (true) {
      const clash = await this.db
        .select()
        .from(categories)
        .where(and(eq(categories.tenantId, tenantId), eq(categories.slug, candidate)))
        .limit(1)
      if (clash.length === 0) return candidate
      candidate = `${base}-${n++}`
    }
  }

  private async getOwned(tenantId: string, id: string): Promise<CategoryRow> {
    const rows = await this.db.select().from(categories).where(and(eq(categories.tenantId, tenantId), eq(categories.id, id))).limit(1)
    if (!rows[0]) throw new NotFoundException('Categoria não encontrada.')
    return rows[0]
  }

  async create(tenantId: string, name: string): Promise<Category> {
    const id = randomUUID()
    const slug = await this.uniqueSlug(tenantId, name)
    const now = new Date()
    await this.db.insert(categories).values({ id, tenantId, name, slug, createdAt: now, updatedAt: now })
    return this.toCategory(await this.getOwned(tenantId, id))
  }

  async update(tenantId: string, id: string, name: string): Promise<Category> {
    await this.getOwned(tenantId, id)
    await this.db.update(categories).set({ name, updatedAt: new Date() }).where(and(eq(categories.tenantId, tenantId), eq(categories.id, id)))
    return this.toCategory(await this.getOwned(tenantId, id))
  }

  async remove(tenantId: string, id: string): Promise<void> {
    await this.getOwned(tenantId, id)
    await this.db.delete(categories).where(and(eq(categories.tenantId, tenantId), eq(categories.id, id)))
  }
}
