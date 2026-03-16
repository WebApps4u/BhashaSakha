import { Mic, Pause, Settings } from 'lucide-react'
import type { SpeechStatus } from '@/hooks/useSpeechCaptions'
import { cn } from '@/lib/utils'

const primaryButtonLabel: Record<SpeechStatus, string> = {
  idle: 'Start',
  listening: 'Stop',
  paused: 'Resume',
}

export default function LiveFloatingControls({
  status,
  isDetecting,
  supportsSpeech,
  onPrimary,
  onPause,
  onSettings,
}: {
  status: SpeechStatus
  isDetecting?: boolean
  supportsSpeech: boolean
  onPrimary: () => void
  onPause: () => void
  onSettings: () => void
}) {
  const isListening = status === 'listening'

  return (
    <div className="pointer-events-none fixed bottom-0 left-0 right-0 z-30 pb-12">
      <div className="mx-auto flex max-w-fit items-center justify-center">
        <div className="pointer-events-auto flex items-center gap-0 bg-white dark:bg-black border border-neutral-100 dark:border-neutral-900 shadow-[0_20px_50px_rgba(0,0,0,0.1)] dark:shadow-none">
          <button
            type="button"
            onClick={onPause}
            disabled={!supportsSpeech || status !== 'listening' || isDetecting}
            className="group flex h-16 w-16 items-center justify-center border-r border-neutral-100 bg-transparent transition-all hover:bg-black hover:text-white disabled:opacity-20 dark:border-neutral-900 dark:hover:bg-white dark:hover:text-black text-black dark:text-white"
            aria-label="Pause"
          >
            <Pause className="h-5 w-5" />
          </button>

          <button
            type="button"
            onClick={onPrimary}
            disabled={!supportsSpeech || isDetecting}
            className={cn(
              'flex h-20 w-32 items-center justify-center transition-all disabled:opacity-20 border-r border-neutral-100 dark:border-neutral-900',
              isListening || isDetecting
                ? 'bg-black text-white dark:bg-white dark:text-black' 
                : 'bg-transparent text-black dark:text-white hover:bg-neutral-50 dark:hover:bg-neutral-900'
            )}
          >
            {isDetecting ? (
               <div className="h-5 w-5 animate-spin border-2 border-current border-t-transparent rounded-full" />
            ) : isListening ? (
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 animate-pulse bg-current rounded-full" />
                <span className="text-[10px] font-bold uppercase tracking-widest">Live</span>
              </div>
            ) : (
              <Mic className="h-6 w-6" />
            )}
          </button>

          <button
            type="button"
            onClick={onSettings}
            className="group flex h-16 w-16 items-center justify-center bg-transparent transition-all hover:bg-black hover:text-white dark:hover:bg-white dark:hover:text-black text-black dark:text-white"
            aria-label="Settings"
          >
            <Settings className="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>
  )
}
