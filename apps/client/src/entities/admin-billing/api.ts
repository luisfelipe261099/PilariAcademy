import type { StudentFinance, StudentHit } from '@pilari/types'
import { httpClient } from '@/shared/api/http-client'

const BASE = '/admin/billing'

export async function searchStudents(q: string): Promise<StudentHit[]> {
  const { data } = await httpClient.get<{ students: StudentHit[] }>(`${BASE}/students`, { params: { q } })
  return data.students
}

export async function getStudentFinance(uid: string): Promise<StudentFinance> {
  const { data } = await httpClient.get<StudentFinance>(`${BASE}/students/${uid}`)
  return data
}

export interface NovaCobranca {
  userId: string
  /** Vazio = cobrança avulsa (exige description + amountInCents). */
  courseIds: string[]
  description?: string
  amountInCents?: number
  installmentCount: number
  /** Só quando o aluno ainda não tem CPF no cadastro. */
  cpf?: string
  /** Libera o acesso já, sem esperar o pagamento. */
  enrollNow?: boolean
  /** Vencimento AAAA-MM-DD. No carnê, o da primeira parcela. */
  dueDate?: string
}

export async function createCharge(input: NovaCobranca): Promise<{ orderId: string; paymentUrl: string }> {
  const { data } = await httpClient.post<{ orderId: string; paymentUrl: string }>(`${BASE}/charges`, input)
  return data
}

export async function cancelCharge(orderId: string): Promise<{ jaEstavaCancelado: boolean }> {
  const { data } = await httpClient.delete<{ jaEstavaCancelado: boolean }>(`${BASE}/orders/${orderId}`)
  return data
}

/** Caminho do carnê em PDF. Sem o prefixo /api porque quem baixa é o downloadPdfAuth. */
export function carneAdminPath(orderId: string): string {
  return `${BASE}/orders/${orderId}/carne`
}
