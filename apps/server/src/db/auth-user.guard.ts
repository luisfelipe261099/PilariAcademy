import type { AuthUser } from '@pilari/types'
import { users } from './schema'

type DbUser = typeof users.$inferSelect

/**
 * Guard de compile-time: o schema drizzle `users` é a fonte de verdade do contrato AuthUser.
 * Se uma coluna consumida pelo contrato for removida/renomeada/mudar de tipo, este arquivo não compila.
 * (roles é validado em runtime pelo backend — string[] no banco vs Role[] no contrato.)
 */
function _authUserSchemaGuard(row: DbUser): void {
  const _check: Pick<AuthUser, 'uid' | 'email' | 'displayName' | 'photoUrl'> = {
    uid: row.uid,
    email: row.email,
    displayName: row.displayName,
    photoUrl: row.photoUrl,
  }
  void _check
}
void _authUserSchemaGuard
