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
    <div className="minimal-card flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
      <div>
        <div className="flex items-center gap-3 text-xs uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
          <Link to="/dashboard" className="hover:text-black hover:underline dark:hover:text-white">
            Dashboard
          </Link>
          <span className="text-neutral-300 dark:text-neutral-700">/</span>
          <span
            className={cn(
              'border px-2 py-0.5 text-[10px] font-bold',
              visibility === 'public'
                ? 'border-black text-black dark:border-white dark:text-white'
                : 'border-neutral-200 text-neutral-500 dark:border-neutral-800 dark:text-neutral-400'
            )}
          >
            {visibility}
          </span>
        </div>
        <h1 className="mt-4 text-2xl font-light tracking-tight text-black dark:text-white">{title}</h1>
        {!supportsSpeech ? (
          <div className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">SpeechRecognition not supported in this browser.</div>
        ) : (
          <div className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">Live captions are stored as segments in Supabase.</div>
        )}
      </div>

      <div className="flex items-center gap-8 border-b border-neutral-200 dark:border-neutral-800">
        <button
          type="button"
          onClick={() => onTab('live')}
          className={cn(
            'pb-2 text-xs font-bold uppercase tracking-widest transition-all',
            tab === 'live'
              ? 'border-b-2 border-black text-black dark:border-white dark:text-white'
              : 'border-b-2 border-transparent text-neutral-400 hover:text-black dark:text-neutral-500 dark:hover:text-white'
          )}
        >
          Live
        </button>
        <button
          type="button"
          disabled={!canEdit}
          onClick={() => onTab('edit')}
          className={cn(
            'pb-2 text-xs font-bold uppercase tracking-widest transition-all',
            tab === 'edit'
              ? 'border-b-2 border-black text-black dark:border-white dark:text-white'
              : 'border-b-2 border-transparent text-neutral-400 hover:text-black dark:text-neutral-500 dark:hover:text-white',
            !canEdit ? 'opacity-30' : ''
          )}
        >
          Edit
        </button>
      </div>
    </div>
  )
}
