import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { Save, Search, Shield, UserX, UserCheck } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useGlobalLoading } from '@/hooks/useGlobalLoading'

type AdminUser = {
  id: string
  email: string | null
  created_at: string
  last_sign_in_at: string | null
  display_name: string
  is_blocked: boolean
  roles: string[]
  plan_code?: string
}

type PlanRow = {
  code: string
  name: string
  is_active: boolean
}

export default function AdminUsers() {
  const { wrapFn } = useGlobalLoading()
  const [loading, setLoading] = useState(true)
  const [busyIds, setBusyIds] = useState<Record<string, true>>({})
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [users, setUsers] = useState<AdminUser[]>([])
  const [plans, setPlans] = useState<PlanRow[]>([])
  const [planDraftByUserId, setPlanDraftByUserId] = useState<Record<string, string>>({})

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return users
    return users.filter((u) => {
      const hay = `${u.email ?? ''} ${u.display_name ?? ''} ${u.id}`.toLowerCase()
      return hay.includes(q)
    })
  }, [query, users])

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

    const [resp, plansResp] = await Promise.all([
      fetch('/api/admin/users?per_page=100', { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }),
      fetch('/api/admin/subscriptions/plans', { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }),
    ])
    const json = (await resp.json().catch(() => ({}))) as any
    const plansJson = (await plansResp.json().catch(() => ({}))) as any
    if (!resp.ok || !json.success) {
      setError(json.error ?? 'Failed to load users')
      setLoading(false)
      return
    }
    if (plansResp.ok && plansJson.success) {
      setPlans((plansJson.plans ?? []) as PlanRow[])
    }
    const nextUsers = (json.users ?? []) as AdminUser[]
    setUsers(nextUsers)
    setPlanDraftByUserId((prev) => {
      const copy = { ...prev }
      for (const u of nextUsers) {
        if (!copy[u.id]) copy[u.id] = (u.plan_code ?? 'free') as string
      }
      return copy
    })
    setLoading(false)
  }, [])

  useEffect(() => {
    void wrapFn(load)
  }, [load, wrapFn])

  const setBusy = (id: string, next: boolean) => {
    setBusyIds((prev) => {
      const copy = { ...prev }
      if (next) copy[id] = true
      else delete copy[id]
      return copy
    })
  }

  const updateBlock = async (userId: string, blocked: boolean) => {
    setBusy(userId, true)
    setError(null)
    try {
      await wrapFn(async () => {
        const { data } = await supabase.auth.getSession()
        const token = data.session?.access_token ?? ''
        const resp = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/block`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ blocked }),
        })
        const json = (await resp.json().catch(() => ({}))) as any
        if (!resp.ok || !json.success) throw new Error(json.error ?? 'Failed to update')
        setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, is_blocked: blocked } : u)))
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update')
    } finally {
      setBusy(userId, false)
    }
  }

  const toggleAdminRole = async (userId: string, makeAdmin: boolean) => {
    setBusy(userId, true)
    setError(null)
    try {
      await wrapFn(async () => {
        const { data } = await supabase.auth.getSession()
        const token = data.session?.access_token ?? ''
        const user = users.find((u) => u.id === userId)
        const current = user?.roles ?? []
        const next = makeAdmin ? Array.from(new Set([...current, 'admin'])) : current.filter((r) => r !== 'admin')

        const resp = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/roles`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ roles: next }),
        })
        const json = (await resp.json().catch(() => ({}))) as any
        if (!resp.ok || !json.success) throw new Error(json.error ?? 'Failed to update roles')
        setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, roles: next } : u)))
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update roles')
    } finally {
      setBusy(userId, false)
    }
  }

  const setUserPlan = async (userId: string, planCode: string) => {
    setBusy(userId, true)
    setError(null)
    try {
      await wrapFn(async () => {
        const { data } = await supabase.auth.getSession()
        const token = data.session?.access_token ?? ''
        const effective_from = new Date().toISOString().slice(0, 10)
        const resp = await fetch(`/api/admin/subscriptions/users/${encodeURIComponent(userId)}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ plan_code: planCode, effective_from, reset_current_month: true }),
        })
        const json = (await resp.json().catch(() => ({}))) as any
        if (!resp.ok || !json.success) throw new Error(json.error ?? 'Failed to set plan')
        setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, plan_code: planCode } : u)))
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to set plan')
    } finally {
      setBusy(userId, false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-lg font-semibold">Users</h1>
          <div className="mt-1 text-sm text-slate-600">Block/unblock users and assign admin role.</div>
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
        <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
          <Search className="h-4 w-4 text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by email, name, or id"
            className="w-full bg-transparent text-sm text-slate-900 outline-none"
          />
        </div>

        {error ? <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</div> : null}

        {loading ? (
          <div className="mt-4 space-y-2">
            <div className="h-10 animate-pulse rounded-xl bg-slate-100" />
            <div className="h-10 animate-pulse rounded-xl bg-slate-100" />
            <div className="h-10 animate-pulse rounded-xl bg-slate-100" />
          </div>
        ) : (
          <div className="mt-4 overflow-hidden rounded-xl border border-slate-200">
            <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-3 bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-600">
              <div>User</div>
              <div>Roles</div>
              <div>Plan</div>
              <div>Status</div>
              <div className="text-right">Actions</div>
            </div>
            <div className="divide-y divide-slate-200">
              {filtered.map((u) => {
                const busy = !!busyIds[u.id]
                const isAdmin = u.roles.includes('admin') || u.roles.includes('super_admin')
                return (
                  <div key={u.id} className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-slate-900">{u.email ?? u.id}</div>
                      <div className="mt-0.5 truncate text-xs text-slate-500">{u.display_name || u.id}</div>
                    </div>

                    <div className="flex items-center gap-2">
                      <div
                        className={cn(
                          'inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs',
                          isAdmin ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-100 text-slate-600',
                        )}
                      >
                        <Shield className="h-3.5 w-3.5" />
                        {isAdmin ? 'admin' : 'user'}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <select
                        value={planDraftByUserId[u.id] ?? (u.plan_code ?? 'free')}
                        disabled={busy}
                        onChange={(e) => setPlanDraftByUserId((p) => ({ ...p, [u.id]: e.target.value }))}
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 disabled:opacity-50"
                      >
                        {plans
                          .filter((p) => p.is_active)
                          .map((p) => (
                            <option key={p.code} value={p.code}>
                              {p.name} ({p.code})
                            </option>
                          ))}
                      </select>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void setUserPlan(u.id, planDraftByUserId[u.id] ?? (u.plan_code ?? 'free'))}
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                      >
                        <span className="inline-flex items-center gap-2">
                          <Save className="h-4 w-4" />
                          Set
                        </span>
                      </button>
                    </div>

                    <div className="flex items-center">
                      <div
                        className={cn(
                          'inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs',
                          u.is_blocked ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700',
                        )}
                      >
                        {u.is_blocked ? <UserX className="h-3.5 w-3.5" /> : <UserCheck className="h-3.5 w-3.5" />}
                        {u.is_blocked ? 'blocked' : 'active'}
                      </div>
                    </div>

                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void toggleAdminRole(u.id, !isAdmin)}
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                      >
                        {isAdmin ? 'Remove admin' : 'Make admin'}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void updateBlock(u.id, !u.is_blocked)}
                        className={cn(
                          'rounded-xl px-3 py-2 text-sm font-medium transition disabled:opacity-50',
                          u.is_blocked ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'bg-rose-600 text-white hover:bg-rose-700',
                        )}
                      >
                        {u.is_blocked ? 'Unblock' : 'Block'}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
