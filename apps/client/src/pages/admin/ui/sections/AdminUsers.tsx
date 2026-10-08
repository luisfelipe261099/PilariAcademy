import { useRef, useState, type FormEvent } from 'react'
import { Role, type AuthUser } from '@pilari/types'
import { PasswordInput } from '@/shared/ui'
import { useMeQuery } from '@/entities/auth'
import { ResetPasswordButton, createUserNotice, useAdminUsersPageQuery, useCreateUserMutation, useSetRolesMutation } from '@/entities/admin-user'

const ALL_ROLES: Role[] = [Role.student, Role.teacher, Role.admin]
const ROLE_LABEL: Record<Role, string> = { [Role.student]: 'Aluno', [Role.teacher]: 'Parceiro', [Role.admin]: 'Admin' }
const PAGE_SIZE = 20

function apiMessage(error: unknown, fallback: string): string {
  const msg = (error as { response?: { data?: { message?: string | string[] } } } | null)?.response?.data?.message
  if (Array.isArray(msg)) return msg.join(' ')
  return msg ?? fallback
}

export function AdminUsers() {
  const { data: me } = useMeQuery()
  const myUid = me?.user?.uid

  const [page, setPage] = useState(1)
  const [searchInput, setSearchInput] = useState('')
  const [q, setQ] = useState('')
  const searchTimer = useRef<number | undefined>(undefined)

  const usersQuery = useAdminUsersPageQuery({ page, pageSize: PAGE_SIZE, q })
  const users = usersQuery.data?.users ?? []
  const total = usersQuery.data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const createMutation = useCreateUserMutation()
  const setRolesMutation = useSetRolesMutation()
  // E-mail que já tinha conta na rede: a senha digitada não valeu, e o admin precisa saber.
  const createNotice = createUserNotice(createMutation.data)

  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [newRoles, setNewRoles] = useState<Role[]>([Role.student])

  // Debounce da busca sem useEffect: agenda a aplicação do termo fora do ciclo do React.
  function onSearchChange(value: string) {
    setSearchInput(value)
    window.clearTimeout(searchTimer.current)
    searchTimer.current = window.setTimeout(() => {
      setQ(value.trim())
      setPage(1)
    }, 300)
  }

  function toggleNewRole(role: Role) {
    setNewRoles((prev) => (prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]))
  }
  function onCreate(e: FormEvent) {
    e.preventDefault()
    createMutation.mutate({ email, displayName, password, roles: newRoles }, {
      onSuccess: () => { setEmail(''); setDisplayName(''); setPassword(''); setNewRoles([Role.student]) },
    })
  }
  function toggleRowRole(user: AuthUser, role: Role) {
    const next = user.roles.includes(role) ? user.roles.filter((r) => r !== role) : [...user.roles, role]
    setRolesMutation.mutate({ uid: user.uid, roles: next })
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-ink">Usuários e papéis</h2>
      <p className="mt-1 text-sm text-muted">Crie contas e defina papéis. Um usuário com o papel <strong>Parceiro</strong> pode ser dono de cursos.</p>

      <form onSubmit={onCreate} className="mt-4 flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
        <h3 className="font-bold text-ink">Criar usuário</h3>
        <input type="email" required placeholder="E-mail" value={email} autoComplete="off" onChange={(e) => setEmail(e.target.value)} className="rounded-lg border border-border bg-bg px-4 py-2 text-foreground" />
        <input type="text" required placeholder="Nome" value={displayName} autoComplete="off" onChange={(e) => setDisplayName(e.target.value)} className="rounded-lg border border-border bg-bg px-4 py-2 text-foreground" />
        <PasswordInput required placeholder="Senha (mín. 6)" value={password} autoComplete="new-password" onChange={(e) => setPassword(e.target.value)} className="rounded-lg border border-border bg-bg py-2 pl-4 pr-10 text-foreground" />
        <div className="flex gap-4">
          {ALL_ROLES.map((role) => (
            <label key={role} className="flex items-center gap-2 text-sm text-foreground">
              <input type="checkbox" checked={newRoles.includes(role)} onChange={() => toggleNewRole(role)} /> {ROLE_LABEL[role]}
            </label>
          ))}
        </div>
        {createMutation.isError && <p className="text-sm text-red-500">{apiMessage(createMutation.error, 'Não foi possível criar.')}</p>}
        {createNotice && <p role="status" className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">{createNotice}</p>}
        <button type="submit" disabled={createMutation.isPending} className="self-start rounded-full bg-brand px-5 py-2 font-bold text-white disabled:opacity-60">
          {createMutation.isPending ? 'Criando…' : 'Criar'}
        </button>
      </form>

      <div className="mt-6 mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="font-bold text-ink">
          Todos os usuários {total > 0 && <span className="font-normal text-muted">({total})</span>}
        </h3>
        <input
          type="search"
          placeholder="Buscar por nome ou e-mail"
          value={searchInput}
          onChange={(e) => onSearchChange(e.target.value)}
          className="rounded-lg border border-border bg-bg px-4 py-2 text-sm text-foreground sm:w-72"
        />
      </div>
      {usersQuery.isLoading && <p className="text-muted">Carregando…</p>}
      {setRolesMutation.isError && <p className="mb-3 text-sm text-red-500">{apiMessage(setRolesMutation.error, 'Não foi possível alterar os papéis.')}</p>}
      {!usersQuery.isLoading && users.length === 0 && <p className="text-muted">Nenhum usuário encontrado.</p>}
      <ul className="flex flex-col gap-2">
        {users.map((user) => (
          <li key={user.uid} className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium text-ink">{user.displayName ?? '—'}</p>
              <p className="text-sm text-muted">{user.email}</p>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              {ALL_ROLES.map((role) => {
                const isSelf = user.uid === myUid
                const disabled = (isSelf && role === Role.admin) || setRolesMutation.isPending
                return (
                  <label key={role} className="flex items-center gap-2 text-sm text-foreground">
                    <input type="checkbox" checked={user.roles.includes(role)} disabled={disabled} onChange={() => toggleRowRole(user, role)} /> {ROLE_LABEL[role]}
                  </label>
                )
              })}
              <ResetPasswordButton uid={user.uid} />
            </div>
          </li>
        ))}
      </ul>

      {users.length > 0 && (
        <div className="mt-4 flex items-center justify-center gap-4">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="cursor-pointer rounded-full border border-border px-4 py-1.5 text-sm font-medium text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            ‹ Anterior
          </button>
          <span className="text-sm text-muted">Página {page} de {totalPages}</span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="cursor-pointer rounded-full border border-border px-4 py-1.5 text-sm font-medium text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            Próxima ›
          </button>
        </div>
      )}
    </div>
  )
}
