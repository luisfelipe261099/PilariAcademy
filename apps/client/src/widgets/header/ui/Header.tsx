import { useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { signOut } from 'firebase/auth'
import { GraduationCap, LogOut, Menu, Search, ShoppingCart, X } from 'lucide-react'
import { Role } from '@pilari/types'
import { ThemeToggle } from '@/features/theme-toggle'
import { useAdminNav } from '@/features/admin-nav'
import { useAuthStore, useMeQuery } from '@/entities/auth'
import { BrandLogo, useTenant } from '@/entities/tenant'
import { useCart } from '@/shared/cart'
import { firebaseAuth } from '@/shared/config/firebase'
import { homeForRoles } from '@/app/router/role-routing'
import { InstallAppButton } from '@/widgets/install-app'

export function Header() {
  const tenant = useTenant()
  const nav = useAdminNav()
  const status = useAuthStore((s) => s.status)
  const { data } = useMeQuery()
  const roles = data?.roles ?? []
  const isAdmin = roles.includes(Role.admin)
  const accountHref = homeForRoles(roles)
  const cartCount = useCart((s) => s.ids.length)
  const location = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)

  // Fecha o menu sempre que a rota muda (evita reabrir num estado inconsistente).
  const [lastPath, setLastPath] = useState(location.pathname)
  if (location.pathname !== lastPath) {
    setLastPath(location.pathname)
    setMenuOpen(false)
  }

  const onAdmin = location.pathname.startsWith('/admin')
  const accountLabel = isAdmin ? 'Admin' : 'Minha conta'
  const logout = () => firebaseAuth && void signOut(firebaseAuth)
  const closeMenu = () => setMenuOpen(false)

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-card/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:px-6 lg:gap-6">
        <Link to="/" className="flex min-w-0 items-center gap-2" aria-label={`${tenant.name} — início`}>
          <BrandLogo className="h-9 w-auto" />
        </Link>

        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          <ThemeToggle />
          <InstallAppButton />
          {tenant.salesEnabled && (
            <Link
              to="/carrinho"
              aria-label={`Carrinho (${cartCount})`}
              className="relative inline-flex size-10 items-center justify-center rounded-full border border-border text-accent transition-colors hover:bg-brand-soft"
            >
              <ShoppingCart className="size-5" aria-hidden="true" />
              {cartCount > 0 && (
                <span className="absolute -top-1 -right-1 grid min-w-5 place-items-center rounded-full bg-brand px-1 text-xs font-bold text-white">
                  {cartCount}
                </span>
              )}
            </Link>
          )}
          {/* Explorar cursos: pill com texto no desktop */}
          <a
            href="/#cursos"
            className="hidden items-center gap-2 rounded-full border border-border px-4 py-2 text-sm font-medium text-accent transition-colors hover:bg-brand-soft lg:inline-flex"
          >
            <Search className="size-4" aria-hidden="true" />
            Explorar cursos
          </a>

          {status === 'authenticated' ? (
            <>
              {/* Desktop: conta + sair inline. Abaixo de lg vão pro menu sanduíche. */}
              <Link
                to={accountHref}
                className="hidden items-center gap-2 rounded-full bg-brand px-5 py-2 text-sm font-bold text-white shadow-sm transition-colors hover:bg-brand-dark lg:inline-flex"
              >
                <GraduationCap className="size-4" aria-hidden="true" />
                {accountLabel}
              </Link>
              <button
                type="button"
                onClick={logout}
                className="hidden rounded-full border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-brand-soft lg:inline-flex"
              >
                Sair
              </button>

              {/* Mobile/tablet: botão sanduíche */}
              <button
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                aria-label={menuOpen ? 'Fechar menu' : 'Abrir menu'}
                aria-expanded={menuOpen}
                className="inline-flex size-10 items-center justify-center rounded-full border border-border text-accent transition-colors hover:bg-brand-soft lg:hidden"
              >
                {menuOpen ? <X className="size-5" aria-hidden="true" /> : <Menu className="size-5" aria-hidden="true" />}
              </button>
            </>
          ) : (
            <Link
              to="/login"
              className="inline-flex items-center gap-2 rounded-full bg-brand px-4 py-2 text-sm font-bold text-white shadow-sm transition-colors hover:bg-brand-dark sm:px-5"
            >
              <GraduationCap className="size-4" aria-hidden="true" />
              Entrar
            </Link>
          )}
        </div>
      </div>

      {/* Dropdown do menu (abre para baixo) — mobile/tablet */}
      {menuOpen && status === 'authenticated' && (
        <div className="absolute inset-x-0 top-full max-h-[80dvh] overflow-y-auto border-b border-border bg-card shadow-lg lg:hidden">
          <nav className="mx-auto flex max-w-7xl flex-col gap-1 p-3">
            {onAdmin && (
              <>
                <p className="px-3 pt-1 pb-0.5 text-xs font-bold uppercase tracking-wide text-muted">Administração</p>
                {nav.map(({ to, end, label, Icon }) => (
                  <NavLink
                    key={to}
                    to={to}
                    end={end}
                    onClick={closeMenu}
                    className={({ isActive }) =>
                      'flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ' +
                      (isActive ? 'bg-brand text-white' : 'text-accent hover:bg-brand-soft')
                    }
                  >
                    <Icon className="size-4" aria-hidden="true" /> {label}
                  </NavLink>
                ))}
                <hr className="my-1 border-border" />
              </>
            )}

            {!onAdmin && (
              <Link
                to={accountHref}
                onClick={closeMenu}
                className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-bold text-accent transition-colors hover:bg-brand-soft"
              >
                <GraduationCap className="size-4" aria-hidden="true" />
                {accountLabel}
              </Link>
            )}
            <button
              type="button"
              onClick={() => {
                closeMenu()
                logout()
              }}
              className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-ink transition-colors hover:bg-brand-soft"
            >
              <LogOut className="size-4" aria-hidden="true" />
              Sair
            </button>
          </nav>
        </div>
      )}
    </header>
  )
}
