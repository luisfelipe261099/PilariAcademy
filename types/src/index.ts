/** Tipos e DTOs compartilhados entre o client e o server. */

export interface ApiMessage {
  message: string
  timestamp: string
}

/** Papéis de acesso do EAD (valores em inglês). Fonte de verdade das permissões fica no banco (tabela users). */
export enum Role {
  student = 'student',
  teacher = 'teacher',
  admin = 'admin',
}

/** Contrato público do usuário autenticado (o que o client consome de /auth/me e /auth/sync-user-data). */
export interface AuthUser {
  uid: string
  email: string
  displayName: string | null
  photoUrl: string | null
  roles: Role[]
  /** Equipe Studio Pilari: aprova cursos e cadastra polos. Age como admin em qualquer polo. */
  isPlatformAdmin: boolean
}

/** Perfil completo de um usuário visto pelo admin (tela de alunos). */
export interface AdminUserDetail extends AuthUser {
  /** Só dígitos, ou null quando ainda não informado. */
  cpf: string | null
  disabled: boolean
  /** ISO 8601. */
  createdAt: string | null
}

/** Campos que o admin pode editar no perfil do aluno. Só os enviados são gravados. */
export interface AdminUpdateUserInput {
  displayName?: string
  cpf?: string
}

export const APP_NAME = 'Studio Pilari'

// ─────────────────────────────────────────────────────────────────────────────
// Contrato de domínio dos cursos (fatia "Cursos no Banco").
// ─────────────────────────────────────────────────────────────────────────────

/** Tipo de curso: consumido na plataforma (online) ou link externo/presencial. */
export type CourseKind = 'online' | 'external'

/** Ciclo de vida do curso. Só 'published' aparece no catálogo público. */
/** in_review: instrutor submeteu e aguarda aprovação de um admin para publicar (A04). */
export type CourseStatus = 'draft' | 'in_review' | 'published' | 'archived'

/** Categoria gerenciada pelo admin. */
export interface Category {
  id: string
  name: string
  slug: string
}

/** Aula (vídeo + texto). Anexos são expostos só na fatia de consumo. */
export interface Lesson {
  id: string
  title: string
  description: string | null
  videoUrl: string | null
  durationSec: number
  order: number
  isFreePreview: boolean
}

/** Módulo agrupa aulas. Existe apenas em cursos 'online'. */
export interface Module {
  id: string
  title: string
  order: number
  lessons: Lesson[]
}

/** Card do catálogo — leve, sem o conteúdo interno. */
export interface CourseSummary {
  id: string
  slug: string
  title: string
  subtitle: string | null
  kind: CourseKind
  /** Preço cobrado (já com a promoção aplicada, quando ativa). */
  priceInCents: number
  /** Preço "de" (riscado) quando em promoção; null fora de promoção. */
  listPriceInCents: number | null
  /** Fim da promoção (ISO) quando em promoção; null caso contrário. */
  promoEndsAt: string | null
  coverImageUrl: string | null
  /** Enquadramento da capa (CSS object-position, ex.: "50% 30%"). null = padrão do card (rodapé, "50% 100%"). */
  coverFocus: string | null
  category: Category | null
  instructorName: string | null
  /** Pré-venda: data ISO em que o conteúdo libera. null = disponível imediatamente. */
  availableAt: string | null
}

/** Perfil público do instrutor, exibido na página do curso (credibilidade). */
export interface InstructorProfile {
  name: string | null
  photoUrl: string | null
  headline: string | null
  bio: string | null
}

/** Detalhe do curso — com módulos/aulas (vazio quando kind='external'). */
export interface CourseDetail extends CourseSummary {
  description: string | null
  status: CourseStatus
  externalUrl: string | null
  modules: Module[]
  instructor: InstructorProfile | null
}

/** Perfil editável pelo próprio usuário (instrutor edita nome, foto, qualificações, bio). */
export interface EditableProfile {
  displayName: string | null
  photoUrl: string | null
  headline: string | null
  bio: string | null
  /** Somente leitura: identifica a conta e não é editável por aqui. */
  email: string | null
  /**
   * CPF do aluno. Vai impresso no certificado e é o documento da cobrança no Asaas, então
   * é WRITE-ONCE: uma vez gravado, só o admin corrige. `cpfLocked` diz à tela se o campo
   * deve aparecer aberto ou travado — sem isso ela teria que adivinhar pela string vazia.
   */
  cpf: string | null
  cpfLocked: boolean
}

