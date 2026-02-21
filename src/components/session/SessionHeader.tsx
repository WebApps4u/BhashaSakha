import { Link } from 'react-router-dom'
import { cn } from '@/lib/utils'

export default function SessionHeader({
  title,
  visibility,
  tab,
  canEdit,
  onTab,
  supportsSpeech,
}: {
  title: string
  visibility: 'private' | 'public'
  tab: 'live' | 'edit'
  canEdit: boolean
  supportsSpeech: boolean
  onTab: (tab: 'live' | 'edit') => void
}) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm md:flex-row md:items-center md:justify-between dark:border-white/10 dark:bg-white/5">
      <div>
        <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-300">
          <Link to="/dashboard" className="hover:text-slate-900 dark:hover:text-slate-50">
            Dashboard
          </Link>
          <span>•</span>
          <span
            className={cn(
              'rounded-full px-3 py-1',
              visibility === 'public'
                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200'
                : 'bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-200'
            )}
          >
            {visibility}
          </span>
        </div>
        <h1 className="mt-2 text-lg font-semibold tracking-tight">{title}</h1>
        {!supportsSpeech ? (
          <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">SpeechRecognition not supported in this browser.</div>
        ) : (
          <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">Live captions are stored as segments in Supabase.</div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onTab('live')}
          className={cn(
            'rounded-xl px-3 py-2 text-sm transition',
            tab === 'live'
              ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
              : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:hover:bg-white/10'
          )}
        >
          Live
        </button>
        <button
          type="button"
          disabled={!canEdit}
          onClick={() => onTab('edit')}
          className={cn(
            'rounded-xl px-3 py-2 text-sm transition',
            tab === 'edit'
              ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
              : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:hover:bg-white/10',
            !canEdit ? 'opacity-50' : ''
          )}
        >
          Edit
        </button>
      </div>
    </div>
  )
}
