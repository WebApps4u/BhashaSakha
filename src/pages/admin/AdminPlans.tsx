import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useGlobalLoading } from '@/hooks/useGlobalLoading'
import { Plus, Save } from 'lucide-react'

type Plan = {
  code: string
  name: string
  monthly_request_limit: number
  monthly_char_limit: number
  is_active: boolean
  created_at?: string
}

const toInt = (v: unknown) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.trunc(n) : 0
}

export default function AdminPlans() {
  const { wrapFn } = useGlobalLoading()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [plans, setPlans] = useState<Plan[]>([])

  const [draft, setDraft] = useState<Plan>({
    code: 'starter',
    name: 'Starter',
    monthly_request_limit: 200,
    monthly_char_limit: 100000,
    is_active: true,
  })

  const canSave = useMemo(() => !!draft.code.trim() && !!draft.name.trim(), [draft])

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

    const resp = await fetch('/api/admin/subscriptions/plans', {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    })
    const json = (await resp.json().catch(() => ({}))) as any
    if (!resp.ok || !json.success) {
      setError(json.error ?? 'Failed to load plans')
      setLoading(false)
      return
    }

    setPlans((json.plans ?? []) as Plan[])
    setLoading(false)
  }, [])

  useEffect(() => {
    void wrapFn(load)
  }, [load, wrapFn])

  const upsert = async (plan: Plan) => {
    setError(null)
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token ?? ''
    const resp = await fetch('/api/admin/subscriptions/plans', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(plan),
    })
    const json = (await resp.json().catch(() => ({}))) as any
    if (!resp.ok || !json.success) throw new Error(json.error ?? 'Failed to save')
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-lg font-semibold">Plans</h1>
          <div className="mt-1 text-sm text-slate-600">Manage subscription tiers and monthly limits.</div>
        </div>
        <button
          type="button"
          onClick={() => void wrapFn(load)}
          className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 transition hover:bg-slate-50"
        >
          Refresh
        </button>
      </div>

      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</div> : null}

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="text-sm font-semibold">Create or update a plan</div>
        <div className="mt-3 grid gap-3 md:grid-cols-5">
          <input
            value={draft.code}
            onChange={(e) => setDraft((p) => ({ ...p, code: e.target.value }))}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
            placeholder="code"
          />
          <input
            value={draft.name}
            onChange={(e) => setDraft((p) => ({ ...p, name: e.target.value }))}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm md:col-span-2"
            placeholder="name"
          />
          <input
            value={draft.monthly_request_limit}
            onChange={(e) => setDraft((p) => ({ ...p, monthly_request_limit: toInt(e.target.value) }))}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
            placeholder="requests"
          />
          <input
            value={draft.monthly_char_limit}
            onChange={(e) => setDraft((p) => ({ ...p, monthly_char_limit: toInt(e.target.value) }))}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
            placeholder="chars"
          />
        </div>
        <div className="mt-3 flex items-center justify-between">
          <label className="inline-flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={draft.is_active}
              onChange={(e) => setDraft((p) => ({ ...p, is_active: e.target.checked }))}
            />
            Active
          </label>
          <button
            type="button"
            disabled={!canSave}
            onClick={() =>
              void wrapFn(async () => {
                await upsert({
                  ...draft,
                  code: draft.code.trim().toLowerCase(),
                  name: draft.name.trim(),
                })
                await load()
              })
            }
            className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            Save
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="text-sm font-semibold">Existing plans</div>
        {loading ? (
          <div className="mt-4 space-y-2">
            <div className="h-10 animate-pulse rounded-xl bg-slate-100" />
            <div className="h-10 animate-pulse rounded-xl bg-slate-100" />
          </div>
        ) : (
          <div className="mt-4 overflow-hidden rounded-xl border border-slate-200">
            <div className="grid grid-cols-[1fr_2fr_1fr_1fr_1fr] gap-3 bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-600">
              <div>Code</div>
              <div>Name</div>
              <div>Requests</div>
              <div>Chars</div>
              <div className="text-right">Action</div>
            </div>
            <div className="divide-y divide-slate-200">
              {plans.map((p) => (
                <div key={p.code} className="grid grid-cols-[1fr_2fr_1fr_1fr_1fr] gap-3 px-4 py-3 text-sm">
                  <div className="font-medium text-slate-900">{p.code}</div>
                  <div className="text-slate-700">{p.name}</div>
                  <div className="text-slate-700">{p.monthly_request_limit === 0 ? 'Unlimited' : p.monthly_request_limit}</div>
                  <div className="text-slate-700">{p.monthly_char_limit === 0 ? 'Unlimited' : p.monthly_char_limit}</div>
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() =>
                        void wrapFn(async () => {
                          await upsert({ ...p, is_active: !p.is_active })
                          await load()
                        })
                      }
                      className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-50"
                    >
                      <Save className="h-4 w-4" />
                      {p.is_active ? 'Deactivate' : 'Activate'}
                    </button>
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