/** Um pedido do próprio aluno, para a página Financeiro. */
export interface MyOrder {
  id: string
  status: OrderStatus
  totalInCents: number
  paymentMode: PaymentMode | null
  billingType: string | null
  /** Fatura hospedada no Asaas: é por onde o aluno paga ou reimprime o boleto. */
  paymentUrl: string | null
  dueDate: string | null
  paidAt: string | null
  createdAt: string | null
  courseTitles: string[]
  /** Parcelas do carnê. Vazio quando não é carnê. */
  installments: OrderInstallment[]
  /** Preenchido quando o carnê quitou (libera o certificado). */
  settledAt: string | null
  /** Caminho autenticado do PDF do carnê. null quando o pedido não é carnê. */
  carneUrl: string | null
}

/** Um certificado já emitido, para a página Certificados. */
export interface MyCertificate {
  code: string
  courseSlug: string
  courseTitle: string
  hours: number | null
  issuedAt: string | null
  status: 'issued' | 'revoked'
}

// ─────────────────────────────────────────────────────────────────────────────
// Contrato de compra/matrícula (fatia "Compra & Asaas").
// ─────────────────────────────────────────────────────────────────────────────

export type EnrollmentStatus = 'pending' | 'active' | 'canceled'
export type EnrollmentSource = 'purchase' | 'free'
export type AsaasPaymentStatus = 'PENDING' | 'CONFIRMED' | 'RECEIVED' | 'OVERDUE' | 'REFUNDED'

/** Matrícula do aluno num curso, com o resumo do curso (p/ "Meus cursos"). */
export interface Enrollment {
  id: string
  courseId: string
  status: EnrollmentStatus
  source: EnrollmentSource
  course: CourseSummary
  paymentStatus: AsaasPaymentStatus | null
  /** % de aulas concluídas (0–100). 0 para cursos sem aulas/external. */
  progressPercent: number
}

/** Matrícula vista pelo admin ao gerenciar os cursos de um aluno manualmente. */
export interface AdminEnrollment {
  courseId: string
  courseTitle: string
  courseSlug: string
  status: EnrollmentStatus
  source: EnrollmentSource
}

// ── Carrinho + cupons (redesenho estilo Udemy) ──────────────────────────────

export type OrderStatus = 'pending' | 'paid' | 'canceled'
export type CouponType = 'percent' | 'fixed'

/** Cupom de desconto gerenciado pelo admin. */
export interface Coupon {
  id: string
  code: string
  type: CouponType
  value: number
  active: boolean
}

/** Resumo do carrinho calculado no server (com cupom aplicado). */
export interface CartSummary {
  items: CourseSummary[]
  subtotalInCents: number
  discountInCents: number
  totalInCents: number
  couponCode: string | null
  couponError: string | null
}

/** Resultado da finalização: link de pagamento OU matrículas já ativas (total 0). */
export interface CheckoutResult {
  paymentUrl: string | null
  enrollments: Enrollment[]
}

/** Como o aluno escolheu pagar. Substitui o booleano `parcelado`.
 *  'boleto' sozinho seria ambíguo: a opção à vista também oferece boleto. */
export type PaymentMode = 'avista' | 'cartao_parcelado' | 'boleto_parcelado'

export type InstallmentStatus = 'pending' | 'paid' | 'overdue' | 'refunded'

/** Uma parcela do carnê. */
export interface OrderInstallment {
  installmentNumber: number | null
  valueInCents: number
  status: InstallmentStatus
  dueDate: string | null
  paidAt: string | null
}

/** Estado de quitação de um pedido, para a tela de certificado bloqueado e para o admin. */
export interface OrderSettlement {
  settled: boolean
  paidCount: number
  totalCount: number
  /** URL do nosso proxy do carnê em PDF; null quando o pedido não é carnê. */
  carneUrl: string | null
}

export interface CheckoutRequest {
  courseIds: string[]
  couponCode?: string
  cpf?: string
  paymentMode?: PaymentMode
  /** Obrigatório quando paymentMode === 'boleto_parcelado'. De 2 a 5. */
  installmentCount?: number
}

