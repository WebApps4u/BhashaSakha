import { Link } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'

export default function Account() {
  const { user, isReady } = useAuthStore()

  if (!isReady) {
    return <div className="h-24 animate-pulse rounded-xl bg-slate-100" />
  }

  if (!user) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="text-sm text-slate-700">Sign in to manage your account.</div>
        <div className="mt-3">
          <Link to="/login" className="text-sm font-medium text-slate-900 underline">
            Go to login
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-6">
        <h1 className="text-lg font-semibold">Account</h1>
        <div className="mt-1 text-sm text-slate-600">Signed in as {user.email ?? user.id}</div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-6">
          <div className="text-sm font-semibold">Plan</div>
          <div className="mt-1 text-sm text-slate-600">Billing UI can be added here.</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-6">
          <div className="text-sm font-semibold">Integrations</div>
          <div className="mt-1 text-sm text-slate-600">Zoom/OBS/Teams hooks can be added here.</div>
        </div>
      </div>
    </div>
  )
}
