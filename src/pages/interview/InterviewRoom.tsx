import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Keyboard, Loader2, Mic, MicOff, PhoneOff, RotateCcw, Video, VideoOff, Volume2, VolumeX } from 'lucide-react'
import { useAuthStore } from '@/store/authStore'
import { cn } from '@/lib/utils'
import { interviewApi, InterviewApiError } from '@/lib/interview/api'
import { PERSONA_ACCENT, formatClock, initials, labelOf, MODE_OPTIONS, TYPE_OPTIONS } from '@/lib/interview/options'
import type { InterviewSession, Panelist, Turn } from '@/lib/interview/types'
import { useInterviewVoice } from '@/hooks/useInterviewVoice'
import { useAnswerCapture } from '@/hooks/useAnswerCapture'
import { PanelistAvatar } from '@/components/interview/ui'

type Phase = 'loading' | 'lobby' | 'joining' | 'speaking' | 'listening' | 'thinking' | 'retry' | 'ending' | 'blocked'

type AnswerPayload = {
  text: string
  input_mode: 'voice' | 'text'
  duration_ms?: number | null
  latency_ms?: number | null
  longest_pause_ms?: number | null
  interrupted?: boolean
}

type TurnResponse = { candidate_turn: Turn; interviewer_turn: Turn; is_final: boolean }

// Short acknowledgements cover the moment the panel "thinks" about the next question.
const ACKS = ['Okay.', 'Right, thank you.', 'Got it.']
const STRESS_INTERRUPT_MS = 150_000

