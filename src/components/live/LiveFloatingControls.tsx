import { Mic, Pause, Settings, Square } from 'lucide-react'
import type { SpeechStatus } from '@/hooks/useSpeechCaptions'

const primaryButtonLabel: Record<SpeechStatus, string> = {
  idle: 'Start',
  listening: 'Stop',
  paused: 'Resume',
}

export default function LiveFloatingControls({
  status,
  supportsSpeech,
  onPrimary,
  onPause,
  onSettings,
}: {
  status: SpeechStatus
  supportsSpeech: boolean
  onPrimary: () => void
  onPause: () => void
  onSettings: () => void
}) {
  const primaryLabel = primaryButtonLabel[status]
  const primaryIcon = status === 'listening' ? <Square className="h-6 w-6" /> : <Mic className="h-6 w-6" />

  return (
    <div className="pointer-events-none fixed bottom-6 left-0 right-0 z-20">
      <div className="mx-auto flex max-w-6xl items-center justify-center px-4">
        <div className="pointer-events-auto flex items-center gap-3 rounded-2xl border border-slate-200 bg-white/90 px-3 py-3 shadow-lg backdrop-blur">
          <button
            type="button"
            onClick={onPause}
            disabled={!supportsSpeech || status !== 'listening'}
            className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
            aria-label="Pause"
          >
            <Pause className="h-5 w-5" />
          </button>

          <button
            type="button"
            onClick={onPrimary}
            disabled={!supportsSpeech}
            className={
              'inline-flex h-16 w-16 items-center justify-center rounded-full text-white shadow-sm transition disabled:opacity-50 ' +
              (status === 'listening' ? 'bg-rose-500 hover:bg-rose-600' : 'bg-slate-900 hover:bg-slate-800')
            }
            aria-label={primaryLabel}
          >
            {primaryIcon}
          </button>

          <button
            type="button"
            onClick={onSettings}
            className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-700 transition hover:bg-slate-50"
            aria-label="Settings"
          >
            <Settings className="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>
  )
}
