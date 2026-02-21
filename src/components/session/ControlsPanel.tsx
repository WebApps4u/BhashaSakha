import { Copy, FileText, Globe, Mic, Pause, Play, Square, Subtitles, UploadCloud } from 'lucide-react'
import LevelBar from '@/components/session/LevelBar'
import { LANGUAGES, getLanguageLabel } from '@/utils/languages'

type SpeechStatus = 'idle' | 'listening' | 'paused'

export default function ControlsPanel({
  isOwner,
  status,
  micLevel,
  speakerLabel,
  onSpeakerLabel,
  targetLangs,
  onTargetLangs,
  ttsEnabled,
  onTtsEnabled,
  ttsLang,
  onTtsLang,
  shareEnabled,
  shareUrl,
  shareBusy,
  exportBusy,
  onStart,
  onPause,
  onResume,
  onStop,
  onEnableShare,
  onCopyShare,
  onExportTxt,
  onExportVtt,
  onUploadVtt,
}: {
  isOwner: boolean
  status: SpeechStatus
  micLevel: number
  speakerLabel: string
  onSpeakerLabel: (label: string) => void
  targetLangs: string[]
  onTargetLangs: (langs: string[]) => void
  ttsEnabled: boolean
  onTtsEnabled: (enabled: boolean) => void
  ttsLang: string
  onTtsLang: (lang: string) => void
  shareEnabled: boolean
  shareUrl: string
  shareBusy: boolean
  exportBusy: boolean
  onStart: () => void
  onPause: () => void
  onResume: () => void
  onStop: () => void
  onEnableShare: () => void
  onCopyShare: () => void
  onExportTxt: () => void
  onExportVtt: () => void
  onUploadVtt: () => void
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-sm font-semibold">Controls</h2>

      <div className="mt-3 flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2">
        <div className="text-xs text-slate-600">Mic level</div>
        <LevelBar level={micLevel} />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={!isOwner || status !== 'idle'}
          onClick={onStart}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-50"
        >
          <Mic className="h-4 w-4" />
          Start
        </button>
        <button
          type="button"
          disabled={!isOwner || status !== 'listening'}
          onClick={onPause}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
        >
          <Pause className="h-4 w-4" />
          Pause
        </button>
        <button
          type="button"
          disabled={!isOwner || status !== 'paused'}
          onClick={onResume}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
        >
          <Play className="h-4 w-4" />
          Resume
        </button>
        <button
          type="button"
          disabled={!isOwner || status === 'idle'}
          onClick={onStop}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
        >
          <Square className="h-4 w-4" />
          Stop
        </button>
      </div>

      <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <div className="text-xs font-semibold text-slate-700">Conversation</div>
        <div className="mt-1 text-xs text-slate-500">Select “Translate to” languages to enable realtime translation.</div>
        <div className="mt-3 grid gap-3">
          <label className="grid gap-1 text-xs text-slate-600">
            Current speaker
            <select
              disabled={!isOwner}
              value={speakerLabel}
              onChange={(e) => onSpeakerLabel(e.target.value)}
              className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 disabled:opacity-50"
            >
              {['Speaker 1', 'Speaker 2', 'Speaker 3', 'Speaker 4'].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>

          <div>
            <div className="text-xs text-slate-600">Translate to</div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {LANGUAGES.map((l) => {
                const checked = targetLangs.includes(l.code)
                return (
                  <label key={l.code} className="inline-flex items-center gap-2 text-xs text-slate-700">
                    <input
                      type="checkbox"
                      disabled={!isOwner}
                      checked={checked}
                      onChange={() => {
                        const next = checked ? targetLangs.filter((c) => c !== l.code) : [...targetLangs, l.code]
                        onTargetLangs(next)
                        if (!next.includes(ttsLang)) {
                          onTtsLang(next[0] ?? '')
                        }
                      }}
                      className="h-4 w-4 rounded border-slate-300"
                    />
                    {l.label}
                  </label>
                )
              })}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <label className="flex items-center justify-between gap-2 text-xs text-slate-700">
              <span>Voice playback (TTS)</span>
              <input
                type="checkbox"
                disabled={!isOwner}
                checked={ttsEnabled}
                onChange={(e) => onTtsEnabled(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300"
              />
            </label>
            <div className="mt-2">
              <select
                disabled={!isOwner || !ttsEnabled || targetLangs.length === 0}
                value={ttsLang}
                onChange={(e) => onTtsLang(e.target.value)}
                className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 disabled:opacity-50"
              >
                {targetLangs.length === 0 ? <option value="">Select target language</option> : null}
                {targetLangs.map((code) => (
                  <option key={code} value={code}>
                    {getLanguageLabel(code)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
          <Globe className="h-4 w-4" />
          Sharing
        </div>
        <div className="mt-1 text-xs text-slate-500">Makes the session public for anon viewers.</div>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            disabled={!isOwner || shareBusy}
            onClick={onEnableShare}
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:opacity-50"
          >
            Enable public link
          </button>
          <button
            type="button"
            disabled={!shareEnabled}
            onClick={onCopyShare}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
          >
            <Copy className="h-4 w-4" />
            Copy
          </button>
        </div>
        {shareEnabled ? (
          <div className="mt-2 truncate rounded-xl bg-white px-3 py-2 text-xs text-slate-600">{shareUrl}</div>
        ) : null}
      </div>

      <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <div className="text-xs font-semibold text-slate-700">Export</div>
        <div className="mt-1 text-xs text-slate-500">Downloads as TXT or VTT (WebVTT captions).</div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={exportBusy}
            onClick={onExportTxt}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
          >
            <FileText className="h-4 w-4" />
            TXT
          </button>
          <button
            type="button"
            disabled={exportBusy}
            onClick={onExportVtt}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
          >
            <Subtitles className="h-4 w-4" />
            VTT
          </button>
        </div>

        <button
          type="button"
          disabled={!isOwner || exportBusy}
          onClick={onUploadVtt}
          className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
        >
          <UploadCloud className="h-4 w-4" />
          Upload latest VTT to Storage
        </button>
      </div>
    </div>
  )
}
