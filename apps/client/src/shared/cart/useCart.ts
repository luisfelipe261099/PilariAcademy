import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/** Adiciona um id evitando duplicata (função pura, testável). */
export function addId(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids : [...ids, id]
}

/** Remove um id (função pura, testável). */
export function removeId(ids: string[], id: string): string[] {
  return ids.filter((x) => x !== id)
}

interface CartState {
  ids: string[]
  add: (id: string) => void
  remove: (id: string) => void
  clear: () => void
}

/** Carrinho persistido no localStorage do navegador. */
export const useCart = create<CartState>()(
  persist(
    (set) => ({
      ids: [],
      add: (id) => set((s) => ({ ids: addId(s.ids, id) })),
      remove: (id) => set((s) => ({ ids: removeId(s.ids, id) })),
      clear: () => set({ ids: [] }),
    }),
    { name: 'pilari-cart' }
  )
)
