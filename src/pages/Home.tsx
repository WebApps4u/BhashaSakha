import { Link, useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import { useState } from 'react'
import { ArrowRight, Radio, ShieldCheck, Zap } from 'lucide-react'

export default function Home() {
  const navigate = useNavigate()
  const { user, isReady } = useAuthStore()
  const [publicId, setPublicId] = useState('')

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-white/10 to-white/5 p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Real-time transcription MVP</h1>
            <p className="mt-2 max-w-2xl text-sm text-white/70">
              Start a live session, generate captions using in-browser speech recognition, sync segments to Supabase, and share a public live view.
            </p>

            <div className="mt-4 flex flex-wrap gap-3 text-xs text-white/70">
              <div className="inline-flex items-center gap-2 rounded-md border border-white/10 bg-[#0F172A] px-3 py-2">
                <Zap className="h-4 w-4 text-[#60A5FA]" />
                Low-latency UI
              </div>
              <div className="inline-flex items-center gap-2 rounded-md border border-white/10 bg-[#0F172A] px-3 py-2">
                <Radio className="h-4 w-4 text-[#60A5FA]" />
                Live captions + Realtime
              </div>
              <div className="inline-flex items-center gap-2 rounded-md border border-white/10 bg-[#0F172A] px-3 py-2">
                <ShieldCheck className="h-4 w-4 text-[#60A5FA]" />
                Supabase Auth + RLS
              </div>
            </div>
          </div>

          <div className="w-full md:w-auto">
            {!isReady ? (
              <div className="h-10 w-full animate-pulse rounded-md bg-white/10 md:w-40" />
            ) : user ? (
              <Link
                to="/dashboard"
                className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-[#60A5FA] px-4 py-2 text-sm font-medium text-[#0B1220] transition hover:brightness-105 md:w-auto"
              >
                Go to dashboard
                <ArrowRight className="h-4 w-4" />
              </Link>
            ) : (
              <Link
                to="/auth"
                className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-[#60A5FA] px-4 py-2 text-sm font-medium text-[#0B1220] transition hover:brightness-105 md:w-auto"
              >
                Sign in to start
                <ArrowRight className="h-4 w-4" />
              </Link>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-white/10 bg-white/5 p-5">
          <h2 className="text-sm font-semibold">Start a live session</h2>
          <p className="mt-1 text-sm text-white/70">Sign in to create a session and capture microphone captions.</p>
          <div className="mt-4">
            <Link
              to={user ? '/dashboard' : '/auth'}
              className="inline-flex items-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/90 transition hover:bg-white/10"
            >
              {user ? 'Open dashboard' : 'Sign in'}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>

        <div className="rounded-xl border border-white/10 bg-white/5 p-5">
          <h2 className="text-sm font-semibold">Open a public shared view</h2>
          <p className="mt-1 text-sm text-white/70">Paste a public session ID to view live captions.</p>

          <form
            className="mt-4 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              const id = publicId.trim()
              if (!id) return
              navigate(`/s/${id}`)
            }}
          >
            <input
              className="w-full rounded-md border border-white/10 bg-[#0F172A] px-3 py-2 text-sm outline-none focus:border-[#60A5FA]"
              placeholder="Public session ID"
              value={publicId}
              onChange={(e) => setPublicId(e.target.value)}
            />
            <button
              type="submit"
              className="inline-flex items-center gap-2 rounded-md bg-[#60A5FA] px-4 py-2 text-sm font-medium text-[#0B1220] transition hover:brightness-105"
            >
              Open
              <ArrowRight className="h-4 w-4" />
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
