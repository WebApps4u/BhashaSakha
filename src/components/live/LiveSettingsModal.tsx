import { Link } from 'react-router-dom'
import { Volume2 } from 'lucide-react'
import { LANGUAGES, getLanguageLabel } from '@/utils/languages'

const SPEAKERS = ['Speaker 1', 'Speaker 2', 'Speaker 3', 'Speaker 4']

export default function LiveSettingsModal({
  open,
  speakerLabel,
  onSpeakerLabel,
  targetLang,
  onTargetLang,
  targetLangs,
  onTargetLangs,
  ttsEnabled,
  onTtsEnabled,
  ttsLang,
  onTtsLang,
  editorHref,
  onClose,
}: {
  open: boolean
  speakerLabel: string
  onSpeakerLabel: (label: string) => void
  targetLang: string
  onTargetLang: (lang: string) => void
  targetLangs: string[]
  onTargetLangs: (langs: string[]) => void
  ttsEnabled: boolean
  onTtsEnabled: (enabled: boolean) => void
  ttsLang: string
  onTtsLang: (lang: string) => void
  editorHref: string | null
  onClose: () => void
}) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/20 p-4 dark:bg-black/60" role="dialog" aria-modal="true">
      <div className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-5 shadow-xl dark:border-white/10 dark:bg-slate-950">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-semibold">Session settings</div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-300">Advanced options (kept out of the main flow).</div>
          </div>
          <button type="button" onClick={onClose} className="text-sm text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-50">
            Close
          </button>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="grid gap-1 text-xs text-slate-600 dark:text-slate-300">
            Current speaker
            <select
              value={speakerLabel}
              onChange={(e) => onSpeakerLabel(e.target.value)}
              className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 dark:border-white/10 dark:bg-white/5 dark:text-slate-50"
            >
              {SPEAKERS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-1 text-xs text-slate-600 dark:text-slate-300">
            Primary target language
            <select
              value={targetLang}
              onChange={(e) => onTargetLang(e.target.value)}
              className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 dark:border-white/10 dark:bg-white/5 dark:text-slate-50"
            >
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>

          <div className="md:col-span-2">
            <div className="text-xs text-slate-600 dark:text-slate-300">Translate to (multi)</div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {LANGUAGES.map((l) => {
                const checked = targetLangs.includes(l.code)
                return (
                  <label key={l.code} className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-200">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        const next = checked ? targetLangs.filter((c) => c !== l.code) : [...targetLangs, l.code]
                        onTargetLangs(next)
                        if (!next.includes(targetLang)) {
                          onTargetLang(next[0] ?? targetLang)
                        }
                        if (!next.includes(ttsLang)) {
                          onTtsLang(next[0] ?? '')
                        }
                      }}
                      className="h-4 w-4 rounded border-slate-300 dark:border-white/20"
                    />
                    {l.label}
                  </label>
                )
              })}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 md:col-span-2 dark:border-white/10 dark:bg-white/5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">Voice playback (TTS)</div>
                <div className="mt-1 text-xs text-slate-600 dark:text-slate-300">Speaks the translated line for your selected language.</div>
              </div>
              <button
                type="button"
                onClick={() => onTtsEnabled(!ttsEnabled)}
                className={
                  'inline-flex h-10 items-center gap-2 rounded-xl px-4 text-sm transition ' +
                  (ttsEnabled
                    ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                    : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:hover:bg-white/10')
                }
              >
                <Volume2 className="h-4 w-4" />
                {ttsEnabled ? 'On' : 'Off'}
              </button>
            </div>

            <div className="mt-3 grid gap-1 text-xs text-slate-600 dark:text-slate-300">
              TTS language
              <select
                value={ttsLang}
                onChange={(e) => onTtsLang(e.target.value)}
                disabled={!ttsEnabled}
                className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 disabled:opacity-50 dark:border-white/10 dark:bg-white/5 dark:text-slate-50"
              >
                {targetLangs.length === 0 ? <option value="">Select</option> : null}
                {targetLangs.map((code) => (
                  <option key={code} value={code}>
                    {getLanguageLabel(code)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between">
          {editorHref ? (
            <Link to={editorHref} className="text-sm font-medium text-slate-900 underline dark:text-slate-50">
              Open editor
            </Link>
          ) : (
            <div className="text-xs text-slate-500 dark:text-slate-300">Start capture to create a session.</div>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
