/** Erro inesperado ao desenhar uma página: em vez da tela em branco, explica e oferece recarregar. */
export function RouteError() {
  return (
    <div className="mx-auto max-w-xl px-4 py-24 text-center">
      <h1 className="text-2xl font-bold text-ink">Algo deu errado nesta página</h1>
      <p className="mt-2 text-muted">Recarregue para tentar de novo. Se continuar, volte ao início.</p>
      <div className="mt-6 flex justify-center gap-3">
        <button type="button" onClick={() => window.location.reload()} className="rounded-full bg-brand px-5 py-2.5 text-sm font-bold text-white hover:bg-brand-dark">
          Recarregar
        </button>
        <a href="/" className="rounded-full border border-border px-5 py-2.5 text-sm font-bold text-ink hover:bg-surface">
          Voltar ao início
        </a>
      </div>
    </div>
  )
}