// ── Sala de aula (player) ────────────────────────────────────────────────────

export interface ClassroomAttachment {
  id: string
  fileName: string
  url: string
}
export interface ClassroomLesson {
  id: string
  title: string
  description: string | null
  durationSec: number
  order: number
  signedVideoUrl: string | null
  attachments: ClassroomAttachment[]
  completed: boolean
}
export interface ClassroomModule {
  id: string
  title: string
  order: number
  lessons: ClassroomLesson[]
  /** O módulo tem uma prova (questões cadastradas). */
  hasQuiz: boolean
  /** O aluno já foi aprovado na prova do módulo. */
  quizPassed: boolean
  /** Gotejamento: data ISO de liberação do módulo. null = sem trava própria. */
  availableAt: string | null
  /** true quando o módulo ainda está bloqueado (availableAt no futuro). */
  locked: boolean
}
/** Conteúdo completo do curso para o aluno matriculado (vídeos/anexos assinados). */
export interface Classroom {
  courseId: string
  slug: string
  title: string
  modules: ClassroomModule[]
  progressPercent: number
  /** Pré-venda: data ISO de liberação. null = já liberado. */
  availableAt: string | null
  /** true quando availableAt ainda está no futuro (conteúdo bloqueado). */
  locked: boolean
  /** true quando o aluno tem CPF válido cadastrado (11 dígitos). */
  hasCpf: boolean
  /** true quando o aluno tem nome cadastrado. Sem ele o certificado não pode ser emitido. */
  hasName: boolean
  /** Tutor de voz com IA ligado neste curso (mostra o botão flutuante na sala de aula). */
  tutor: boolean
}

// ── Autoria do instrutor ─────────────────────────────────────────────────────

/** Ticket de upload: URL assinada de PUT + caminho do objeto a salvar depois. */
export interface UploadTicket {
  uploadUrl: string
  objectPath: string
}

/** Curso na visão do instrutor (inclui rascunhos + contagens). */
export interface InstructorCourse {
  id: string
  slug: string
  title: string
  subtitle: string | null
  description: string | null
  /** Preço normal (de tabela) — o instrutor edita aqui. */
  priceInCents: number
  /** Preço promocional (campanha) ou null. */
  promoPriceInCents: number | null
  /** Fim da promoção (ISO) ou null. */
  promoEndsAt: string | null
  coverImageUrl: string | null
  coverFocus: string | null
  categoryId: string | null
  status: CourseStatus
  moduleCount: number
  lessonCount: number
  /** Pré-venda: data ISO de liberação do conteúdo. null = imediato. */
  availableAt: string | null
  /**
   * Coordenador do curso — 2a assinatura do certificado. A 1a (Diretora) está na arte de
   * fundo e vale para todos. null = certificado sai só com a assinatura da Diretora.
   * Só admin edita: é nome em documento oficial.
   */
  coordinatorName: string | null
  coordinatorRole: string | null
  /** Template do certificado. null = usa o padrão. */
  certificateTemplateId: string | null
  /** Caminho no GCS da rubrica do coordenador. null = certificado sem a 2ª assinatura. */
  coordinatorSignaturePath: string | null
  /** Carga horária impressa no certificado. null = soma a duração das aulas. */
  workloadHours: number | null
  /** Tutor de voz com IA na sala de aula. Só admin liga (cada pergunta tem custo). */
  tutorEnabled: boolean
  /** Primeira aprovação (ISO). */
  approvedAt: string | null
  /** Motivo da devolução ou da retirada do ar, escrito pelo Studio Pilari. */
  reviewNote: string | null
  /** true quando título, carga horária e coordenador só mudam pelo Studio Pilari (para quem está vendo). */
  certificateFieldsLocked: boolean
}

export interface AuthoringAttachment {
  id: string
  fileName: string
  /** URL tocável/baixável (assinada se for objeto do GCS). */
  url: string
}
export interface AuthoringLesson {
  id: string
  title: string
  description: string | null
  videoUrl: string | null
  durationSec: number
  order: number
  isFreePreview: boolean
  attachments: AuthoringAttachment[]
}
export interface AuthoringModule {
  id: string
  title: string
  order: number
  lessons: AuthoringLesson[]
  /** Gotejamento: data ISO de liberação do módulo. null = junto com o curso. */
  availableAt: string | null
}

