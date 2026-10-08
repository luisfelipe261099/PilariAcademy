/**
 * URL da capa para o cliente:
 * - vazio → null
 * - http(s) (URL colada) → usa direto
 * - caminho de objeto no GCS (upload) → rota de proxy que assina e redireciona
 */
export function coverUrl(courseId: string, coverImageUrl: string | null | undefined): string | null {
  if (!coverImageUrl) return null
  if (/^https?:\/\//i.test(coverImageUrl)) return coverImageUrl
  return `/api/courses/${courseId}/cover`
}
