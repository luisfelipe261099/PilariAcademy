/** % de progresso (função pura, testável). */
export function pctOf(loaded: number, total: number): number {
  if (total <= 0) return 0
  return Math.min(100, Math.round((100 * loaded) / total))
}

/** Faz PUT do arquivo na URL assinada do GCS, reportando progresso. */
export function uploadToSignedUrl(
  uploadUrl: string,
  file: File,
  onProgress: (pct: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', uploadUrl)
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream')
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(pctOf(e.loaded, e.total))
    }
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload falhou (${xhr.status})`)))
    xhr.onerror = () => reject(new Error('Erro de rede no upload'))
    xhr.send(file)
  })
}
