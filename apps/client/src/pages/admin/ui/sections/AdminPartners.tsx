import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Handshake, Plus } from 'lucide-react'
import { Role, type AdminCourseRow, type AuthUser, type InstructorFinance } from '@pilari/types'
import { PasswordInput } from '@/shared/ui'
import { formatMoneyBRL } from '@/entities/course'
import { ResetPasswordButton, createUserNotice, useAdminUsersQuery, useCreateUserMutation } from '@/entities/admin-user'
import { useAdminCoursesQuery } from '@/entities/admin-dashboard'
import { useAdminFinanceQuery } from '@/entities/finance'

function apiMessage(error: unknown, fallback: string): string {
  const msg = (error as { response?: { data?: { message?: string | string[] } } } | null)?.response?.data?.message
  if (Array.isArray(msg)) return msg.join(' ')
  return msg ?? fallback
}

function CreatePartner() {
  const createMutation = useCreateUserMutation()
  // Mesma rota da tela de usuários: e-mail que já tinha conta na rede não usa a senha digitada.
  const createNotice = createUserNotice(createMutation.data)
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')

  function onCreate(e: FormEvent) {
    e.preventDefault()
    createMutation.mutate(
      { email, displayName, password, roles: [Role.teacher] },
      { onSuccess: () => { setEmail(''); setDisplayName(''); setPassword('') } }
    )
  }

  return (
    <form onSubmit={onCreate} className="mt-4 grid gap-3 rounded-lg border border-border bg-card p-4 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
      <label className="text-sm font-bold text-ink">Nome
        <input type="text" required value={displayName} autoComplete="off" onChange={(e) => setDisplayName(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-bg px-3 py-2 font-normal text-foreground" />
      </label>
      <label className="text-sm font-bold text-ink">E-mail
        <input type="email" required value={email} autoComplete="off" onChange={(e) => setEmail(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-bg px-3 py-2 font-normal text-foreground" />
      </label>
      <label className="text-sm font-bold text-ink">Senha
        <PasswordInput required placeholder="mín. 6" value={password} autoComplete="new-password" onChange={(e) => setPassword(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-bg py-2 pl-3 pr-10 font-normal text-foreground" />
      </label>
      <button type="submit" disabled={createMutation.isPending} className="inline-flex items-center justify-center gap-2 rounded-full bg-brand px-5 py-2 font-bold text-white hover:bg-brand-dark disabled:opacity-60">
        <Plus className="size-5" aria-hidden="true" /> {createMutation.isPending ? 'Criando…' : 'Novo parceiro'}
      </button>
      {createMutation.isError && <p className="text-sm text-red-500 sm:col-span-4">{apiMessage(createMutation.error, 'Não foi possível criar o parceiro.')}</p>}
      {createNotice && <p role="status" className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 sm:col-span-4">{createNotice}</p>}
    </form>
  )
}

function PartnerCard({ partner, courses, finance }: { partner: AuthUser; courses: AdminCourseRow[]; finance?: InstructorFinance }) {
  return (
    <li className="rounded-2xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-bold text-ink">{partner.displayName ?? '—'}</p>
          <p className="text-sm text-muted">{partner.email}</p>
        </div>
        <ResetPasswordButton uid={partner.uid} />
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        <span className="rounded-full bg-brand-soft px-2.5 py-1 font-bold text-brand">{courses.length} {courses.length === 1 ? 'curso' : 'cursos'}</span>
        <span className="rounded-full border border-border px-2.5 py-1 text-ink">A receber: {formatMoneyBRL(finance?.owedInCents ?? 0)}</span>
        <span className="rounded-full border border-border px-2.5 py-1 text-ink">No mês: {formatMoneyBRL(finance?.monthNetInCents ?? 0)}</span>
      </div>

      {courses.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {courses.map((c) => (
            <li key={c.id}>
              <Link to={`/instrutor/curso/${c.id}`} className="rounded-lg border border-border px-2.5 py-1 text-sm text-accent hover:border-brand/40">{c.title}</Link>
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

export function AdminPartners() {
  const usersQuery = useAdminUsersQuery()
  const coursesQuery = useAdminCoursesQuery()
  const financeQuery = useAdminFinanceQuery()

  const partners = usersQuery.data?.filter((u) => u.roles.includes(Role.teacher)) ?? []

  const coursesByOwner = new Map<string, AdminCourseRow[]>()
  for (const c of coursesQuery.data ?? []) {
    if (!c.instructorId) continue
    const arr = coursesByOwner.get(c.instructorId) ?? []
    arr.push(c)
    coursesByOwner.set(c.instructorId, arr)
  }
  const financeByOwner = new Map((financeQuery.data?.instructors ?? []).map((i) => [i.instructorId, i]))

  return (
    <div>
      <h2 className="flex items-center gap-2 text-2xl font-bold text-ink">
        <Handshake className="size-6 text-brand" aria-hidden="true" /> Parceiros
      </h2>
      <p className="mt-1 text-sm text-muted">Parceiros são os donos dos cursos. Crie um parceiro e vincule cursos a ele na aba <strong>Cursos</strong>.</p>

      <CreatePartner />

      <h3 className="mt-6 mb-3 font-bold text-ink">{partners.length} {partners.length === 1 ? 'parceiro' : 'parceiros'}</h3>
      {usersQuery.isLoading && <p className="text-muted">Carregando…</p>}
      {usersQuery.data && partners.length === 0 && <p className="text-muted">Nenhum parceiro ainda. Crie o primeiro acima.</p>}
      <ul className="flex flex-col gap-3">
        {partners.map((p) => (
          <PartnerCard key={p.uid} partner={p} courses={coursesByOwner.get(p.uid) ?? []} finance={financeByOwner.get(p.uid)} />
        ))}
      </ul>
    </div>
  )
}
