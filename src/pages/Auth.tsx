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
    <div className="mx-auto max-w-md pt-12">
      <div className="border border-neutral-200 bg-white p-8 dark:border-neutral-800 dark:bg-black">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-xl font-bold uppercase tracking-widest text-black dark:text-white">
            {mode === 'signin' ? t('auth.signIn') : t('auth.createAccount')}
          </h1>
          <Link to="/live" className="text-xs uppercase tracking-wider text-neutral-500 hover:text-black dark:text-neutral-400 dark:hover:text-white">
            {t('common.back')}
          </Link>
        </div>

        <p className="mb-6 text-sm text-neutral-600 dark:text-neutral-300">{t('live.signInToStart')}</p>

        <form
          className="space-y-6"
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
            <span className="text-xs font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">{t('auth.email')}</span>
            <input
              className="minimal-input text-black dark:text-white mt-1"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <label className="block">
            <span className="text-xs font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">{t('auth.password')}</span>
            <input
              className="minimal-input text-black dark:text-white mt-1"
              type="password"
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
            />
          </label>

          {error ? (
            <div className="border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-900/10 dark:text-red-200">
              {error}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={busy}
            className="minimal-btn-primary w-full"
          >
            {busy ? t('auth.pleaseWait') : mode === 'signin' ? t('auth.signIn') : t('auth.createAccount')}
          </button>
        </form>

        <div className="mt-6 text-center text-sm">
          {mode === 'signin' ? (
            <button type="button" className="text-neutral-500 hover:text-black hover:underline dark:text-neutral-400 dark:hover:text-white" onClick={() => setMode('signup')}>
              {t('auth.needAccount')}
            </button>
          ) : (
            <button type="button" className="text-neutral-500 hover:text-black hover:underline dark:text-neutral-400 dark:hover:text-white" onClick={() => setMode('signin')}>
              {t('auth.haveAccount')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
