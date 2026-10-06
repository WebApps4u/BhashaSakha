import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AlertTriangle, ArrowRight, Check, ChevronDown, Keyboard, Loader2, Mic, Play, RotateCcw } from 'lucide-react'
import { useAuthStore } from '@/store/authStore'
import { cn } from '@/lib/utils'
import { interviewApi } from '@/lib/interview/api'
import { labelOf, MISTAKE_LABELS, MODE_OPTIONS, TYPE_OPTIONS } from '@/lib/interview/options'
import type { InterviewProfile, InterviewSession, QuestionFeedback, Turn } from '@/lib/interview/types'
import { useInterviewVoice } from '@/hooks/useInterviewVoice'
import { Chip, ErrorNote, PanelistRow, ScoreBar, SectionLabel } from '@/components/interview/ui'

type Detail = { session: InterviewSession; turns: Turn[]; feedback: QuestionFeedback[]; profile: (Pick<InterviewProfile, 'id' | 'target_title' | 'company_name'> & { analysis: InterviewProfile['analysis_json'] }) | null }
type Tab = 'overview' | 'questions' | 'transcript' | 'plan'

const CATEGORY_ROWS: Array<[keyof NonNullable<InterviewSession['scores']>['categories'], string]> = [
  ['technical', 'Technical'],
  ['communication', 'Communication'],
  ['behavioral', 'Behavioral'],
  ['role_alignment', 'Role alignment'],
  ['delivery', 'Confidence & delivery'],
]

const DIMENSION_LABELS: Record<string, string> = {
  communication: 'Communication',
  relevance: 'Answer relevance',
  structure: 'Answer structure',
  technical: 'Technical knowledge',
  problem_solving: 'Problem solving',
  confidence: 'Confidence',
  clarity: 'Clarity',
  specificity: 'Specificity',
  leadership: 'Leadership',
  domain: 'Domain knowledge',
  role_alignment: 'Role alignment',
  star_usage: 'STAR usage',
}

const readinessLabel = (v: number) => (v >= 80 ? 'Interview-ready' : v >= 65 ? 'Nearly ready' : v >= 50 ? 'Needs practice' : 'Not ready yet')

