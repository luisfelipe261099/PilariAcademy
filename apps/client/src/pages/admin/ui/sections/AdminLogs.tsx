import { useAdminLogsQuery } from '@/entities/audit'

export function AdminLogs() {
  const { data, isLoading, isError } = useAdminLogsQuery()

  return (
    <div>
      <h2 className="text-2xl font-bold text-ink">Logs (auditoria)</h2>
      {isLoading && <p className="mt-4 text-muted">Carregando…</p>}
      {isError && <p className="mt-4 text-red-500">Não foi possível carregar os logs.</p>}
      {data && data.length === 0 && <p className="mt-4 text-muted">Nenhum evento registrado ainda.</p>}
      {data && data.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm text-ink">
            <thead className="text-xs text-muted">
              <tr className="border-b border-border">
                <th className="py-2 pr-3 font-medium">Quando</th>
                <th className="px-3 font-medium">Quem</th>
                <th className="px-3 font-medium">Ação</th>
                <th className="px-3 font-medium">Detalhe</th>
              </tr>
            </thead>
            <tbody>
              {data.map((l) => (
                <tr key={l.id} className="border-b border-border">
                  <td className="py-2 pr-3 whitespace-nowrap text-muted">{l.createdAt ? new Date(l.createdAt).toLocaleString('pt-BR') : '—'}</td>
                  <td className="px-3 text-muted">{l.actorEmail ?? 'sistema'}</td>
                  <td className="px-3"><code className="rounded bg-brand-soft px-1.5 py-0.5 text-xs text-brand">{l.action}</code></td>
                  <td className="px-3">{l.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
