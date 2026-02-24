import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useGlobalLoading } from '@/hooks/useGlobalLoading'
import { RefreshCw, Save } from 'lucide-react'

type Model = { id: string; model_id: string; display_name: string; status: string }
type PolicyRow = { id: string; model_pk: string; status: string; policy: any; updated_at?: string }

const pretty = (v: any) => {
  try {
    return JSON.stringify(v ?? {}, null, 2)
  } catch {
    return '{}'
  }
}

export default function AdminAIRouting() {
  const { wrapFn } = useGlobalLoading()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [models, setModels] = useState<Model[]>([])
  const [policies, setPolicies] = useState<PolicyRow[]>([])
  const [selectedModelPk, setSelectedModelPk] = useState<string | null>(null)
  const [status, setStatus] = useState('active')
  const [policyText, setPolicyText] = useState('')

  const selectedModel = useMemo(() => models.find((m) => m.id === selectedModelPk) ?? null, [models, selectedModelPk])
  const selectedPolicy = useMemo(() => policies.find((p) => p.model_pk === selectedModelPk) ?? null, [policies, selectedModelPk])

  const loadAll = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token ?? ''
    if (!token) {
      setError('Not signed in')
      setLoading(false)
      return
    }
    const [mResp, pResp] = await Promise.all([
      fetch('/api/admin/ai/models', { headers: { Authorization: `Bearer ${token}` } }),
      fetch('/api/admin/ai/routing-policies', { headers: { Authorization: `Bearer ${token}` } }),
    ])
    const mJson = (await mResp.json().catch(() => ({}))) as any
    const pJson = (await pResp.json().catch(() => ({}))) as any
    if (!mResp.ok || !mJson.success) {
      setError(mJson.error ?? 'Failed to load models')
      setLoading(false)
      return
    }
    if (!pResp.ok || !pJson.success) {
      setError(pJson.error ?? 'Failed to load routing policies')
      setLoading(false)
      return
    }
    const ms = (mJson.models ?? []) as Model[]
    const ps = (pJson.policies ?? []) as PolicyRow[]
    setModels(ms)
    setPolicies(ps)
    if (ms.length && !selectedModelPk) setSelectedModelPk(ms[0].id)
    setLoading(false)
  }, [selectedModelPk])

  useEffect(() => {
    void wrapFn(loadAll)
  }, [loadAll, wrapFn])

  useEffect(() => {
    if (!selectedModelPk) return
    const pol = policies.find((p) => p.model_pk === selectedModelPk)
    setStatus(pol?.status ?? 'active')
    setPolicyText(pretty(pol?.policy ?? {
      primary: { provider_key: 'gemini', key_strategy: 'priority' },
      fallbacks: [{ provider_key: 'openai' }],
      max_attempts: 2,
      retry_on: ['timeout', '5xx', 'rate_limit'],
      quota_exhausted_fallback_model_id: 'translate_lite',
    }))
  }, [policies, selectedModelPk])

  const save = async () => {
    if (!selectedModelPk) return
    setError(null)
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token ?? ''
    let parsed: any
    try {
      parsed = JSON.parse(policyText)
    } catch {
      throw new Error('Policy JSON is invalid')
    }
    const resp = await fetch('/api/admin/ai/routing-policies', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model_pk: selectedModelPk, status, policy: parsed }),
    })
    const json = (await resp.json().catch(() => ({}))) as any
    if (!resp.ok || !json.success) throw new Error(json.error ?? 'Failed to save policy')
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-lg font-semibold">Routing & Fallbacks</h1>
          <div className="mt-1 text-sm text-slate-600">Database-driven routing policy per model.</div>
        </div>
        <button
          type="button"
          onClick={() => void wrapFn(loadAll)}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 transition hover:bg-slate-50"
        >
          <RefreshCw className="h-4 w-4" />
          Refresh
        </button>
      </div>

      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</div> : null}

      <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-sm font-semibold">Models</div>
          {loading ? (
            <div className="mt-4 space-y-2">
              <div className="h-10 animate-pulse rounded-xl bg-slate-100" />
              <div className="h-10 animate-pulse rounded-xl bg-slate-100" />
            </div>
          ) : (
            <div className="mt-4 space-y-2">
              {models.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setSelectedModelPk(m.id)}
                  className={
                    'w-full rounded-xl border px-3 py-2 text-left text-sm transition ' +
                    (selectedModelPk === m.id ? 'border-indigo-200 bg-indigo-50' : 'border-slate-200 bg-white hover:bg-slate-50')
                  }
                >
                  <div className="font-medium text-slate-900">{m.display_name}</div>
                  <div className="mt-0.5 text-xs text-slate-600">{m.model_id} · {m.status}</div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-sm font-semibold">Policy</div>
              <div className="mt-1 text-xs text-slate-600">Model: {selectedModel ? `${selectedModel.display_name} (${selectedModel.model_id})` : 'None selected'}</div>
              <div className="mt-1 text-xs text-slate-600">Existing policy: {selectedPolicy ? 'yes' : 'no'}</div>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                <option value="active">active</option>
                <option value="disabled">disabled</option>
              </select>
              <button
                type="button"
                disabled={!selectedModelPk}
                onClick={() =>
                  void wrapFn(async () => {
                    await save()
                    await loadAll()
                  })
                }
                className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-50"
              >
                <Save className="h-4 w-4" />
                Save
              </button>
            </div>
          </div>

          <textarea
            value={policyText}
            onChange={(e) => setPolicyText(e.target.value)}
            className="mt-4 min-h-[420px] w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-xs"
            spellCheck={false}
          />
        </div>
      </div>
    </div>
  )
}

