import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, UserCircle } from 'lucide-react'
import type { EditableProfile } from '@pilari/types'
import { useProfileQuery, useUpdateProfileMutation } from '@/entities/profile'

function ProfileForm({ profile }: { profile: EditableProfile }) {
  const [displayName, setDisplayName] = useState(profile.displayName ?? '')
  const [photoUrl, setPhotoUrl] = useState(profile.photoUrl ?? '')
  const [headline, setHeadline] = useState(profile.headline ?? '')
  const [bio, setBio] = useState(profile.bio ?? '')
  const save = useUpdateProfileMutation()

  return (
    <div className="mt-6 flex flex-col gap-4 rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center gap-4">
        {photoUrl ? (
          <img src={photoUrl} alt="Foto de perfil" className="size-20 rounded-full object-cover" />
        ) : (
          <UserCircle className="size-20 text-muted" aria-hidden="true" />
        )}
        <div className="flex-1">
          <label className="text-sm font-bold text-ink">URL da foto de perfil
            <input value={photoUrl} onChange={(e) => setPhotoUrl(e.target.value)} placeholder="https://…" className="mt-1 w-full rounded-lg border border-border bg-bg px-3 py-2 font-normal text-foreground" />
          </label>
        </div>
      </div>

      <label className="text-sm font-bold text-ink">Nome de exibição
        <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-bg px-3 py-2 font-normal text-foreground" />
      </label>

      <label className="text-sm font-bold text-ink">Qualificação (linha curta)
        <input value={headline} onChange={(e) => setHeadline(e.target.value)} placeholder="Ex.: Fisioterapeuta · Especialista em Pilates clínico" className="mt-1 w-full rounded-lg border border-border bg-bg px-3 py-2 font-normal text-foreground" />
      </label>

      <label className="text-sm font-bold text-ink">Bio / apresentação
        <textarea value={bio} onChange={(e) => setBio(e.target.value)} rows={5} placeholder="Conte sua experiência, formação e o que te torna referência no tema." className="mt-1 w-full rounded-lg border border-border bg-bg px-3 py-2 font-normal text-foreground" />
      </label>

      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={save.isPending}
          onClick={() => save.mutate({ displayName, photoUrl, headline, bio })}
          className="self-start rounded-full bg-brand px-6 py-2.5 font-bold text-white hover:bg-brand-dark disabled:opacity-60"
        >
          {save.isPending ? 'Salvando…' : 'Salvar perfil'}
        </button>
        {save.isError && <span className="text-sm text-red-500">Não foi possível salvar.</span>}
        {save.isSuccess && <span className="text-sm text-accent">Perfil salvo!</span>}
      </div>
    </div>
  )
}

export function InstructorProfilePage() {
  const q = useProfileQuery()

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <Link to="/instrutor" className="inline-flex items-center gap-2 text-sm font-medium text-accent hover:text-brand-bright">
        <ArrowLeft className="size-4" aria-hidden="true" /> Meus cursos
      </Link>
      <h1 className="mt-3 text-2xl font-bold text-ink">Meu perfil de instrutor</h1>
      <p className="mt-1 text-sm text-muted">Essas informações aparecem para os alunos na página dos seus cursos — dão credibilidade e ajudam na decisão de compra.</p>

      {q.isLoading && <p className="mt-6 text-muted">Carregando…</p>}
      {q.isError && <p className="mt-6 text-red-500">Não foi possível carregar seu perfil.</p>}
      {q.data && <ProfileForm key={q.data.headline ?? ''} profile={q.data} />}
    </div>
  )
}
