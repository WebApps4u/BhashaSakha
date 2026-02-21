import { ArrowLeftRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { LANGUAGES } from '@/utils/languages'

export type LiveMode = 'transcribe' | 'translate' | 'dubbing'

function LangSelect({
  value,
  onChange,
  allowAuto,
}: {
  value: string
  onChange: (value: string) => void
  allowAuto?: boolean
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm outline-none focus:border-slate-300"
    >
      {allowAuto ? <option value="auto">Auto-detect</option> : null}
      {LANGUAGES.map((l) => (
        <option key={l.code} value={l.code}>
          {l.label}
        </option>
      ))}
    </select>
  )
}

function Pill({
  active,
  children,
  onClick,
  disabled,
}: {
  active?: boolean
  children: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={
        'h-10 rounded-xl px-4 text-sm transition ' +
        (active
          ? 'border border-slate-900 bg-slate-900 text-white'
          : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50') +
        (disabled ? ' opacity-50' : '')
      }
    >
      {children}
    </button>
  )
}

export default function LiveHeader({
  mode,
  onMode,
  privacy,
  onPrivacy,
  sourceLang,
  onSourceLang,
  targetLang,
  onTargetLang,
  onSwap,
  canShare,
  onOpenShare,
  editorHref,
  isSignedIn,
}: {
  mode: LiveMode
  onMode: (mode: LiveMode) => void
  privacy: 'private' | 'shareable'
  onPrivacy: (privacy: 'private' | 'shareable') => void
  sourceLang: string
  onSourceLang: (value: string) => void
  targetLang: string
  onTargetLang: (value: string) => void
  onSwap: () => void
  canShare: boolean
  onOpenShare: () => void
  editorHref: string | null
  isSignedIn: boolean
}) {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <div className="text-center">
        <h1 className="text-3xl font-semibold tracking-tight">Live Transcription</h1>
        <div className="mt-2 text-sm text-slate-600">Generate translated captions and audio in real-time.</div>
      </div>

      <div className="mt-8 flex justify-center">
        <div className="inline-flex rounded-full border border-slate-200 bg-white p-1 shadow-sm">
          <button
            type="button"
            onClick={() => onPrivacy('private')}
            className={
              'rounded-full px-4 py-2 text-sm transition ' +
              (privacy === 'private' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50')
            }
          >
            Private
          </button>
          <button
            type="button"
            onClick={() => onPrivacy('shareable')}
            className={
              'rounded-full px-4 py-2 text-sm transition ' +
              (privacy === 'shareable' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50')
            }
          >
            Shareable
          </button>
        </div>
      </div>

      <div className="mt-6 flex justify-center gap-3">
        <Pill active={mode === 'transcribe'} onClick={() => onMode('transcribe')}>Transcribe</Pill>
        <Pill active={mode === 'translate'} onClick={() => onMode('translate')}>Translate</Pill>
        <Pill active={mode === 'dubbing'} onClick={() => onMode('dubbing')} disabled>
          Dubbing
        </Pill>
      </div>

      <div className="mt-6 grid gap-3 md:grid-cols-[1fr_auto_1fr] md:items-center md:justify-center">
        <LangSelect value={sourceLang} onChange={onSourceLang} allowAuto />
        <button
          type="button"
          onClick={onSwap}
          disabled={sourceLang === 'auto' || mode !== 'translate'}
          className="mx-auto inline-flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
          aria-label="Swap languages"
        >
          <ArrowLeftRight className="h-5 w-5" />
        </button>
        <LangSelect value={targetLang} onChange={(v) => onTargetLang(v)} />
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
        <div className="min-w-0">
          <div className="text-sm font-medium text-slate-900">Press and start talking</div>
          <div className="mt-1 text-xs text-slate-500">
            {isSignedIn ? 'Captions appear immediately. Translation appears per finalized phrase.' : 'Sign in is required to start capture.'}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onOpenShare}
            disabled={!canShare}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
          >
            Share
          </button>
          {editorHref ? (
            <Link to={editorHref} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800">
              Open editor
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  )
}
