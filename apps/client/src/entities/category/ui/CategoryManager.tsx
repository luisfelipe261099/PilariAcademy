import { useState, type FormEvent } from 'react'
import { Trash2 } from 'lucide-react'
import {
  useCategoriesQuery,
  useCreateCategoryMutation,
  useDeleteCategoryMutation,
} from '@/entities/category'

export function CategoryManager() {
  const categoriesQuery = useCategoriesQuery()
  const createMutation = useCreateCategoryMutation()
  const deleteMutation = useDeleteCategoryMutation()
  const [name, setName] = useState('')

  function onCreate(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    createMutation.mutate(name.trim(), { onSuccess: () => setName('') })
  }

  return (
    <section className="mb-8 rounded-lg border border-border bg-card p-4">
      <h2 className="mb-3 font-bold text-foreground">Categorias</h2>

      <form onSubmit={onCreate} className="mb-4 flex gap-2">
        <input
          type="text"
          placeholder="Nova categoria"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="min-w-0 flex-1 rounded-lg border border-border bg-bg px-4 py-2 text-foreground"
        />
        <button
          type="submit"
          disabled={createMutation.isPending}
          className="shrink-0 rounded-full bg-brand px-5 py-2 font-bold whitespace-nowrap text-white disabled:opacity-60"
        >
          {createMutation.isPending ? 'Criando…' : 'Adicionar'}
        </button>
      </form>

      {categoriesQuery.isLoading && <p className="text-muted-foreground">Carregando…</p>}
      {categoriesQuery.isError && <p className="text-red-500">Não foi possível carregar as categorias.</p>}

      <ul className="flex flex-col gap-2">
        {categoriesQuery.data?.map((cat) => (
          <li key={cat.id} className="flex items-center justify-between rounded-lg border border-border bg-bg p-3">
            <span className="text-foreground">{cat.name}</span>
            <button
              type="button"
              onClick={() => deleteMutation.mutate(cat.id)}
              disabled={deleteMutation.isPending}
              aria-label={`Remover ${cat.name}`}
              className="text-muted-foreground transition-colors hover:text-red-500"
            >
              <Trash2 className="size-4" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
