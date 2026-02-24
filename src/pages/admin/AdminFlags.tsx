import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { Save, Plus } from 'lucide-react'

type FlagRow = {
  key: string
  enabled: boolean
  description: string
  payload: unknown
}

type StyleMode = 'both' | 'pro' | 'free'

const parseStyleMode = (raw: string): StyleMode => {
  try {
    const json = JSON.parse(raw || '{}') as any
    const arr = json?.allowed_plans
    const allowed = Array.isArray(arr) ? arr.map((x: any) => String(x).toLowerCase()) : []
    const hasFree = allowed.includes('free')
    const hasPro = allowed.includes('pro')
    if (hasFree && hasPro) return 'both'
    if (hasPro) return 'pro'
    if (hasFree) return 'free'
    return 'both'
  } catch {
    return 'both'
  }
}

const setStyleModePayload = (mode: StyleMode) => {
  const allowed_plans = mode === 'both' ? ['free', 'pro'] : mode === 'pro' ? ['pro'] : ['free']
  return JSON.stringify({ allowed_plans }, null, 2)
}

const tryStringify = (v: unknown) => {
  try {
    return JSON.stringify(v ?? {}, null, 2)
  } catch {
    return '{}'
  }
}

export default function AdminFlags() {
  const [loading, setLoading] = useState(true)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [rows, setRows] = useState<FlagRow[]>([])
  const [draftPayloads, setDraftPayloads] = useState<Record<string, string>>({})
  const [newKey, setNewKey] = useState('')

  const sorted = useMemo(() => rows.slice().sort((a, b) => a.key.localeCompare(b.key)), [rows])

  const load = async () => {
    setLoading(true)
    setError(null)
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token ?? ''
    const resp = await fetch('/api/admin/flags', {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    })
    const json = (await resp.json().catch(() => ({}))) as any
    if (!resp.ok || !json.success) {
      setError(json.error ?? 'Failed to load flags')
      setLoading(false)
      return
    }
    const list = (json.flags ?? []) as FlagRow[]
    setRows(list)
    setDraftPayloads(Object.fromEntries(list.map((r) => [r.key, tryStringify(r.payload)])))
    setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [])

  const save = async (row: FlagRow) => {
    setBusyKey(row.key)
    setError(null)
    try {
      const raw = draftPayloads[row.key] ?? '{}'
      let payload: unknown
      try {
        payload = JSON.parse(raw)
      } catch {
        throw new Error('Invalid JSON payload')
      }

      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token ?? ''
      const resp = await fetch(`/api/admin/flags/${encodeURIComponent(row.key)}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: row.enabled,
          description: row.description,
          payload,
        }),
      })
      const json = (await resp.json().catch(() => ({}))) as any
      if (!resp.ok || !json.success) throw new Error(json.error ?? 'Failed to save')
      setRows((prev) => prev.map((r) => (r.key === row.key ? { ...row, payload } : r)))
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
          <h1 className="text-lg font-semibold">Feature toggles</h1>
          <div className="mt-1 text-sm text-slate-600">Control feature exposure without code changes.</div>
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
            <div className="text-xs font-semibold text-slate-700">Create flag</div>
            <input
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              placeholder="e.g. enable_dubbing"
              className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none"
            />
          </div>
          <button
            type="button"
            onClick={() => {
              const key = newKey.trim()
              if (!key) return
              setRows((prev) =>
                prev.some((r) => r.key === key)
                  ? prev
                  : [...prev, { key, enabled: false, description: '', payload: {} }]
              )
              setDraftPayloads((prev) => ({ ...prev, [key]: prev[key] ?? '{}' }))
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
          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">No flags yet.</div>
        ) : (
          <div className="mt-4 space-y-3">
            {sorted.map((row) => {
              const busy = busyKey === row.key
              const isStyleFlag = row.key === 'tts_style_prompting'
              return (
                <div key={row.key} className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-slate-900">{row.key}</div>
                      <input
                        value={row.description}
                        onChange={(e) => setRows((prev) => prev.map((r) => (r.key === row.key ? { ...r, description: e.target.value } : r)))}
                        placeholder="Description"
                        className="mt-2 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none"
                      />
                      <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
                        <label className="inline-flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={row.enabled}
                            onChange={(e) => setRows((prev) => prev.map((r) => (r.key === row.key ? { ...r, enabled: e.target.checked } : r)))}
                            className="h-4 w-4 rounded border-slate-300"
                          />
                          Enabled
                        </label>
                        {isStyleFlag ? (
                          <label className="inline-flex items-center gap-2">
                            <span className="text-xs text-slate-600">Access</span>
                            <select
                              value={parseStyleMode(draftPayloads[row.key] ?? '{}')}
                              onChange={(e) => {
                                const mode = e.target.value as StyleMode
                                setDraftPayloads((prev) => ({ ...prev, [row.key]: setStyleModePayload(mode) }))
                              }}
                              className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-900 outline-none"
                            >
                              <option value="both">Free + Pro</option>
                              <option value="pro">Pro only</option>
                              <option value="free">Free only</option>
                            </select>
                          </label>
                        ) : null}
                      </div>
                    </div>

                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void save(row)}
                      className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-50"
                    >
                      <Save className="h-4 w-4" />
                      Save
                    </button>
                  </div>

                  <div className="mt-3">
                    <div className="text-xs font-semibold text-slate-700">Payload (JSON)</div>
                    <textarea
                      value={draftPayloads[row.key] ?? ''}
                      onChange={(e) => setDraftPayloads((prev) => ({ ...prev, [row.key]: e.target.value }))}
                      spellCheck={false}
                      className="mt-2 h-36 w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-900 outline-none"
                    />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
