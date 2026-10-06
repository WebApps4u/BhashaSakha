import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { AlertTriangle, Ban, CheckCircle2, Loader2, RefreshCw, RotateCcw, Search, Settings2, Users, X, XCircle, Zap } from 'lucide-react'
import { useGlobalLoading } from '@/hooks/useGlobalLoading'
import { adminApi, timeAgo, type AiOverview } from '@/lib/adminApi'

type QuotaState = 'ok' | 'near' | 'exhausted' | 'disabled'

type Quota = { model_pk: string; model_id: string; display_name: string; used: number; limit: number | null; remaining: number | null; state: QuotaState; overridden: boolean }

type UserUsage = {
  user_id: string
  email: string | null
  display_name: string | null
  plan_code: string
  total_requests: number
  quotas: Quota[]
  state: 'ok' | 'near' | 'exhausted'
  last_active_at: string | null
}

type UsageOverview = {
  month: string
  totals: { success: number; error: number; rejected_limit: number; input_units: number; output_units: number; users: number }
  by_model: Array<{ model_pk: string; model_id: string; display_name: string; success: number; error: number; rejected_limit: number; input_units: number; output_units: number; users: number }>
  by_provider: Array<{ provider_id: string; name: string; success: number; error: number }>
  errors: Array<{ code: string; count: number; last_at: string; explanation: string }>
  users: UserUsage[]
}

type Filter = 'all' | 'attention' | 'exhausted'

