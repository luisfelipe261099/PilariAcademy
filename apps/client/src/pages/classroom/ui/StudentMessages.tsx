import { MessageCircle } from 'lucide-react'
import { ChatThread, useSendStudentMessageMutation, useStudentThreadQuery } from '@/entities/message'

/** Painel de chat do aluno com o instrutor do curso, dentro da sala de aula. */
export function StudentMessages({ slug }: { slug: string }) {
  const threadQuery = useStudentThreadQuery(slug)
  const sendMut = useSendStudentMessageMutation(slug)
  const messages = threadQuery.data?.messages ?? []

  return (
    <section className="mt-6 rounded-2xl border border-border bg-bg p-5">
      <h3 className="flex items-center gap-2 text-lg font-bold text-ink">
        <MessageCircle className="size-5 text-brand" aria-hidden="true" /> Mensagens com o instrutor
      </h3>
      <div className="mt-3">
        <ChatThread
          messages={messages}
          viewerIsStudent
          onSend={(b) => sendMut.mutate(b)}
          sending={sendMut.isPending}
          emptyHint="Tire suas dúvidas com o instrutor do curso."
        />
        {sendMut.isError && <p className="mt-2 text-sm text-red-500">Não foi possível enviar. Tente novamente.</p>}
      </div>
    </section>
  )
}
