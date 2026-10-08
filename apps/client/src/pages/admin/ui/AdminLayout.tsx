import { NavLink, Outlet } from 'react-router-dom'
import { signOut } from 'firebase/auth'
import { LogOut } from 'lucide-react'
import { useAdminNav } from '@/features/admin-nav'
import { firebaseAuth } from '@/shared/config/firebase'

export function AdminLayout() {
  const nav = useAdminNav()
  return (
    <div className="mx-auto flex max-w-7xl gap-6 px-4 py-8 sm:px-6">
      {/* Desktop: barra lateral. No mobile a navegação vai no menu sanduíche do header. */}
      <aside className="hidden w-56 shrink-0 lg:block">
        <h1 className="mb-4 text-xl font-bold text-ink">Administração</h1>
        <nav className="flex flex-col gap-1">
          {nav.map(({ to, end, label, Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                'flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ' +
                (isActive ? 'bg-brand text-white' : 'text-accent hover:bg-brand-soft')
              }
            >
              <Icon className="size-4" aria-hidden="true" /> {label}
            </NavLink>
          ))}
          <button
            type="button"
            onClick={() => firebaseAuth && void signOut(firebaseAuth)}
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-muted transition-colors hover:bg-brand-soft"
          >
            <LogOut className="size-4" aria-hidden="true" /> Sair
          </button>
        </nav>
      </aside>
      <main className="min-w-0 flex-1">
        <Outlet />
      </main>
    </div>
  )
}