export default function InterviewRoom() {
  const { sessionId = '' } = useParams()
  const navigate = useNavigate()
  const { user, isReady, init } = useAuthStore()

  const [session, setSession] = useState<InterviewSession | null>(null)
  const [turns, setTurns] = useState<Turn[]>([])
  const [phase, setPhaseState] = useState<Phase>('loading')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine)
  const [micMuted, setMicMutedState] = useState(false)
  const [typing, setTypingState] = useState(false)
  const [draft, setDraft] = useState('')
  const [submitted, setSubmitted] = useState<string | null>(null)
  const [confirmEnd, setConfirmEnd] = useState(false)
  const [now, setNow] = useState(Date.now())

  const phaseRef = useRef<Phase>('loading')
  const typingRef = useRef(false)
  const micMutedRef = useRef(false)
  const finalRef = useRef(false)
  const pendingRef = useRef<AnswerPayload | null>(null)
  const submitVoiceRef = useRef<(interrupted: boolean) => void>(() => undefined)

  // Read through a function: the ref changes across awaits, which TypeScript's narrowing can't see.
  const phaseNow = () => phaseRef.current
  const setPhase = (p: Phase) => {
    phaseRef.current = p
    setPhaseState(p)
  }
  const setTyping = (v: boolean) => {
    typingRef.current = v
    setTypingState(v)
  }

  const voice = useInterviewVoice()
  const camera = useCamera()
  const capture = useAnswerCapture({
    autoDetect: true,
    interruptAfterMs: session?.config.mode === 'stress' ? STRESS_INTERRUPT_MS : null,
    onAutoSubmit: (reason) => submitVoiceRef.current(reason === 'interrupt'),
  })

  const panel = useMemo(() => session?.panel ?? [], [session])
  const personaFor = useCallback((id: string | null) => panel.find((p) => p.id === id) ?? panel[0], [panel])
  const lastInterviewerTurn = useMemo(() => [...turns].reverse().find((t) => t.speaker === 'interviewer') ?? null, [turns])
  const asker = lastInterviewerTurn ? personaFor(lastInterviewerTurn.persona_id) : null

  // ------------------------------------------------------------------ load
  // The room renders outside AppShell (full-screen call), so it initialises auth itself.
  useEffect(() => {
    void init()
  }, [init])

  useEffect(() => {
    if (isReady && !user) navigate('/login')
  }, [isReady, user, navigate])

  useEffect(() => {
    if (!user || !sessionId) return
    let alive = true
    void interviewApi<{ session: InterviewSession; turns: Turn[] }>(`/sessions/${sessionId}`)
      .then((r) => {
        if (!alive) return
        if (r.session.status !== 'ready' && r.session.status !== 'live') {
          navigate(`/interview/${sessionId}/report`, { replace: true })
          return
        }
        setSession(r.session)
        setTurns(r.turns)
        finalRef.current = r.session.is_final
        setTyping(!capture.isSupported)
        setPhase('lobby')
      })
      .catch((e) => {
        if (!alive) return
        setError(e.message)
        setPhase('blocked')
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, sessionId])

  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  const inCall = phase === 'speaking' || phase === 'listening' || phase === 'thinking' || phase === 'retry'
  useEffect(() => {
    if (!inCall) return
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [inCall])

  // ------------------------------------------------------------------ flow
  const endInterview = useCallback(async () => {
    setConfirmEnd(false)
    setPhase('ending')
    voice.stop()
    await capture.cancel()
    try {
      await interviewApi(`/sessions/${sessionId}/end`, { body: {} })
    } catch {
      // the report page retries ending if needed
    }
    navigate(`/interview/${sessionId}/report`)
  }, [capture, navigate, sessionId, voice])

  const beginAnswer = useCallback(async () => {
    setPhase('listening')
    setNotice(null)
    setSubmitted(null)
    setDraft('')
    await capture.begin({ listen: !typingRef.current && !micMutedRef.current })
  }, [capture])

  const askTurn = useCallback(
    async (turn: Turn) => {
      setPhase('speaking')
      await voice.speak(turn.text, personaFor(turn.persona_id))
      if (phaseRef.current !== 'speaking') return
      if (finalRef.current) {
        await endInterview()
        return
      }
      await beginAnswer()
    },
    [beginAnswer, endInterview, personaFor, voice],
  )

  const send = useCallback(
    async (payload: AnswerPayload) => {
      pendingRef.current = payload
      setPhase('thinking')
      setError(null)
      setSubmitted(payload.text || null)

      const speaker = lastInterviewerTurn ? personaFor(lastInterviewerTurn.persona_id) : panel[0]
      const candidateCount = turns.filter((t) => t.speaker === 'candidate').length
      const ack = speaker && candidateCount % 3 !== 2 ? voice.speak(ACKS[candidateCount % ACKS.length], speaker) : Promise.resolve()

      try {
        const [r] = await Promise.all([interviewApi<TurnResponse>(`/sessions/${sessionId}/turns`, { body: payload }), ack])
        pendingRef.current = null
        finalRef.current = r.is_final
        setTurns((prev) => {
          const rest = prev.filter((t) => t.seq !== r.candidate_turn.seq && t.seq !== r.interviewer_turn.seq)
          return [...rest, r.candidate_turn, r.interviewer_turn].sort((a, b) => a.seq - b.seq)
        })
        await askTurn(r.interviewer_turn)
      } catch (e) {
        const err = e as InterviewApiError
        if (err.status === 409 && /not live|ended/i.test(err.message)) {
          await endInterview()
          return
        }
        setError(err.message ?? 'Something went wrong')
        setPhase(err.status === 429 || err.status === 403 ? 'blocked' : 'retry')
      }
    },
    [askTurn, endInterview, lastInterviewerTurn, panel, personaFor, sessionId, turns, voice],
  )

  const submitVoice = useCallback(
    async (interrupted: boolean) => {
      if (phaseRef.current !== 'listening' || typingRef.current) return
      const answer = await capture.finish(interrupted)
      if (!answer.text) {
        setNotice("We didn't catch that. Try again, check your mic, or type your answer.")
        await beginAnswer()
        return
      }
      await send({ ...answer, input_mode: 'voice' })
    },
    [beginAnswer, capture, send],
  )
  submitVoiceRef.current = (interrupted) => void submitVoice(interrupted)

  const submitText = useCallback(async () => {
    const text = draft.trim()
    if (!text || phaseRef.current !== 'listening') return
    await capture.cancel()
    await send({ text, input_mode: 'text' })
  }, [capture, draft, send])

  const join = async () => {
    voice.unlock() // must run inside the click so audio playback is allowed later
    setPhase('joining')
    setError(null)
    try {
      const r = await interviewApi<{ session: InterviewSession; turns: Turn[] }>(`/sessions/${sessionId}/start`, { body: {} })
      setSession(r.session)
      setTurns(r.turns)
      finalRef.current = r.session.is_final
      for (const p of r.session.panel) for (const a of ACKS) void voice.prefetch(a, p)

      const last = r.turns[r.turns.length - 1]
      if (!last) throw new Error('The interview could not be started.')
      if (last.speaker === 'candidate') {
        // A previous answer was saved but the panel never replied: ask the server to continue.
        pendingRef.current = { text: last.text, input_mode: (last.input_mode as 'voice' | 'text') ?? 'text' }
        await send(pendingRef.current)
        return
      }
      await askTurn(last)
    } catch (e) {
      const err = e as InterviewApiError
      setError(err.message ?? 'Could not join the interview')
      setPhase(err.status === 429 || err.status === 403 ? 'blocked' : 'lobby')
    }
  }

  // ------------------------------------------------------------------ controls
  const toggleMic = async () => {
    const next = !micMutedRef.current
    micMutedRef.current = next
    setMicMutedState(next)
    if (phaseRef.current === 'listening' && !typingRef.current) await capture.setMicMuted(next)
  }

  const toggleTyping = async () => {
    const next = !typingRef.current
    if (next) {
      const soFar = capture.liveText
      setTyping(true)
      if (phaseRef.current === 'listening') {
        await capture.cancel()
        setDraft((d) => d || soFar)
      }
    } else {
      setTyping(false)
      if (phaseRef.current === 'listening') await capture.begin({ listen: !micMutedRef.current })
    }
  }

  const repeatQuestion = async () => {
    if (!lastInterviewerTurn || phaseRef.current !== 'listening') return
    await capture.cancel()
    setPhase('speaking')
    await voice.speak(lastInterviewerTurn.text, personaFor(lastInterviewerTurn.persona_id))
    if (phaseNow() === 'speaking') await beginAnswer()
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || phaseRef.current !== 'listening' || typingRef.current) return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.tagName === 'BUTTON')) return
      e.preventDefault()
      void submitVoice(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [submitVoice])

  // ------------------------------------------------------------------ derived
  const config = session?.config
  const elapsedSec = session?.started_at ? (now - new Date(session.started_at).getTime()) / 1000 : 0
  const durationSec = (config?.duration_min ?? 0) * 60
  const plan = session?.round_plan ?? []
  const currentRound = plan.findIndex((r) => elapsedSec < r.end_sec)
  const roundIdx = currentRound === -1 ? Math.max(0, plan.length - 1) : currentRound
  const round = plan[roundIdx]
  const questionNumber = turns.filter((t) => t.speaker === 'interviewer').length
  const practiceTip = config?.mode === 'practice' ? lastInterviewerTurn?.practice_tip ?? null : null

  const status =
    !online ? { label: 'Offline', tone: 'bg-red-500' } : phase === 'retry' ? { label: 'Reconnecting', tone: 'bg-amber-400' } : { label: 'Connected', tone: 'bg-emerald-400' }

  if (phase === 'loading') {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-neutral-950 text-white">
        <Loader2 className="h-6 w-6 animate-spin" aria-label="Loading interview" />
      </div>
    )
  }

  if (!session || phase === 'blocked') {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-neutral-950 px-6 text-white">
        <div className="max-w-md text-center">
          <h1 className="text-xl font-medium">We couldn't open this interview</h1>
          <p className="mt-3 text-sm text-neutral-400">{error ?? 'Please try again.'}</p>
          <div className="mt-6 flex justify-center gap-4 text-xs font-semibold uppercase tracking-wider">
            <Link to="/interview" className="underline underline-offset-4">
              Back to interviews
            </Link>
            {error?.toLowerCase().includes('plan') || error?.toLowerCase().includes('month') ? (
              <Link to="/usage" className="underline underline-offset-4">
                View plan & usage
              </Link>
            ) : null}
          </div>
        </div>
      </div>
    )
  }

  if (phase === 'lobby' || phase === 'joining') {
    return (
      <Lobby
        session={session}
        camera={camera}
        voice={voice}
        voiceSupported={capture.isSupported}
        joining={phase === 'joining'}
        error={error}
        onJoin={() => void join()}
      />
    )
  }

  const tileCount = panel.length + 1

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-neutral-950 text-white">
      {/* Top bar */}
      <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-white/10 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-neutral-300">
            <span className={cn('h-2 w-2 rounded-full', status.tone, status.label === 'Connected' && 'animate-pulse')} aria-hidden="true" />
            {status.label}
          </span>
          <span className="hidden truncate text-sm text-neutral-300 md:inline">
            {session.title} · {labelOf(TYPE_OPTIONS, config!.interview_type)} · {labelOf(MODE_OPTIONS, config!.mode)}
          </span>
        </div>
        <div className="hidden text-center text-xs text-neutral-400 sm:block" aria-live="polite">
          {round ? `Round ${roundIdx + 1} of ${plan.length} · ${round.label}` : null}
          <span className="mx-2 text-neutral-600">|</span>Q{Math.max(1, questionNumber)}
        </div>
        <div className={cn('font-mono text-sm tabular-nums', elapsedSec > durationSec ? 'text-amber-300' : 'text-neutral-200')} aria-label="Interview timer">
          {formatClock(elapsedSec)} <span className="text-neutral-500">/ {formatClock(durationSec)}</span>
        </div>
      </header>

      {/* Participants */}
      <main className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3 sm:p-5">
        <div
          className={cn(
            'grid flex-1 gap-3',
            tileCount <= 2 ? 'grid-cols-1 sm:grid-cols-2' : tileCount === 3 ? 'grid-cols-2 lg:grid-cols-3' : 'grid-cols-2 lg:grid-cols-3',
          )}
        >
          {panel.map((p) => (
            <PanelTile
              key={p.id}
              panelist={p}
              speaking={voice.speakingId === p.id}
              asking={asker?.id === p.id}
              thinking={phase === 'thinking' && asker?.id === p.id && voice.speakingId !== p.id}
            />
          ))}
          <CandidateTile
            name={user?.email ?? 'You'}
            videoRef={camera.videoRef}
            cameraOn={camera.on}
            micMuted={micMuted || typing}
            level={phase === 'listening' && !typing ? capture.micLevel : 0}
          />
        </div>

        {/* Captions */}
        <section className="mx-auto w-full max-w-4xl space-y-3" aria-live="polite">
          {lastInterviewerTurn && asker ? (
            <div className="border border-white/10 bg-white/[0.03] px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-neutral-400">
                  {asker.name} · {asker.title}
                </div>
                {phase === 'listening' ? (
                  <button type="button" onClick={() => void repeatQuestion()} className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-400 hover:text-white">
                    <RotateCcw className="h-3 w-3" /> Repeat
                  </button>
                ) : null}
              </div>
              <p className="mt-1.5 text-base leading-relaxed text-white sm:text-lg">{lastInterviewerTurn.text}</p>
            </div>
          ) : null}

          {practiceTip && phase !== 'thinking' ? (
            <div className="border border-sky-400/30 bg-sky-500/10 px-4 py-2.5 text-sm text-sky-100">
              <span className="mr-2 text-[10px] font-bold uppercase tracking-[0.2em] text-sky-300">Coach tip</span>
              {practiceTip}
            </div>
          ) : null}

          {phase === 'listening' && !typing ? (
            <div className="min-h-[3.5rem] px-1 text-sm text-neutral-300">
              <span className="mr-2 text-[10px] font-bold uppercase tracking-[0.2em] text-neutral-500">You</span>
              {capture.liveText || (micMuted ? 'Your mic is muted — unmute to answer, or type instead.' : 'Listening… answer in your own words.')}
            </div>
          ) : null}

          {phase === 'listening' && typing ? (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                void submitText()
              }}
              className="flex flex-col gap-2 sm:flex-row"
            >
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault()
                    void submitText()
                  }
                }}
                rows={3}
                autoFocus
                placeholder="Type your answer… (Ctrl/⌘ + Enter to send)"
                aria-label="Your answer"
                className="min-h-[5rem] flex-1 resize-y border border-white/15 bg-black/40 px-3 py-2 text-sm text-white outline-none placeholder:text-neutral-500 focus:border-white/40"
              />
            </form>
          ) : null}

          {phase === 'thinking' && submitted ? (
            <div className="px-1 text-sm text-neutral-500">
              <span className="mr-2 text-[10px] font-bold uppercase tracking-[0.2em] text-neutral-600">You</span>
              {submitted}
            </div>
          ) : null}

          {capture.pendingSubmit && phase === 'listening' && !typing ? (
            <div className="px-1 text-xs text-neutral-400">Sounds like you've finished — sending your answer. Keep talking to continue.</div>
          ) : null}
          {notice ? <div className="px-1 text-xs text-amber-300">{notice}</div> : null}
          {capture.error && phase === 'listening' && !typing && /not-allowed|denied/i.test(capture.error) ? (
            <div className="px-1 text-xs text-amber-300">Microphone access is blocked. Allow it in your browser's address bar, or type your answer.</div>
          ) : null}
          {phase === 'retry' ? (
            <div className="flex flex-wrap items-center gap-3 border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
              <span>{error ?? 'Connection problem.'} Your answer is saved.</span>
              <button type="button" onClick={() => pendingRef.current && void send(pendingRef.current)} className="font-semibold underline underline-offset-4">
                Retry
              </button>
            </div>
          ) : null}
        </section>
      </main>

      {/* Controls */}
      <footer className="shrink-0 border-t border-white/10 px-3 py-3 sm:px-6">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ControlButton label={micMuted ? 'Unmute microphone' : 'Mute microphone'} active={!micMuted} onClick={() => void toggleMic()} disabled={typing}>
              {micMuted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
            </ControlButton>
            <ControlButton label={camera.on ? 'Turn camera off' : 'Turn camera on'} active={camera.on} onClick={() => void camera.toggle()}>
              {camera.on ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
            </ControlButton>
            <ControlButton label={voice.muted ? 'Unmute panel audio' : 'Mute panel audio (captions only)'} active={!voice.muted} onClick={() => voice.setMuted(!voice.muted)}>
              {voice.muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
            </ControlButton>
            <ControlButton label={typing ? 'Answer by voice' : 'Type your answer'} active={typing} onClick={() => void toggleTyping()} disabled={!capture.isSupported && typing}>
              <Keyboard className="h-5 w-5" />
            </ControlButton>
          </div>

          <div className="flex items-center gap-2">
            {phase === 'listening' ? (
              <button
                type="button"
                onClick={() => (typing ? void submitText() : void submitVoice(false))}
                disabled={typing ? !draft.trim() : false}
                className="inline-flex h-11 items-center bg-white px-5 text-[11px] font-bold uppercase tracking-[0.15em] text-black transition hover:bg-neutral-200 disabled:opacity-40"
              >
                {typing ? 'Send answer' : 'Done answering'}
                {!typing ? <kbd className="ml-2 hidden border border-black/20 px-1 text-[9px] font-normal sm:inline">Space</kbd> : null}
              </button>
            ) : (
              <span className="inline-flex h-11 items-center px-3 text-xs text-neutral-400">
                {phase === 'speaking' ? `${asker?.first_name ?? 'Panel'} is speaking…` : phase === 'thinking' ? 'Panel is noting your answer…' : phase === 'ending' ? 'Wrapping up…' : ''}
              </span>
            )}
            <button
              type="button"
              onClick={() => setConfirmEnd(true)}
              disabled={phase === 'ending'}
              className="inline-flex h-11 items-center gap-2 bg-red-600 px-4 text-[11px] font-bold uppercase tracking-[0.15em] text-white transition hover:bg-red-500 disabled:opacity-50"
            >
              <PhoneOff className="h-4 w-4" />
              <span className="hidden sm:inline">End</span>
            </button>
          </div>
        </div>
      </footer>

      {confirmEnd ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 px-6" role="dialog" aria-modal="true" aria-labelledby="end-title">
          <div className="w-full max-w-sm border border-white/15 bg-neutral-900 p-6">
            <h2 id="end-title" className="text-lg font-medium">End the interview now?</h2>
            <p className="mt-2 text-sm text-neutral-400">You'll get feedback on the questions you've answered so far. This can't be resumed.</p>
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => setConfirmEnd(false)} className="px-4 py-2 text-xs font-semibold uppercase tracking-wider text-neutral-300 hover:text-white">
                Keep going
              </button>
              <button type="button" onClick={() => void endInterview()} className="bg-red-600 px-4 py-2 text-xs font-bold uppercase tracking-wider text-white hover:bg-red-500">
                End & get feedback
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------

function ControlButton({ label, active, onClick, disabled, children }: { label: string; active: boolean; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex h-11 w-11 items-center justify-center rounded-full transition disabled:opacity-40',
        active ? 'bg-white/10 text-white hover:bg-white/20' : 'bg-white text-black hover:bg-neutral-200',
      )}
    >
      {children}
    </button>
  )
}

function PanelTile({ panelist, speaking, asking, thinking }: { panelist: Panelist; speaking: boolean; asking: boolean; thinking: boolean }) {
  const accent = PERSONA_ACCENT[panelist.kind]
  return (
    <div
      className={cn(
        'relative flex min-h-[9rem] items-center justify-center overflow-hidden rounded-lg bg-neutral-900 ring-1 ring-white/5 transition-shadow sm:min-h-[12rem]',
        speaking && cn('ring-2', accent.ring),
      )}
    >
      <PanelistAvatar panelist={panelist} size="xl" className={cn('transition-transform duration-300', speaking && 'scale-105')} />
      {asking ? (
        <span className="absolute left-3 top-3 bg-white px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-black">{speaking ? 'Speaking' : 'Asking'}</span>
      ) : null}
      {thinking ? (
        <span className="absolute right-3 top-3 flex gap-1" aria-label={`${panelist.first_name} is thinking`}>
          {[0, 1, 2].map((i) => (
            <span key={i} className="h-1.5 w-1.5 animate-bounce rounded-full bg-neutral-400" style={{ animationDelay: `${i * 150}ms` }} />
          ))}
        </span>
      ) : null}
      <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 bg-gradient-to-t from-black/70 to-transparent px-3 pb-2 pt-6">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-white">{panelist.name}</div>
          <div className="truncate text-[11px] text-neutral-400">
            {panelist.title} · {panelist.kind_label}
          </div>
        </div>
        {speaking ? <SpeakingBars /> : null}
      </div>
    </div>
  )
}

function SpeakingBars() {
  return (
    <span className="flex h-4 items-end gap-0.5" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <span key={i} className="w-1 animate-pulse rounded-sm bg-white" style={{ height: `${40 + ((i * 37) % 60)}%`, animationDelay: `${i * 120}ms` }} />
      ))}
    </span>
  )
}

