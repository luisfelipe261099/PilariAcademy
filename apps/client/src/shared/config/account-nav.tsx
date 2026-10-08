import { User, Receipt, Award, KeyRound, LayoutDashboard, type LucideIcon } from 'lucide-react'

/** Quem vê o item: todo aluno; ou só quem estuda onde o polo vende online (sem venda não há o que cobrar). */
export type AccountNavAudience = 'aluno' | 'vendas'

export interface AccountNavItem {
  to: string
  end?: boolean
  label: string
  Icon: LucideIcon
  audience: AccountNavAudience
}

/** Navegação da área do aluno — sidebar no desktop e menu do header no mobile. */
export const ACCOUNT_NAV: AccountNavItem[] = [
  { to: '/dashboard', label: 'Meus cursos', Icon: LayoutDashboard, audience: 'aluno' },
  { to: '/minha-conta', end: true, label: 'Meus dados', Icon: User, audience: 'aluno' },
  { to: '/minha-conta/financeiro', label: 'Financeiro', Icon: Receipt, audience: 'vendas' },
  { to: '/minha-conta/certificados', label: 'Certificados', Icon: Award, audience: 'aluno' },
  { to: '/minha-conta/senha', label: 'Senha', Icon: KeyRound, audience: 'aluno' },
]
