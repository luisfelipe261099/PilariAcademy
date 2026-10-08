import { Link } from 'react-router-dom'
import { BookOpen, CheckCircle2, DollarSign, GraduationCap, ShoppingBag, Users, type LucideIcon } from 'lucide-react'
import { useAdminNav } from '@/features/admin-nav'
import { useAdminStatsQuery } from '@/entities/admin-dashboard'
import { formatMoneyBRL } from '@/entities/course'

function Stat({ label, value, Icon, accent }: { label: string; value: string | number; Icon: LucideIcon; accent: string }) {
  return (
    <div className="flex items-center gap-4 rounded-2xl border border-border bg-card p-5">
      <span className={`grid size-12 shrink-0 place-items-center rounded-xl ${accent}`}>
        <Icon className="size-6" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <span className="block text-sm text-muted">{label}</span>
        <span className="mt-0.5 block truncate text-2xl font-bold text-ink">{value}</span>
      </div>
    </div>
  )
}

const SHORTCUTS = [
  { to: '/admin/alunos', label: 'Gerenciar alunos', Icon: GraduationCap },
  { to: '/admin/cursos', label: 'Cursos', Icon: BookOpen },
  { to: '/admin/usuarios', label: 'Usuários', Icon: Users },
  { to: '/admin/financeiro', label: 'Financeiro', Icon: DollarSign },
]

export function AdminOverview() {
  const { data, isLoading, isError } = useAdminStatsQuery()
  // Só os atalhos que o menu deste polo mostra: o Financeiro, por exemplo, volta para cá onde não há venda online.
  const nav = useAdminNav()
  const shortcuts = SHORTCUTS.filter((s) => nav.some((i) => i.to === s.to))

  return (
    <div>
      <h2 className="text-2xl font-bold text-ink">Visão geral</h2>
      <p className="mt-1 text-sm text-muted">Indicadores da plataforma em tempo real.</p>

      {isLoading && <p className="mt-4 text-muted">Carregando…</p>}
      {isError && <p className="mt-4 text-red-500">Não foi possível carregar os indicadores.</p>}

      {data && (
        <>
          <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Stat label="Alunos" value={data.studentCount} Icon={GraduationCap} accent="bg-brand-soft text-brand" />
            <Stat label="Professores" value={data.teacherCount} Icon={Users} accent="bg-blue-50 text-blue-600" />
            <Stat label="Cursos" value={data.courseCount} Icon={BookOpen} accent="bg-amber-50 text-amber-600" />
            <Stat label="Publicados" value={data.publishedCourseCount} Icon={CheckCircle2} accent="bg-emerald-50 text-emerald-600" />
            <Stat label="Vendas pagas" value={data.paidOrderCount} Icon={ShoppingBag} accent="bg-pink-50 text-pink-600" />
            <Stat label="Receita" value={formatMoneyBRL(data.grossInCents)} Icon={DollarSign} accent="bg-emerald-50 text-emerald-600" />
          </div>

          <h3 className="mt-8 mb-3 text-sm font-bold text-ink">Atalhos</h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {shortcuts.map(({ to, label, Icon }) => (
              <Link
                key={to}
                to={to}
                className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-3 text-sm font-medium text-accent transition-colors hover:bg-brand-soft"
              >
                <Icon className="size-4 shrink-0" aria-hidden="true" /> {label}
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
