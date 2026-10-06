import { useState } from 'react'
import { CheckCircle2, ChevronDown, XCircle } from 'lucide-react'
import type { ProbeResult } from '@/lib/adminApi'

export function ProbeResultLine({ result }: { result: ProbeResult }) {
  const [open, setOpen] = useState(false)
  return (
    <div className={'rounded-lg px-3 py-2 text-sm ' + (result.ok ? 'bg-emerald-50 text-emerald-900' : 'bg-rose-50 text-rose-900')}>
      <div className="flex items-start gap-2">
        {result.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0" />}
        <div className="min-w-0 flex-1">
          <div>
            {result.message}
            {result.latency_ms ? <span className="opacity-70"> · {(result.latency_ms / 1000).toFixed(1)}s</span> : null}
            {result.key_source ? <span className="opacity-70"> · {result.key_source}</span> : null}
          </div>
          {!result.ok && result.preview ? (
            <button type="button" onClick={() => setOpen(!open)} className="mt-1 inline-flex items-center gap-1 text-xs underline">
              <ChevronDown className={'h-3 w-3 transition ' + (open ? 'rotate-180' : '')} /> Provider response
            </button>
          ) : null}
          {open && result.preview ? <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all text-xs opacity-80">{result.preview}</pre> : null}
        </div>
      </div>
    </div>
  )
}

export function ModelInput({ value, onChange, models, loading, id }: { value: string; onChange: (v: string) => void; models: string[]; loading: boolean; id: string }) {
  const known = !value || !models.length || models.includes(value)
  return (
    <div className="min-w-0 flex-1">
      <input
        list={`${id}-models`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={loading ? 'Loading models…' : 'Choose or type a model name'}
        aria-label="Model name"
        className={'w-full rounded-xl border bg-white px-3 py-2 text-sm ' + (known ? 'border-slate-200' : 'border-amber-400')}
      />
      <datalist id={`${id}-models`}>
        {models.map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
      {!known ? <div className="mt-1 text-xs text-amber-800">Not in this provider's model list — check the spelling.</div> : null}
    </div>
  )
}
