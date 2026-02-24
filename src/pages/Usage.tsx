import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import { useGlobalLoading } from '@/hooks/useGlobalLoading'
import { supabase } from '@/lib/supabaseClient'
import { Crown, Gauge, LogIn } from 'lucide-react'
import { cn } from '@/lib/utils'

type PlanRow = {
  code: string
  name: string
  monthly_request_limit: number
  monthly_char_limit: number
  is_active: boolean
}

type UsageMe = {
  user_id: string
  month: string
  plan: {
    code: string
    name: string
    monthly_request_limit: number
    monthly_char_limit: number
    per_request_char_limit: number
    max_targets: number
    effective_from: string | null
  }
  usage: {
    requests_used: number
    chars_used: number
    updated_at: string | null
  }
  remaining: {
    requests_remaining: number | null
    chars_remaining: number | null
  }
  reset_at: string
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n))

export default function Usage() {
  const navigate = useNavigate()
  const { user, isReady } = useAuthStore()
  const { wrapFn } = useGlobalLoading()

  const [plans, setPlans] = useState<PlanRow[]>([])
  const [me, setMe] = useState<UsageMe | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [planSwitching, setPlanSwitching] = useState(false)

  const canLoad = useMemo(() => isReady, [isReady])

  const load = useCallback(async () => {
    setError(null)
    const { data: sessionData } = await supabase.auth.getSession()
    const token = sessionData.session?.access_token ?? ''

    const plansResp = await fetch('/api/subscriptions/plans', { headers: { 'Content-Type': 'application/json' } })
    const plansJson = (await plansResp.json().catch(() => ({}))) as any
    if (plansResp.ok && plansJson.success) {
      setPlans((plansJson.plans ?? []) as PlanRow[])
    }

    if (token) {
      const meResp = await fetch('/api/subscriptions/me', {
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      })
      const meJson = (await meResp.json().catch(() => ({}))) as any
      if (!meResp.ok || !meJson.success) {
        setMe(null)
        setError(meJson.error ?? 'Failed to load usage')
      } else {
        setMe(meJson as UsageMe)
      }
    } else {
      setMe(null)
    }
  }, [])

  const activatePlan = async (planCode: string) => {
    setError(null)
    setPlanSwitching(true)
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData.session?.access_token ?? ''
      if (!token) throw new Error('Not signed in')

      const resp = await fetch('/api/subscriptions/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ plan_code: planCode, reset_current_month: true }),
      })
      const json = (await resp.json().catch(() => ({}))) as any
      if (!resp.ok || !json.success) throw new Error(json.error ?? 'Failed to activate plan')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to activate plan')
    } finally {
      setPlanSwitching(false)
    }
  }

  useEffect(() => {
    if (!canLoad) return
    void wrapFn(load)
  }, [canLoad, load, wrapFn])

  if (!canLoad) {
    return <div className="h-24 animate-pulse rounded-2xl bg-slate-100 dark:bg-white/10" />
  }

  if (!user) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-white/5">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 inline-flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900 text-white dark:bg-white dark:text-slate-900">
              <LogIn className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-slate-900 dark:text-slate-50">Sign in required</div>
              <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">You need an account to view your usage and plan limits.</div>
              <div className="mt-4 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => navigate('/login')}
                  className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100"
                >
                  Sign in
                </button>
                <Link to="/live" className="text-sm font-medium text-slate-700 underline dark:text-slate-200">
                  Back to Live
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const reqLimit = me?.plan.monthly_request_limit ?? 0
  const charLimit = me?.plan.monthly_char_limit ?? 0
  const reqUsed = me?.usage.requests_used ?? 0
  const charsUsed = me?.usage.chars_used ?? 0
  const reqPct = reqLimit > 0 ? clamp01(reqUsed / reqLimit) : 0
  const charPct = charLimit > 0 ? clamp01(charsUsed / charLimit) : 0

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Subscription & Usage</h1>
          <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">Monthly limits help keep the service reliable and cost-efficient.</div>
        </div>
        <button
          type="button"
          onClick={() => void wrapFn(load)}
          className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 transition hover:bg-slate-50 dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:hover:bg-white/10"
        >
          Refresh
        </button>
      </div>

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-100">
          {error}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm lg:col-span-1 dark:border-white/10 dark:bg-white/5">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Gauge className="h-4 w-4" />
            Current month
          </div>
          <div className="mt-3 space-y-4">
            <div>
              <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-300">
                <span>Requests</span>
                <span>{reqLimit > 0 ? `${reqUsed}/${reqLimit}` : `${reqUsed} used`}</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
                <div className="h-full bg-indigo-600" style={{ width: `${Math.round(reqPct * 100)}%` }} />
              </div>
              <div className="mt-1 text-xs text-slate-500 dark:text-slate-300">
                Remaining: {me?.remaining.requests_remaining == null ? 'Unlimited' : me.remaining.requests_remaining}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-300">
                <span>Characters</span>
                <span>{charLimit > 0 ? `${charsUsed}/${charLimit}` : `${charsUsed} used`}</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
                <div className="h-full bg-emerald-600" style={{ width: `${Math.round(charPct * 100)}%` }} />
              </div>
              <div className="mt-1 text-xs text-slate-500 dark:text-slate-300">
                Remaining: {me?.remaining.chars_remaining == null ? 'Unlimited' : me.remaining.chars_remaining}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-300">
              Resets at: {me?.reset_at ? new Date(me.reset_at).toLocaleString() : '—'}
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-300">
              Per-request limit: {me?.plan.per_request_char_limit ? `${me.plan.per_request_char_limit} chars` : 'Unlimited'}; Max targets: {me?.plan.max_targets ? me.plan.max_targets : 'Unlimited'}
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm lg:col-span-2 dark:border-white/10 dark:bg-white/5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Crown className="h-4 w-4" />
              Your plan
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-300">Current: {me?.plan.name ?? '—'}</div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {plans.map((p) => {
              const isCurrent = (me?.plan.code ?? 'free') === p.code
              return (
                <div
                  key={p.code}
                  className={cn(
                    'rounded-2xl border p-4',
                    isCurrent
                      ? 'border-indigo-200 bg-indigo-50 dark:border-indigo-400/30 dark:bg-indigo-500/10'
                      : 'border-slate-200 bg-white dark:border-white/10 dark:bg-transparent',
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-slate-900 dark:text-slate-50">{p.name}</div>
                      <div className="mt-1 text-xs text-slate-600 dark:text-slate-300">Code: {p.code}</div>
                    </div>
                    {isCurrent ? (
                      <div className="rounded-full bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white">Current</div>
                    ) : null}
                  </div>
                  <div className="mt-3 text-xs text-slate-600 dark:text-slate-300">
                    Requests/month: {p.monthly_request_limit === 0 ? 'Unlimited' : p.monthly_request_limit}
                  </div>
                  <div className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                    Characters/month: {p.monthly_char_limit === 0 ? 'Unlimited' : p.monthly_char_limit}
                  </div>
                  <div className="mt-4 text-xs text-slate-500 dark:text-slate-300">
                    {isCurrent ? 'This plan is active on your account.' : ''}
                  </div>
                  {!isCurrent ? (
                    <div className="mt-3">
                      <button
                        type="button"
                        disabled={planSwitching}
                        onClick={() => {
                          if (!window.confirm(`Activate plan ${p.name} (${p.code})?`)) return
                          void wrapFn(() => activatePlan(p.code))
                        }}
                        className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-50 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100"
                      >
                        Activate
                      </button>
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
