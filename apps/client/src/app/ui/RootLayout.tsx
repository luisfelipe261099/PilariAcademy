import { Outlet } from 'react-router-dom'
import { suspendedCopy, useTenant } from '@/entities/tenant'
import { Footer, PoloFooter } from '@/widgets/footer'
import { Header } from '@/widgets/header'
import { ScrollToTop } from './ScrollToTop'
import { WhatsAppButton } from './WhatsAppButton'

export function RootLayout() {
  const tenant = useTenant()
  const suspenso = suspendedCopy(tenant)
  return (
    <div className="flex min-h-dvh flex-col overflow-x-clip bg-bg">
      <ScrollToTop />
      <Header />
      {suspenso && (
        <div role="status" className="border-b border-amber-500/40 bg-amber-500/10 px-4 py-2 text-center text-sm text-ink">
          {suspenso.banner}
        </div>
      )}
      <main className="min-w-0 flex-1">
        <Outlet />
      </main>
      {tenant.isMatriz ? <Footer /> : <PoloFooter />}
      <WhatsAppButton />
    </div>
  )
}
