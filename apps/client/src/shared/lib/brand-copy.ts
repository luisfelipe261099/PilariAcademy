/**
 * Cópia que depende do polo. A matriz é o Studio Pilari. Os cursos são livres, com certificado de conclusão:
 * nenhuma frase atribui ao MEC o reconhecimento de um curso, na matriz ou no polo.
 */
import { BRAND } from '@/shared/config/brand'

export interface HeroCopy {
  badge: string
  /** Título; quando `highlight` existe, ele vem em destaque logo depois. */
  title: string
  highlight: string | null
  subtitle: string
  /** Os três selos de confiança abaixo da busca, na ordem dos ícones. */
  trust: [string, string, string]
}

/** "Cursos", "1 curso", "3 cursos": lista vazia (ou carregando) não anuncia "0 cursos". */
function contagem(total: number, maiuscula: boolean): string {
  if (total === 0) return maiuscula ? 'Cursos' : 'cursos'
  return total === 1 ? '1 curso' : `${total} cursos`
}

export function heroCopy(
  t: { isMatriz: boolean; name: string; heroTitle: string | null; heroSubtitle: string | null },
  total: number
): HeroCopy {
  if (t.isMatriz) {
    return {
      badge: `Cursos online · ${BRAND.name}`,
      title: 'Transforme sua vida através do ',
      highlight: 'movimento.',
      subtitle: `${contagem(total, true)} online com a ${BRAND.professional}, fisioterapeuta. Aprenda no seu ritmo, com certificado de conclusão.`,
      trust: ['Conduzido por fisioterapeuta', 'Certificado de conclusão', 'Assista quando quiser'],
    }
  }
  // Texto vazio ou só de espaços vale como ausente. O servidor já grava null, mas o JSON da marca pode
  // trazer "" e o título e o destaque não podem discordar sobre isso.
  const titulo = t.heroTitle?.trim() || null
  const subtitulo = t.heroSubtitle?.trim() || null
  return {
    badge: 'Cursos online · Certificado de conclusão',
    title: titulo ?? 'Transforme sua vida através do ',
    highlight: titulo ? null : 'movimento.',
    subtitle: subtitulo ?? `${t.name}: ${contagem(total, false)} online com certificado de conclusão. Comece quando quiser.`,
    trust: ['Certificado de conclusão', 'Código de verificação no certificado', 'Assista quando quiser'],
  }
}

export function loginTagline(isMatriz: boolean): string {
  return isMatriz
    ? `Seus cursos com a ${BRAND.professional}, no seu ritmo.`
    : 'Aprenda no seu ritmo, com certificado de conclusão.'
}

/** Abertura do aviso de pré-venda da página do curso: o polo sem venda online não convida a comprar. */
export function preSaleLead(salesEnabled: boolean): string {
  return salesEnabled ? 'Pré-venda — compre agora e o conteúdo libera em ' : 'Pré-venda — o conteúdo libera em '
}

export interface ProfileCopy {
  /** CPF já gravado e travado: a quem pedir a correção. */
  cpfLocked: string
  /** CPF ainda em branco: para que serve e quem o altera depois de salvo. */
  cpfOpen: string
}

/**
 * Textos do CPF em "Meus dados". Na matriz quem corrige é o Studio Pilari. No polo quem corrige é o
 * próprio polo (ou o Studio Pilari), e o carnê só entra na explicação onde há venda.
 */
export function profileCopy(t: { isMatriz: boolean; salesEnabled: boolean }): ProfileCopy {
  if (t.isMatriz) {
    return {
      cpfLocked: `Já cadastrado. Para corrigir, fale com o ${BRAND.name}.`,
      cpfOpen: `Necessário para emitir certificado e para comprar no carnê. Depois de salvo, só o ${BRAND.name} altera.`,
    }
  }
  return {
    cpfLocked: 'Já cadastrado. Para corrigir, fale com o seu polo.',
    cpfOpen: `Necessário para emitir certificado${t.salesEnabled ? ' e para comprar no carnê' : ''}. Depois de salvo, só o seu polo ou o ${BRAND.name} alteram.`,
  }
}
