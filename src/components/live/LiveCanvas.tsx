import { Volume2 } from 'lucide-react'

export default function LiveCanvas({
  showRight,
  leftLines,
  interim,
  rightLines,
  translatingIds,
  footerLeft,
  languageChip,
  ttsEnabled,
}: {
  showRight: boolean
  leftLines: Array<{ id: string; text: string }>
  interim: string
  rightLines: Array<{ id: string; text: string }>
  translatingIds: Record<string, true>
  footerLeft: string
  languageChip: string
  ttsEnabled: boolean
}) {
  return (
    <div className="relative mx-auto max-w-6xl px-4 pb-32">
      <div className={showRight ? 'grid gap-6 md:grid-cols-2' : ''}>
        <div className="min-h-[46vh] rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex h-full flex-col justify-end">
            {leftLines.length === 0 ? (
              <div className="text-center text-sm text-slate-400">You can start speaking now…</div>
            ) : (
              <div className="space-y-2">
                {leftLines.slice(-18).map((l) => (
                  <div key={l.id} className="text-base leading-6 text-slate-900">
                    {l.text}
                  </div>
                ))}
                {interim ? <div className="text-base text-slate-500">{interim}</div> : null}
              </div>
            )}
          </div>
        </div>

        {showRight ? (
          <div className="min-h-[46vh] rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex h-full flex-col justify-end">
              {rightLines.length === 0 ? (
                <div className="text-center text-sm text-slate-400">Translation will appear here…</div>
              ) : (
                <div className="space-y-2">
                  {rightLines.slice(-18).map((l) => (
                    <div key={l.id} className="relative pl-3 text-base leading-6 text-slate-900">
                      <div className="absolute left-0 top-1.5 h-4 w-[2px] rounded bg-slate-200" />
                      {l.text || (translatingIds[l.id] ? 'Translating…' : '')}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : null}
      </div>

      <div className="mt-4 flex items-center justify-between">
        <div className="text-xs text-slate-500">{footerLeft}</div>
        <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 shadow-sm">
          {languageChip}
          {ttsEnabled ? <Volume2 className="h-3.5 w-3.5 text-slate-500" /> : null}
        </div>
      </div>
    </div>
  )
}
