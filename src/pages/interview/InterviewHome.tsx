import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, Plus, Trash2 } from 'lucide-react'
import { useAuthStore } from '@/store/authStore'
import { cn } from '@/lib/utils'
import { interviewApi } from '@/lib/interview/api'
import { labelOf, MODE_OPTIONS, TYPE_OPTIONS } from '@/lib/interview/options'
import type { SessionListItem } from '@/lib/interview/types'
import { ErrorNote, SectionLabel } from '@/components/interview/ui'

type Quota = { enabled: boolean; remaining: number | null }

const STATUS_LABEL: Record<SessionListItem['status'], string> = {
  ready: 'Not started',
  live: 'In progress',
  evaluating: 'Generating feedback',
  completed: 'Completed',
  abandoned: 'No answers',
}

export default function InterviewHome() {
  const navigate = useNavigate()
  const { user, isReady } = useAuthStore()
  const userId = user?.id ?? null
  const [sessions, setSessions] = useState<SessionListItem[] | null>(null)
  const [quota, setQuota] = useState<Quota | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isReady) return
    if (!userId) {
      navigate('/login')
      return
    }
    void interviewApi<{ sessions: SessionListItem[]; quota: Quota }>('/sessions')
      .then((r) => {
        setSessions(r.sessions)
        setQuota(r.quota)
      })
      .catch((e) => setError(e.message))
  }, [isReady, userId, navigate])

  // Improvement = change in readiness vs. the previous completed interview for the same target role.
  const rows = useMemo(() => {
    const list = sessions ?? []
    const completed = list.filter((s) => s.status === 'completed' && s.readiness != null)
    return list.map((s) => {
      if (s.status !== 'completed' || s.readiness == null) return { s, delta: null as number | null }
      const prev = completed.find((p) => p.created_at < s.created_at && p.config.target_role.toLowerCase() === s.config.target_role.toLowerCase())
      return { s, delta: prev ? s.readiness - prev.readiness! : null }
    })
  }, [sessions])

  const trend = useMemo(
    () =>
      (sessions ?? [])
        .filter((s) => s.status === 'completed' && s.readiness != null)
        .slice(0, 10)
        .reverse(),
    [sessions],
  )

  const remove = async (id: string) => {
    if (!window.confirm('Delete this interview and its feedback? This cannot be undone.')) return
    try {
      await interviewApi(`/sessions/${id}`, { method: 'DELETE' })
      setSessions((prev) => (prev ?? []).filter((s) => s.id !== id))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete')
    }
  }

  const openHref = (s: SessionListItem) => (s.status === 'ready' || s.status === 'live' ? `/interview/${s.id}/room` : `/interview/${s.id}/report`)

  return (
    <div className="space-y-12">
      <div className="flex flex-col gap-6 border-b border-neutral-200 pb-6 dark:border-neutral-800 md:flex-row md:items-end md:justify-between">
        <div className="max-w-2xl">
          <h1 className="text-3xl font-light tracking-tight text-black dark:text-white">Interview simulator</h1>
          <p className="mt-3 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
            Sit in front of an AI interview panel built from your resume and the job you want. Answer out loud, get cross-questioned like the real thing, and leave knowing exactly what to fix.
          </p>
          {quota ? (
            <p className="mt-3 text-xs uppercase tracking-wider text-neutral-500">
              {!quota.enabled ? 'Not included in your plan' : quota.remaining == null ? 'Unlimited interviews on your plan' : `${quota.remaining} interview${quota.remaining === 1 ? '' : 's'} left this month`}
              {quota.enabled && quota.remaining === 0 ? (
                <Link to="/usage" className="ml-2 underline underline-offset-2">
                  Upgrade
                </Link>
              ) : null}
            </p>
          ) : null}
        </div>
        <Link to="/interview/new" className="minimal-btn-primary shrink-0">
          <Plus className="mr-2 h-4 w-4" /> New mock interview
        </Link>
      </div>

      {error ? <ErrorNote>{error}</ErrorNote> : null}

      {trend.length >= 2 ? (
        <section>
          <SectionLabel>Readiness over time</SectionLabel>
          <div className="mt-4 flex h-32 items-end gap-2" role="img" aria-label={`Readiness trend: ${trend.map((s) => `${s.readiness}%`).join(', ')}`}>
            {trend.map((s) => (
              <Link key={s.id} to={`/interview/${s.id}/report`} className="group flex flex-1 flex-col items-center justify-end gap-1" title={`${s.title}: ${s.readiness}%`}>
                <span className="text-[10px] tabular-nums text-neutral-500 group-hover:text-black dark:group-hover:text-white">{s.readiness}</span>
                <span className="w-full max-w-[3rem] bg-black transition-opacity group-hover:opacity-70 dark:bg-white" style={{ height: `${Math.max(4, s.readiness ?? 0)}%` }} />
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <section>
        <SectionLabel>Interview history</SectionLabel>
        {sessions === null && !error ? <div className="mt-4 h-24 animate-pulse bg-neutral-100 dark:bg-neutral-900" /> : null}
        {sessions && sessions.length === 0 ? (
          <div className="mt-4 border border-dashed border-neutral-300 p-10 text-center dark:border-neutral-700">
            <p className="text-sm text-neutral-600 dark:text-neutral-400">No interviews yet. Your first one takes about 2 minutes to set up.</p>
            <Link to="/interview/new" className="minimal-btn-outline mt-6">
              Set up my first interview
            </Link>
          </div>
        ) : null}
        {sessions && sessions.length > 0 ? (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-neutral-200 text-[10px] uppercase tracking-wider text-neutral-500 dark:border-neutral-800">
                  <th className="py-3 pr-4 font-semibold">Date</th>
                  <th className="py-3 pr-4 font-semibold">Role</th>
                  <th className="py-3 pr-4 font-semibold">Type</th>
                  <th className="py-3 pr-4 font-semibold">Score</th>
                  <th className="py-3 pr-4 font-semibold">Change</th>
                  <th className="py-3 font-semibold">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ s, delta }) => (
                  <tr key={s.id} className="border-b border-neutral-100 dark:border-neutral-900">
                    <td className="whitespace-nowrap py-3 pr-4 text-neutral-500">{new Date(s.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</td>
                    <td className="py-3 pr-4">
                      <Link to={openHref(s)} className="font-medium hover:underline">
                        {s.title}
                      </Link>
                      <div className="text-xs text-neutral-500">{labelOf(MODE_OPTIONS, s.config.mode)}</div>
                    </td>
                    <td className="py-3 pr-4">{labelOf(TYPE_OPTIONS, s.config.interview_type)}</td>
                    <td className="py-3 pr-4 tabular-nums">{s.status === 'completed' && s.readiness != null ? `${s.readiness}%` : <span className="text-xs text-neutral-500">{STATUS_LABEL[s.status]}</span>}</td>
                    <td className={cn('py-3 pr-4 tabular-nums', delta != null && delta > 0 && 'text-emerald-600', delta != null && delta < 0 && 'text-red-600')}>
                      {delta == null ? '—' : `${delta > 0 ? '+' : ''}${delta}%`}
                    </td>
                    <td className="py-3 text-right">
                      <div className="flex items-center justify-end gap-3">
                        <Link to={openHref(s)} className="inline-flex items-center text-xs font-semibold uppercase tracking-wider hover:underline">
                          {s.status === 'ready' || s.status === 'live' ? 'Open' : 'Report'} <ArrowRight className="ml-1 h-3 w-3" />
                        </Link>
                        <button type="button" onClick={() => void remove(s.id)} aria-label={`Delete ${s.title}`} className="text-neutral-400 hover:text-red-600">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </div>
  )
}
