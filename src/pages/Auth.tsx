import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabaseClient'

export default function Auth() {
  const navigate = useNavigate()
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  return (
    <div className="mx-auto max-w-md">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-white/5">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">{mode === 'signin' ? 'Sign in' : 'Create account'}</h1>
          <Link to="/live" className="text-sm text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-50">
            Back
          </Link>
        </div>

        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Sign in to save sessions, share links, and export.</p>

        <form
          className="mt-4 space-y-3"
          onSubmit={async (e) => {
            e.preventDefault()
            setBusy(true)
            setError(null)

            try {
              if (mode === 'signin') {
                const { data, error: signInError } = await supabase.auth.signInWithPassword({
                  email,
                  password,
                })
                if (signInError) throw signInError

                if (data.user) {
                  await supabase.from('profiles').upsert({
                    id: data.user.id,
                    display_name: data.user.email ?? '',
                  })
                }
              } else {
                const { data, error: signUpError } = await supabase.auth.signUp({
                  email,
                  password,
                })
                if (signUpError) throw signUpError

                if (data.user) {
                  await supabase.from('profiles').upsert({
                    id: data.user.id,
                    display_name: data.user.email ?? '',
                  })
                }
              }

              navigate('/dashboard')
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Authentication failed')
            } finally {
              setBusy(false)
            }
          }}
        >
          <label className="block">
            <span className="text-xs text-slate-600 dark:text-slate-300">Email</span>
            <input
              className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-300 dark:border-white/10 dark:bg-white/5 dark:text-slate-50"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <label className="block">
            <span className="text-xs text-slate-600 dark:text-slate-300">Password</span>
            <input
              className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-300 dark:border-white/10 dark:bg-white/5 dark:text-slate-50"
              type="password"
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
            />
          </label>

          {error ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-100">
              {error}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={busy}
            className="inline-flex w-full items-center justify-center rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-50 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100"
          >
            {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <div className="mt-4 text-sm text-slate-600 dark:text-slate-300">
          {mode === 'signin' ? (
            <button type="button" className="underline hover:text-slate-900 dark:hover:text-slate-50" onClick={() => setMode('signup')}>
              Need an account? Sign up
            </button>
          ) : (
            <button type="button" className="underline hover:text-slate-900 dark:hover:text-slate-50" onClick={() => setMode('signin')}>
              Already have an account? Sign in
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