const monthKeyUtc = () => {
  const d = new Date()
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

const fmt = (n: number) => n.toLocaleString()

const STATE_STYLE: Record<QuotaState, { bar: string; badge: string; label: string }> = {
  ok: { bar: 'bg-emerald-500', badge: 'bg-emerald-100 text-emerald-800', label: 'OK' },
  near: { bar: 'bg-amber-500', badge: 'bg-amber-100 text-amber-800', label: 'Near limit' },
  exhausted: { bar: 'bg-rose-500', badge: 'bg-rose-100 text-rose-800', label: 'Limit reached' },
  disabled: { bar: 'bg-slate-300', badge: 'bg-slate-100 text-slate-600', label: 'Blocked' },
}

export default function AdminUsage() {
  const { wrapFn } = useGlobalLoading()
  const [month, setMonth] = useState(monthKeyUtc())
  const [data, setData] = useState<UsageOverview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [managing, setManaging] = useState<UserUsage | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      setData(await adminApi<UsageOverview>(`/ai/usage-overview?month=${encodeURIComponent(month)}`))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load usage')
    }
  }, [month])

  useEffect(() => {
    void wrapFn(load)
  }, [load, wrapFn])

  const users = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (data?.users ?? []).filter((u) => {
      if (filter === 'exhausted' && u.state !== 'exhausted') return false
      if (filter === 'attention' && u.state === 'ok') return false
      return !q || `${u.email ?? ''} ${u.display_name ?? ''} ${u.user_id}`.toLowerCase().includes(q)
    })
  }, [data, filter, query])

  const exhausted = data?.users.filter((u) => u.state === 'exhausted').length ?? 0
  const near = data?.users.filter((u) => u.state === 'near').length ?? 0
  const totalRequests = data ? data.totals.success + data.totals.error + data.totals.rejected_limit : 0

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-lg font-semibold">Usage</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">AI requests, failures and plan limits for every user and model. Limits shown are each user's current plan limits.</p>
        </div>
        <div className="flex items-end gap-2">
          <label className="grid gap-1 text-xs text-slate-600">
            Month
            <input type="month" value={month} max={monthKeyUtc()} onChange={(e) => e.target.value && setMonth(e.target.value)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900" />
          </label>
          <button type="button" onClick={() => void wrapFn(load)} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
        </div>
      </div>

      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</div> : null}
      {!data ? <div className="h-40 animate-pulse rounded-2xl bg-slate-100" /> : null}

      {data ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi icon={<CheckCircle2 className="h-4 w-4 text-emerald-600" />} label="Successful requests" value={fmt(data.totals.success)} hint={totalRequests ? `${Math.round((data.totals.success / totalRequests) * 100)}% of ${fmt(totalRequests)}` : 'No requests this month'} />
            <Kpi icon={<XCircle className="h-4 w-4 text-rose-600" />} label="Failed (provider errors)" value={fmt(data.totals.error)} hint={data.totals.error ? data.errors.find((e) => e.code.startsWith('provider_'))?.explanation ?? 'See errors below' : 'None'} />
            <Kpi icon={<Ban className="h-4 w-4 text-amber-600" />} label="Blocked by plan limit" value={fmt(data.totals.rejected_limit)} hint={`${exhausted} user${exhausted === 1 ? '' : 's'} at limit · ${near} near`} />
            <Kpi icon={<Users className="h-4 w-4 text-slate-600" />} label="Active users" value={fmt(data.totals.users)} hint={`${fmt(data.totals.input_units)} chars in · ${fmt(data.totals.output_units)} out`} />
          </div>

          {data.errors.length ? (
            <Panel title="Errors this month" subtitle="Why requests failed. Provider limits affect every user, not just one.">
              <ul className="divide-y divide-slate-100">
                {data.errors.map((e) => (
                  <li key={e.code} className="flex flex-col gap-1 py-2.5 text-sm sm:flex-row sm:items-center sm:justify-between">
                    <span className="flex items-start gap-2">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                      <span>
                        <span className="font-medium text-slate-900">{e.explanation}</span> <code className="text-xs text-slate-500">{e.code}</code>
                      </span>
                    </span>
                    <span className="shrink-0 text-slate-600">
                      {fmt(e.count)}× · last {timeAgo(e.last_at)}
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}

          <div className="grid gap-4 xl:grid-cols-[2fr_1fr]">
            <Panel title="By AI model">
              {data.by_model.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[520px] text-sm">
                    <thead className="text-left text-xs text-slate-500">
                      <tr>
                        <th className="py-2 font-medium">Model</th>
                        <th className="py-2 text-right font-medium">Successful</th>
                        <th className="py-2 text-right font-medium">Failed</th>
                        <th className="py-2 text-right font-medium">Blocked</th>
                        <th className="py-2 text-right font-medium">Users</th>
                        <th className="py-2 text-right font-medium">Chars in / out</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {data.by_model.map((m) => (
                        <tr key={m.model_pk}>
                          <td className="py-2">
                            <div className="font-medium text-slate-900">{m.display_name}</div>
                            <code className="text-xs text-slate-500">{m.model_id}</code>
                          </td>
                          <td className="py-2 text-right tabular-nums">{fmt(m.success)}</td>
                          <td className={'py-2 text-right tabular-nums ' + (m.error ? 'text-rose-700' : '')}>{fmt(m.error)}</td>
                          <td className={'py-2 text-right tabular-nums ' + (m.rejected_limit ? 'text-amber-700' : '')}>{fmt(m.rejected_limit)}</td>
                          <td className="py-2 text-right tabular-nums">{fmt(m.users)}</td>
                          <td className="py-2 text-right tabular-nums text-slate-600">
                            {fmt(m.input_units)} / {fmt(m.output_units)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty>No AI requests in this month.</Empty>
              )}
            </Panel>
            <Panel title="By provider">
              {data.by_provider.length ? (
                <ul className="divide-y divide-slate-100 text-sm">
                  {data.by_provider.map((p) => (
                    <li key={p.provider_id} className="flex justify-between py-2">
                      <span className="font-medium text-slate-900">{p.name}</span>
                      <span className="tabular-nums text-slate-600">
                        {fmt(p.success)} ok · <span className={p.error ? 'text-rose-700' : ''}>{fmt(p.error)} failed</span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty>No provider calls in this month.</Empty>
              )}
            </Panel>
          </div>

          <Panel
            title="Users"
            subtitle="Sorted by who needs attention first. Use Manage to raise a limit, reset a count or change the plan."
            actions={
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="flex rounded-xl border border-slate-200 bg-white p-0.5 text-xs" role="radiogroup" aria-label="Filter users">
                  {(
                    [
                      ['all', `All (${data.users.length})`],
                      ['attention', `Near or at limit (${exhausted + near})`],
                      ['exhausted', `At limit (${exhausted})`],
                    ] as Array<[Filter, string]>
                  ).map(([id, label]) => (
                    <button key={id} type="button" role="radio" aria-checked={filter === id} onClick={() => setFilter(id)} className={'rounded-lg px-2.5 py-1.5 ' + (filter === id ? 'bg-slate-900 text-white' : 'text-slate-600 hover:text-slate-900')}>
                      {label}
                    </button>
                  ))}
                </div>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search users" className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm sm:w-56" />
                </div>
              </div>
            }
          >
            {users.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead className="text-left text-xs text-slate-500">
                    <tr>
                      <th className="py-2 font-medium">User</th>
                      <th className="py-2 font-medium">Plan</th>
                      <th className="py-2 font-medium">Usage vs limit</th>
                      <th className="py-2 font-medium">Last active</th>
                      <th className="py-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {users.map((u) => (
                      <tr key={u.user_id} className="align-top">
                        <td className="py-3 pr-3">
                          <div className="font-medium text-slate-900">{u.email ?? 'Unknown user'}</div>
                          <div className="text-xs text-slate-500">{u.display_name || u.user_id.slice(0, 8)}</div>
                          {u.state !== 'ok' ? <span className={'mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium ' + STATE_STYLE[u.state].badge}>{STATE_STYLE[u.state].label}</span> : null}
                        </td>
                        <td className="py-3 pr-3">
                          <span className="rounded-lg bg-slate-100 px-2 py-0.5 text-xs font-medium uppercase text-slate-700">{u.plan_code}</span>
                        </td>
                        <td className="py-3 pr-3">
                          <div className="space-y-2">
                            {u.quotas.length ? u.quotas.map((q) => <QuotaBar key={q.model_pk} quota={q} />) : <span className="text-slate-500">No usage</span>}
                          </div>
                        </td>
                        <td className="py-3 pr-3 text-slate-600">{timeAgo(u.last_active_at)}</td>
                        <td className="py-3 text-right">
                          <button type="button" onClick={() => setManaging(u)} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
                            <Settings2 className="h-4 w-4" /> Manage
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty>{data.users.length ? 'No users match this filter.' : 'No user activity in this month.'}</Empty>
            )}
          </Panel>
        </>
      ) : null}

      {managing && data ? (
        <ManageUserModal
          user={managing}
          month={data.month}
          onClose={() => setManaging(null)}
          onChanged={async () => {
            await load()
          }}
        />
      ) : null}
    </div>
  )
}

function Kpi({ icon, label, value, hint }: { icon: ReactNode; label: string; value: string; hint: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-2 text-xs font-medium text-slate-600">
        {icon}
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums text-slate-900">{value}</div>
      <div className="mt-1 truncate text-xs text-slate-500" title={hint}>
        {hint}
      </div>
    </div>
  )
}

function Panel({ title, subtitle, actions, children }: { title: string; subtitle?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
          {subtitle ? <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p> : null}
        </div>
        {actions}
      </div>
      {children}
    </section>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="py-6 text-center text-sm text-slate-500">{children}</div>
}

function QuotaBar({ quota: q }: { quota: Quota }) {
  const pct = q.limit ? Math.min(100, Math.round((q.used / q.limit) * 100)) : 0
  const style = STATE_STYLE[q.state]
  return (
    <div className="max-w-sm">
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className="truncate text-slate-700">
          {q.display_name}
          {q.overridden ? <span className="ml-1 rounded bg-indigo-100 px-1 text-[10px] text-indigo-800">custom</span> : null}
        </span>
        <span className="shrink-0 tabular-nums text-slate-900">
          {fmt(q.used)} / {q.state === 'disabled' ? 'blocked' : q.limit ? fmt(q.limit) : '∞'}
          {q.remaining != null && q.state !== 'disabled' ? <span className="text-slate-500"> · {fmt(q.remaining)} left</span> : null}
        </span>
      </div>
      <div className="mt-1 h-1.5 rounded-full bg-slate-100">
        {q.limit && q.state !== 'disabled' ? <div className={'h-full rounded-full ' + style.bar} style={{ width: `${Math.max(2, pct)}%` }} /> : q.state === 'disabled' ? <div className="h-full w-full rounded-full bg-slate-300" /> : null}
      </div>
    </div>
  )
}

type OverrideRow = { model_pk: string; override_enabled: boolean | null; override_monthly_request_limit: number | null }
type LimitChoice = 'plan' | 'unlimited' | 'custom' | 'blocked'

const choiceOf = (o: OverrideRow | undefined): { choice: LimitChoice; custom: string } => {
  if (!o || (o.override_enabled == null && o.override_monthly_request_limit == null)) return { choice: 'plan', custom: '' }
  if (o.override_enabled === false) return { choice: 'blocked', custom: '' }
  if (o.override_monthly_request_limit === 0) return { choice: 'unlimited', custom: '' }
  if (o.override_monthly_request_limit != null) return { choice: 'custom', custom: String(o.override_monthly_request_limit) }
  return { choice: 'plan', custom: '' }
}

function ManageUserModal({ user, month, onClose, onChanged }: { user: UserUsage; month: string; onClose: () => void; onChanged: () => Promise<void> }) {
  const [overview, setOverview] = useState<AiOverview | null>(null)
  const [overrides, setOverrides] = useState<OverrideRow[]>([])
  const [plans, setPlans] = useState<Array<{ code: string; name: string; is_active: boolean }>>([])
  const [plan, setPlan] = useState(user.plan_code)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const loadDetails = useCallback(async () => {
    const [o, ov, pl] = await Promise.all([
      adminApi<AiOverview>('/ai/overview'),
      adminApi<{ overrides: OverrideRow[] }>(`/ai/user-overrides?user_id=${encodeURIComponent(user.user_id)}`),
      adminApi<{ plans: Array<{ code: string; name: string; is_active: boolean }> }>('/subscriptions/plans'),
    ])
    setOverview(o)
    setOverrides(ov.overrides)
    setPlans(pl.plans)
  }, [user.user_id])

  useEffect(() => {
    void loadDetails().catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
  }, [loadDetails])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const run = async (key: string, fn: () => Promise<void>, done: string) => {
    setBusy(key)
    setError(null)
    setNotice(null)
    try {
      await fn()
      await Promise.all([loadDetails(), onChanged()])
      setNotice(done)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setBusy(null)
    }
  }

  const savePlan = () =>
    run(
      'plan',
      async () => {
        // Carry the user's other subscription settings over; only the plan changes.
        const current = await adminApi<{ subscription: any }>(`/subscriptions/users/${encodeURIComponent(user.user_id)}`).catch(() => null)
        const sub = current?.subscription ?? {}
        await adminApi(`/subscriptions/users/${encodeURIComponent(user.user_id)}`, {
          body: {
            plan_code: plan,
            override_monthly_request_limit: sub.override_monthly_request_limit ?? null,
            override_monthly_char_limit: sub.override_monthly_char_limit ?? null,
            override_per_request_char_limit: sub.override_per_request_char_limit ?? null,
            override_max_targets: sub.override_max_targets ?? null,
          },
        })
      },
      `Plan changed to ${plan}.`,
    )

  const models = (overview?.models ?? []).filter((m) => m.status === 'active')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true" aria-labelledby="manage-title">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="manage-title" className="text-base font-semibold">
              {user.email ?? user.user_id}
            </h2>
            <p className="text-sm text-slate-500">Limits for {month}. Changes apply immediately.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-slate-500 hover:text-slate-900">
            <X className="h-5 w-5" />
          </button>
        </div>

        {error ? <div className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</div> : null}
        {notice ? <div className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{notice}</div> : null}

        <div className="mt-5 flex flex-col gap-2 rounded-xl bg-slate-50 p-4 sm:flex-row sm:items-center">
          <span className="text-sm font-medium text-slate-900 sm:w-28">Plan</span>
          <select value={plan} onChange={(e) => setPlan(e.target.value)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm sm:w-48" aria-label="Plan">
            {plans.map((p) => (
              <option key={p.code} value={p.code}>
                {p.name} ({p.code}){p.is_active ? '' : ' — inactive'}
              </option>
            ))}
          </select>
          <button type="button" onClick={() => void savePlan()} disabled={plan === user.plan_code || busy !== null} className="rounded-xl bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-40">
            {busy === 'plan' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Change plan'}
          </button>
        </div>

        <div className="mt-5 text-sm font-medium text-slate-900">Limits per AI model</div>
        <p className="text-xs text-slate-500">"Plan default" follows the plan. A custom limit or block applies to this user only.</p>
        {!overview ? (
          <div className="mt-3 h-24 animate-pulse rounded-xl bg-slate-100" />
        ) : (
          <ul className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-200">
            {models.map((m) => (
              <ModelLimitRow
                key={m.id}
                model={m}
                planCode={user.plan_code}
                quota={user.quotas.find((q) => q.model_pk === m.id)}
                override={overrides.find((o) => o.model_pk === m.id)}
                busy={busy}
                onSave={(choice, custom) =>
                  run(
                    `limit-${m.id}`,
                    () =>
                      adminApi('/ai/user-overrides', {
                        body: {
                          user_id: user.user_id,
                          model_pk: m.id,
                          override_enabled: choice === 'plan' ? null : choice !== 'blocked',
                          override_monthly_request_limit: choice === 'unlimited' ? 0 : choice === 'custom' ? Math.max(1, Math.trunc(Number(custom) || 0)) : null,
                        },
                      }).then(() => undefined),
                    `${m.display_name}: limit updated.`,
                  )
                }
                onReset={() => {
                  if (!window.confirm(`Reset ${m.display_name} usage for ${month} to 0 for this user?`)) return
                  void run(
                    `reset-${m.id}`,
                    () => adminApi('/ai/usage/reset', { body: { user_id: user.user_id, month, model_pk: m.id } }).then(() => undefined),
                    `${m.display_name}: this month's count was reset.`,
                  )
                }}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function ModelLimitRow({
  model,
  planCode,
  quota,
  override,
  busy,
  onSave,
  onReset,
}: {
  model: AiOverview['models'][number]
  planCode: string
  quota: Quota | undefined
  override: OverrideRow | undefined
  busy: string | null
  onSave: (choice: LimitChoice, custom: string) => void
  onReset: () => void
}) {
  const initial = choiceOf(override)
  const [choice, setChoice] = useState<LimitChoice>(initial.choice)
  const [custom, setCustom] = useState(initial.custom)
  useEffect(() => {
    const next = choiceOf(override)
    setChoice(next.choice)
    setCustom(next.custom)
  }, [override])

  const planLimit = model.limits.find((l) => l.plan_code === planCode)
  const planText = !planLimit ? 'not set' : !planLimit.enabled ? 'not included' : planLimit.monthly_request_limit > 0 ? `${fmt(planLimit.monthly_request_limit)}/month` : 'unlimited'
  const changed = choice !== initial.choice || (choice === 'custom' && custom !== initial.custom)
  const used = quota?.used ?? 0

  return (
    <li className="grid gap-2 p-3 md:grid-cols-[1fr_auto] md:items-center">
      <div className="min-w-0">
        <div className="text-sm font-medium text-slate-900">{model.display_name}</div>
        <div className="text-xs text-slate-500">
          Used {fmt(used)} this month · plan default {planText}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select value={choice} onChange={(e) => setChoice(e.target.value as LimitChoice)} className="rounded-xl border border-slate-200 bg-white px-2 py-1.5 text-sm" aria-label={`${model.display_name} limit`}>
          <option value="plan">Plan default</option>
          <option value="custom">Custom limit</option>
          <option value="unlimited">Unlimited</option>
          <option value="blocked">Blocked</option>
        </select>
        {choice === 'custom' ? (
          <input type="number" min={1} value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="per month" className="w-28 rounded-xl border border-slate-200 px-2 py-1.5 text-sm" aria-label="Custom monthly limit" />
        ) : null}
        <button
          type="button"
          onClick={() => onSave(choice, custom)}
          disabled={!changed || busy !== null || (choice === 'custom' && !(Number(custom) > 0))}
          className="inline-flex items-center gap-1 rounded-xl bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-30"
        >
          {busy === `limit-${model.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />} Save
        </button>
        <button
          type="button"
          onClick={onReset}
          disabled={!used || busy !== null}
          title="Set this month's count back to 0"
          className="inline-flex items-center gap-1 rounded-xl border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-30"
        >
          {busy === `reset-${model.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />} Reset count
        </button>
      </div>
    </li>
  )
}
