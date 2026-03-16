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
        'group inline-flex items-center gap-2 px-1 py-1 text-xs font-semibold uppercase tracking-wider transition-all',
        isActive
          ? 'text-black dark:text-white border-b-2 border-black dark:border-white'
          : 'text-neutral-500 hover:text-black dark:text-neutral-400 dark:hover:text-white border-b-2 border-transparent'
      )}
    >
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
    <div className="min-h-screen bg-white text-black dark:bg-black dark:text-white">
      <div
        className={cn(
          'fixed left-0 top-0 z-50 h-0.5 w-full bg-black transition-opacity dark:bg-white',
          pending > 0 || routeLoading ? 'opacity-100' : 'opacity-0',
        )}
      />
      <header className="sticky top-0 z-40 border-b border-neutral-200 bg-white/80 backdrop-blur-md dark:border-neutral-800 dark:bg-black/80">
        <div className={cn('mx-auto flex items-center justify-between px-6', isFullBleed ? 'max-w-[1400px] py-4' : 'max-w-6xl py-4')}>
          <div className="flex items-center gap-8">
            <Link to="/live" className="text-xl font-bold uppercase tracking-widest text-black dark:text-white">
              BhashaSakha
            </Link>
            <div className="hidden items-center gap-6 sm:flex">
              <NavLink to="/live" label={t('nav.live')} icon={Mic2} />
              {user ? <NavLink to="/dashboard" label={t('nav.dashboard')} icon={LayoutDashboard} /> : null}
              {user ? <NavLink to="/usage" label="Usage" icon={Gauge} /> : null}
              {user ? <NavLink to="/models" label="Models" icon={Bot} /> : null}
              {user ? <NavLink to="/account" label={t('nav.account')} icon={Settings} /> : null}
            </div>
          </div>

          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={toggle}
              className="inline-flex h-9 w-9 items-center justify-center text-neutral-500 transition hover:text-black dark:text-neutral-400 dark:hover:text-white"
              aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
              title={theme === 'dark' ? 'Light theme' : 'Dark theme'}
            >
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            {!isReady ? (
              <div className="h-9 w-24 animate-pulse bg-neutral-100 dark:bg-neutral-900" />
            ) : user ? (
              <button
                type="button"
                onClick={async () => {
                  await signOut()
                  navigate('/live')
                }}
                className="text-xs font-semibold uppercase tracking-wider text-neutral-500 hover:text-black dark:text-neutral-400 dark:hover:text-white"
              >
                {t('auth.signOut')}
              </button>
            ) : (
              <Link
                to="/login"
                className="text-xs font-bold uppercase tracking-widest text-black hover:underline dark:text-white"
              >
                {t('auth.signIn')}
              </Link>
            )}
          </div>
        </div>
      </header>

      <main className={cn(isFullBleed ? 'px-0 py-0' : 'mx-auto max-w-6xl px-4 py-12')}>
        <Outlet />
      </main>
    </div>
  )
}
