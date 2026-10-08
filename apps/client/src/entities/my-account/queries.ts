import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getMyProfile, listMyCertificates, listMyOrders, updateMyProfile, downloadPdfAuth } from './api'

export const MY_PROFILE_KEY = ['me', 'profile'] as const
export const MY_ORDERS_KEY = ['me', 'orders'] as const
export const MY_CERTIFICATES_KEY = ['me', 'certificates'] as const

export function useMyProfileQuery() {
  return useQuery({ queryKey: MY_PROFILE_KEY, queryFn: getMyProfile })
}

export function useUpdateMyProfileMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: updateMyProfile,
    // O nome e o CPF entram no certificado; sem invalidar, a sala de aula seguiria
    // achando que faltam dados e continuaria pedindo o formulário.
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: MY_PROFILE_KEY })
      void qc.invalidateQueries({ queryKey: ['classroom'] })
    },
  })
}

export function useMyOrdersQuery() {
  return useQuery({ queryKey: MY_ORDERS_KEY, queryFn: listMyOrders })
}

export function useMyCertificatesQuery() {
  return useQuery({ queryKey: MY_CERTIFICATES_KEY, queryFn: listMyCertificates })
}

export function useDownloadCarneMutation() {
  return useMutation({ mutationFn: (url: string) => downloadPdfAuth(url, 'carne.pdf') })
}
