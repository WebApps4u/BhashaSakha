import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, ArrowDown, ArrowUp, CheckCircle2, ChevronDown, FlaskConical, Hash, Loader2, Plus, RefreshCw, Save, Trash2, Undo2 } from 'lucide-react'
import { useGlobalLoading } from '@/hooks/useGlobalLoading'
import { adminApi, type AiModelView, type AiOverview, type AiProviderView, type ProbeResult } from '@/lib/adminApi'
import { ModelInput, ProbeResultLine } from '@/components/admin/AiParts'
import { useProviderModels } from '@/hooks/useProviderModels'

type DraftStep = { provider_id: string; provider_model_name: string }
type RouteTest = { ok: boolean; attempts: Array<ProbeResult & { provider_name: string; provider_model_name: string | null; skipped?: boolean }> }

const limitText = (limit: { enabled: boolean; monthly_request_limit: number }) =>
  !limit.enabled ? 'not included' : limit.monthly_request_limit > 0 ? `${limit.monthly_request_limit.toLocaleString()} / month` : 'unlimited'

export default function AdminAIModels() {
  const { wrapFn } = useGlobalLoading()
  const [overview, setOverview] = useState<AiOverview | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      setOverview(await adminApi<AiOverview>('/ai/overview'))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load models')
    }
  }, [])

  useEffect(() => {
    void wrapFn(load)
  }, [load, wrapFn])

  const models = overview?.models ?? []
  const broken = models.filter((m) => !m.works)

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-lg font-semibold">AI models &amp; routing</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">
            Each app feature uses an <strong>app model</strong>. Its route lists which provider model answers it: the <strong>primary</strong> is tried first, and if it fails or runs out
            of quota the <strong>fallbacks</strong> are tried in order. Steps whose provider has no API key are skipped.
          </p>
        </div>
        <button type="button" onClick={() => void wrapFn(load)} className="inline-flex items-center gap-2 self-start rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
      </div>

      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</div> : null}
      {broken.length ? (
        <div className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {broken.map((m) => m.display_name).join(', ')} {broken.length === 1 ? 'has' : 'have'} no working provider. Requests for {broken.length === 1 ? 'it' : 'them'} will fail until a provider with an API key is added to the route.
          </span>
        </div>
      ) : null}

      {!overview ? <div className="h-48 animate-pulse rounded-2xl bg-slate-100" /> : null}
      <div className="space-y-4">
        {models.map((m) => (
          <ModelCard key={m.id} model={m} providers={overview!.providers} onSaved={() => void wrapFn(load)} />
        ))}
      </div>

      {overview ? <AdvancedSection onCreated={() => void wrapFn(load)} /> : null}
    </div>
  )
}

