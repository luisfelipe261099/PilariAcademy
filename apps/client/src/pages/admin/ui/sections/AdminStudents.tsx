import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { GraduationCap, Search } from 'lucide-react'
import { Role } from '@pilari/types'
import { ManageEnrollmentsButton, ResetPasswordButton, useAdminUsersQuery } from '@/entities/admin-user'

export function AdminStudents() {
  const { data, isLoading, isError } = useAdminUsersQuery()
  const [search, setSearch] = useState('')

  const students = useMemo(() => {
    const list = data?.filter((u) => u.roles.includes(Role.student)) ?? []
    const q = search.trim().toLowerCase()
    if (!q) return list
    return list.filter(
      (u) => (u.displayName ?? '').toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
    )
  }, [data, search])

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-bold text-ink">
            <GraduationCap className="size-6 text-brand" aria-hidden="true" /> Alunos
          </h2>
          <p className="mt-1 text-sm text-muted">Clique no aluno para abrir o perfil, editar nome e CPF e gerenciar matrículas.</p>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome ou e-mail"
            className="w-64 max-w-full rounded-full border border-border bg-bg py-2 pl-9 pr-4 text-sm text-foreground"
          />
        </div>
      </div>

      {isLoading && <p className="mt-4 text-muted">Carregando…</p>}
      {isError && <p className="mt-4 text-red-500">Não foi possível carregar os alunos.</p>}
      {!isLoading && (
        <p className="mt-3 text-sm text-muted">
          {students.length} {students.length === 1 ? 'aluno' : 'alunos'}
          {search && ' encontrado(s)'}
        </p>
      )}

      <ul className="mt-3 flex flex-col gap-2">
        {students.map((u) => (
          <li
            key={u.uid}
            className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <Link
              to={`/admin/alunos/${u.uid}`}
              className="group flex min-w-0 items-center gap-3 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-brand"
              title="Abrir perfil do aluno"
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-brand-soft text-sm font-bold text-brand">
                {(u.displayName ?? u.email).slice(0, 2).toUpperCase()}
              </span>
              <div className="min-w-0">
                <p className="truncate font-medium text-ink group-hover:underline">{u.displayName ?? '—'}</p>
                <p className="truncate text-sm text-muted">{u.email}</p>
              </div>
            </Link>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <ManageEnrollmentsButton user={u} />
              <ResetPasswordButton uid={u.uid} />
            </div>
          </li>
        ))}
        {!isLoading && students.length === 0 && (
          <li className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-muted">
            {search ? 'Nenhum aluno corresponde à busca.' : 'Nenhum aluno cadastrado ainda.'}
          </li>
        )}
      </ul>
    </div>
  )
}
