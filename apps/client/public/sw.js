// Service worker do app (PWA). Mínimo de propósito:
// - páginas: sempre da rede (o index.html muda a cada deploy e por polo); sem internet, a página offline;
// - /assets/: arquivos com hash no nome (imutáveis) ficam guardados, então o app abre rápido;
// - todo o resto (API, PDFs, vídeos, login) passa direto, sem cache.
const CACHE = 'app-v1'
const OFFLINE = '/offline.html'
/** Teto de arquivos guardados: cada deploy troca os nomes, e os velhos saem pelos mais antigos. */
const TETO_ASSETS = 80

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.add(new Request(OFFLINE, { cache: 'reload' })))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches
      .keys()
      .then((nomes) => Promise.all(nomes.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  )
})

async function aparar(cache) {
  const chaves = (await cache.keys()).filter((r) => new URL(r.url).pathname.startsWith('/assets/'))
  for (const velha of chaves.slice(0, Math.max(0, chaves.length - TETO_ASSETS))) await cache.delete(velha)
}

async function assetGuardado(pedido) {
  const cache = await caches.open(CACHE)
  const guardado = await cache.match(pedido)
  if (guardado) return guardado
  const resposta = await fetch(pedido)
  if (resposta.ok) {
    await cache.put(pedido, resposta.clone())
    await aparar(cache)
  }
  return resposta
}

self.addEventListener('fetch', (evento) => {
  const pedido = evento.request
  if (pedido.method !== 'GET') return
  const url = new URL(pedido.url)
  if (url.origin !== self.location.origin) return

  if (pedido.mode === 'navigate') {
    evento.respondWith(fetch(pedido).catch(() => caches.match(OFFLINE)))
    return
  }
  if (url.pathname.startsWith('/assets/')) evento.respondWith(assetGuardado(pedido))
})
