import { Link } from 'react-router-dom'

/** Botão flutuante do tutor de voz (o único da sala de aula). Abre a página da esfera no módulo da aula atual. */
export function TutorButton({ slug, moduleId }: { slug: string; moduleId: string | null }) {
  const destino = `/aprender/${slug}/tutor${moduleId ? `?modulo=${encodeURIComponent(moduleId)}` : ''}`
  return (
    <Link
      to={destino}
      aria-label="Conversar com o tutor de voz"
      title="Tire dúvidas por voz com o tutor"
      className="fixed right-5 bottom-5 z-50 flex items-center gap-2 rounded-full bg-gradient-to-br from-[#3563e3] to-[#7aa2f7] py-2 pr-4 pl-2 text-sm font-semibold text-white shadow-lg transition-transform hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400"
    >
      <span aria-hidden="true" className="grid size-9 place-items-center rounded-full bg-[radial-gradient(circle_at_50%_70%,#eef3ff_0%,#bcd0fb_45%,#3563e3_100%)] shadow-inner" />
      Tutor IA
    </Link>
  )
}
