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
    <div className="minimal-card h-full">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-sm font-bold uppercase tracking-widest text-black dark:text-white">Captions</h2>
        <div className="inline-flex items-center gap-2 border border-neutral-200 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-neutral-600 dark:border-neutral-800 dark:text-neutral-300">
          {status === 'listening' ? (
            <>
              <Mic className="h-3 w-3" />
              Listening
            </>
          ) : status === 'paused' ? (
            <>
              <MicOff className="h-3 w-3" />
              Paused
            </>
          ) : (
            <>Idle</>
          )}
        </div>
      </div>

      <div className={cn('h-[60vh] overflow-auto pr-2')}>
        <div className="space-y-6">
          {segments.map((s) => (
            <div key={s.id} className="group relative border-l-2 border-transparent pl-4 hover:border-neutral-200 dark:hover:border-neutral-800">
              <div className="flex items-center justify-between mb-1">
                <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">
                  {s.speaker_label}
                  {s.detected_lang ? <span className="ml-2 text-neutral-300">({s.detected_lang})</span> : null}
                </div>
                {s.is_edited ? <div className="text-[9px] uppercase tracking-widest text-neutral-400">edited</div> : null}
              </div>
              <div className="text-lg font-light leading-relaxed text-black dark:text-white">{s.text}</div>

              {translationsBySegmentId?.[s.id]?.length ? (
                <div className="mt-3 space-y-2 border-l border-neutral-200 pl-4 dark:border-neutral-800">
                  {translationsBySegmentId[s.id]
                    .slice()
                    .sort((a, b) => a.target_lang.localeCompare(b.target_lang))
                    .map((t) => (
                      <div key={t.id}>
                        <div className="text-[10px] uppercase tracking-wider text-neutral-400 mb-0.5">{t.target_lang}</div>
                        <div className="text-base font-light text-neutral-700 dark:text-neutral-300">{t.text}</div>
                      </div>
                    ))}
                </div>
              ) : isTranslating ? (
                <div className="mt-2 text-xs italic text-neutral-400">Translating…</div>
              ) : null}
            </div>
          ))}

          {interim ? (
            <div className="border-l-2 border-black pl-4 dark:border-white">
              <div className="text-[10px] font-bold uppercase tracking-wider text-black dark:text-white mb-1">Live</div>
              <div className="text-lg font-light leading-relaxed text-black dark:text-white">{interim}</div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
