/** Montagem do pedido ao Gemini e leitura da resposta. Puro: sem rede e sem banco, para testar sem custo. */

export interface TurnoTutor {
  role: 'aluno' | 'tutor'
  text: string
}

export interface PerguntaTutor {
  audioWavBase64?: string
  texto?: string
}

export interface ContextoTutor {
  cursoTitulo: string
  moduloTitulo: string
  /** Títulos de todos os módulos do curso, para o tutor saber onde cada assunto mora. */
  modulos: string[]
  material: string
}

/** Últimas falas mandadas como contexto. Mais que isso encarece cada pergunta sem ganho perceptível na voz. */
export const MAX_TURNOS_HISTORICO = 8
const MAX_CHARS_TURNO = 1200

export function instrucaoDoSistema(ctx: Omit<ContextoTutor, 'material'>): string {
  return [
    `Você é a tutora de voz do Studio Pilari no curso "${ctx.cursoTitulo}". O aluno está estudando o "${ctx.moduloTitulo}".`,
    `Módulos do curso: ${ctx.modulos.join('; ')}.`,
    'Responda em português do Brasil, em linguagem falada, como uma professora atenciosa conversando: frases curtas, sem listas,',
    'sem tópicos, sem markdown, sem emojis e sem ler símbolos. Use no máximo 90 palavras, a não ser que o aluno peça mais detalhes.',
    'Baseie a resposta no MATERIAL DE APOIO do módulo. Se o assunto não estiver no material, diga isso com naturalidade, dê uma',
    'orientação geral curta e sugira em qual módulo do curso o tema aparece, se souber.',
    'Não resolva nem dê as respostas das provas e avaliações do curso: se o aluno pedir, explique o conceito e incentive-o a responder.',
    'Se o aluno pedir para revisar ou para ser testado, faça uma pergunta por vez sobre o módulo, espere a resposta e comente se',
    'está certa, explicando o porquê.',
    'Quando fizer sentido, termine com uma pergunta curta para checar se ele entendeu ou se quer um exemplo.',
    'Cumprimente só na primeira resposta da conversa; nas seguintes, vá direto ao assunto.',
    'Não fale do studio nas respostas, a não ser que o aluno pergunte sobre ele; se precisar citá-lo, escreva "Studio Pilari".',
  ].join(' ')
}

/** O material vem primeiro e igual em toda pergunta do módulo: é o prefixo que o cache implícito do Gemini reaproveita. */
export function montarPedido(ctx: ContextoTutor, historico: ReadonlyArray<TurnoTutor>, pergunta: PerguntaTutor): Record<string, unknown> {
  const recentes = historico.slice(-MAX_TURNOS_HISTORICO)
  const conversa = recentes.length
    ? 'CONVERSA ATÉ AGORA:\n' + recentes.map((t) => `${t.role === 'aluno' ? 'Aluno' : 'Tutora'}: ${t.text.slice(0, MAX_CHARS_TURNO)}`).join('\n')
    : 'CONVERSA ATÉ AGORA: (início da conversa)'
  const partes: Array<Record<string, unknown>> = [
    { text: `MATERIAL DE APOIO DO ${ctx.moduloTitulo.toUpperCase()}:\n${ctx.material || '(Este módulo ainda não tem material de apoio.)'}` },
    { text: conversa },
  ]
  if (pergunta.audioWavBase64) {
    partes.push({ text: 'NOVA PERGUNTA DO ALUNO, em áudio:' })
    partes.push({ inlineData: { mimeType: 'audio/wav', data: pergunta.audioWavBase64 } })
  } else {
    partes.push({ text: `NOVA PERGUNTA DO ALUNO, digitada: ${pergunta.texto ?? ''}` })
  }
  return {
    systemInstruction: { parts: [{ text: instrucaoDoSistema(ctx) }] },
    contents: [{ role: 'user', parts: partes }],
    generationConfig: {
      // Baixa: a resposta precisa seguir a apostila, não variar o conteúdo.
      temperature: 0.2,
      maxOutputTokens: 700,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          transcricao: { type: 'STRING', description: 'O que o aluno disse na NOVA PERGUNTA, transcrito literalmente, em português.' },
          resposta: { type: 'STRING', description: 'A resposta falada da tutora para o aluno.' },
        },
        required: ['transcricao', 'resposta'],
        propertyOrdering: ['transcricao', 'resposta'],
      },
    },
  }
}

export interface RespostaTutor {
  transcricao: string
  resposta: string
}

/** Lê o JSON do modelo. Tolera cercas de código e texto solto em volta; `null` se não achar a resposta. */
export function lerResposta(texto: string): RespostaTutor | null {
  const limpo = texto.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
  const inicio = limpo.indexOf('{')
  const fim = limpo.lastIndexOf('}')
  if (inicio < 0 || fim <= inicio) return null
  try {
    const j = JSON.parse(limpo.slice(inicio, fim + 1)) as Partial<RespostaTutor>
    const resposta = typeof j.resposta === 'string' ? j.resposta.trim() : ''
    if (!resposta) return null
    return { transcricao: typeof j.transcricao === 'string' ? j.transcricao.trim() : '', resposta }
  } catch {
    return null
  }
}

/** Texto para a voz: a TTS lê melhor sem marcações que o modelo às vezes deixa escapar. */
export function textoParaFala(resposta: string): string {
  return resposta
    .replace(/[*_#`>]+/g, '')
    .replace(/\s*\n+\s*/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/** Dia no fuso de Brasília (YYYY-MM-DD): o limite diário vira à meia-noite do aluno, não à meia-noite UTC. */
export function diaBrasilia(agora: Date = new Date()): string {
  return agora.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
}

/** Primeiro dia do mês em Brasília (YYYY-MM-01): o teto mensal da plataforma vira junto com o mês do aluno. */
export function inicioDoMesBrasilia(agora: Date = new Date()): string {
  return `${diaBrasilia(agora).slice(0, 7)}-01`
}

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

/** "1º de novembro": quando o tutor volta depois de atingir o teto do mês. */
export function voltaDoTetoMensal(agora: Date = new Date()): string {
  const mes = Number(diaBrasilia(agora).slice(5, 7)) // 1–12; o índice do mês seguinte no array é o próprio número
  return `1º de ${MESES[mes % 12]}`
}