// ── Financeiro / repasse ─────────────────────────────────────────────────────

export interface InstructorFinance {
  instructorId: string
  instructorName: string | null
  netInCents: number
  paidInCents: number
  owedInCents: number
  /** Líquido gerado no mês selecionado (o que tende a ser repassado no fim do mês). */
  monthNetInCents: number
}
/** Uma venda paga (quem comprou), com o split já calculado. */
export interface AdminSale {
  orderId: string
  buyerName: string | null
  buyerEmail: string | null
  courseTitles: string[]
  /** Bruto da venda. */
  grossInCents: number
  /** Taxa que o Asaas cobrou. */
  asaasFeeInCents: number
  /** Parte do parceiro (após a taxa). */
  netInCents: number
  /** Lucro da plataforma (após a taxa). */
  platformInCents: number
  paidAt: string | null
}
export interface AdminFinance {
  grossInCents: number
  /** Total de taxas do Asaas (descontado antes do lucro). */
  asaasFeeInCents: number
  /** Lucro da plataforma = bruto − taxa Asaas − repasse aos parceiros. */
  commissionInCents: number
  netInCents: number
  /** Mês do recorte no formato 'YYYY-MM'. */
  month: string
  /** Líquido total gerado no mês selecionado. */
  monthNetInCents: number
  instructors: InstructorFinance[]
  /** Vendas pagas (quem comprou) — mais recentes primeiro. */
  sales: AdminSale[]
}
export interface PayoutRecord {
  id: string
  amountInCents: number
  note: string | null
  paidAt: string
}
/**
 * Resultado da reconciliação pull com o Asaas. Cobre DUAS varreduras: pedidos `pending` com
 * link (libera o que o webhook perdeu) e carnês `paid` ainda não quitados (recupera parcelas
 * 2..N cujo webhook se perdeu). `checked`/`reconciled`/`stillPending`/`failed` somam as duas;
 * `installmentsReconciled`/`settled` são exclusivos da varredura de carnês — opcionais porque
 * só fazem sentido quando ela roda (mantém o formato antigo válido para quem só olhava as
 * quatro chaves originais).
 */
export interface AsaasReconcileResult {
  /** Pedidos consultados no Asaas nesta rodada (pendentes com link + carnês em aberto). */
  checked: number
  /** Pedidos pendentes liberados agora (Asaas confirmou pagamento). */
  reconciled: number
  /** Pedidos pendentes que seguem sem pagamento no Asaas. */
  stillPending: number
  /** Falhas ao consultar o Asaas, nas duas varreduras (rede/API). */
  failed: number
  /** Parcelas de carnê que o Asaas já dava como pagas e esta rodada acabou de gravar. */
  installmentsReconciled?: number
  /** Carnês que quitaram (settled_at carimbado) nesta rodada — o certificado acabou de destravar. */
  settled?: number
}
/** Linha da aba Cobranças do admin (pedido + aluno + cursos). */
export interface AdminOrderRow {
  id: string
  userEmail: string | null
  userName: string | null
  status: OrderStatus
  totalInCents: number
  /** Forma de cobrança do Asaas: PIX/BOLETO/CREDIT_CARD/UNDEFINED. */
  billingType: string | null
  /** Parcelas escolhidas pelo aluno no Asaas. null = à vista ou pedido ainda não pago. */
  installmentCount: number | null
  asaasChargeId: string | null
  /** Link da fatura hospedada no Asaas (pra reenviar ao aluno). */
  paymentUrl: string | null
  dueDate: string | null
  paidAt: string | null
  createdAt: string | null
  courseTitles: string[]
  /** Modo escolhido no carrinho. null em pedidos anteriores a esta funcionalidade. */
  paymentMode: PaymentMode | null
  /** Parcelas do carnê. Vazio quando o pedido não é carnê. */
  installments: OrderInstallment[]
  /** Do que se trata, quando não é curso. null = pedido de curso (ver `courseTitles`). */
  description?: string | null
  /** uid do admin que criou. null = checkout feito pelo próprio aluno. */
  createdByAdmin?: string | null
  /** Preenchido quando o pedido está quitado. */
  settledAt: string | null
}
export interface InstructorEarnings {
  netInCents: number
  paidInCents: number
  owedInCents: number
  payouts: PayoutRecord[]
}

