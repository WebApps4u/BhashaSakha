import { useEffect, useMemo, useState, type ComponentType } from 'react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { LayoutDashboard, Users, Sliders, ToggleLeft, ScrollText, LogOut, CreditCard, BarChart3, Bot, Boxes, Route, KeyRound } from 'lucide-react'
import { supabase } from '@/lib/supabaseClient'
import { cn } from '@/lib/utils'

type AdminMe = {
  user_id: string
  roles: Array<{ key: string; name: string }>
  permissions: string[]
}

function AdminNavLink({
  to,
  label,
  icon: Icon,
}: {
  to: string
  label: string
  icon: ComponentType<{ className?: string }>
}) {
  const location = useLocation()
  const isActive = location.pathname === to
  return (
    <Link
      to={to}
      className={cn(
        'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition',
        isActive ? 'bg-white/10 text-white' : 'text-white/80 hover:bg-white/5 hover:text-white',
      )}
    >
      <Icon className="h-4 w-4" />
      <span className="truncate">{label}</span>
    </Link>
  )
}

export default function AdminShell() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [me, setMe] = useState<AdminMe | null>(null)
  const [error, setError] = useState<string | null>(null)

  const canAccess = useMemo(() => (me?.roles ?? []).some((r) => r.key === 'admin' || r.key === 'super_admin'), [me])

  useEffect(() => {
    let mounted = true
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const { data } = await supabase.auth.getSession()
        const token = data.session?.access_token ?? ''
        if (!token) {
          navigate('/login')
          return
        }

        const resp = await fetch('/api/admin/me', {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
        })
        const json = (await resp.json().catch(() => ({}))) as any
        if (!resp.ok || !json.success) {
          if (!mounted) return
          setMe(null)
          setError(json.error ?? 'Admin access check failed')
          setLoading(false)
          return
        }

        if (!mounted) return
        setMe({ user_id: json.user_id, roles: json.roles ?? [], permissions: json.permissions ?? [] })
        setLoading(false)
      } catch (err) {
        if (!mounted) return
        setError(err instanceof Error ? err.message : 'Admin access check failed')
        setLoading(false)
      }
    }

    void load()
    return () => {
      mounted = false
    }
  }, [navigate])

  if (loading) {
    return <div className="h-48 animate-pulse rounded-2xl bg-slate-100 dark:bg-white/10" />
  }

  if (!canAccess) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-white/5">
          <div className="text-sm font-semibold text-slate-900 dark:text-slate-50">Access denied</div>
          <div className="mt-2 text-sm text-slate-600 dark:text-slate-300">
            {error ?? 'Your account does not have admin privileges.'}
          </div>
          <div className="mt-4 flex items-center gap-3">
            <Link to="/live" className="text-sm font-medium text-slate-900 underline dark:text-slate-50">
              Back to app
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <div className="flex min-h-screen">
        <aside className="w-72 bg-slate-900 text-white">
          <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
            <Link to="/admin" className="flex items-center gap-2">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-white text-slate-900">A</span>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">Admin</div>
                <div className="truncate text-xs text-white/60">BhashaSakha</div>
              </div>
            </Link>
            <button
              type="button"
              onClick={async () => {
                await supabase.auth.signOut()
                navigate('/login')
              }}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-white/5 text-white/80 transition hover:bg-white/10 hover:text-white"
              aria-label="Sign out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>

          <div className="px-4 py-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-white/50">Management</div>
            <div className="mt-3 space-y-1">
              <AdminNavLink to="/admin" label="Overview" icon={LayoutDashboard} />
              <AdminNavLink to="/admin/users" label="Users" icon={Users} />
              <AdminNavLink to="/admin/plans" label="Plans" icon={CreditCard} />
              <AdminNavLink to="/admin/usage" label="Usage" icon={BarChart3} />
              <div className="pt-2 text-[11px] font-semibold uppercase tracking-wide text-white/50">AI model layer</div>
              <AdminNavLink to="/admin/ai/providers" label="Providers & keys" icon={KeyRound} />
              <AdminNavLink to="/admin/ai/models" label="Models" icon={Boxes} />
              <AdminNavLink to="/admin/ai/routing" label="Routing" icon={Route} />
              <AdminNavLink to="/admin/ai/entitlements" label="Entitlements" icon={Bot} />
              <AdminNavLink to="/admin/settings" label="App settings" icon={Sliders} />
              <AdminNavLink to="/admin/flags" label="Feature toggles" icon={ToggleLeft} />
              <AdminNavLink to="/admin/logs" label="Audit logs" icon={ScrollText} />
            </div>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
            <div>
              <div className="text-sm font-semibold">Admin Dashboard</div>
              <div className="mt-0.5 text-xs text-slate-500">Role: {(me?.roles ?? []).map((r) => r.name).join(', ')}</div>
            </div>
            <Link to="/live" className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 transition hover:bg-slate-50">
              Open app
            </Link>
          </header>

          <main className="min-w-0 flex-1 p-6">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  )
}
