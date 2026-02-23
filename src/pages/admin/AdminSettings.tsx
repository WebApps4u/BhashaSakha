import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { Save, Plus } from 'lucide-react'

type SettingRow = {
  key: string
  value: unknown
  updated_at?: string
  updated_by?: string
}

const tryStringify = (v: unknown) => {
  try {
    return JSON.stringify(v ?? {}, null, 2)
  } catch {
    return '{}'
  }
}

export default function AdminSettings() {
  const [loading, setLoading] = useState(true)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [rows, setRows] = useState<SettingRow[]>([])
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [newKey, setNewKey] = useState('')

  const sorted = useMemo(() => rows.slice().sort((a, b) => a.key.localeCompare(b.key)), [rows])

  const load = async () => {
    setLoading(true)
    setError(null)
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token ?? ''
    const resp = await fetch('/api/admin/settings', {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    })
    const json = (await resp.json().catch(() => ({}))) as any
    if (!resp.ok || !json.success) {
      setError(json.error ?? 'Failed to load settings')
      setLoading(false)
      return
    }
    const list = (json.settings ?? []) as SettingRow[]
    setRows(list)
    setDrafts(Object.fromEntries(list.map((r) => [r.key, tryStringify(r.value)])))
    setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [])

  const save = async (key: string) => {
    setBusyKey(key)
    setError(null)
    try {
      const raw = drafts[key] ?? '{}'
      let value: unknown
      try {
        value = JSON.parse(raw)
      } catch {
        throw new Error('Invalid JSON')
      }
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token ?? ''
      const resp = await fetch(`/api/admin/settings/${encodeURIComponent(key)}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ value }),
      })
      const json = (await resp.json().catch(() => ({}))) as any
      if (!resp.ok || !json.success) throw new Error(json.error ?? 'Failed to save')

      setRows((prev) => {
        const idx = prev.findIndex((r) => r.key === key)
        const nextRow: SettingRow = { key, value }
        if (idx >= 0) {
          const copy = prev.slice()
          copy[idx] = nextRow
          return copy
        }
        return [...prev, nextRow]
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setBusyKey(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-lg font-semibold">App settings</h1>
          <div className="mt-1 text-sm text-slate-600">Store configuration as JSON by key.</div>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 transition hover:bg-slate-50"
        >
          Refresh
        </button>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-2 md:flex-row md:items-center">
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold text-slate-700">Create key</div>
            <input
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              placeholder="e.g. ui.languages"
              className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none"
            />
          </div>
          <button
            type="button"
            onClick={() => {
              const key = newKey.trim()
              if (!key) return
              setRows((prev) => (prev.some((r) => r.key === key) ? prev : [...prev, { key, value: {} }]))
              setDrafts((prev) => ({ ...prev, [key]: prev[key] ?? '{}' }))
              setNewKey('')
            }}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
          >
            <Plus className="h-4 w-4" />
            Add
          </button>
        </div>

        {error ? <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</div> : null}

        {loading ? (
          <div className="mt-4 space-y-2">
            <div className="h-10 animate-pulse rounded-xl bg-slate-100" />
            <div className="h-10 animate-pulse rounded-xl bg-slate-100" />
            <div className="h-10 animate-pulse rounded-xl bg-slate-100" />
          </div>
        ) : sorted.length === 0 ? (
          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">No settings yet.</div>
        ) : (
          <div className="mt-4 space-y-3">
            {sorted.map((row) => {
              const key = row.key
              const busy = busyKey === key
              return (
                <div key={key} className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-slate-900">{key}</div>
                      <div className="mt-1 text-xs text-slate-500">JSON value</div>
                    </div>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void save(key)}
                      className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-50"
                    >
                      <Save className="h-4 w-4" />
                      Save
                    </button>
                  </div>
                  <textarea
                    value={drafts[key] ?? ''}
                    onChange={(e) => setDrafts((prev) => ({ ...prev, [key]: e.target.value }))}
                    spellCheck={false}
                    className="mt-3 h-40 w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-900 outline-none"
                  />
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

