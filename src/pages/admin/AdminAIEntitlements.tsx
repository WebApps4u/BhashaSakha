import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useGlobalLoading } from '@/hooks/useGlobalLoading'
import { RefreshCw, Save } from 'lucide-react'

type Plan = { code: string; name: string; is_active: boolean }
type Model = { id: string; model_id: string; display_name: string; status: string }
type Entitlement = {
  id: string
  plan_code: string
  model_pk: string
  is_enabled: boolean
  monthly_request_limit: number
  monthly_input_unit_limit: number
  monthly_output_unit_limit: number
}

const toInt = (v: unknown) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0
}

export default function AdminAIEntitlements() {
  const { wrapFn } = useGlobalLoading()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [plans, setPlans] = useState<Plan[]>([])
  const [models, setModels] = useState<Model[]>([])
  const [entitlements, setEntitlements] = useState<Entitlement[]>([])
  const [planCode, setPlanCode] = useState<string>('free')
  const [dirty, setDirty] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token ?? ''
    if (!token) {
      setError('Not signed in')
      setLoading(false)
      return
    }
    const resp = await fetch('/api/admin/ai/plans-matrix', { headers: { Authorization: `Bearer ${token}` } })
    const json = (await resp.json().catch(() => ({}))) as any
    if (!resp.ok || !json.success) {
      setError(json.error ?? 'Failed to load matrix')
      setLoading(false)
      return
    }
    const ps = (json.plans ?? []) as Plan[]
    const ms = (json.models ?? []) as Model[]
    const es = (json.entitlements ?? []) as Entitlement[]
    setPlans(ps)
    setModels(ms)
    setEntitlements(es)
    if (ps.length && !ps.some((p) => p.code === planCode)) setPlanCode(ps[0].code)
    setDirty(false)
    setLoading(false)
  }, [planCode])

  useEffect(() => {
    void wrapFn(load)
  }, [load, wrapFn])

  const byKey = useMemo(() => {
    const m = new Map<string, Entitlement>()
    for (const e of entitlements) m.set(`${e.plan_code}:${e.model_pk}`, e)
    return m
  }, [entitlements])

  const rows = useMemo(() => {
    return models
      .filter((m) => m.status !== 'disabled')
      .map((m) => {
        const existing = byKey.get(`${planCode}:${m.id}`)
        return {
          model: m,
          entitlement: {
            id: existing?.id ?? '',
            plan_code: planCode,
            model_pk: m.id,
            is_enabled: existing?.is_enabled ?? false,
            monthly_request_limit: existing?.monthly_request_limit ?? 0,
            monthly_input_unit_limit: existing?.monthly_input_unit_limit ?? 0,
            monthly_output_unit_limit: existing?.monthly_output_unit_limit ?? 0,
          } as Entitlement,
        }
      })
  }, [models, byKey, planCode])

  const setRow = (modelPk: string, patch: Partial<Entitlement>) => {
    setEntitlements((prev) => {
      const key = `${planCode}:${modelPk}`
      const idx = prev.findIndex((e) => `${e.plan_code}:${e.model_pk}` === key)
      if (idx >= 0) {
        const next = [...prev]
        next[idx] = { ...next[idx], ...patch }
        return next
      }
      return [...prev, { id: '', plan_code: planCode, model_pk: modelPk, is_enabled: false, monthly_request_limit: 0, monthly_input_unit_limit: 0, monthly_output_unit_limit: 0, ...patch } as Entitlement]
    })
    setDirty(true)
  }

  const saveAll = async () => {
    setError(null)
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token ?? ''
    const relevant = entitlements.filter((e) => e.plan_code === planCode)
    for (const e of relevant) {
      const resp = await fetch('/api/admin/ai/plan-entitlements', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan_code: e.plan_code,
          model_pk: e.model_pk,
          is_enabled: e.is_enabled,
          monthly_request_limit: e.monthly_request_limit,
          monthly_input_unit_limit: e.monthly_input_unit_limit,
          monthly_output_unit_limit: e.monthly_output_unit_limit,
        }),
      })
      const json = (await resp.json().catch(() => ({}))) as any
      if (!resp.ok || !json.success) throw new Error(json.error ?? 'Failed to save entitlements')
    }
    setDirty(false)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-lg font-semibold">Plans & Entitlements</h1>
          <div className="mt-1 text-sm text-slate-600">Assign models and per-model quotas per subscription plan.</div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void wrapFn(load)}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 transition hover:bg-slate-50"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
          <button
            type="button"
            disabled={!dirty}
            onClick={() => void wrapFn(saveAll)}
            className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            Save
          </button>
        </div>
      </div>

      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</div> : null}

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="text-sm font-semibold">Plan</div>
          <select
            value={planCode}
            onChange={(e) => {
              setPlanCode(e.target.value)
              setDirty(false)
            }}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
          >
            {plans.map((p) => (
              <option key={p.code} value={p.code}>
                {p.name} ({p.code})
              </option>
            ))}
          </select>
        </div>

        {loading ? (
          <div className="mt-4 space-y-2">
            <div className="h-10 animate-pulse rounded-xl bg-slate-100" />
            <div className="h-10 animate-pulse rounded-xl bg-slate-100" />
          </div>
        ) : (
          <div className="mt-4 overflow-hidden rounded-xl border border-slate-200">
            <div className="grid grid-cols-[2fr_1fr_1fr_1fr] gap-3 bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-600">
              <div>Model</div>
              <div>Enabled</div>
              <div className="text-right">Requests/month</div>
              <div className="text-right">Input/Output units</div>
            </div>
            <div className="divide-y divide-slate-200">
              {rows.map((row) => (
                <div key={row.model.id} className="grid grid-cols-[2fr_1fr_1fr_1fr] items-center gap-3 px-4 py-3 text-sm">
                  <div>
                    <div className="font-medium text-slate-900">{row.model.display_name}</div>
                    <div className="mt-0.5 text-xs text-slate-600">{row.model.model_id}</div>
                  </div>
                  <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={row.entitlement.is_enabled}
                      onChange={(e) => setRow(row.model.id, { is_enabled: e.target.checked })}
                    />
                    {row.entitlement.is_enabled ? 'Yes' : 'No'}
                  </label>
                  <input
                    value={row.entitlement.monthly_request_limit}
                    onChange={(e) => setRow(row.model.id, { monthly_request_limit: toInt(e.target.value) })}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-right text-sm"
                    placeholder="0 = unlimited"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      value={row.entitlement.monthly_input_unit_limit}
                      onChange={(e) => setRow(row.model.id, { monthly_input_unit_limit: toInt(e.target.value) })}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-right text-sm"
                      placeholder="in"
                    />
                    <input
                      value={row.entitlement.monthly_output_unit_limit}
                      onChange={(e) => setRow(row.model.id, { monthly_output_unit_limit: toInt(e.target.value) })}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-right text-sm"
                      placeholder="out"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

