import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { RefreshCw } from 'lucide-react'

type LogRow = {
  id: string
  actor_id: string | null
  action: string
  entity_type: string
  entity_id: string | null
  meta: unknown
  created_at: string
}

const safeStringify = (v: unknown) => {
  try {
    return JSON.stringify(v ?? {}, null, 2)
  } catch {
    return '{}'
  }
}

export default function AdminLogs() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [rows, setRows] = useState<LogRow[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const selected = useMemo(() => rows.find((r) => r.id === selectedId) ?? null, [rows, selectedId])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token ?? ''
    const resp = await fetch('/api/admin/logs', {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    })
    const json = (await resp.json().catch(() => ({}))) as any
    if (!resp.ok || !json.success) {
      setError(json.error ?? 'Failed to load logs')
      setLoading(false)
      return
    }
    const list = (json.logs ?? []) as LogRow[]
    setRows(list)
    if (selectedId && !list.some((x) => x.id === selectedId)) setSelectedId(null)
    setLoading(false)
  }, [selectedId])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-lg font-semibold">Audit logs</h1>
          <div className="mt-1 text-sm text-slate-600">Last 200 admin actions.</div>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 transition hover:bg-slate-50"
        >
          <RefreshCw className="h-4 w-4" />
          Refresh
        </button>
      </div>

      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</div> : null}

      {loading ? (
        <div className="space-y-2">
          <div className="h-10 animate-pulse rounded-xl bg-slate-100" />
          <div className="h-10 animate-pulse rounded-xl bg-slate-100" />
          <div className="h-10 animate-pulse rounded-xl bg-slate-100" />
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">No logs yet.</div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_420px]">
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="grid grid-cols-[1fr_1fr_1fr] gap-3 bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-600">
              <div>When</div>
              <div>Action</div>
              <div>Entity</div>
            </div>
            <div className="max-h-[70vh] overflow-auto divide-y divide-slate-200">
              {rows.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setSelectedId(r.id)}
                  className={
                    'grid w-full grid-cols-[1fr_1fr_1fr] gap-3 px-4 py-3 text-left text-sm transition ' +
                    (selectedId === r.id ? 'bg-slate-100' : 'bg-white hover:bg-slate-50')
                  }
                >
                  <div className="text-xs text-slate-600">{new Date(r.created_at).toLocaleString()}</div>
                  <div className="truncate font-medium text-slate-900">{r.action}</div>
                  <div className="truncate text-slate-600">
                    {r.entity_type}
                    {r.entity_id ? `:${r.entity_id}` : ''}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-sm font-semibold">Details</div>
            {selected ? (
              <div className="mt-3 space-y-3">
                <div className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-700">
                  <div>Actor: {selected.actor_id ?? '—'}</div>
                  <div>Action: {selected.action}</div>
                  <div>
                    Entity: {selected.entity_type}
                    {selected.entity_id ? `:${selected.entity_id}` : ''}
                  </div>
                </div>
                <pre className="max-h-[52vh] overflow-auto rounded-xl border border-slate-200 bg-slate-950 px-3 py-3 text-xs text-slate-100">
{safeStringify(selected.meta)}
                </pre>
              </div>
            ) : (
              <div className="mt-2 text-sm text-slate-600">Select a row to inspect.</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
