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
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/20 p-4 dark:bg-black/60" role="dialog" aria-modal="true">
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-xl dark:border-white/10 dark:bg-slate-950">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-semibold">Share live view</div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-300">Anyone with the link can watch live captions.</div>
          </div>
          <button type="button" onClick={onClose} className="text-sm text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-50">
            Close
          </button>
        </div>

        <div className="mt-4">
          <div className="text-xs text-slate-600 dark:text-slate-300">Link</div>
          <div className="mt-1 flex gap-2">
            <input
              readOnly
              value={shareUrl}
              className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 dark:border-white/10 dark:bg-white/5 dark:text-slate-50"
            />
            <button
              type="button"
              onClick={async () => {
                if (!shareUrl) return
                await navigator.clipboard.writeText(shareUrl)
              }}
              className="h-10 rounded-xl bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100"
            >
              Copy
            </button>
          </div>
          <div className="mt-3 text-xs text-slate-500 dark:text-slate-300">Open link on another device to see realtime updates.</div>
        </div>
      </div>
    </div>
  )
}
