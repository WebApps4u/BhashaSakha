import { X, Copy } from 'lucide-react'

export default function LiveShareModal({
  open,
  shareUrl,
  onClose,
}: {
  open: boolean
  shareUrl: string
  onClose: () => void
}) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/80 p-4 backdrop-blur-sm dark:bg-black/80" role="dialog" aria-modal="true">
      <div className="w-full max-w-lg border border-neutral-200 bg-white p-8 shadow-2xl dark:border-neutral-800 dark:bg-black">
        <div className="flex items-start justify-between mb-8">
          <div>
            <h2 className="text-xl font-bold uppercase tracking-widest text-black dark:text-white">Share View</h2>
            <div className="mt-1 text-xs uppercase tracking-wider text-neutral-500 dark:text-neutral-400">Anyone with the link can watch live captions.</div>
          </div>
          <button 
            type="button" 
            onClick={onClose} 
            className="group p-2 text-black transition-colors hover:bg-black hover:text-white dark:text-white dark:hover:bg-white dark:hover:text-black"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-4">
          <div className="text-xs font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400 mb-2">Link</div>
          <div className="flex gap-0 border border-neutral-200 dark:border-neutral-800">
            <input
              readOnly
              value={shareUrl}
              className="w-full bg-transparent px-4 py-3 text-sm text-black outline-none dark:text-white"
            />
            <button
              type="button"
              onClick={async () => {
                if (!shareUrl) return
                await navigator.clipboard.writeText(shareUrl)
              }}
              className="flex items-center gap-2 border-l border-neutral-200 bg-neutral-50 px-6 py-3 text-xs font-bold uppercase tracking-widest text-black transition-colors hover:bg-black hover:text-white dark:border-neutral-800 dark:bg-neutral-900 dark:text-white dark:hover:bg-white dark:hover:text-black"
            >
              <Copy className="h-4 w-4" />
              Copy
            </button>
          </div>
          <div className="mt-4 text-[10px] uppercase tracking-wider text-neutral-400 dark:text-neutral-500">Open link on another device to see realtime updates.</div>
        </div>
      </div>
    </div>
  )
}
