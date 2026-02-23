import { useEffect, useState, type ComponentType } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { Users, ToggleLeft, Sliders, ScrollText } from 'lucide-react'

type StatCardProps = {
  title: string
  value: string
  icon: ComponentType<{ className?: string }>
  subtitle: string
}

function StatCard({ title, value, icon: Icon, subtitle }: StatCardProps) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs text-slate-500">{title}</div>
          <div className="mt-2 text-2xl font-semibold tracking-tight">{value}</div>
          <div className="mt-2 text-xs text-slate-500">{subtitle}</div>
        </div>
        <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900 text-white">
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  )
}

export default function AdminHome() {
  const [stats, setStats] = useState({ users: '—', flags: '—', settings: '—', logs: '—' })

  useEffect(() => {
    let mounted = true
    const load = async () => {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token ?? ''
      if (!token) return

      const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

      const [usersResp, flagsResp, settingsResp, logsResp] = await Promise.all([
        fetch('/api/admin/users?per_page=1', { headers }).catch(() => null),
        fetch('/api/admin/flags', { headers }).catch(() => null),
        fetch('/api/admin/settings', { headers }).catch(() => null),
        fetch('/api/admin/logs', { headers }).catch(() => null),
      ])

      const next = { users: '—', flags: '—', settings: '—', logs: '—' }

      if (usersResp?.ok) {
        const json = (await usersResp.json().catch(() => ({}))) as any
        next.users = json.success ? String((json.users ?? []).length) : '—'
      }
      if (flagsResp?.ok) {
        const json = (await flagsResp.json().catch(() => ({}))) as any
        next.flags = json.success ? String((json.flags ?? []).length) : '—'
      }
      if (settingsResp?.ok) {
        const json = (await settingsResp.json().catch(() => ({}))) as any
        next.settings = json.success ? String((json.settings ?? []).length) : '—'
      }
      if (logsResp?.ok) {
        const json = (await logsResp.json().catch(() => ({}))) as any
        next.logs = json.success ? String((json.logs ?? []).length) : '—'
      }

      if (!mounted) return
      setStats(next)
    }

    void load()
    return () => {
      mounted = false
    }
  }, [])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Overview</h1>
        <div className="mt-1 text-sm text-slate-600">Manage users, configuration, and feature toggles.</div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Users" value={stats.users} icon={Users} subtitle="Loaded on demand" />
        <StatCard title="Feature toggles" value={stats.flags} icon={ToggleLeft} subtitle="Public + admin-only" />
        <StatCard title="App settings" value={stats.settings} icon={Sliders} subtitle="JSON values" />
        <StatCard title="Audit logs" value={stats.logs} icon={ScrollText} subtitle="Last 200 events" />
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="text-sm font-semibold">Getting started</div>
        <div className="mt-2 text-sm text-slate-600">
          Use the bootstrap endpoint once to assign your first admin role, then manage everything from here.
        </div>
        <div className="mt-4 rounded-xl bg-slate-50 p-4 text-xs text-slate-700">
          POST /api/admin/bootstrap (header: x-bootstrap-token)
        </div>
      </div>
    </div>
  )
}
