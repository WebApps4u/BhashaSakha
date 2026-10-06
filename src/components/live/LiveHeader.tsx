import { ArrowLeftRight, Share2, ExternalLink } from 'lucide-react'
import { Link } from 'react-router-dom'
import { LANGUAGES } from '@/utils/languages'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import type { LiveSection } from '@/lib/liveSections'

export type LiveMode = 'transcribe' | 'translate' | 'dubbing'

function LangSelect({
  value,
  onChange,
  allowAuto,
}: {
  value: string
  onChange: (value: string) => void
  allowAuto?: boolean
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full appearance-none border-b border-neutral-300 bg-transparent py-2 pr-8 text-center text-xl font-light text-black outline-none transition-colors hover:border-black focus:border-black dark:border-neutral-700 dark:text-white dark:hover:border-white dark:focus:border-white"
      >
        {allowAuto ? <option value="auto">Auto-detect</option> : null}
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code}>
            {l.label}
          </option>
        ))}
      </select>
      <div className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 opacity-50">
        <svg width="10" height="6" viewBox="0 0 10 6" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square"/>
        </svg>
      </div>
    </div>
  )
}

function Tab({
  active,
  children,
  onClick,
  disabled,
}: {
  active?: boolean
  children: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'pb-1 text-xs font-bold uppercase tracking-widest transition-all disabled:opacity-30',
        active
          ? 'border-b-2 border-black text-black dark:border-white dark:text-white'
          : 'border-b-2 border-transparent text-neutral-400 hover:text-black dark:text-neutral-500 dark:hover:text-white'
      )}
    >
      {children}
    </button>
  )
}

export default function LiveHeader({
  mode,
  onMode,
  section,
  privacy,
  onPrivacy,
  sourceLang,
  onSourceLang,
  targetLang,
  onTargetLang,
  onSwap,
  canShare,
  onOpenShare,
  editorHref,
  isSignedIn,
}: {
  mode: LiveMode
  onMode: (mode: LiveMode) => void
  section: LiveSection
  privacy: 'private' | 'shareable'
  onPrivacy: (privacy: 'private' | 'shareable') => void
  sourceLang: string
  onSourceLang: (value: string) => void
  targetLang: string
  onTargetLang: (value: string) => void
  onSwap: () => void
  canShare: boolean
  onOpenShare: () => void
  editorHref: string | null
  isSignedIn: boolean
}) {
  const { t } = useTranslation()
  return (
    <div className="mx-auto max-w-[1400px] px-6 py-12">
      <div className="flex flex-col items-center justify-center space-y-8">
        {/* Title Area */}
        <div className="text-center">
          <h1 className="text-4xl font-light tracking-tight text-black dark:text-white sm:text-5xl md:text-6xl">
            {section.id === 'general' ? t('live.title') : t(`live.sections.${section.id}.title`, { defaultValue: section.title })}
          </h1>
          <div className="mt-4 text-sm font-medium uppercase tracking-widest text-neutral-500 dark:text-neutral-400">
            {section.id === 'general' ? t('live.subtitle') : t(`live.sections.${section.id}.description`, { defaultValue: section.description })}
          </div>
        </div>

        {/* Privacy Toggles */}
        <div className="flex items-center gap-6">
          <button
            type="button"
            onClick={() => onPrivacy('private')}
            className={cn(
              'text-xs font-bold uppercase tracking-widest transition-colors',
              privacy === 'private' ? 'text-black dark:text-white' : 'text-neutral-400 hover:text-black dark:text-neutral-500 dark:hover:text-white'
            )}
          >
            {t('live.private')}
          </button>
          <div className="h-3 w-[1px] bg-neutral-300 dark:bg-neutral-700" />
          <button
            type="button"
            onClick={() => onPrivacy('shareable')}
            className={cn(
              'text-xs font-bold uppercase tracking-widest transition-colors',
              privacy === 'shareable' ? 'text-black dark:text-white' : 'text-neutral-400 hover:text-black dark:text-neutral-500 dark:hover:text-white'
            )}
          >
            {t('live.shareable')}
          </button>
        </div>

        {/* Mode Tabs */}
        <div className="flex items-center gap-8 border-b border-neutral-200 pb-px dark:border-neutral-800">
          <Tab active={mode === 'transcribe'} onClick={() => onMode('transcribe')}>{t('live.transcribe')}</Tab>
          <Tab active={mode === 'translate'} onClick={() => onMode('translate')}>{t('live.translate')}</Tab>
          <Tab active={mode === 'dubbing'} onClick={() => onMode('dubbing')} disabled>
            {t('live.dubbing')}
          </Tab>
        </div>

        {/* Language Selection Grid */}
        <div className="grid w-full max-w-2xl grid-cols-[1fr_auto_1fr] items-center gap-8 pt-8">
          <LangSelect value={sourceLang} onChange={onSourceLang} allowAuto />
          
          <button
            type="button"
            onClick={onSwap}
            disabled={sourceLang === 'auto' || mode !== 'translate'}
            className="group flex h-12 w-12 items-center justify-center border border-neutral-200 bg-white transition-all hover:border-black hover:bg-black hover:text-white disabled:opacity-30 dark:border-neutral-800 dark:bg-black dark:hover:border-white dark:hover:bg-white dark:hover:text-black"
            aria-label="Swap languages"
          >
            <ArrowLeftRight className="h-5 w-5 transition-transform group-hover:rotate-180" />
          </button>

          <LangSelect value={targetLang} onChange={(v) => onTargetLang(v)} />
        </div>

        {/* Action Bar */}
        <div className="flex w-full max-w-4xl items-center justify-between border-t border-neutral-200 pt-8 dark:border-neutral-800">
          <div className="flex flex-col gap-1">
            <div className="text-sm font-medium uppercase tracking-wider text-black dark:text-white">
              {t('live.pressAndTalk')}
            </div>
            <div className="text-xs text-neutral-500 dark:text-neutral-400">
              {isSignedIn ? t('live.signedInHint') : t('live.signedOutHint')}
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={onOpenShare}
              disabled={!canShare}
              className="group inline-flex items-center gap-2 border border-black bg-transparent px-5 py-2.5 text-xs font-bold uppercase tracking-widest text-black transition-all hover:bg-black hover:text-white disabled:opacity-50 dark:border-white dark:text-white dark:hover:bg-white dark:hover:text-black"
            >
              <Share2 className="h-4 w-4" />
              {t('live.share')}
            </button>
            
            {editorHref ? (
              <Link
                to={editorHref}
                className="inline-flex items-center gap-2 border border-black bg-black px-5 py-2.5 text-xs font-bold uppercase tracking-widest text-white transition-all hover:bg-neutral-800 dark:border-white dark:bg-white dark:text-black dark:hover:bg-neutral-200"
              >
                <ExternalLink className="h-4 w-4" />
                {t('live.openEditor')}
              </Link>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
