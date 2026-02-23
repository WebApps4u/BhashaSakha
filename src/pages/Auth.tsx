import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabaseClient'
import { useTranslation } from 'react-i18next'

export default function Auth() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const ensureWelcomeSession = async (userId: string) => {
    const { data: existing } = await supabase.from('sessions').select('id').eq('owner_id', userId).limit(1)
    if ((existing ?? []).length) return

    const { data: created, error: sessionErr } = await supabase
      .from('sessions')
      .insert({
        owner_id: userId,
        title: 'Welcome demo session',
        source_lang: 'auto',
        target_langs: ['en', 'hi'],
        visibility: 'private',
        started_at: new Date().toISOString(),
      })
      .select('id')
      .single()
    if (sessionErr || !created?.id) return

    const { data: seg } = await supabase
      .from('transcript_segments')
      .insert({
        session_id: created.id,
        seq: 1,
        speaker_label: 'Speaker 1',
        start_ms: 0,
        end_ms: 1500,
        text: 'Hello! This is a demo segment.',
        is_final: true,
        is_edited: false,
        detected_lang: 'en',
      })
      .select('id')
      .single()

    if (!seg?.id) return
    await supabase.from('translations').upsert({
      segment_id: seg.id,
      target_lang: 'hi',
      text: 'Namaste! Yeh demo segment hai.',
    })
  }

  return (
    <div className="mx-auto max-w-md">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-white/5">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">{mode === 'signin' ? t('auth.signIn') : t('auth.createAccount')}</h1>
          <Link to="/live" className="text-sm text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-50">
            {t('common.back')}
          </Link>
        </div>

        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{t('live.signInToStart')}</p>

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
                    email: data.user.email ?? '',
                  })

                  const { data: prof } = await supabase.from('profiles').select('is_blocked').eq('id', data.user.id).maybeSingle()
                  if ((prof as any)?.is_blocked) {
                    await supabase.auth.signOut()
                    throw new Error('Your account is blocked. Contact support.')
                  }
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
                    email: data.user.email ?? '',
                  })

                  await ensureWelcomeSession(data.user.id)

                  const { data: prof } = await supabase.from('profiles').select('is_blocked').eq('id', data.user.id).maybeSingle()
                  if ((prof as any)?.is_blocked) {
                    await supabase.auth.signOut()
                    throw new Error('Your account is blocked. Contact support.')
                  }
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
            <span className="text-xs text-slate-600 dark:text-slate-300">{t('auth.email')}</span>
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
            <span className="text-xs text-slate-600 dark:text-slate-300">{t('auth.password')}</span>
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
            {busy ? t('auth.pleaseWait') : mode === 'signin' ? t('auth.signIn') : t('auth.createAccount')}
          </button>
        </form>

        <div className="mt-4 text-sm text-slate-600 dark:text-slate-300">
          {mode === 'signin' ? (
            <button type="button" className="underline hover:text-slate-900 dark:hover:text-slate-50" onClick={() => setMode('signup')}>
              {t('auth.needAccount')}
            </button>
          ) : (
            <button type="button" className="underline hover:text-slate-900 dark:hover:text-slate-50" onClick={() => setMode('signin')}>
              {t('auth.haveAccount')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
