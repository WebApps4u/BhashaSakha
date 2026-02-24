import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useGlobalLoading } from '@/hooks/useGlobalLoading'
import { useAuthStore } from '@/store/authStore'
import { Bot, RefreshCw } from 'lucide-react'

type AllowedModel = {
  model_id: string
  display_name: string
  remaining_requests: number | null
  remaining_input_units: number | null
  remaining_output_units: number | null
  resets_at: string
}

type UsageEvent = {
  created_at: string
  status: string
  error_code: string | null
  used_fallback: boolean
  downgraded: boolean
  input_units: number
  output_units: number
  model_used: { id: string; model_id: string; display_name: string } | null
  model_requested: { id: string; model_id: string; display_name: string } | null
  provider: { id: string; key: string; name: string } | null
}

const formatRemaining = (v: number | null) => {
  if (v === null) return 'Unlimited'
  return v <= 0 ? '0' : String(v)
}

export default function Models() {
  const { wrapFn } = useGlobalLoading()
  const { user, isReady } = useAuthStore()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [models, setModels] = useState<AllowedModel[]>([])
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null)
  const [events, setEvents] = useState<UsageEvent[]>([])
  const [planCode, setPlanCode] = useState<string>('free')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token ?? ''
    if (!token) {
      setError('Not signed in')
      setModels([])
      setSelectedModelId(null)
      setEvents([])
      setLoading(false)
      return
    }

    const [mResp, uResp] = await Promise.all([
      fetch('/api/models/allowed', { headers: { Authorization: `Bearer ${token}` } }),
      fetch('/api/models/usage?limit=25', { headers: { Authorization: `Bearer ${token}` } }),
    ])
    const mJson = (await mResp.json().catch(() => ({}))) as any
    const uJson = (await uResp.json().catch(() => ({}))) as any
    if (!mResp.ok || !mJson.success) {
      setError(mJson.error ?? 'Failed to load models')
      setLoading(false)
      return
    }
    if (!uResp.ok || !uJson.success) {
      setError(uJson.error ?? 'Failed to load usage')
      setLoading(false)
      return
    }

    setModels((mJson.models ?? []) as AllowedModel[])
    setSelectedModelId((mJson.selected_model_id as string) ?? null)
    setEvents((uJson.events ?? []) as UsageEvent[])
    setPlanCode(typeof mJson.plan_code === 'string' && mJson.plan_code ? mJson.plan_code : 'free')
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!isReady) return
    if (!user) return
    void wrapFn(load)
  }, [isReady, user, load, wrapFn])

  const selectModel = async (modelId: string) => {
    setSaving(true)
    setError(null)
    try {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token ?? ''
      const resp = await fetch('/api/models/selection', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model_id: modelId }),
      })
      const json = (await resp.json().catch(() => ({}))) as any
      if (!resp.ok || !json.success) throw new Error(json.error ?? 'Failed to update selection')
      setSelectedModelId(json.selected_model_id ?? modelId)
      await load()
    } finally {
      setSaving(false)
    }
  }

  const selected = useMemo(() => models.find((m) => m.model_id === selectedModelId) ?? null, [models, selectedModelId])

  if (!isReady || !user) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-slate-200">
        Sign in to select models.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-lg font-semibold">Models</h1>
          <div className="mt-1 text-sm text-slate-600">Select from models available to your subscription.</div>
        </div>
        <button
          type="button"
          onClick={() => void wrapFn(load)}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 transition hover:bg-slate-50 dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:hover:bg-white/10"
        >
          <RefreshCw className="h-4 w-4" />
          Refresh
        </button>
      </div>

      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</div> : null}

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-white/5">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Bot className="h-4 w-4" />
          Current selection
        </div>
        <div className="mt-2 text-sm text-slate-700 dark:text-slate-200">
          {selected ? `${selected.display_name} (${selected.model_id})` : 'No model selected'}
        </div>
        <div className="mt-1 text-xs text-slate-500 dark:text-slate-300">Subscription plan: {planCode}</div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-white/5">
        <div className="text-sm font-semibold">Allowed models</div>
        {loading ? (
          <div className="mt-4 space-y-2">
            <div className="h-10 animate-pulse rounded-xl bg-slate-100 dark:bg-white/10" />
            <div className="h-10 animate-pulse rounded-xl bg-slate-100 dark:bg-white/10" />
          </div>
        ) : models.length ? (
          <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 dark:border-white/10">
            <div className="grid grid-cols-[2fr_2fr_2fr_1fr_1fr] gap-3 bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-600 dark:bg-white/5 dark:text-slate-300">
              <div>Model</div>
              <div>ID</div>
              <div>Remaining</div>
              <div>Resets</div>
              <div className="text-right">Action</div>
            </div>
            <div className="divide-y divide-slate-200 dark:divide-white/10">
              {models.map((m) => {
                const isSelected = m.model_id === selectedModelId
                const blockedReq = typeof m.remaining_requests === 'number' && m.remaining_requests <= 0
                const blockedIn = typeof m.remaining_input_units === 'number' && m.remaining_input_units <= 0
                const blockedOut = typeof m.remaining_output_units === 'number' && m.remaining_output_units <= 0
                const blocked = blockedReq || blockedIn || blockedOut
                return (
                  <div key={m.model_id} className="grid grid-cols-[2fr_2fr_2fr_1fr_1fr] items-center gap-3 px-4 py-3 text-sm">
                    <div className="font-medium text-slate-900 dark:text-slate-50">{m.display_name}</div>
                    <div className="text-slate-700 dark:text-slate-200">{m.model_id}</div>
                    <div className="text-slate-700 dark:text-slate-200">
                      <div className="flex flex-wrap gap-x-3 gap-y-1">
                        <span>req: {formatRemaining(m.remaining_requests)}</span>
                        <span>in: {formatRemaining(m.remaining_input_units)}</span>
                        <span>out: {formatRemaining(m.remaining_output_units)}</span>
                      </div>
                    </div>
                    <div className="text-slate-700 dark:text-slate-200">{m.resets_at ? new Date(m.resets_at).toLocaleString() : '-'}</div>
                    <div className="flex justify-end">
                      <button
                        type="button"
                        disabled={saving || isSelected || blocked}
                        onClick={() => void wrapFn(() => selectModel(m.model_id))}
                        className={
                          'rounded-xl px-3 py-2 text-sm transition ' +
                          (isSelected
                            ? 'border border-slate-200 bg-slate-100 text-slate-700 dark:border-white/10 dark:bg-white/10 dark:text-slate-200'
                            : 'bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50')
                        }
                      >
                        {blocked ? 'Blocked' : isSelected ? 'Selected' : 'Select'}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ) : (
          <div className="mt-4 text-sm text-slate-600 dark:text-slate-300">No models are available for your account.</div>
        )}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-white/5">
        <div className="text-sm font-semibold">Recent usage</div>
        {loading ? (
          <div className="mt-4 space-y-2">
            <div className="h-10 animate-pulse rounded-xl bg-slate-100 dark:bg-white/10" />
            <div className="h-10 animate-pulse rounded-xl bg-slate-100 dark:bg-white/10" />
          </div>
        ) : events.length ? (
          <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 dark:border-white/10">
            <div className="grid grid-cols-[1.5fr_2fr_1fr_1fr_1fr] gap-3 bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-600 dark:bg-white/5 dark:text-slate-300">
              <div>Time</div>
              <div>Model / Provider</div>
              <div>Status</div>
              <div className="text-right">Units</div>
              <div className="text-right">Flags</div>
            </div>
            <div className="divide-y divide-slate-200 dark:divide-white/10">
              {events.map((e, idx) => (
                <div key={idx} className="grid grid-cols-[1.5fr_2fr_1fr_1fr_1fr] items-center gap-3 px-4 py-3 text-sm">
                  <div className="text-slate-700 dark:text-slate-200">{new Date(e.created_at).toLocaleString()}</div>
                  <div className="text-slate-700 dark:text-slate-200">
                    {(e.model_used?.display_name ?? e.model_used?.model_id ?? 'Unknown') +
                      (e.provider ? ` · ${e.provider.name}` : '')}
                  </div>
                  <div className="text-slate-700 dark:text-slate-200">{e.status}</div>
                  <div className="text-right text-slate-700 dark:text-slate-200">{e.input_units + e.output_units}</div>
                  <div className="text-right text-slate-700 dark:text-slate-200">
                    {e.used_fallback ? 'fallback' : '-'}{e.downgraded ? ' downgrade' : ''}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="mt-4 text-sm text-slate-600 dark:text-slate-300">No usage yet.</div>
        )}
      </div>
    </div>
  )
}