function CandidateTile({ name, videoRef, cameraOn, micMuted, level }: { name: string; videoRef: RefObject<HTMLVideoElement>; cameraOn: boolean; micMuted: boolean; level: number }) {
  const talking = level > 0.04
  return (
    <div className={cn('relative flex min-h-[9rem] items-center justify-center overflow-hidden rounded-lg bg-neutral-800 ring-1 ring-white/5 sm:min-h-[12rem]', talking && 'ring-2 ring-white/70')}>
      <video ref={videoRef} autoPlay muted playsInline className={cn('absolute inset-0 h-full w-full -scale-x-100 object-cover', !cameraOn && 'hidden')} />
      {!cameraOn ? (
        <div className="flex h-24 w-24 items-center justify-center rounded-full bg-white/10 text-2xl font-semibold sm:h-28 sm:w-28 sm:text-3xl" aria-hidden="true">
          {initials(name.split('@')[0].replace(/[._-]+/g, ' ')) || 'Y'}
        </div>
      ) : null}
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/70 to-transparent px-3 pb-2 pt-6">
        <span className="text-sm font-medium text-white">You</span>
        {micMuted ? <MicOff className="h-4 w-4 text-red-400" aria-label="Microphone off" /> : null}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

function useCamera() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [on, setOn] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const attach = () => {
    if (videoRef.current && streamRef.current && videoRef.current.srcObject !== streamRef.current) videoRef.current.srcObject = streamRef.current
  }
  useEffect(attach)
  useEffect(() => () => streamRef.current?.getTracks().forEach((t) => t.stop()), [])

  // Local preview only: the video is never recorded or uploaded.
  const toggle = async () => {
    if (on) {
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
      setOn(false)
      return
    }
    try {
      streamRef.current = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 360 }, audio: false })
      setError(null)
      setOn(true)
    } catch {
      setError('Camera unavailable or blocked.')
    }
  }
  return { videoRef, on, error, toggle }
}

