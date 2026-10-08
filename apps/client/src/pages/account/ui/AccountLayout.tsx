import { NavLink, Outlet } from 'react-router-dom'
import { useTenant } from '@/entities/tenant'
import { ACCOUNT_NAV } from '@/shared/config/account-nav'
import { visibleAccountNav } from '@/shared/config/account-nav-visibility'

export function AccountLayout() {
  // Polo sem venda online não mostra o Financeiro (pedidos e carnês): não há o que cobrar do aluno.
  const { salesEnabled } = useTenant()
  const nav = visibleAccountNav(ACCOUNT_NAV, { salesEnabled })
  return (
    <div className="mx-auto flex max-w-6xl gap-6 px-4 py-8 sm:px-6">
      {/* Desktop: barra lateral. No mobile a lista vira abas horizontais roláveis — o
          header do site não tem menu sanduíche para o aluno, então a navegação precisa
          existir dentro da própria página. */}
      <aside className="hidden w-56 shrink-0 lg:block">
        <h1 className="mb-4 text-xl font-bold text-ink">Minha conta</h1>
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
        </nav>
      </aside>

      <div className="min-w-0 flex-1">
        <nav className="mb-5 flex gap-2 overflow-x-auto lg:hidden" aria-label="Minha conta">
          {nav.map(({ to, end, label, Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                'flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ' +
                (isActive ? 'border-brand bg-brand text-white' : 'border-border text-accent hover:bg-brand-soft')
              }
            >
              <Icon className="size-4" aria-hidden="true" /> {label}
            </NavLink>
          ))}
        </nav>
        <Outlet />
      </div>
    </div>
  )
}