// ── Painel admin (visão geral + cursos) ──────────────────────────────────────

export interface AdminStats {
  studentCount: number
  teacherCount: number
  courseCount: number
  publishedCourseCount: number
  paidOrderCount: number
  grossInCents: number
}
export interface AdminCourseRow {
  id: string
  title: string
  slug: string
  status: CourseStatus
  kind: CourseKind
  priceInCents: number
  commissionPercent: number
  instructorId: string | null
  instructorName: string | null
  /** Template de certificado do curso. null = usa o padrão. */
  certificateTemplateId: string | null
  /** Primeira aprovação (ISO). */
  approvedAt: string | null
  /** Nota do Studio Pilari ao devolver ou tirar do ar. Enquanto existir, o polo não republica sem nova análise. */
  reviewNote: string | null
}

// ── Prova / quiz (por módulo) ────────────────────────────────────────────────

/** Questão na visão do instrutor (com a resposta certa). */
export interface AuthoringQuestion {
  id: string
  prompt: string
  options: string[]
  correctIndex: number
  order: number
  /** Peso da questão em pontos; a soma da prova deve dar 10. */
  points: number
}
/** Questão na visão do aluno (sem a resposta certa). */
export interface QuizQuestion {
  id: string
  prompt: string
  options: string[]
  points: number
}
export interface QuizForStudent {
  moduleId: string
  questions: QuizQuestion[]
  /** Melhor nota (0–100) entre todas as tentativas; divida por 10 para exibir. */
  bestScore: number | null
  /** Nota da tentativa mais recente (0–100). */
  lastScore: number | null
  passed: boolean
  attemptsUsed: number
  maxAttempts: number
  /** true quando as tentativas se esgotaram (sem liberação). */
  locked: boolean
}
export interface QuizResult {
  score: number
  passed: boolean
  bestScore: number
  attemptsUsed: number
  maxAttempts: number
  locked: boolean
}
/** Boletim do aluno num curso: nota por módulo + nota final. */
export interface CourseModuleGrade {
  moduleId: string
  title: string
  hasQuiz: boolean
  /** Melhor nota do módulo em escala 0–10, ou null se ainda não fez a prova. */
  grade: number | null
  passed: boolean
}
export interface CourseGrades {
  modules: CourseModuleGrade[]
  /** Média (0–10) dos módulos com prova, ou null se nenhum tem prova. */
  finalGrade: number | null
  approved: boolean
}

/** Verificação pública de um certificado. */
export interface CertificateVerification {
  valid: boolean
  studentName: string | null
  courseTitle: string | null
  issuedAt: string | null
  hasDocument: boolean
  /** Polo que ofereceu o curso. null quando é curso da próprio Studio Pilari ou código inválido. */
  poloName: string | null
}

/** Registro de auditoria (quem fez o quê). */
export interface AuditLog {
  id: string
  actorEmail: string | null
  action: string
  summary: string
  targetType: string | null
  targetId: string | null
  createdAt: string
}

/** Log no console da plataforma: o mesmo registro com o polo de origem (null nos dois = ação da plataforma). */
export interface PlatformAuditLog extends AuditLog {
  tenantId: string | null
  tenantName: string | null
}

// ── Mensagens (chat aluno↔instrutor por curso) ───────────────────────────────

/** Uma mensagem numa conversa (curso + aluno). `fromStudent` = enviada pelo aluno. */
export interface Message {
  id: string
  courseId: string
  studentId: string
  senderId: string
  fromStudent: boolean
  body: string
  createdAt: string
  readAt: string | null
}
/** Resumo de conversa para a caixa de entrada do instrutor. */
export interface ConversationSummary {
  courseId: string
  courseTitle: string
  studentId: string
  studentName: string | null
  lastBody: string
  lastAt: string
  unread: number
}
/** Thread completa de uma conversa (curso + aluno). */
export interface MessageThread {
  courseId: string
  courseTitle: string
  studentId: string
  studentName: string | null
  messages: Message[]
}

// ── Engajamento: avaliações, observações, anúncios ───────────────────────────

