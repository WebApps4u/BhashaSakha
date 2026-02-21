import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabaseClient'
import { useAuthStore } from '@/store/authStore'
import { Plus, ArrowRight, Lock, Globe } from 'lucide-react'
import { cn } from '@/lib/utils'

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
  const navigate = useNavigate()
  const { user, isReady } = useAuthStore()
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

    void load()
    return () => {
      mounted = false
    }
  }, [isReady, navigate, user])

  if (!canLoad) {
    return <div className="h-24 animate-pulse rounded-2xl bg-slate-100 dark:bg-white/10" />
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Your saved live sessions.</p>
        </div>
        <Link
          to="/live"
          className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100"
        >
          <Plus className="h-4 w-4" />
          New live session
        </Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm lg:col-span-1 dark:border-white/10 dark:bg-white/5">
          <div className="text-sm font-semibold">Quick create</div>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Creates a private session owned by your account.</p>

          <form
            className="mt-4 space-y-3"
            onSubmit={async (e) => {
              e.preventDefault()
              if (!user) return
              setBusy(true)
              setError(null)
              try {
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
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to create session')
              } finally {
                setBusy(false)
              }
            }}
          >
            <label className="block">
              <span className="text-xs text-slate-600 dark:text-slate-300">Title</span>
              <input
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-300 dark:border-white/10 dark:bg-white/5 dark:text-slate-50"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Team meeting, demo, call…"
              />
            </label>
            {error ? (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-100">
                {error}
              </div>
            ) : null}
            <button
              type="submit"
              disabled={busy}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-50 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100"
            >
              <span>Create & open</span>
              <ArrowRight className="h-4 w-4" />
            </button>
          </form>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm lg:col-span-2 dark:border-white/10 dark:bg-white/5">
          <h2 className="text-sm font-semibold">Recent sessions</h2>
          <div className="mt-3">
            {loading ? (
              <div className="space-y-2">
                <div className="h-10 animate-pulse rounded-xl bg-slate-100 dark:bg-white/10" />
                <div className="h-10 animate-pulse rounded-xl bg-slate-100 dark:bg-white/10" />
                <div className="h-10 animate-pulse rounded-xl bg-slate-100 dark:bg-white/10" />
              </div>
            ) : sessions.length === 0 ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-300">
                No sessions yet.
              </div>
            ) : (
              <div className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 dark:divide-white/10 dark:border-white/10">
                {sessions.map((s) => (
                  <Link
                    key={s.id}
                    to={`/session/${s.id}`}
                    className="flex items-center justify-between gap-3 bg-white px-4 py-3 text-sm transition hover:bg-slate-50 dark:bg-transparent dark:hover:bg-white/5"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium text-slate-900 dark:text-slate-50">{s.title || 'Untitled session'}</div>
                      <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-300">
                        <span>{new Date(s.updated_at).toLocaleString()}</span>
                        <span className="text-slate-300 dark:text-white/20">•</span>
                        <span className="truncate">source: {s.source_lang}</span>
                      </div>
                    </div>
                    <div
                      className={cn(
                        'inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs',
                        s.visibility === 'public'
                          ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200'
                          : 'bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-200'
                      )}
                    >
                      {s.visibility === 'public' ? <Globe className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
                      {s.visibility}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
