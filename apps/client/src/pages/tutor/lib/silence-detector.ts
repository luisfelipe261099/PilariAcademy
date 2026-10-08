/**
 * Decide quando o aluno terminou de falar, a partir do volume de cada bloco de áudio. O piso de ruído é aprendido
 * no próprio ambiente (sala silenciosa e sala barulhenta têm pisos diferentes): fala é volume bem acima do piso.
 */
export type DecisaoGravacao = 'continua' | 'fim' | 'sem-fala' | 'limite'

export interface OpcoesDetector {
  /** Silêncio depois da fala que encerra a pergunta. */
  silencioMs?: number
  /** Sem nenhuma fala até aqui: desiste (o aluno tocou e não falou). */
  semFalaMs?: number
  /** Duração máxima da pergunta. */
  maxMs?: number
  /** Volume mínimo considerado fala, mesmo em sala muito silenciosa. */
  limiarMin?: number
}

export interface Detector {
  processar(volume: number, agoraMs: number): DecisaoGravacao
  readonly falou: boolean
}

const PISO_INICIAL_MAX = 0.02

export function criarDetector(opts: OpcoesDetector = {}): Detector {
  const silencioMs = opts.silencioMs ?? 1300
  const semFalaMs = opts.semFalaMs ?? 8000
  const maxMs = opts.maxMs ?? 45000
  const limiarMin = opts.limiarMin ?? 0.012
  let inicio: number | null = null
  let piso: number | null = null
  let falou = false
  let ultimaFala = 0

  return {
    get falou() {
      return falou
    },
    processar(volume, agora) {
      if (inicio === null) inicio = agora
      // Piso: desce rápido (ruído baixo aparece logo) e sobe devagar (para a fala não virar "ruído").
      // Começa baixo mesmo se o aluno já estiver falando no primeiro bloco: senão a própria voz vira o "ruído".
      piso = piso === null ? Math.min(volume, PISO_INICIAL_MAX) : volume < piso ? piso * 0.7 + volume * 0.3 : piso * 0.995 + volume * 0.005
      const limiar = Math.max(limiarMin, piso * 2.8)
      if (volume > limiar) {
        falou = true
        ultimaFala = agora
      }
      if (agora - inicio >= maxMs) return falou ? 'limite' : 'sem-fala'
      if (!falou) return agora - inicio >= semFalaMs ? 'sem-fala' : 'continua'
      return agora - ultimaFala >= silencioMs ? 'fim' : 'continua'
    },
  }
}
