import { useCallback } from 'react'
import type { FaseTutor } from '../lib/tutor-state'

/**
 * Sinais que a esfera lê a cada quadro. Objeto mutável e estável (criado uma vez na página e atualizado nos handlers):
 * o volume muda 60 vezes por segundo e não pode passar por estado do React.
 */
export interface SinaisDaEsfera {
  fase: FaseTutor
  nivel: () => number
}

interface Props {
  sinais: SinaisDaEsfera
  onToque: () => void
  rotulo: string
}

/** Pontos da faixa de nuvem: posição ao longo da esfera, tamanho e intensidade (fixos, para a forma ser estável). */
const NUVENS = Array.from({ length: 22 }, (_, i) => {
  const s = Math.sin(i * 12.9898) * 43758.5453
  const r = s - Math.floor(s)
  return { x: -1.15 + (i / 21) * 2.3, raio: 0.22 + r * 0.22, alfa: 0.55 + r * 0.4, fase: r * Math.PI * 2 }
})

function desenhar(ctx: CanvasRenderingContext2D, lado: number, t: number, nivel: number, fase: FaseTutor) {
  const c = lado / 2
  const raio = lado * 0.4 * (1 + nivel * 0.07)
  ctx.clearRect(0, 0, lado, lado)

  // brilho difuso em volta
  const halo = ctx.createRadialGradient(c, c, raio * 0.9, c, c, raio * 1.35)
  halo.addColorStop(0, `rgba(80, 120, 240, ${0.18 + nivel * 0.25})`)
  halo.addColorStop(1, 'rgba(80, 120, 240, 0)')
  ctx.fillStyle = halo
  ctx.fillRect(0, 0, lado, lado)

  ctx.save()
  ctx.beginPath()
  ctx.arc(c, c, raio, 0, Math.PI * 2)
  ctx.clip()

  const base = ctx.createLinearGradient(0, c - raio, 0, c + raio)
  base.addColorStop(0, fase === 'erro' ? '#5b6fa8' : '#3563e3')
  base.addColorStop(0.45, fase === 'erro' ? '#7385b8' : '#4c7cf0')
  base.addColorStop(1, '#b7cbfa')
  ctx.fillStyle = base
  ctx.fillRect(c - raio, c - raio, raio * 2, raio * 2)

  // faixa de nuvem: manchas brancas suaves ao longo de uma onda que se move devagar (mais rápido com a voz)
  const velocidade = fase === 'pensando' ? 1.6 : 0.6 + nivel * 2.2
  for (const n of NUVENS) {
    const x = c + n.x * raio + Math.sin(t * 0.25 * velocidade + n.fase) * raio * 0.06
    const y = c + raio * 0.18 + Math.sin(n.x * 2.4 + t * 0.5 * velocidade) * raio * (0.1 + nivel * 0.08) + Math.cos(t * 0.3 + n.fase) * raio * 0.03
    const r = n.raio * raio * (1 + nivel * 0.15)
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, `rgba(245, 248, 255, ${n.alfa})`)
    g.addColorStop(0.55, `rgba(232, 239, 255, ${n.alfa * 0.55})`)
    g.addColorStop(1, 'rgba(232, 239, 255, 0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }

  // luz no topo, como na referência
  const luz = ctx.createRadialGradient(c - raio * 0.3, c - raio * 0.55, 0, c - raio * 0.3, c - raio * 0.55, raio * 0.9)
  luz.addColorStop(0, 'rgba(255,255,255,0.10)')
  luz.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = luz
  ctx.fillRect(c - raio, c - raio, raio * 2, raio * 2)
  ctx.restore()
}

export function TutorOrb({ sinais, onToque, rotulo }: Props) {
  // O laço de animação vive enquanto o canvas está montado (callback de ref com limpeza, React 19).
  const montar = useCallback(
    (canvas: HTMLCanvasElement | null) => {
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const reduzido = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      let quadro = 0
      let nivelSuave = 0
      const ajustar = () => {
        const lado = Math.round(canvas.clientWidth * (window.devicePixelRatio || 1))
        if (canvas.width !== lado) {
          canvas.width = lado
          canvas.height = lado
        }
        return lado
      }
      const passo = (agora: number) => {
        const alvo = sinais.fase === 'ouvindo' || sinais.fase === 'falando' ? sinais.nivel() : sinais.fase === 'pensando' ? 0.12 + Math.sin(agora / 300) * 0.06 : 0
        nivelSuave += (alvo - nivelSuave) * 0.25
        desenhar(ctx, ajustar(), (reduzido ? agora / 4 : agora) / 1000, reduzido ? nivelSuave * 0.3 : nivelSuave, sinais.fase)
        quadro = requestAnimationFrame(passo)
      }
      quadro = requestAnimationFrame(passo)
      return () => cancelAnimationFrame(quadro)
    },
    [sinais]
  )

  return (
    <button
      type="button"
      onClick={onToque}
      aria-label={rotulo}
      className="relative mx-auto block aspect-square w-[min(78vw,360px,42dvh)] max-w-full cursor-pointer rounded-full focus-visible:outline-4 focus-visible:outline-offset-4 focus-visible:outline-blue-400"
    >
      <canvas ref={montar} className="size-full" aria-hidden="true" />
    </button>
  )
}
