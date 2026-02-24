import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { LayoutDashboard, LogIn, LogOut, Mic2, Moon, Settings, Sun, Gauge, Bot } from 'lucide-react'
import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/store/authStore'
import { useTheme } from '@/hooks/useTheme'
import { useTranslation } from 'react-i18next'
import { useLoadingStore } from '@/store/loadingStore'

import type { ComponentType } from 'react'

function NavLink({ to, label, icon: Icon }: { to: string; label: string; icon: ComponentType<{ className?: string }> }) {
  const location = useLocation()
  const isActive = location.pathname === to || (to === '/live' && location.pathname === '/')

  return (
    <Link
      to={to}
      className={cn(
        'inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition',
        isActive
          ? 'bg-slate-100 text-slate-900 dark:bg-white/10 dark:text-slate-50'
          : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-white/5 dark:hover:text-slate-50'
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
    </Link>
  )
}

export default function AppShell() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const { init, isReady, user, signOut } = useAuthStore()
  const { theme, toggle } = useTheme()
  const pending = useLoadingStore((s) => s.pending)
  const [routeLoading, setRouteLoading] = useState(false)

  useEffect(() => {
    void init()
  }, [init])

  useEffect(() => {
    setRouteLoading(true)
    const t = setTimeout(() => setRouteLoading(false), 350)
    return () => clearTimeout(t)
  }, [location.pathname, location.search])

  const isFullBleed = location.pathname.startsWith('/live') || location.pathname.startsWith('/s/')

  return (
    <div className="min-h-screen bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-50">
      <div
        className={cn(
          'fixed left-0 top-0 z-50 h-0.5 w-full bg-indigo-500 transition-opacity',
          pending > 0 || routeLoading ? 'opacity-100' : 'opacity-0',
        )}
      />
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur dark:border-white/10 dark:bg-slate-950/80">
        <div className={cn('mx-auto flex items-center justify-between px-4', isFullBleed ? 'max-w-6xl py-3' : 'max-w-6xl py-3')}>
          <div className="flex items-center gap-3">
            <Link to="/live" className="inline-flex items-center gap-2 text-sm font-semibold tracking-tight">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-slate-900 text-white dark:bg-white dark:text-slate-900">B</span>
              BhashaSakha
            </Link>
            <div className="hidden items-center gap-1 sm:flex">
              <NavLink to="/live" label={t('nav.live')} icon={Mic2} />
              {user ? <NavLink to="/dashboard" label={t('nav.dashboard')} icon={LayoutDashboard} /> : null}
              {user ? <NavLink to="/usage" label="Usage" icon={Gauge} /> : null}
              {user ? <NavLink to="/models" label="Models" icon={Bot} /> : null}
              {user ? <NavLink to="/account" label={t('nav.account')} icon={Settings} /> : null}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggle}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 transition hover:bg-slate-50 dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:hover:bg-white/10"
              aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
              title={theme === 'dark' ? 'Light theme' : 'Dark theme'}
            >
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            {!isReady ? (
              <div className="h-9 w-28 animate-pulse rounded-lg bg-slate-100 dark:bg-white/10" />
            ) : user ? (
              <button
                type="button"
                onClick={async () => {
                  await signOut()
                  navigate('/live')
                }}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-50 dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:hover:bg-white/10"
              >
                <LogOut className="h-4 w-4" />
                {t('auth.signOut')}
              </button>
            ) : (
              <Link
                to="/login"
                className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100"
              >
                <LogIn className="h-4 w-4" />
                {t('auth.signIn')}
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
