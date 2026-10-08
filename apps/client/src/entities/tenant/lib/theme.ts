/**
 * Aplica ou troca o tema do polo. Em produção o servidor já embute o mesmo <style id="tenant-theme">;
 * aqui ele serve ao dev do Vite e à troca de marca feita na Minha escola.
 */
export function applyThemeCss(doc: Document, css: string | null): void {
  const atual = doc.getElementById('tenant-theme')
  if (!css) {
    if (atual) atual.textContent = ''
    return
  }
  if (atual) {
    atual.textContent = css
    return
  }
  const el = doc.createElement('style')
  el.id = 'tenant-theme'
  el.textContent = css
  doc.head.appendChild(el)
}
