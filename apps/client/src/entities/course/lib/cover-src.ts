/**
 * `src` exibível da capa. Espelha o coverUrl() do server: URL http(s) colada
 * usa direto; caminho de objeto no GCS (upload) vira a rota de proxy que assina
 * e serve a imagem. As rotas do instrutor devolvem o caminho cru porque o
 * editor precisa dele no round-trip do PATCH — a conversão é só de exibição.
 */
export function courseCoverSrc(courseId: string, coverImageUrl: string | null | undefined): string | null {
  if (!coverImageUrl) return null
  if (/^https?:\/\//i.test(coverImageUrl)) return coverImageUrl
  return `/api/courses/${courseId}/cover`
}