/** Avaliação (review) de um curso feita por um aluno. */
export interface CourseReview {
  id: string
  /** UID do autor — `null` na listagem pública (não expõe o UID do Firebase a anônimos). */
  userId: string | null
  userName: string | null
  rating: number
  comment: string | null
  createdAt: string
}
/** Avaliações de um curso: média, total, a minha (se houver) e a lista. */
export interface CourseReviews {
  average: number
  count: number
  mine: CourseReview | null
  reviews: CourseReview[]
}

/** Observação (anotação) do aluno, ancorada num segundo do vídeo. */
export interface LessonNote {
  id: string
  lessonId: string
  lessonTitle: string | null
  atSec: number
  body: string
  createdAt: string
}

/** Anúncio do instrutor para a turma de um curso. */
export interface Announcement {
  id: string
  courseId: string
  title: string
  body: string
  authorName: string | null
  createdAt: string
}

export interface CertificateTemplateSummary {
  id: string
  name: string
  /** Usado por curso sem template próprio. Exatamente um é true. */
  isDefault: boolean
  updatedAt: string | null
  /** Quantos cursos apontam explicitamente para este template. */
  courseCount: number
}

export interface CertificateTemplateDetail {
  id: string
  name: string
  html: string
  isDefault: boolean
}

export interface StudentHit {
  uid: string
  name: string | null
  email: string | null
  cpf: string | null
}

/** Ficha financeira de um aluno, na visão do admin. */
export interface StudentFinance {
  student: StudentHit
  orders: AdminOrderRow[]
  /** Soma dos pedidos ainda `pending`. */
  totalPendingInCents: number
  totalPaidInCents: number
}

// ── Polos (multi-tenant) ─────────────────────────────────────────────────────

/** Situação do polo. Suspenso fecha a loja; sala de aula, conta do aluno e painel continuam. */
export type TenantStatus = 'active' | 'suspended'

/**
 * Marca do polo. As URLs aceitam `https://` externo ou caminho no bucket do EAD sob
 * `polos/<tenantId>/marca/`. Na versão pública (PublicTenant) os caminhos já viram
 * `/api/tenant/assets/<kind>?v=<versão>`.
 */
export interface TenantBranding {
  /** Logo principal, para fundo claro: cabeçalho, rodapé e login no tema claro. */
  logoUrl: string | null
  /** Versão da logo para o tema escuro. Quando nula, o tema escuro usa `logoUrl`. */
  logoLightUrl: string | null
  faviconUrl: string | null
  /** #RRGGBB. Gera os tokens roxos do tema. */
  primaryColor: string
  /** #RRGGBB. Gera os tokens laranja (botões de ação). */
  accentColor: string
  /** Só dígitos, com DDI: 5541999999999. */
  whatsapp: string | null
  phone: string | null
  email: string | null
  address: string | null
  /** Até 300 caracteres. Meta description e texto do rodapé. */
  description: string | null
  /** Até 120 caracteres. Título da home. */
  heroTitle: string | null
  /** Até 300 caracteres. Subtítulo da home. */
  heroSubtitle: string | null
}

export type TenantBrandingInput = Partial<TenantBranding>

/** O polo do endereço acessado, como o site o enxerga (GET /api/tenant e bloco injetado no index.html). */
export interface PublicTenant {
  slug: string
  name: string
  isMatriz: boolean
  status: TenantStatus
  /** Etapa 1: só a matriz vende. A etapa 2 passa a calcular pela configuração de pagamento do polo. */
  salesEnabled: boolean
  /** Marca com URLs já públicas. */
  branding: TenantBranding
  /** CSS do tema do polo. Nulo na matriz, que usa o tema padrão do app. */
  themeCss: string | null
}

/** Imagens da marca servidas por /api/tenant/assets/:kind. */
export type BrandingAssetKind = 'logo' | 'logo-light' | 'favicon'

/** Configurações do próprio polo, na página Minha escola do admin. */
export interface MyTenantSettings {
  slug: string
  name: string
  siteUrl: string
  isMatriz: boolean
  salesEnabled: boolean
  /** Marca crua, para o formulário (caminhos do bucket). */
  branding: TenantBranding
  /** Marca com URLs públicas, para as prévias das imagens. */
  publicBranding: TenantBranding
}

