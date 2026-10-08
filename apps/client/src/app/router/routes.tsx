import type { ReactNode } from 'react'
import { Navigate, type RouteObject } from 'react-router-dom'
import { Role } from '@pilari/types'
import { CourseDetailPage } from '@/pages/course'
import { HomePage } from '@/pages/home'
import { LoginPage } from '@/pages/login'
import { DashboardPage } from '@/pages/dashboard'
import { AccountLayout, ProfilePage, FinancePage, CertificatesPage, PasswordPage } from '@/pages/account'
import {
  AdminLayout, AdminOverview, AdminCourses, AdminStudents, AdminStudentProfile, AdminUsers, AdminPartners, AdminCobrancas, AdminLogs, AdminCertificate,
  AdminMySchool, PlatformTenants, PlatformTenantDetail, PlatformReview, PlatformLogs,
} from '@/pages/admin'
import { CartPage } from '@/pages/cart'
import { ClassroomPage } from '@/pages/classroom'
import { TutorPage } from '@/pages/tutor'
import { InstructorPage } from '@/pages/instructor'
import { InstructorMessagesPage } from '@/pages/instructor-messages'
import { InstructorProfilePage } from '@/pages/instructor-profile'
import { CourseEditorPage } from '@/pages/instructor-course-editor'
import { CertificateVerifyPage } from '@/pages/certificate-verify'
import { FinanceManager } from '@/entities/finance'
import { CategoryManager } from '@/entities/category'
import { CouponManager } from '@/entities/coupon'
import { ProtectedRoute } from './ProtectedRoute'
import { RequireRole } from './RequireRole'
import { RequirePlatformAdmin } from './RequirePlatformAdmin'
import { RequireSales } from './RequireSales'
import { RootLayout } from '../ui/RootLayout'
import { RouteError } from '../ui/RouteError'
import { REDE_HABILITADA } from '@/shared/config'

/** Tela da rede de polos e parceiros: com a rede desligada (features.ts), o endereço volta para a visão geral. */
const rede = (tela: ReactNode): ReactNode => (REDE_HABILITADA ? tela : <Navigate to="/admin" replace />)

export const routes: RouteObject[] = [
  { path: '/login', element: <LoginPage />, errorElement: <RouteError /> },
  // Tutor de voz: tela cheia, fora do layout (sem cabeçalho, rodapé nem botão do WhatsApp).
  {
    path: '/aprender/:slug/tutor',
    element: (
      <ProtectedRoute>
        <TutorPage />
      </ProtectedRoute>
    ),
    errorElement: <RouteError />,
  },
  {
    element: <RootLayout />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'curso/:slug', element: <CourseDetailPage /> },
      { path: 'certificado/:code', element: <CertificateVerifyPage /> },
      { path: 'carrinho', element: <CartPage /> },
      {
        path: 'aprender/:slug',
        element: (
          <ProtectedRoute>
            <ClassroomPage />
          </ProtectedRoute>
        ),
      },
      {
        path: 'dashboard',
        element: (
          <ProtectedRoute>
            <DashboardPage />
          </ProtectedRoute>
        ),
      },
      {
        // Área do aluno. O layout traz a navegação (sidebar no desktop, abas no mobile),
        // então cada filha só renderiza o próprio conteúdo.
        path: 'minha-conta',
        element: (
          <ProtectedRoute>
            <AccountLayout />
          </ProtectedRoute>
        ),
        children: [
          { index: true, element: <ProfilePage /> },
          { path: 'financeiro', element: <RequireSales fallback="/minha-conta"><FinancePage /></RequireSales> },
          { path: 'certificados', element: <CertificatesPage /> },
          { path: 'senha', element: <PasswordPage /> },
        ],
      },
      {
        path: 'instrutor',
        element: (
          <ProtectedRoute>
            <RequireRole role={Role.teacher}>
              <InstructorPage />
            </RequireRole>
          </ProtectedRoute>
        ),
      },
      {
        path: 'instrutor/mensagens',
        element: (
          <ProtectedRoute>
            <RequireRole role={Role.teacher}>
              <InstructorMessagesPage />
            </RequireRole>
          </ProtectedRoute>
        ),
      },
      {
        path: 'instrutor/perfil',
        element: (
          <ProtectedRoute>
            <RequireRole role={Role.teacher}>
              <InstructorProfilePage />
            </RequireRole>
          </ProtectedRoute>
        ),
      },
      {
        path: 'instrutor/curso/:id',
        element: (
          <ProtectedRoute>
            <RequireRole role={Role.teacher}>
              <CourseEditorPage />
            </RequireRole>
          </ProtectedRoute>
        ),
      },
      {
        path: 'admin',
        element: (
          <ProtectedRoute>
            <RequireRole role={Role.admin}>
              <AdminLayout />
            </RequireRole>
          </ProtectedRoute>
        ),
        children: [
          { index: true, element: <AdminOverview /> },
          { path: 'cursos', element: <AdminCourses /> },
          { path: 'parceiros', element: rede(<AdminPartners />) },
          { path: 'usuarios', element: <AdminUsers /> },
          { path: 'alunos', element: <AdminStudents /> },
          { path: 'alunos/:uid', element: <AdminStudentProfile /> },
          { path: 'financeiro', element: <RequireSales><FinanceManager /></RequireSales> },
          { path: 'cobrancas', element: <RequireSales><AdminCobrancas /></RequireSales> },
          { path: 'categorias', element: <CategoryManager /> },
          { path: 'cupons', element: <RequireSales><CouponManager /></RequireSales> },
          { path: 'certificado', element: <RequirePlatformAdmin><AdminCertificate /></RequirePlatformAdmin> },
          { path: 'minha-escola', element: rede(<AdminMySchool />) },
          { path: 'logs', element: <AdminLogs /> },
          { path: 'polos', element: rede(<RequirePlatformAdmin><PlatformTenants /></RequirePlatformAdmin>) },
          { path: 'polos/:id', element: rede(<RequirePlatformAdmin><PlatformTenantDetail /></RequirePlatformAdmin>) },
          { path: 'aprovacao', element: rede(<RequirePlatformAdmin><PlatformReview /></RequirePlatformAdmin>) },
          { path: 'logs-plataforma', element: rede(<RequirePlatformAdmin><PlatformLogs /></RequirePlatformAdmin>) },
        ],
      },
      { path: '*', element: <HomePage /> },
    ],
  },
]
