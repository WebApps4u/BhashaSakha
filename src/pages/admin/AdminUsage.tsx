import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useGlobalLoading } from '@/hooks/useGlobalLoading'
import { Search, RefreshCw, UserCog } from 'lucide-react'
import SubscriptionUserEditor from '@/components/admin/SubscriptionUserEditor'

type UsageRow = {
  user_id: string
  email: string | null
  display_name: string
  month: string
  requests_used: number
  chars_used: number
  updated_at: string
  plan_code: string
  effective_from: string | null
  override_monthly_request_limit: number | null
  override_monthly_char_limit: number | null
}

type Plan = {
  code: string
  name: string
  monthly_request_limit: number
  monthly_char_limit: number
  is_active: boolean
}

const monthKeyUtc = () => {
  const d = new Date()
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth() + 1
  return `${y}-${String(m).padStart(2, '0')}`
}

export default function AdminUsage() {
  const { wrapFn } = useGlobalLoading()
  const [month, setMonth] = useState(monthKeyUtc())
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState<UsageRow[]>([])
  const [plans, setPlans] = useState<Plan[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<UsageRow | null>(null)
  const [busy, setBusy] = useState(false)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) => `${r.email ?? ''} ${r.display_name ?? ''} ${r.user_id}`.toLowerCase().includes(q))
  }, [query, rows])

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

    const plansResp = await fetch('/api/admin/subscriptions/plans', {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    })
    const plansJson = (await plansResp.json().catch(() => ({}))) as any
    if (plansResp.ok && plansJson.success) setPlans((plansJson.plans ?? []) as Plan[])

    const resp = await fetch(`/api/admin/subscriptions/usage?month=${encodeURIComponent(month)}`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    })
    const json = (await resp.json().catch(() => ({}))) as any
    if (!resp.ok || !json.success) {
      setError(json.error ?? 'Failed to load usage')
      setLoading(false)
      return
    }
    setRows((json.rows ?? []) as UsageRow[])
    setLoading(false)
  }, [month])

  useEffect(() => {
    void wrapFn(load)
  }, [load, wrapFn])

  const assignPlan = async (userId: string, payload: any) => {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token ?? ''
    const resp = await fetch(`/api/admin/subscriptions/users/${encodeURIComponent(userId)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const json = (await resp.json().catch(() => ({}))) as any
    if (!resp.ok || !json.success) throw new Error(json.error ?? 'Failed to update subscription')
  }

  const saveSelected = async (resetCurrentMonth: boolean) => {
    if (!selected) return
    setBusy(true)
    setError(null)
    try {
      await assignPlan(selected.user_id, {
        plan_code: selected.plan_code,
        effective_from: selected.effective_from || null,
        override_monthly_request_limit: selected.override_monthly_request_limit,
        override_monthly_char_limit: selected.override_monthly_char_limit,
        reset_current_month: resetCurrentMonth,
      })
      await load()
      setSelected(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-lg font-semibold">Usage</h1>
          <div className="mt-1 text-sm text-slate-600">Monitor monthly usage and adjust subscriptions.</div>
        </div>
        <button
          type="button"
          onClick={() => void wrapFn(load)}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 transition hover:bg-slate-50"
        >
          <RefreshCw className="h-4 w-4" />
          Refresh
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <label className="block">
          <span className="text-xs text-slate-600">Month (YYYY-MM)</span>
          <input
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
            placeholder="2026-02"
          />
        </label>
        <div className="md:col-span-2">
          <span className="text-xs text-slate-600">Search users</span>
          <div className="mt-1 flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
            <Search className="h-4 w-4 text-slate-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full bg-transparent text-sm outline-none"
              placeholder="Search by email, name, or id"
            />
          </div>
        </div>
      </div>

      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</div> : null}

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        {loading ? (
          <div className="space-y-2">
            <div className="h-10 animate-pulse rounded-xl bg-slate-100" />
            <div className="h-10 animate-pulse rounded-xl bg-slate-100" />
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200">
            <div className="grid grid-cols-[2fr_1fr_1fr_1fr] gap-3 bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-600">
              <div>User</div>
              <div>Plan</div>
              <div>Requests</div>
              <div className="text-right">Action</div>
            </div>
            <div className="divide-y divide-slate-200">
              {filtered.map((r) => (
                <div key={r.user_id} className="grid grid-cols-[2fr_1fr_1fr_1fr] gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-slate-900">{r.email ?? r.user_id}</div>
                    <div className="mt-0.5 truncate text-xs text-slate-500">{r.display_name || r.user_id}</div>
                  </div>
                  <div className="flex items-center">
                    <div className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700">{r.plan_code}</div>
                  </div>
                  <div className="flex items-center text-sm text-slate-700">
                    {r.requests_used} / {r.chars_used}
                  </div>
                  <div className="flex items-center justify-end">
                    <button
                      type="button"
                      onClick={() => setSelected(r)}
                      className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-50"
                    >
                      <UserCog className="h-4 w-4" />
                      Manage
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {selected ? (
        <SubscriptionUserEditor
          value={selected}
          plans={plans}
          busy={busy}
          onChange={(next) => setSelected(next)}
          onClose={() => setSelected(null)}
          onSave={() => void wrapFn(() => saveSelected(false))}
          onReset={() => void wrapFn(() => saveSelected(true))}
        />
      ) : null}
    </div>
  )
}
