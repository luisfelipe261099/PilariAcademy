import { useMutation, useQuery } from '@tanstack/react-query'
import { downloadCarne, downloadCertificate, getSettlement, verifyCertificate } from './api'

export function useVerifyCertificateQuery(code: string) {
  return useQuery({
    queryKey: ['certificate', 'verify', code] as const,
    queryFn: () => verifyCertificate(code),
    enabled: Boolean(code),
    retry: false,
  })
}

export function useDownloadCertificateMutation() {
  return useMutation({ mutationFn: ({ slug, cpf, nome }: { slug: string; cpf?: string; nome?: string }) => downloadCertificate(slug, cpf, nome) })
}

/** Estado de quitação do carnê, para a tela de certificado bloqueado. */
export function useSettlementQuery(slug: string) {
  return useQuery({
    queryKey: ['certificate', 'settlement', slug] as const,
    queryFn: () => getSettlement(slug),
    enabled: Boolean(slug),
    retry: false,
  })
}

export function useDownloadCarneMutation() {
  return useMutation({ mutationFn: (carneUrl: string) => downloadCarne(carneUrl) })
}
