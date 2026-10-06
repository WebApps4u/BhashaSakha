import { Link, Outlet, useLocation, useMatch, useNavigate } from 'react-router-dom'
import { ChevronDown, Moon, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/store/authStore'
import { useTheme } from '@/hooks/useTheme'
import { useTranslation } from 'react-i18next'
import { useLoadingStore } from '@/store/loadingStore'
import { DEFAULT_LIVE_PATH, LIVE_SECTIONS, getLiveSection, liveSectionPath } from '@/lib/liveSections'

function NavLink({ to, label }: { to: string; label: string }) {
  const location = useLocation()
  const isActive = location.pathname === to

  return (
    <Link
      to={to}
      aria-current={isActive ? 'page' : undefined}
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
  const liveMatch = useMatch('/live/:category')
  const liveSection = location.pathname.startsWith('/interview') ? getLiveSection('interview') : getLiveSection(liveMatch?.params.category)
  const liveHref = liveSection ? liveSectionPath(liveSection.id) : DEFAULT_LIVE_PATH
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
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-6 gap-y-3">
            <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:gap-4">
              <Link to={liveHref} className="text-xl font-bold uppercase tracking-widest text-black dark:text-white">
                BhashaSakha
              </Link>
              {liveSection ? (
                <div className="relative">
                  <select
                    aria-label="Live section"
                    value={liveSection.id}
                    onChange={(e) => {
                      const next = getLiveSection(e.target.value)
                      if (next && next.id !== liveSection.id) navigate(liveSectionPath(next.id))
                    }}
                    className="appearance-none border border-neutral-200 bg-white py-2 pl-3 pr-8 text-[10px] font-semibold uppercase tracking-widest text-neutral-600 outline-none transition-colors hover:border-neutral-400 focus-visible:ring-2 focus-visible:ring-neutral-500 dark:border-neutral-800 dark:bg-black dark:text-neutral-300"
                  >
                    {LIVE_SECTIONS.map((section) => (
                      <option key={section.id} value={section.id}>{section.label}</option>
                    ))}
                  </select>
                  <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-neutral-500" />
                </div>
              ) : null}
            </div>
            <div className="hidden items-center gap-6 sm:flex sm:basis-full xl:basis-auto">
              <NavLink to={liveHref} label={t('nav.live')} />
              {user ? <NavLink to="/dashboard" label={t('nav.dashboard')} /> : null}
              {user ? <NavLink to="/usage" label="Usage" /> : null}
              {user ? <NavLink to="/models" label="Models" /> : null}
              {user ? <NavLink to="/account" label={t('nav.account')} /> : null}
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