function Lobby({
  session,
  camera,
  voice,
  voiceSupported,
  joining,
  error,
  onJoin,
}: {
  session: InterviewSession
  camera: ReturnType<typeof useCamera>
  voice: ReturnType<typeof useInterviewVoice>
  voiceSupported: boolean
  joining: boolean
  error: string | null
  onJoin: () => void
}) {
  const mic = useMicCheck()
  const [speakerTested, setSpeakerTested] = useState(false)
  const lead = session.panel[0]
  const rejoining = session.status === 'live'

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-neutral-950 text-white">
      <div className="mx-auto grid min-h-full max-w-6xl items-center gap-10 px-6 py-10 lg:grid-cols-[1.3fr_1fr]">
        <div className="space-y-4">
          <div className="relative flex aspect-video items-center justify-center overflow-hidden rounded-lg bg-neutral-800">
            <video ref={camera.videoRef} autoPlay muted playsInline className={cn('absolute inset-0 h-full w-full -scale-x-100 object-cover', !camera.on && 'hidden')} />
            {!camera.on ? <div className="text-sm text-neutral-400">Camera is off</div> : null}
            <div className="absolute bottom-3 left-3 right-3 flex items-center gap-2">
              <button
                type="button"
                onClick={() => void camera.toggle()}
                className="inline-flex h-10 items-center gap-2 rounded-full bg-black/60 px-4 text-xs font-semibold uppercase tracking-wider hover:bg-black/80"
              >
                {camera.on ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />}
                {camera.on ? 'Camera on' : 'Turn camera on'}
              </button>
              <span className="text-[11px] text-neutral-300">Preview only — your video is never recorded or uploaded.</span>
            </div>
          </div>
          {camera.error ? <p className="text-xs text-amber-300">{camera.error}</p> : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="border border-white/10 p-4">
              <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-neutral-400">Microphone</div>
              {voiceSupported ? (
                <>
                  <div className="mt-3 h-1.5 w-full bg-white/10">
                    <div className="h-full bg-emerald-400 transition-all duration-100" style={{ width: `${Math.min(100, mic.level * 400)}%` }} />
                  </div>
                  <button type="button" onClick={() => void (mic.active ? mic.stop() : mic.start())} className="mt-3 text-xs font-semibold uppercase tracking-wider underline underline-offset-4">
                    {mic.active ? 'Stop test' : 'Test microphone'}
                  </button>
                  {mic.error ? <p className="mt-2 text-xs text-amber-300">{mic.error}</p> : mic.active ? <p className="mt-2 text-xs text-neutral-400">Say something — the bar should move.</p> : null}
                </>
              ) : (
                <p className="mt-2 text-xs text-amber-300">Voice answers need Chrome or Edge on desktop. You can still take this interview by typing.</p>
              )}
            </div>
            <div className="border border-white/10 p-4">
              <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-neutral-400">Speaker</div>
              <p className="mt-2 text-xs text-neutral-400">The panel speaks their questions. Captions are always shown.</p>
              <button
                type="button"
                onClick={() => {
                  voice.unlock()
                  setSpeakerTested(true)
                  void voice.speak("Hi, can you hear me clearly?", lead)
                }}
                className="mt-3 text-xs font-semibold uppercase tracking-wider underline underline-offset-4"
              >
                {speakerTested ? 'Play again' : 'Test speaker'}
              </button>
            </div>
          </div>
        </div>

        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-neutral-400">{rejoining ? 'Interview in progress' : 'Ready to join?'}</div>
          <h1 className="mt-2 text-2xl font-light">{session.title}</h1>
          <p className="mt-1 text-sm text-neutral-400">
            {labelOf(TYPE_OPTIONS, session.config.interview_type)} · {labelOf(MODE_OPTIONS, session.config.mode)} · {session.config.duration_min} min
          </p>

          <div className="mt-6 space-y-3">
            {session.panel.map((p) => (
              <div key={p.id} className="flex items-center gap-3">
                <PanelistAvatar panelist={p} size="md" />
                <div>
                  <div className="text-sm">{p.name}</div>
                  <div className="text-xs text-neutral-400">
                    {p.title} · {p.kind_label}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <ul className="mt-6 space-y-1.5 text-xs text-neutral-400">
            <li>• Answer out loud. When you pause for a few seconds, your answer is sent — or press “Done answering”.</li>
            <li>• Ask the panel to repeat or clarify any time, just like a real interview.</li>
            <li>• {session.config.mode === 'practice' ? 'You will see a short coaching tip after each answer.' : 'Detailed feedback comes after the interview.'}</li>
          </ul>

          {error ? <p className="mt-4 text-sm text-amber-300">{error}</p> : null}

          <div className="mt-8 flex items-center gap-4">
            <button
              type="button"
              onClick={() => {
                mic.stop()
                onJoin()
              }}
              disabled={joining}
              className="inline-flex h-12 items-center bg-white px-8 text-xs font-bold uppercase tracking-[0.2em] text-black transition hover:bg-neutral-200 disabled:opacity-60"
            >
              {joining ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {rejoining ? 'Rejoin interview' : 'Join interview'}
            </button>
            <Link to="/interview" className="text-xs font-semibold uppercase tracking-wider text-neutral-400 hover:text-white">
              Leave
            </Link>
          </div>
          {!rejoining ? <p className="mt-3 text-[11px] text-neutral-500">Joining uses one interview from your monthly allowance.</p> : null}
        </div>
      </div>
    </div>
  )
}

function useMicCheck() {
  const [level, setLevel] = useState(0)
  const [active, setActive] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<{ stream: MediaStream; ctx: AudioContext; raf: number } | null>(null)

  const stop = () => {
    const r = ref.current
    if (!r) return
    cancelAnimationFrame(r.raf)
    r.stream.getTracks().forEach((t) => t.stop())
    void r.ctx.close()
    ref.current = null
    setActive(false)
    setLevel(0)
  }

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const ctx = new AudioContext()
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 1024
      ctx.createMediaStreamSource(stream).connect(analyser)
      const data = new Uint8Array(analyser.frequencyBinCount)
      const loop = () => {
        analyser.getByteTimeDomainData(data)
        let sum = 0
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128
          sum += v * v
        }
        setLevel(Math.sqrt(sum / data.length))
        if (ref.current) ref.current.raf = requestAnimationFrame(loop)
      }
      ref.current = { stream, ctx, raf: requestAnimationFrame(loop) }
      setError(null)
      setActive(true)
    } catch {
      setError('Microphone blocked or unavailable. Allow access in the address bar, or type your answers.')
    }
  }

  useEffect(() => stop, [])
  return { level, active, error, start, stop }
}
