import { createHash } from 'node:crypto'

/**
 * Hashes sha256 (no formato que a CSP espera em script-src) dos scripts inline de um HTML.
 * Scripts com `src` são externos e ficam de fora — esses a CSP cobre por origem ('self').
 * O hash é dos bytes exatos entre as tags (sem trim), como o browser calcula.
 */
export function inlineScriptHashes(html: string): string[] {
  return [...html.matchAll(/<script(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi)].map(
    (m) => `'sha256-${createHash('sha256').update(m[1]).digest('base64')}'`
  )
}