/** Linha da lista de polos no console da plataforma. */
export interface PlatformTenantRow {
  id: string
  slug: string
  name: string
  status: TenantStatus
  isMatriz: boolean
  siteUrl: string
  adminCount: number
  studentCount: number
  publishedCourseCount: number
  inReviewCount: number
  createdAt: string | null
}

export interface PlatformTenantDetail extends PlatformTenantRow {
  /** Marca crua (caminhos do bucket), para o formulário de edição. */
  branding: TenantBranding
  domains: string[]
}

export interface CreateTenantInput {
  slug: string
  name: string
  branding: TenantBrandingInput
  firstAdminEmail: string
  firstAdminName: string
}

export interface UpdateTenantInput {
  name?: string
  status?: TenantStatus
  branding?: TenantBrandingInput
}

/** Admin vinculado a um polo pelo console da plataforma. */
export interface TenantAdminResult {
  uid: string
  email: string
  /** true quando o e-mail já tinha conta na rede: a pessoa entra com a senha que já usa. */
  existingAccount: boolean
  /** true quando o link de definir senha foi enviado (conta nova). */
  resetEmailSent: boolean
}

export interface CreateTenantResult {
  tenant: PlatformTenantDetail
  firstAdmin: TenantAdminResult
}

/** Curso de qualquer polo, na lista da plataforma (escolha dos cursos de um modelo de certificado). */
export interface PlatformCourseRow {
  id: string
  title: string
  slug: string
  tenantId: string
  tenantName: string
  status: CourseStatus
  /** Modelo de certificado do curso. null = usa o padrão. */
  certificateTemplateId: string | null
}

/** Curso aguardando aprovação, na fila da plataforma. */
export interface ReviewQueueItem {
  courseId: string
  title: string
  tenantId: string
  tenantName: string
  tenantSlug: string
  instructorName: string | null
  submittedAt: string | null
  moduleCount: number
  lessonCount: number
  /**
   * Carga horária que o certificado vai imprimir: a definida pelo polo ou, sem ela, a soma das aulas arredondada
   * (`workloadIsComputed`). Na primeira aprovação, o número calculado é gravado no curso e passa a valer travado.
   */
  workloadHours: number
  /** true quando o polo não definiu a carga e `workloadHours` vem da soma das aulas. */
  workloadIsComputed: boolean
  coordinatorName: string | null
  coordinatorRole: string | null
  /** true quando o curso tem a imagem da assinatura do coordenador (o caminho não vem: a imagem abre pelo editor). */
  hasCoordinatorSignature: boolean
  /** true quando o curso nunca foi aprovado: esta aprovação trava os dados do certificado (e congela a carga calculada). */
  firstApproval: boolean
  /** A nota atual do Studio Pilari: o motivo da devolução ou da retirada anterior, para quem revisa o reenvio. */
  reviewNote: string | null
  /**
   * Versão do que o certificado vai levar (título, carga, coordenador, cargo e assinatura). A aprovação manda este valor
   * de volta e recebe 409 `COURSE_CHANGED` se o curso mudou desde que a fila foi carregada.
   */
  fingerprint: string
  /** Link do editor do curso no site do polo, para a revisão do conteúdo. */
  editorUrl: string
}

// ── Tutor de voz com IA ──────────────────────────────────────────────────────

export interface TutorModulo {
  id: string
  titulo: string
  /** O módulo tem PDF anexado às aulas (material de apoio para o tutor). */
  temMaterial: boolean
}

export interface TutorInfo {
  cursoTitulo: string
  modulos: TutorModulo[]
  /** Segundos de conversa permitidos por dia e já usados hoje (fuso de Brasília). */
  limiteSegundos: number
  usadosHoje: number
  /** Cota do aluno no mês (incluída no plano do polo) e quanto ele já usou, em segundos. */
  limiteMensalSegundos: number
  usadosNoMes: number
  /** Aviso para o aluno quando o teto mensal da plataforma foi atingido (o tutor volta no dia 1º); `null` com saldo. */
  pausa: string | null
}

export interface TutorTurno {
  role: 'aluno' | 'tutor'
  text: string
}

export interface TutorResposta {
  /** O que o aluno disse (transcrição do áudio) ou digitou. */
  transcricao: string
  resposta: string
  usadosHoje: number
  limiteSegundos: number
  usadosNoMes: number
  limiteMensalSegundos: number
}
