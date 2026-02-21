import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { LayoutDashboard, LogIn, LogOut, Mic2, Settings } from 'lucide-react'
import { useEffect } from 'react'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/store/authStore'

import type { ComponentType } from 'react'

function NavLink({ to, label, icon: Icon }: { to: string; label: string; icon: ComponentType<{ className?: string }> }) {
  const location = useLocation()
  const isActive = location.pathname === to || (to === '/live' && location.pathname === '/')

  return (
    <Link
      to={to}
      className={cn(
        'inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition',
        isActive ? 'bg-slate-100 text-slate-900' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
    </Link>
  )
}

export default function AppShell() {
  const navigate = useNavigate()
  const location = useLocation()
  const { init, isReady, user, signOut } = useAuthStore()

  useEffect(() => {
    void init()
  }, [init])

  const isFullBleed = location.pathname.startsWith('/live') || location.pathname.startsWith('/s/')

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur">
        <div className={cn('mx-auto flex items-center justify-between px-4', isFullBleed ? 'max-w-6xl py-3' : 'max-w-6xl py-3')}>
          <div className="flex items-center gap-3">
            <Link to="/live" className="inline-flex items-center gap-2 text-sm font-semibold tracking-tight">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-slate-900 text-white">B</span>
              BhashaSakha
            </Link>
            <div className="hidden items-center gap-1 sm:flex">
              <NavLink to="/live" label="Live" icon={Mic2} />
              {user ? <NavLink to="/dashboard" label="Dashboard" icon={LayoutDashboard} /> : null}
              {user ? <NavLink to="/account" label="Account" icon={Settings} /> : null}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {!isReady ? (
              <div className="h-9 w-28 animate-pulse rounded-lg bg-slate-100" />
            ) : user ? (
              <button
                type="button"
                onClick={async () => {
                  await signOut()
                  navigate('/live')
                }}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-50"
              >
                <LogOut className="h-4 w-4" />
                Sign out
              </button>
            ) : (
              <Link
                to="/login"
                className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
              >
                <LogIn className="h-4 w-4" />
                Sign in
              </Link>
            )}
          </div>
        </div>
      </header>

      <main className={cn(isFullBleed ? 'px-0 py-0' : 'mx-auto max-w-6xl px-4 py-6')}>
        <Outlet />
      </main>
    </div>
  )
}
