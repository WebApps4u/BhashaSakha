import { Volume2, VolumeX } from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { extractRisks } from '@/utils/risk'

function HighlightedText({
  text,
  enabled,
}: {
  text: string
  enabled: boolean
}) {
  if (!enabled) return <>{text}</>

  const risks = extractRisks(text)
  if (!risks.length) return <>{text}</>

  const parts: Array<{ key: string; node: ReactNode }> = []
  let cursor = 0
  for (let i = 0; i < risks.length; i++) {
    const r = risks[i]
    if (r.start > cursor) {
      parts.push({ key: `t-${i}-a`, node: text.slice(cursor, r.start) })
    }
    parts.push({
      key: `t-${i}-b`,
      node: (
        <span className="bg-neutral-900/5 px-2 py-0.5 underline decoration-neutral-500/50 underline-offset-[6px] dark:bg-white/10">
          {text.slice(r.start, r.end)}
        </span>
      ),
    })
    cursor = r.end
  }
  if (cursor < text.length) {
    parts.push({ key: `t-end`, node: text.slice(cursor) })
  }

  return <>{parts.map((p) => <span key={p.key}>{p.node}</span>)}</>
}

export default function LiveCanvas({
  showRight,
  leftLines,
  interim,
  rightLines,
  translatingIds,
  footerLeft,
  languageChip,
  ttsEnabled,
  onToggleTts,
  highlightRisks,
}: {
  showRight: boolean
  leftLines: Array<{ id: string; text: string }>
  interim: string
  rightLines: Array<{ id: string; text: string }>
  translatingIds: Record<string, true>
  footerLeft: string
  languageChip: string
  ttsEnabled: boolean
  onToggleTts?: () => void
  highlightRisks?: boolean
}) {
  const leftScrollRef = useRef<HTMLDivElement | null>(null)
  const rightScrollRef = useRef<HTMLDivElement | null>(null)

  const scrollToBottom = (el: HTMLDivElement | null) => {
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom(leftScrollRef.current)
  }, [leftLines.length, interim])

  useEffect(() => {
    scrollToBottom(rightScrollRef.current)
  }, [rightLines.length])

  return (
    <div className="relative mx-auto h-full w-full max-w-[1600px] px-8">
      {/* Central Divider Hairline */}
      {showRight && (
        <div className="absolute left-1/2 top-0 h-full w-[1px] -translate-x-1/2 bg-neutral-100 dark:bg-neutral-900" />
      )}

      <div className={cn('grid h-full gap-0', showRight ? 'md:grid-cols-2' : 'max-w-3xl mx-auto')}>
        {/* Left Panel: Original Speech */}
        <div className={cn('h-full overflow-hidden transition-all duration-500', showRight ? 'pr-12' : '')}>
          <div
            ref={leftScrollRef}
            className="h-full overflow-y-auto pb-40 pt-10 [scrollbar-width:none]"
            style={{ WebkitOverflowScrolling: 'touch' } as any}
          >
            <div className="min-h-full flex flex-col justify-end">
              <div className="space-y-10">
                {leftLines.map((l) => (
                  <div key={l.id} className="animate-in fade-in slide-in-from-bottom-4 duration-700">
                    <div className="text-3xl font-extralight leading-tight tracking-tight text-black dark:text-white md:text-5xl lg:text-6xl opacity-90">
                      <HighlightedText text={l.text.toLowerCase()} enabled={!!highlightRisks} />
                    </div>
                  </div>
                ))}
                {interim ? (
                  <div className="text-3xl font-extralight leading-tight tracking-tight text-neutral-300 dark:text-neutral-600 md:text-5xl lg:text-6xl">
                    <HighlightedText text={interim.toLowerCase()} enabled={!!highlightRisks} />
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        {/* Right Panel: Translation */}
        {showRight ? (
          <div className="h-full overflow-hidden pl-12 transition-all duration-500">
            <div
              ref={rightScrollRef}
              className="h-full overflow-y-auto pb-40 pt-10 [scrollbar-width:none]"
              style={{ WebkitOverflowScrolling: 'touch' } as any}
            >
              <div className="min-h-full flex flex-col justify-end">
                <div className="space-y-10">
                  {rightLines.map((l) => (
                    <div key={l.id} className="animate-in fade-in slide-in-from-bottom-4 duration-700">
                      <div className="text-3xl font-extralight leading-tight tracking-tight text-black dark:text-white md:text-5xl lg:text-6xl opacity-90">
                        {l.text ? (
                          <HighlightedText text={l.text} enabled={!!highlightRisks} />
                        ) : translatingIds[l.id] ? (
                          <span className="animate-pulse text-neutral-200">...</span>
                        ) : (
                          ''
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {/* Footer Info */}
      <div className="fixed bottom-0 left-0 right-0 z-20 px-8 pb-8 pointer-events-none">
        <div className="mx-auto max-w-[1600px] flex items-center justify-between">
            <div className="text-[10px] font-bold uppercase tracking-[0.3em] text-neutral-400 dark:text-neutral-600">{footerLeft}</div>
            <button
            type="button"
            onClick={onToggleTts}
            disabled={!onToggleTts}
            className="pointer-events-auto group inline-flex items-center gap-4 transition-colors disabled:opacity-50"
            >
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-neutral-400 group-hover:text-black dark:text-neutral-600 dark:group-hover:text-white">
                {languageChip}
            </span>
            {ttsEnabled ? (
                <Volume2 className="h-4 w-4 text-black dark:text-white" />
            ) : (
                <VolumeX className="h-4 w-4 text-neutral-300 dark:text-neutral-700" />
            )}
            </button>
        </div>
      </div>
    </div>
  )
}
