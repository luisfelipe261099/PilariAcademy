/** Converte um texto em slug: minúsculo, sem acentos, separado por hifens. */
export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // remove diacríticos (combining marks)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-') // não-alfanumérico vira hifen
    .replace(/^-+|-+$/g, '') // apara hifens das pontas
}
