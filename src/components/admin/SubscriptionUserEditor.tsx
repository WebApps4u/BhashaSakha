import { cn } from '@/lib/utils'

type Plan = {
  code: string
  name: string
}

type SubscriptionEditable = {
  user_id: string
  email: string | null
  display_name: string
  plan_code: string
  effective_from: string | null
  override_monthly_request_limit: number | null
  override_monthly_char_limit: number | null
}

export default function SubscriptionUserEditor<T extends SubscriptionEditable>({
  value,
  plans,
  busy,
  onChange,
  onClose,
  onSave,
  onReset,
}: {
  value: T
  plans: Plan[]
  busy: boolean
  onChange: (next: T) => void
  onClose: () => void
  onSave: () => void
  onReset: () => void
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <div className="text-sm font-semibold">Manage subscription</div>
          <div className="mt-1 truncate text-xs text-slate-500">{value.email ?? value.user_id}</div>
        </div>
        <button type="button" onClick={onClose} className="text-sm text-slate-600 underline">
          Close
        </button>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <label className="block">
          <span className="text-xs text-slate-600">Plan</span>
          <select
            value={value.plan_code}
            onChange={(e) => onChange({ ...value, plan_code: e.target.value })}
            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
          >
            {plans.map((p) => (
              <option key={p.code} value={p.code}>
                {p.name} ({p.code})
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs text-slate-600">Effective from</span>
          <input
            value={value.effective_from ?? ''}
            onChange={(e) => onChange({ ...value, effective_from: e.target.value })}
            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
            placeholder="YYYY-MM-DD"
          />
        </label>
        <label className="block">
          <span className="text-xs text-slate-600">Override request limit (optional)</span>
          <input
            value={value.override_monthly_request_limit ?? ''}
            onChange={(e) => {
              const v = e.target.value.trim()
              onChange({ ...value, override_monthly_request_limit: v ? Number(v) : null })
            }}
            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
            placeholder="e.g. 500"
          />
        </label>
        <label className="block">
          <span className="text-xs text-slate-600">Override char limit (optional)</span>
          <input
            value={value.override_monthly_char_limit ?? ''}
            onChange={(e) => {
              const v = e.target.value.trim()
              onChange({ ...value, override_monthly_char_limit: v ? Number(v) : null })
            }}
            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
            placeholder="e.g. 250000"
          />
        </label>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <button
          type="button"
          disabled={busy}
          onClick={onSave}
          className={cn('rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-50')}
        >
          Save
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onReset}
          className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
        >
          Reset current month
        </button>
      </div>
    </div>
  )
}
