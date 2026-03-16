import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabaseClient'
import { useAuthStore } from '@/store/authStore'
import { Plus, ArrowRight, Lock, Globe } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTranslation } from 'react-i18next'
import { useGlobalLoading } from '@/hooks/useGlobalLoading'

type SessionRow = {
  id: string
  title: string
  source_lang: string
  target_langs: string[]
  visibility: 'private' | 'public'
  created_at: string
  updated_at: string
}

export default function Dashboard() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { user, isReady } = useAuthStore()
  const { wrapFn } = useGlobalLoading()
  const [title, setTitle] = useState('')
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canLoad = useMemo(() => isReady && !!user, [isReady, user])

  useEffect(() => {
    if (!isReady) return
    if (!user) {
      navigate('/login')
      return
    }

    let mounted = true
    const load = async () => {
      setLoading(true)
      setError(null)
      const { data, error: err } = await supabase
        .from('sessions')
        .select('id,title,source_lang,target_langs,visibility,created_at,updated_at')
        .order('created_at', { ascending: false })
      if (!mounted) return
      if (err) {
        setError(err.message)
      } else {
        setSessions((data ?? []) as SessionRow[])
      }
      setLoading(false)
    }

    void wrapFn(load)
    return () => {
      mounted = false
    }
  }, [isReady, navigate, user, wrapFn])

  if (!canLoad) {
    return <div className="h-24 animate-pulse bg-neutral-100 dark:bg-neutral-900" />
  }

  return (
    <div className="space-y-12">
      <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between border-b border-neutral-200 pb-6 dark:border-neutral-800">
        <div>
          <h1 className="text-3xl font-light tracking-tight text-black dark:text-white">{t('dashboard.title')}</h1>
          <p className="mt-2 text-sm uppercase tracking-wider text-neutral-500 dark:text-neutral-400">{t('dashboard.subtitle')}</p>
        </div>
        <Link
          to="/live"
          className="minimal-btn-primary"
        >
          <Plus className="h-4 w-4 mr-2" />
          {t('dashboard.newLiveSession')}
        </Link>
      </div>

      <div className="grid gap-8 lg:grid-cols-3">
        {/* Quick Create Card */}
        <div className="minimal-card lg:col-span-1 h-fit">
          <div className="text-sm font-bold uppercase tracking-widest text-black dark:text-white">{t('dashboard.quickCreate')}</div>
          <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-300">{t('dashboard.quickCreateHint')}</p>

          <form
            className="mt-8 space-y-6"
            onSubmit={async (e) => {
              e.preventDefault()
              if (!user) return
              setBusy(true)
              setError(null)
              try {
                await wrapFn(async () => {
                    const { data, error: err } = await supabase
                      .from('sessions')
                      .insert({
                        owner_id: user.id,
                        title: title.trim() || 'Untitled session',
                        source_lang: 'auto',
                        target_langs: ['en'],
                        visibility: 'private',
                        started_at: new Date().toISOString(),
                      })
                      .select('id')
                      .single()
                    if (err) throw err
                    navigate(`/session/${data.id}`)
                })
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to create session')
              } finally {
                setBusy(false)
              }
            }}
          >
            <label className="block">
              <span className="text-xs font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">{t('dashboard.sessionTitleLabel')}</span>
              <input
                className="minimal-input mt-2 text-black dark:text-white"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Team meeting, demo, call…"
              />
            </label>
            {error ? (
              <div className="border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-900/10 dark:text-red-200">
                {error}
              </div>
            ) : null}
            <button
              type="submit"
              disabled={busy}
              className="minimal-btn-primary w-full justify-between group"
            >
              <span>{t('dashboard.createAndOpen')}</span>
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </button>
          </form>
        </div>

        {/* Recent Sessions List */}
        <div className="minimal-card lg:col-span-2">
          <h2 className="text-sm font-bold uppercase tracking-widest text-black dark:text-white mb-6">{t('dashboard.recentSessions')}</h2>
          
          {loading ? (
            <div className="space-y-4">
              <div className="h-12 animate-pulse bg-neutral-100 dark:bg-neutral-900" />
              <div className="h-12 animate-pulse bg-neutral-100 dark:bg-neutral-900" />
              <div className="h-12 animate-pulse bg-neutral-100 dark:bg-neutral-900" />
            </div>
          ) : sessions.length === 0 ? (
            <div className="border border-neutral-200 bg-neutral-50 px-6 py-4 text-sm text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900/30 dark:text-neutral-400">
              {t('dashboard.noSessions')}
            </div>
          ) : (
            <div className="divide-y divide-neutral-200 border-t border-b border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
              {sessions.map((s) => (
                <Link
                  key={s.id}
                  to={`/session/${s.id}`}
                  className="group flex items-center justify-between gap-4 py-4 transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-900/30"
                >
                  <div className="min-w-0">
                    <div className="truncate text-base font-medium text-black group-hover:underline dark:text-white">{s.title || 'Untitled session'}</div>
                    <div className="mt-1 flex items-center gap-3 text-xs uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                      <span>{new Date(s.updated_at).toLocaleDateString()}</span>
                      <span className="text-neutral-300 dark:text-neutral-700">|</span>
                      <span className="truncate">
                        {t('dashboard.source')}: {s.source_lang}
                      </span>
                    </div>
                  </div>
                  <div
                    className={cn(
                      'inline-flex items-center gap-2 border px-3 py-1 text-[10px] font-bold uppercase tracking-widest',
                      s.visibility === 'public'
                        ? 'border-black bg-black text-white dark:border-white dark:bg-white dark:text-black'
                        : 'border-neutral-200 text-neutral-500 dark:border-neutral-800 dark:text-neutral-400'
                    )}
                  >
                    {s.visibility === 'public' ? <Globe className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
                    {s.visibility}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
