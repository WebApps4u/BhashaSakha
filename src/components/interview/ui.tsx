import type { ReactNode } from 'react'
import { Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import { PERSONA_ACCENT, initials } from '@/lib/interview/options'
import type { Panelist } from '@/lib/interview/types'

export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('text-[10px] font-bold uppercase tracking-[0.2em] text-neutral-500 dark:text-neutral-400', className)}>{children}</div>
}

export function AiBadge({ changed, onReset }: { changed?: boolean; onReset?: () => void }) {
  if (changed) {
    return (
      <span className="inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
        Changed
        {onReset ? (
          <button type="button" onClick={onReset} className="underline underline-offset-2 hover:text-black dark:hover:text-white">
            Reset
          </button>
        ) : null}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 bg-black px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white dark:bg-white dark:text-black">
      <Sparkles className="h-2.5 w-2.5" aria-hidden="true" />
      AI recommended
    </span>
  )
}

export function Chip({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'solid' | 'warn' | 'good' }) {
  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-1 text-xs',
        tone === 'solid' && 'bg-black text-white dark:bg-white dark:text-black',
        tone === 'neutral' && 'border border-neutral-200 text-neutral-700 dark:border-neutral-800 dark:text-neutral-300',
        tone === 'warn' && 'border border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200',
        tone === 'good' && 'border border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-200',
      )}
    >
      {children}
    </span>
  )
}

export function PanelistAvatar({ panelist, size = 'md', className }: { panelist: Panelist; size?: 'sm' | 'md' | 'lg' | 'xl'; className?: string }) {
  const accent = PERSONA_ACCENT[panelist.kind]
  return (
    <div
      aria-hidden="true"
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full font-semibold tracking-wide',
        accent.avatar,
        size === 'sm' && 'h-8 w-8 text-[11px]',
        size === 'md' && 'h-11 w-11 text-sm',
        size === 'lg' && 'h-16 w-16 text-lg',
        size === 'xl' && 'h-24 w-24 text-2xl sm:h-28 sm:w-28 sm:text-3xl',
        className,
      )}
    >
      {initials(panelist.name)}
    </div>
  )
}

/** Light-surface avatar for setup and report pages (call-room avatars use the dark variant). */
export function PanelistRow({ panelist }: { panelist: Panelist }) {
  return (
    <div className="flex items-center gap-3">
      <PanelistAvatar panelist={panelist} className="!bg-neutral-900 !text-white dark:!bg-neutral-100 dark:!text-black" />
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-black dark:text-white">{panelist.name}</div>
        <div className="truncate text-xs text-neutral-500">
          {panelist.title} · {panelist.kind_label}
        </div>
      </div>
    </div>
  )
}

export function ScoreBar({ label, value, hint }: { label: string; value: number | null | undefined; hint?: string }) {
  const v = typeof value === 'number' ? Math.max(0, Math.min(100, value)) : null
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm text-neutral-700 dark:text-neutral-300">{label}</span>
        <span className="text-sm font-semibold tabular-nums text-black dark:text-white">{v == null ? '—' : `${v}%`}</span>
      </div>
      <div className="mt-1.5 h-1.5 w-full bg-neutral-100 dark:bg-neutral-900" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={v ?? undefined}>
        {v != null ? <div className="h-full bg-black transition-all duration-700 dark:bg-white" style={{ width: `${v}%` }} /> : null}
      </div>
      {hint ? <div className="mt-1 text-xs text-neutral-500">{hint}</div> : null}
    </div>
  )
}

export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-2" aria-label="Setup progress">
      {steps.map((label, i) => (
        <li key={label} className="flex items-center gap-2">
          <span
            aria-current={i === current ? 'step' : undefined}
            className={cn(
              'flex h-6 w-6 items-center justify-center text-[10px] font-bold',
              i < current && 'bg-neutral-300 text-black dark:bg-neutral-700 dark:text-white',
              i === current && 'bg-black text-white dark:bg-white dark:text-black',
              i > current && 'border border-neutral-300 text-neutral-400 dark:border-neutral-700',
            )}
          >
            {i + 1}
          </span>
          <span className={cn('hidden text-[10px] font-semibold uppercase tracking-widest sm:inline', i === current ? 'text-black dark:text-white' : 'text-neutral-400')}>{label}</span>
          {i < steps.length - 1 ? <span className="mx-1 h-px w-4 bg-neutral-300 dark:bg-neutral-700 sm:w-8" aria-hidden="true" /> : null}
        </li>
      ))}
    </ol>
  )
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
      {children}
    </div>
  )
}
