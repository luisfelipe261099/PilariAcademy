import type { Request } from 'express'
import type { TenantContext } from './tenant-context'

/** Requisição depois do middleware do polo. */
export type RequestWithTenant = Request & { tenant?: TenantContext }