function ModelCard({ model, providers, onSaved }: { model: AiModelView; providers: AiProviderView[]; onSaved: () => void }) {
  const initial = useMemo<DraftStep[]>(
    () => model.route.filter((s) => s.provider_id).map((s) => ({ provider_id: s.provider_id!, provider_model_name: s.provider_model_name ?? '' })),
    [model.route],
  )
  const [steps, setSteps] = useState<DraftStep[]>(initial)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [routeTest, setRouteTest] = useState<RouteTest | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => setSteps(initial), [initial])

  const dirty = JSON.stringify(steps) !== JSON.stringify(initial)
  const usedProviders = new Set(steps.map((s) => s.provider_id))
  const available = providers.filter((p) => !usedProviders.has(p.id))
  const providerById = (id: string) => providers.find((p) => p.id === id)

  const move = (i: number, dir: -1 | 1) =>
    setSteps((prev) => {
      const next = [...prev]
      const j = i + dir
      if (j < 0 || j >= next.length) return prev
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await adminApi(`/ai/models/${model.id}/route`, { method: 'PUT', body: { steps } })
      setRouteTest(null)
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  const testRoute = async () => {
    setTesting(true)
    setError(null)
    setRouteTest(null)
    try {
      const r = await adminApi<{ result: RouteTest }>(`/ai/models/${model.id}/test`, { body: {} })
      setRouteTest(r.result)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Test failed')
    } finally {
      setTesting(false)
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-semibold text-slate-900">{model.display_name}</h2>
            <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{model.model_id}</code>
            {model.virtual ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600"><Hash className="h-3 w-3" /> Counter</span>
            ) : model.works ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800"><CheckCircle2 className="h-3 w-3" /> Has a working provider</span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800"><AlertTriangle className="h-3 w-3" /> No working provider</span>
            )}
          </div>
          <p className="mt-1 text-sm text-slate-600">{model.used_for}</p>
        </div>
        <div className="shrink-0 text-sm md:text-right">
          <div className="text-slate-900">{model.requests_this_month.toLocaleString()} requests this month</div>
          <div className="mt-0.5 text-xs text-slate-500">
            {model.limits.length
              ? model.limits
                  .slice()
                  .sort((a, b) => a.plan_code.localeCompare(b.plan_code))
                  .map((l) => `${l.plan_code}: ${limitText(l)}`)
                  .join(' · ')
              : 'No plan limits set'}{' '}
            · <Link to="/admin/ai/entitlements" className="underline">edit limits</Link>
          </div>
        </div>
      </div>

      {model.virtual ? null : (
        <div className="mt-4">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Route</div>
          <ol className="mt-2 space-y-2">
            {steps.map((step, i) => {
              const saved = model.route.find((r) => r.provider_id === step.provider_id)
              const unchanged = saved && saved.provider_model_name === step.provider_model_name && saved.position === i
              return (
                <RouteRow
                  key={step.provider_id}
                  index={i}
                  step={step}
                  provider={providerById(step.provider_id)}
                  problem={unchanged ? saved!.problem : null}
                  isLast={i === steps.length - 1}
                  onModel={(name) => setSteps((prev) => prev.map((s, k) => (k === i ? { ...s, provider_model_name: name } : s)))}
                  onUp={() => move(i, -1)}
                  onDown={() => move(i, 1)}
                  onRemove={() => setSteps((prev) => prev.filter((_, k) => k !== i))}
                />
              )
            })}
          </ol>
          {available.length && steps.length < 5 ? (
            <AddStep providers={available} label={steps.length ? 'Add fallback' : 'Add provider'} onAdd={(provider_id) => setSteps((prev) => [...prev, { provider_id, provider_model_name: '' }])} />
          ) : null}

          {error ? <div className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</div> : null}

          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
            <button
              type="button"
              onClick={() => void save()}
              disabled={!dirty || saving || !steps.length || steps.some((s) => !s.provider_model_name.trim())}
              className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-40"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save route
            </button>
            {dirty ? (
              <button type="button" onClick={() => setSteps(initial)} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
                <Undo2 className="h-4 w-4" /> Discard changes
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => void testRoute()}
              disabled={dirty || testing || !steps.length}
              title={dirty ? 'Save the route first' : 'Runs the saved route exactly like a real request'}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FlaskConical className="h-4 w-4" />} Test route
            </button>
            {dirty ? <span className="text-xs text-amber-700">Unsaved changes</span> : null}
          </div>

          {routeTest ? (
            <div className="mt-3 space-y-2">
              <div className="text-sm font-medium">{routeTest.ok ? 'The route works.' : 'No step in the route answered.'}</div>
              {routeTest.attempts.map((a, i) => (
                <div key={i} className="grid gap-1 sm:grid-cols-[12rem_1fr] sm:items-start">
                  <div className="text-xs text-slate-600">
                    {i === 0 ? 'Primary' : `Fallback ${i}`} · {a.provider_name}
                    <div className="truncate">{a.provider_model_name ?? '—'}</div>
                  </div>
                  {a.skipped ? (
                    <div className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700">Skipped: {a.message}</div>
                  ) : (
                    <ProbeResultLine result={a} />
                  )}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </section>
  )
}

function RouteRow({
  index,
  step,
  provider,
  problem,
  isLast,
  onModel,
  onUp,
  onDown,
  onRemove,
}: {
  index: number
  step: DraftStep
  provider: AiProviderView | undefined
  problem: string | null
  isLast: boolean
  onModel: (name: string) => void
  onUp: () => void
  onDown: () => void
  onRemove: () => void
}) {
  const list = useProviderModels(step.provider_id)
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<ProbeResult | null>(null)
  const providerProblem = !provider ? 'Provider missing.' : provider.status !== 'active' ? 'Provider is disabled — skipped.' : !provider.usable ? 'Provider has no API key — skipped.' : null
  const warning = providerProblem ?? problem

  const test = async () => {
    setTesting(true)
    setResult(null)
    try {
      const r = await adminApi<{ result: ProbeResult }>(`/ai/providers/${step.provider_id}/test`, { body: { model: step.provider_model_name } })
      setResult(r.result)
    } catch (e) {
      setResult({ ok: false, status: 0, latency_ms: 0, key_source: null, message: e instanceof Error ? e.message : 'Test failed', preview: null })
    } finally {
      setTesting(false)
    }
  }

  return (
    <li className={'rounded-xl border p-3 ' + (warning ? 'border-amber-200 bg-amber-50/50' : 'border-slate-200')}>
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <div className="flex w-full items-center gap-2 lg:w-56 lg:shrink-0">
          <span className={'rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ' + (index === 0 ? 'bg-slate-900 text-white' : 'bg-slate-200 text-slate-700')}>
            {index === 0 ? 'Primary' : `Fallback ${index}`}
          </span>
          <span className="truncate text-sm font-medium text-slate-900">{provider?.name ?? 'Unknown provider'}</span>
        </div>
        <ModelInput value={step.provider_model_name} onChange={onModel} models={list.models} loading={list.loading} id={`route-${step.provider_id}`} />
        <div className="flex shrink-0 items-center gap-1">
          <IconButton label="Test this step" onClick={() => void test()} disabled={testing || !step.provider_model_name.trim()}>
            {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FlaskConical className="h-4 w-4" />}
          </IconButton>
          <IconButton label="Move up" onClick={onUp} disabled={index === 0}>
            <ArrowUp className="h-4 w-4" />
          </IconButton>
          <IconButton label="Move down" onClick={onDown} disabled={isLast}>
            <ArrowDown className="h-4 w-4" />
          </IconButton>
          <IconButton label="Remove from route" onClick={onRemove}>
            <Trash2 className="h-4 w-4" />
          </IconButton>
        </div>
      </div>
      {warning ? (
        <div className="mt-2 flex items-center gap-1.5 text-xs text-amber-800">
          <AlertTriangle className="h-3.5 w-3.5" /> {warning}{' '}
          {providerProblem && provider ? <Link to="/admin/ai/providers" className="underline">Open providers</Link> : null}
        </div>
      ) : null}
      {list.message && !providerProblem ? <div className="mt-2 text-xs text-amber-800">Couldn't list models: {list.message}</div> : null}
      {result ? <div className="mt-2"><ProbeResultLine result={result} /></div> : null}
    </li>
  )
}

function IconButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} disabled={disabled} className="rounded-lg border border-slate-200 bg-white p-2 text-slate-700 hover:bg-slate-50 disabled:opacity-30">
      {children}
    </button>
  )
}

function AddStep({ providers, label, onAdd }: { providers: AiProviderView[]; label: string; onAdd: (providerId: string) => void }) {
  const [providerId, setProviderId] = useState('')
  return (
    <div className="mt-2 flex flex-col gap-2 sm:flex-row">
      <select value={providerId} onChange={(e) => setProviderId(e.target.value)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm sm:w-72" aria-label="Provider to add">
        <option value="">Choose a provider…</option>
        {providers.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
            {p.status !== 'active' ? ' (disabled)' : !p.usable ? ' (no API key)' : ''}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={!providerId}
        onClick={() => {
          onAdd(providerId)
          setProviderId('')
        }}
        className="inline-flex items-center justify-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40"
      >
        <Plus className="h-4 w-4" /> {label}
      </button>
    </div>
  )
}

function AdvancedSection({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false)
  const [modelId, setModelId] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const valid = /^[a-z][a-z0-9_]{2,40}$/.test(modelId) && !!name.trim()

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center justify-between text-left text-sm font-medium text-slate-900">
        Advanced: create a new app model
        <ChevronDown className={'h-4 w-4 transition ' + (open ? 'rotate-180' : '')} />
      </button>
      {open ? (
        <div className="mt-3 space-y-3 text-sm">
          <p className="text-slate-600">
            Only needed by developers: a new app model does nothing until the app's code requests it by its id. Retry behaviour and key strategy live on{' '}
            <Link to="/admin/ai/routing" className="underline">Routing (advanced)</Link>.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input value={modelId} onChange={(e) => setModelId(e.target.value.toLowerCase())} placeholder="id, e.g. summarize_lite" className="rounded-xl border border-slate-200 px-3 py-2 sm:w-64" />
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Display name" className="flex-1 rounded-xl border border-slate-200 px-3 py-2" />
            <button
              type="button"
              disabled={!valid || busy}
              onClick={async () => {
                setBusy(true)
                setError(null)
                try {
                  await adminApi('/ai/models', { body: { model_id: modelId, display_name: name.trim(), modality: 'text', status: 'active' } })
                  setModelId('')
                  setName('')
                  onCreated()
                } catch (e) {
                  setError(e instanceof Error ? e.message : 'Could not create')
                } finally {
                  setBusy(false)
                }
              }}
              className="rounded-xl bg-slate-900 px-4 py-2 text-white disabled:opacity-40"
            >
              Create
            </button>
          </div>
          {error ? <div className="text-rose-700">{error}</div> : null}
        </div>
      ) : null}
    </section>
  )
}
