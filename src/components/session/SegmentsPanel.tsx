import { Mic, MicOff } from 'lucide-react'
import { cn } from '@/lib/utils'

type SpeechStatus = 'idle' | 'listening' | 'paused'

export type SegmentRow = {
  id: string
  seq: number
  speaker_label: string
  detected_lang?: string | null
  text: string
  is_edited: boolean
}

export type TranslationRow = {
  id: string
  segment_id: string
  target_lang: string
  text: string
}

export default function SegmentsPanel({
  segments,
  interim,
  status,
  translationsBySegmentId,
  isTranslating,
}: {
  segments: SegmentRow[]
  interim: string
  status: SpeechStatus
  translationsBySegmentId?: Record<string, TranslationRow[]>
  isTranslating?: boolean
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Captions</h2>
        <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
          {status === 'listening' ? (
            <>
              <Mic className="h-3.5 w-3.5" />
              Listening
            </>
          ) : status === 'paused' ? (
            <>
              <MicOff className="h-3.5 w-3.5" />
              Paused
            </>
          ) : (
            <>Idle</>
          )}
        </div>
      </div>

      <div className={cn('mt-3 h-[60vh] overflow-auto rounded-xl border border-slate-200 bg-white p-3')}>
        <div className="space-y-2">
          {segments.map((s) => (
            <div key={s.id} className="rounded-xl border border-slate-200 bg-white px-3 py-2">
              <div className="flex items-center justify-between">
                <div className="text-xs text-slate-500">
                  {s.speaker_label}
                  {s.detected_lang ? <span className="ml-2 text-slate-400">({s.detected_lang})</span> : null}
                </div>
                {s.is_edited ? <div className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700">edited</div> : null}
              </div>
              <div className="mt-1 text-sm text-slate-900">{s.text}</div>

              {translationsBySegmentId?.[s.id]?.length ? (
                <div className="mt-2 space-y-1">
                  {translationsBySegmentId[s.id]
                    .slice()
                    .sort((a, b) => a.target_lang.localeCompare(b.target_lang))
                    .map((t) => (
                      <div key={t.id} className="rounded-xl border border-slate-200 bg-slate-50 px-2 py-1">
                        <div className="text-[11px] text-slate-500">{t.target_lang}</div>
                        <div className="text-sm text-slate-900">{t.text}</div>
                      </div>
                    ))}
                </div>
              ) : isTranslating ? (
                <div className="mt-2 text-xs text-slate-500">Translating…</div>
              ) : null}
            </div>
          ))}

          {interim ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <div className="text-xs text-slate-500">Live</div>
              <div className="mt-1 text-sm text-slate-900">{interim}</div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
