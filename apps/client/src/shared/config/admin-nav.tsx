import {
  LayoutDashboard, BookOpen, Users, Handshake, GraduationCap, DollarSign, Receipt, Tag, Ticket, ScrollText, Award,
  School, Building2, ClipboardCheck, ListChecks, type LucideIcon,
} from 'lucide-react'

/**
 * Quem vê o item: admin de qualquer polo; admin de polo que vende online; admin de polo que não é a
 * matriz; admin da plataforma no endereço da matriz.
 */
export type AdminNavAudience = 'polo' | 'vendas' | 'polo-parceiro' | 'plataforma'

export interface AdminNavItem {
  to: string
  end?: boolean
  label: string
  Icon: LucideIcon
  audience: AdminNavAudience
  /** Tela da rede de polos e parceiros: some enquanto `REDE_HABILITADA` for false (ver features.ts). */
  rede?: true
}

/** Navegação da área de administração — sidebar (desktop) e menu do header (mobile). */
export const ADMIN_NAV: AdminNavItem[] = [
  { to: '/admin', end: true, label: 'Visão geral', Icon: LayoutDashboard, audience: 'polo' },
  { to: '/admin/cursos', label: 'Cursos', Icon: BookOpen, audience: 'polo' },
  { to: '/admin/parceiros', label: 'Parceiros', Icon: Handshake, audience: 'polo', rede: true },
  { to: '/admin/usuarios', label: 'Usuários', Icon: Users, audience: 'polo' },
  { to: '/admin/alunos', label: 'Alunos', Icon: GraduationCap, audience: 'polo' },
  { to: '/admin/financeiro', label: 'Financeiro', Icon: DollarSign, audience: 'vendas' },
  { to: '/admin/cobrancas', label: 'Cobranças', Icon: Receipt, audience: 'vendas' },
  { to: '/admin/categorias', label: 'Categorias', Icon: Tag, audience: 'polo' },
  { to: '/admin/cupons', label: 'Cupons', Icon: Ticket, audience: 'vendas' },
  { to: '/admin/minha-escola', label: 'Minha escola', Icon: School, audience: 'polo-parceiro', rede: true },
  { to: '/admin/certificado', label: 'Certificado', Icon: Award, audience: 'plataforma' },
  { to: '/admin/logs', label: 'Logs', Icon: ScrollText, audience: 'polo' },
  { to: '/admin/polos', label: 'Polos', Icon: Building2, audience: 'plataforma', rede: true },
  { to: '/admin/aprovacao', label: 'Aprovação de cursos', Icon: ClipboardCheck, audience: 'plataforma', rede: true },
  { to: '/admin/logs-plataforma', label: 'Logs da plataforma', Icon: ListChecks, audience: 'plataforma', rede: true },
]