export default function InterviewReport() {
  const { sessionId = '' } = useParams()
  const navigate = useNavigate()
  const { user, isReady } = useAuthStore()
  const [detail, setDetail] = useState<Detail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [evalProgress, setEvalProgress] = useState<{ evaluated: number; total: number } | null>(null)
  const [tab, setTab] = useState<Tab>('overview')
  const [openQ, setOpenQ] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const evaluating = useRef(false)

  const load = useCallback(async () => {
    const r = await interviewApi<Detail>(`/sessions/${sessionId}`)
    setDetail(r)
    return r
  }, [sessionId])

  const runEvaluation = useCallback(async () => {
    if (evaluating.current) return
    evaluating.current = true
    setError(null)
    try {
      for (let attempt = 0; attempt < 12; attempt++) {
        const r = await interviewApi<{ status: string; evaluated?: number; total?: number }>(`/sessions/${sessionId}/evaluate`, { body: {} })
        if (r.status === 'completed') break
        if (typeof r.total === 'number') setEvalProgress({ evaluated: r.evaluated ?? 0, total: r.total })
      }
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Feedback could not be generated')
    } finally {
      evaluating.current = false
    }
  }, [load, sessionId])

  useEffect(() => {
    if (isReady && !user) navigate('/login')
  }, [isReady, user, navigate])

  useEffect(() => {
    if (!user) return
    void load()
      .then((r) => {
        if (r.session.status === 'evaluating') void runEvaluation()
      })
      .catch((e) => setError(e.message))
  }, [user, load, runEvaluation])

  const endAndEvaluate = async () => {
    setBusy(true)
    try {
      await interviewApi(`/sessions/${sessionId}/end`, { body: {} })
      const r = await load()
      if (r.session.status === 'evaluating') await runEvaluation()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not end the interview')
    } finally {
      setBusy(false)
    }
  }

  const practiceAgain = async (type?: string) => {
    if (!detail?.session.profile_id) return
    setBusy(true)
    try {
      const config = { ...detail.session.config, ...(type ? { interview_type: type } : {}) }
      const r = await interviewApi<{ session: { id: string } }>('/sessions', {
        body: { profile_id: detail.session.profile_id, config, parent_session_id: detail.session.id },
      })
      navigate(`/interview/${r.session.id}/room`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start a new interview')
      setBusy(false)
    }
  }

  if (!detail) {
    return error ? <ErrorNote>{error}</ErrorNote> : <div className="h-40 animate-pulse bg-neutral-100 dark:bg-neutral-900" />
  }

  const { session, turns, feedback } = detail

  if (session.status !== 'completed') {
    return (
      <div className="mx-auto max-w-xl py-16 text-center">
        {session.status === 'evaluating' ? (
          <>
            {!error ? <Loader2 className="mx-auto h-6 w-6 animate-spin" /> : null}
            <h1 className="mt-6 text-2xl font-light">Reviewing your interview</h1>
            <p className="mt-2 text-sm text-neutral-500" aria-live="polite">
              {evalProgress ? `Evaluated ${evalProgress.evaluated} of ${evalProgress.total} questions…` : 'Checking every answer against what you actually said. This takes about a minute.'}
            </p>
            {error ? (
              <div className="mt-6 space-y-4">
                <ErrorNote>{error}</ErrorNote>
                <button type="button" className="minimal-btn-primary" onClick={() => void runEvaluation()}>
                  Try again
                </button>
              </div>
            ) : null}
          </>
        ) : session.status === 'abandoned' ? (
          <>
            <h1 className="text-2xl font-light">No answers were recorded</h1>
            <p className="mt-2 text-sm text-neutral-500">This interview ended before any answers were given, so there's nothing to evaluate.</p>
            <Link to="/interview/new" className="minimal-btn-primary mt-8">
              Start a new interview
            </Link>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-light">This interview is still open</h1>
            <p className="mt-2 text-sm text-neutral-500">Rejoin to continue, or end it now to get feedback on what you've answered.</p>
            {error ? <div className="mt-4"><ErrorNote>{error}</ErrorNote></div> : null}
            <div className="mt-8 flex justify-center gap-3">
              <Link to={`/interview/${session.id}/room`} className="minimal-btn-outline">
                {session.status === 'ready' ? 'Enter room' : 'Rejoin'}
              </Link>
              {session.status === 'live' ? (
                <button type="button" className="minimal-btn-primary" disabled={busy} onClick={() => void endAndEvaluate()}>
                  End & get feedback
                </button>
              ) : null}
            </div>
          </>
        )}
      </div>
    )
  }

  const report = session.report
  const scores = session.scores
  const readiness = session.readiness
  const openQuestion = (q: number) => {
    setTab('questions')
    setOpenQ(q)
    window.setTimeout(() => document.getElementById(`q-${q}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }

  return (
    <div className="space-y-10">
      <header className="flex flex-col gap-6 border-b border-neutral-200 pb-6 dark:border-neutral-800 md:flex-row md:items-end md:justify-between">
        <div>
          <Link to="/interview" className="text-[10px] font-bold uppercase tracking-[0.2em] text-neutral-500 hover:text-black dark:hover:text-white">
            ← Interviews
          </Link>
          <h1 className="mt-3 text-3xl font-light tracking-tight">{session.title}</h1>
          <p className="mt-2 text-sm text-neutral-500">
            {new Date(session.started_at ?? session.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })} ·{' '}
            {labelOf(TYPE_OPTIONS, session.config.interview_type)} · {labelOf(MODE_OPTIONS, session.config.mode)} · {session.config.duration_min} min
          </p>
        </div>
        <button type="button" className="minimal-btn-primary disabled:opacity-50" disabled={busy || !session.profile_id} onClick={() => void practiceAgain()}>
          <RotateCcw className="mr-2 h-4 w-4" /> Practice again
        </button>
      </header>

      {error ? <ErrorNote>{error}</ErrorNote> : null}

      <nav className="flex gap-6 border-b border-neutral-200 dark:border-neutral-800" role="tablist" aria-label="Report sections">
        {(
          [
            ['overview', 'Overview'],
            ['questions', `Questions (${feedback.length})`],
            ['transcript', 'Transcript'],
            ['plan', 'Improvement plan'],
          ] as Array<[Tab, string]>
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={cn(
              '-mb-px border-b-2 pb-3 text-xs font-semibold uppercase tracking-wider transition-colors',
              tab === id ? 'border-black text-black dark:border-white dark:text-white' : 'border-transparent text-neutral-500 hover:text-black dark:hover:text-white',
            )}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === 'overview' && report && scores ? (
        <div className="space-y-12">
          <div className="grid gap-10 lg:grid-cols-[1fr_1.3fr]">
            <div>
              <SectionLabel>Interview readiness</SectionLabel>
              <div className="mt-3 flex items-baseline gap-3">
                <span className="text-6xl font-light tabular-nums">{readiness ?? '—'}</span>
                {readiness != null ? <span className="text-2xl font-light text-neutral-400">%</span> : null}
              </div>
              {readiness != null ? <div className="mt-1 text-sm font-medium">{readinessLabel(readiness)}</div> : null}
              {scores.low_confidence ? (
                <p className="mt-3 text-xs text-amber-700 dark:text-amber-300">Based on only {feedback.length} answered question{feedback.length === 1 ? '' : 's'}. A longer interview gives a more reliable score.</p>
              ) : null}
              <div className="mt-8 space-y-4">
                {CATEGORY_ROWS.map(([key, label]) => (
                  <ScoreBar key={key} label={label} value={scores.categories[key]} hint={scores.categories[key] == null ? 'Not assessed in this interview' : undefined} />
                ))}
              </div>
            </div>
            <div className="space-y-8">
              {report.biggest_risk ? (
                <div className="bg-black p-6 text-white dark:bg-white dark:text-black">
                  <div className="text-[10px] font-bold uppercase tracking-[0.2em] opacity-70">Your biggest risk before the real interview</div>
                  <p className="mt-2 text-lg leading-snug">{report.biggest_risk}</p>
                  <button type="button" onClick={() => setTab('plan')} className="mt-4 inline-flex items-center text-xs font-semibold uppercase tracking-wider underline underline-offset-4">
                    See your action plan <ArrowRight className="ml-1 h-3 w-3" />
                  </button>
                </div>
              ) : null}
              {report.overall_summary ? <p className="text-sm leading-relaxed text-neutral-700 dark:text-neutral-300">{report.overall_summary}</p> : null}
              <DeliveryStats turns={turns} />
            </div>
          </div>

          <div className="grid gap-8 md:grid-cols-3">
            <AreaList title="Strong areas" tone="good" areas={report.strong_areas} onQuestion={openQuestion} />
            <AreaList title="Weak areas" tone="warn" areas={report.weak_areas} onQuestion={openQuestion} />
            <AreaList title="Critical to improve" tone="bad" areas={report.critical_areas} onQuestion={openQuestion} empty="Nothing critical — good." />
          </div>

          {report.communication_analysis ? (
            <div>
              <SectionLabel>Communication</SectionLabel>
              <p className="mt-3 max-w-3xl text-sm leading-relaxed text-neutral-700 dark:text-neutral-300">{report.communication_analysis}</p>
            </div>
          ) : null}

          <details className="group border-t border-neutral-200 pt-6 dark:border-neutral-800">
            <summary className="flex cursor-pointer list-none items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-neutral-500">
              <ChevronDown className="h-3 w-3 transition-transform group-open:rotate-180" /> All dimensions & how scores are calculated
            </summary>
            <div className="mt-6 grid gap-x-10 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
              {Object.entries(DIMENSION_LABELS).map(([key, label]) => (
                <ScoreBar key={key} label={label} value={scores.dimensions[key]} />
              ))}
            </div>
            <p className="mt-6 max-w-3xl text-xs leading-relaxed text-neutral-500">
              Each answer is scored only on dimensions it actually shows, and every strength or mistake must quote what you said. Findings that couldn't be matched to your words are discarded. Pace, pauses
              and filler words are measured from timing, not judged by AI. Readiness is a weighted average of the category scores, with weights set by the interview type.
            </p>
          </details>
        </div>
      ) : null}

      {tab === 'questions' ? (
        <div className="space-y-4">
          {feedback.length === 0 ? <p className="text-sm text-neutral-500">No questions were evaluated.</p> : null}
          {feedback.map((f) => (
            <QuestionCard key={f.thread_id} f={f} turns={turns} session={session} open={openQ === f.q_number} onToggle={() => setOpenQ(openQ === f.q_number ? null : f.q_number)} />
          ))}
        </div>
      ) : null}

      {tab === 'transcript' ? <Transcript session={session} turns={turns} /> : null}

      {tab === 'plan' && report ? (
        <div className="grid gap-12 lg:grid-cols-[1.4fr_1fr]">
          <div>
            <SectionLabel>What to practise next</SectionLabel>
            <ol className="mt-4 space-y-6">
              {report.action_plan.map((a, i) => (
                <li key={a.title} className="flex gap-4">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center bg-black text-xs font-bold text-white dark:bg-white dark:text-black">{i + 1}</span>
                  <div>
                    <div className="font-medium">{a.title}</div>
                    {a.why ? <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">{a.why}</p> : null}
                    {a.how ? <p className="mt-1 text-sm text-neutral-700 dark:text-neutral-300">{a.how}</p> : null}
                  </div>
                </li>
              ))}
            </ol>
          </div>
          <aside className="space-y-8">
            <div className="border border-neutral-200 p-6 dark:border-neutral-800">
              <SectionLabel>Practise your weak areas</SectionLabel>
              <p className="mt-2 text-sm text-neutral-500">Start a focused interview with the same profile and panel. Then compare your readiness.</p>
              <div className="mt-4 space-y-2">
                {Array.from(new Set(report.action_plan.map((a) => a.practice_type))).map((type) => (
                  <button
                    key={type}
                    type="button"
                    disabled={busy || !session.profile_id}
                    onClick={() => void practiceAgain(type)}
                    className="flex w-full items-center justify-between border border-neutral-200 px-4 py-3 text-left text-sm transition-colors hover:border-black disabled:opacity-50 dark:border-neutral-800 dark:hover:border-white"
                  >
                    Practise {labelOf(TYPE_OPTIONS, type).toLowerCase()} questions
                    <ArrowRight className="h-4 w-4" />
                  </button>
                ))}
                <Link
                  to={`/interview/new?profile=${session.profile_id ?? ''}&parent=${session.id}`}
                  className="flex w-full items-center justify-between border border-neutral-200 px-4 py-3 text-sm transition-colors hover:border-black dark:border-neutral-800 dark:hover:border-white"
                >
                  Customise a new practice interview <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </div>
            {report.recommended_topics.length ? (
              <div>
                <SectionLabel>Topics to review</SectionLabel>
                <div className="mt-3 flex flex-wrap gap-2">
                  {report.recommended_topics.map((t) => (
                    <Chip key={t}>{t}</Chip>
                  ))}
                </div>
              </div>
            ) : null}
            <div>
              <SectionLabel>Your panel</SectionLabel>
              <div className="mt-3 space-y-3">
                {session.panel.map((p) => (
                  <PanelistRow key={p.id} panelist={p} />
                ))}
              </div>
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------

function DeliveryStats({ turns }: { turns: Turn[] }) {
  const answers = turns.filter((t) => t.speaker === 'candidate' && t.metrics_json)
  const voice = answers.filter((t) => t.metrics_json!.wpm != null)
  if (!answers.length) return null
  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null)
  const pace = avg(voice.map((t) => t.metrics_json!.wpm!))
  const words = avg(answers.map((t) => t.metrics_json!.word_count))
  const fillers = answers.reduce((s, t) => s + t.metrics_json!.filler_count, 0)
  const latency = avg(voice.filter((t) => t.metrics_json!.latency_ms != null).map((t) => t.metrics_json!.latency_ms!))

  return (
    <div>
      <SectionLabel>Measured delivery</SectionLabel>
      <dl className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Pace" value={pace != null ? `${pace} wpm` : '—'} hint={pace == null ? 'typed answers' : pace < 110 ? 'a little slow' : pace > 170 ? 'fast' : 'comfortable'} />
        <Stat label="Avg answer" value={words != null ? `${words} words` : '—'} />
        <Stat label="Filler words" value={String(fillers)} hint={voice.length ? 'voice recognition may miss "um/uh"' : undefined} />
        <Stat label="Time to start" value={latency != null ? `${(latency / 1000).toFixed(1)}s` : '—'} />
      </dl>
    </div>
  )
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wider text-neutral-500">{label}</dt>
      <dd className="mt-1 text-lg tabular-nums">{value}</dd>
      {hint ? <dd className="text-[11px] text-neutral-500">{hint}</dd> : null}
    </div>
  )
}

function AreaList({
  title,
  tone,
  areas,
  onQuestion,
  empty,
}: {
  title: string
  tone: 'good' | 'warn' | 'bad'
  areas: Array<{ area: string; detail: string; questions: string[] }>
  onQuestion: (q: number) => void
  empty?: string
}) {
  return (
    <div>
      <div className="flex items-center gap-2">
        <span className={cn('h-2 w-2', tone === 'good' && 'bg-emerald-500', tone === 'warn' && 'bg-amber-500', tone === 'bad' && 'bg-red-500')} aria-hidden="true" />
        <SectionLabel>{title}</SectionLabel>
      </div>
      {areas.length ? (
        <ul className="mt-4 space-y-4">
          {areas.map((a) => (
            <li key={a.area}>
              <div className="text-sm font-medium">{a.area}</div>
              <p className="mt-0.5 text-sm text-neutral-600 dark:text-neutral-400">{a.detail}</p>
              {a.questions.length ? (
                <div className="mt-1 flex gap-2">
                  {a.questions.map((q) => {
                    const n = Number(q.replace(/\D/g, ''))
                    return Number.isFinite(n) && n > 0 ? (
                      <button key={q} type="button" onClick={() => onQuestion(n)} className="text-xs font-semibold underline underline-offset-2">
                        Q{n}
                      </button>
                    ) : null
                  })}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-neutral-500">{empty ?? 'None identified.'}</p>
      )}
    </div>
  )
}

/** Highlights quoted evidence inside an answer (exact, case-insensitive matches only). */
function Highlighted({ text, good, bad }: { text: string; good: string[]; bad: string[] }) {
  const marks: Array<{ start: number; end: number; tone: 'good' | 'bad' }> = []
  const lower = text.toLowerCase()
  for (const [list, tone] of [
    [good, 'good'],
    [bad, 'bad'],
  ] as const) {
    for (const q of list) {
      const idx = lower.indexOf(q.toLowerCase().trim())
      if (idx >= 0 && q.trim().length > 3 && !marks.some((m) => idx < m.end && idx + q.length > m.start)) marks.push({ start: idx, end: idx + q.trim().length, tone })
    }
  }
  marks.sort((a, b) => a.start - b.start)
  const parts: ReactNode[] = []
  let cursor = 0
  marks.forEach((m, i) => {
    if (m.start > cursor) parts.push(<Fragment key={`t${i}`}>{text.slice(cursor, m.start)}</Fragment>)
    parts.push(
      <mark key={`m${i}`} className={cn('px-0.5', m.tone === 'good' ? 'bg-emerald-100 text-inherit dark:bg-emerald-500/20' : 'bg-amber-100 text-inherit dark:bg-amber-500/20')}>
        {text.slice(m.start, m.end)}
      </mark>,
    )
    cursor = m.end
  })
  if (cursor < text.length) parts.push(<Fragment key="end">{text.slice(cursor)}</Fragment>)
  return <>{parts}</>
}

function QuestionCard({ f, turns, session, open, onToggle }: { f: QuestionFeedback; turns: Turn[]; session: InterviewSession; open: boolean; onToggle: () => void }) {
  const threadTurns = turns.filter((t) => t.thread_id === f.thread_id)
  const persona = session.panel.find((p) => p.id === f.persona_id)
  const goodQuotes = f.did_well.flatMap((d) => d.evidence.map((e) => e.quote))
  const badQuotes = f.mistakes.flatMap((m) => m.evidence.map((e) => e.quote))
  const candidateAnswer = threadTurns
    .filter((t) => t.speaker === 'candidate')
    .map((t) => t.text)
    .join(' ')

  return (
    <article id={`q-${f.q_number}`} className="scroll-mt-24 border border-neutral-200 dark:border-neutral-800">
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-start gap-4 p-5 text-left">
        <span className="text-xs font-bold tabular-nums text-neutral-400">Q{f.q_number}</span>
        <div className="min-w-0 flex-1">
          <div className="font-medium leading-snug">{f.question}</div>
          <div className="mt-1 text-xs text-neutral-500">
            {persona ? `${persona.name} · ` : ''}
            {f.category.replace(/_/g, ' ')}
          </div>
        </div>
        <span
          className={cn(
            'shrink-0 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider',
            f.verdict === 'strong' && 'bg-emerald-100 text-emerald-900 dark:bg-emerald-500/20 dark:text-emerald-200',
            f.verdict === 'adequate' && 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200',
            f.verdict === 'weak' && 'bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200',
          )}
        >
          {f.verdict}
        </span>
        <ChevronDown className={cn('mt-0.5 h-4 w-4 shrink-0 text-neutral-400 transition-transform', open && 'rotate-180')} aria-hidden="true" />
      </button>

      {open ? (
        <div className="space-y-8 border-t border-neutral-200 p-5 dark:border-neutral-800">
          <div>
            <SectionLabel>The exchange</SectionLabel>
            <div className="mt-3 space-y-3">
              {threadTurns.map((t) => {
                const p = session.panel.find((x) => x.id === t.persona_id)
                return (
                  <div key={t.id} className={cn('text-sm leading-relaxed', t.speaker === 'candidate' ? 'border-l-2 border-black pl-3 dark:border-white' : 'text-neutral-600 dark:text-neutral-400')}>
                    <span className="mr-2 text-[10px] font-bold uppercase tracking-wider text-neutral-500">{t.speaker === 'candidate' ? 'You' : p?.first_name ?? 'Panel'}</span>
                    {t.speaker === 'candidate' ? <Highlighted text={t.text} good={goodQuotes} bad={badQuotes} /> : t.text}
                  </div>
                )
              })}
            </div>
          </div>

          <div className="grid gap-8 md:grid-cols-2">
            <div>
              <SectionLabel>What you did well</SectionLabel>
              {f.did_well.length ? (
                <ul className="mt-3 space-y-3">
                  {f.did_well.map((d) => (
                    <li key={d.point} className="flex gap-2 text-sm">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
                      <div>
                        {d.point}
                        {d.evidence[0] ? <div className="mt-0.5 text-xs italic text-neutral-500">“{d.evidence[0].quote}”</div> : null}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-sm text-neutral-500">Nothing that could be backed by a quote from your answer.</p>
              )}
            </div>
            <div>
              <SectionLabel>What was missing</SectionLabel>
              {f.missing.length ? (
                <ul className="mt-3 space-y-2">
                  {f.missing.map((m) => (
                    <li key={m} className="flex gap-2 text-sm">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
                      {m}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-sm text-neutral-500">Nothing important was missing.</p>
              )}
            </div>
          </div>

          {f.mistakes.length ? (
            <div>
              <SectionLabel>Mistakes to fix</SectionLabel>
              <div className="mt-3 space-y-4">
                {f.mistakes.map((m, i) => (
                  <div key={`${m.type}-${i}`} className="border-l-2 border-amber-500 pl-4">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      {MISTAKE_LABELS[m.type] ?? m.type}
                      {m.measured ? <span className="text-[9px] font-bold uppercase tracking-wider text-neutral-500">Measured</span> : null}
                    </div>
                    <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-3">
                      <div>
                        <dt className="text-[10px] uppercase tracking-wider text-neutral-500">What happened</dt>
                        <dd className="mt-0.5">
                          {m.what_happened}
                          {m.evidence[0] ? <span className="mt-0.5 block text-xs italic text-neutral-500">“{m.evidence[0].quote}”</span> : null}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[10px] uppercase tracking-wider text-neutral-500">Why it matters</dt>
                        <dd className="mt-0.5">{m.why_it_matters}</dd>
                      </div>
                      <div>
                        <dt className="text-[10px] uppercase tracking-wider text-neutral-500">How to improve</dt>
                        <dd className="mt-0.5">{m.how_to_improve}</dd>
                      </div>
                    </dl>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {f.better_approach.length ? (
            <div>
              <SectionLabel>Better approach{f.framework && f.framework !== 'none' ? ` · ${f.framework.replace(/_/g, ' ')}` : ''}</SectionLabel>
              <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm">
                {f.better_approach.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
              {f.star ? (
                <div className="mt-4 flex flex-wrap gap-2" aria-label="STAR coverage">
                  {(['situation', 'task', 'action', 'result'] as const).map((k) => (
                    <Chip key={k} tone={f.star![k] ? 'good' : 'warn'}>
                      {f.star![k] ? '✓' : '✗'} {k[0].toUpperCase() + k.slice(1)}
                    </Chip>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {f.stronger_answer ? (
            <div>
              <SectionLabel>Your answer vs. a stronger answer</SectionLabel>
              <div className="mt-3 grid gap-4 md:grid-cols-2">
                <div className="border border-neutral-200 p-4 dark:border-neutral-800">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">Your answer</div>
                  <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-neutral-700 dark:text-neutral-300">{candidateAnswer}</p>
                </div>
                <div className="border border-black p-4 dark:border-white">
                  <div className="text-[10px] font-bold uppercase tracking-wider">A stronger answer</div>
                  <p className="mt-2 whitespace-pre-line text-sm leading-relaxed">{f.stronger_answer}</p>
                  <p className="mt-3 text-[11px] text-neutral-500">Built only from your answer and resume. Fill the [brackets] with your real details — never invent numbers.</p>
                </div>
              </div>
              {f.why_stronger.length ? (
                <ul className="mt-4 space-y-1 text-sm">
                  {f.why_stronger.map((w) => (
                    <li key={w} className="flex gap-2">
                      <Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                      {w}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          {f.unverified_findings_dropped > 0 ? (
            <p className="text-[11px] text-neutral-500">
              {f.unverified_findings_dropped} AI finding{f.unverified_findings_dropped === 1 ? ' was' : 's were'} removed because {f.unverified_findings_dropped === 1 ? 'it' : 'they'} couldn't be matched to your actual words.
            </p>
          ) : null}
        </div>
      ) : null}
    </article>
  )
}

function Transcript({ session, turns }: { session: InterviewSession; turns: Turn[] }) {
  const voice = useInterviewVoice()
  const roundLabel = (id: string | null) => session.round_plan.find((r) => r.id === id)?.label ?? (id === 'closing' ? 'Closing' : id ?? '')
  return (
    <ol className="space-y-5">
      {turns.map((t, i) => {
        const p = session.panel.find((x) => x.id === t.persona_id)
        const newRound = t.speaker === 'interviewer' && t.round !== turns.slice(0, i).reverse().find((x) => x.speaker === 'interviewer')?.round
        return (
          <li key={t.id}>
            {newRound ? <div className="mb-4 mt-8 text-[10px] font-bold uppercase tracking-[0.2em] text-neutral-400 first:mt-0">— {roundLabel(t.round)} —</div> : null}
            <div className={cn('flex gap-4', t.speaker === 'candidate' && 'pl-6 sm:pl-12')}>
              <div className="w-24 shrink-0 text-xs sm:w-32">
                <div className="font-semibold">{t.speaker === 'candidate' ? 'You' : p?.name ?? 'Panel'}</div>
                <div className="text-neutral-500">
                  {t.speaker === 'candidate' ? (
                    <span className="inline-flex items-center gap-1">
                      {t.input_mode === 'voice' ? <Mic className="h-3 w-3" /> : <Keyboard className="h-3 w-3" />}
                      {t.metrics_json?.duration_ms ? `${Math.round(t.metrics_json.duration_ms / 1000)}s` : t.input_mode}
                    </span>
                  ) : (
                    p?.title
                  )}
                </div>
              </div>
              <div className="min-w-0 flex-1 text-sm leading-relaxed">
                {t.text}
                {t.speaker === 'interviewer' && p ? (
                  <button
                    type="button"
                    onClick={() => {
                      voice.unlock()
                      void voice.speak(t.text, p)
                    }}
                    className="ml-2 inline-flex translate-y-0.5 text-neutral-400 hover:text-black dark:hover:text-white"
                    aria-label={`Listen to ${p.first_name}'s question`}
                  >
                    <Play className="h-3.5 w-3.5" />
                  </button>
                ) : null}
                {t.practice_tip ? <div className="mt-2 border-l-2 border-sky-500 pl-3 text-xs text-sky-800 dark:text-sky-200">Coach tip: {t.practice_tip}</div> : null}
              </div>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
