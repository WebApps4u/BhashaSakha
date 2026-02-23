export default function Setup({ error }: { error?: string | null }) {
  return (
    <div className="min-h-screen bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-50">
      <div className="mx-auto max-w-3xl px-4 py-10">
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-slate-200">
          <div className="text-base font-semibold">Local setup required</div>
          <div className="mt-2 text-slate-600 dark:text-slate-300">
            This app requires Supabase environment variables to run.
          </div>
          {error ? (
            <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
              {error}
            </div>
          ) : null}

          <div className="mt-4 space-y-2 text-slate-700 dark:text-slate-200">
            <div className="font-medium">Fix</div>
            <ol className="list-decimal space-y-1 pl-5">
              <li>
                Create a <span className="font-mono">.env</span> file in the project root (copy from{' '}
                <span className="font-mono">.env.example</span>).
              </li>
              <li>
                Set <span className="font-mono">VITE_SUPABASE_URL</span> and{' '}
                <span className="font-mono">VITE_SUPABASE_ANON_KEY</span>.
              </li>
              <li>Restart the dev server and reload the page.</li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  )
}

