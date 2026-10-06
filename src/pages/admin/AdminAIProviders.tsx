import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, ArrowDown, ArrowUp, CheckCircle2, ExternalLink, FlaskConical, KeyRound, Loader2, Pencil, Plus, Power, RefreshCw, X } from 'lucide-react'
import { useGlobalLoading } from '@/hooks/useGlobalLoading'
import { adminApi, timeAgo, type AiOverview, type AiProviderView, type ProbeResult } from '@/lib/adminApi'
import { ModelInput, ProbeResultLine } from '@/components/admin/AiParts'
import { useProviderModels } from '@/hooks/useProviderModels'

type Preset = { id: string; name: string; key: string; auth_type: 'google' | 'bearer'; base_url: string; note: string; keyUrl?: string }

const PRESETS: Preset[] = [
  {
    id: 'gemini',
    name: 'Google Gemini',
    key: 'gemini',
    auth_type: 'google',
    base_url: 'https://generativelanguage.googleapis.com',
    note: 'Free tier in Google AI Studio with small daily limits per model. On the free tier Google may use prompts to improve its products.',
    keyUrl: 'https://aistudio.google.com/apikey',
  },
  { id: 'openai', name: 'OpenAI', key: 'openai', auth_type: 'bearer', base_url: 'https://api.openai.com/v1', note: 'Paid, pay-as-you-go.', keyUrl: 'https://platform.openai.com/api-keys' },
  {
    id: 'groq',
    name: 'Groq',
    key: 'groq',
    auth_type: 'bearer',
    base_url: 'https://api.groq.com/openai/v1',
    note: 'Free tier without a card. Low tokens-per-minute, so it works best as a fallback.',
    keyUrl: 'https://console.groq.com/keys',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    key: 'openrouter',
    auth_type: 'bearer',
    base_url: 'https://openrouter.ai/api/v1',
    note: 'Many models with one key. Free (":free") models allow about 50 requests/day without credits.',
    keyUrl: 'https://openrouter.ai/keys',
  },
  {
    id: 'mistral',
    name: 'Mistral',
    key: 'mistral',
    auth_type: 'bearer',
    base_url: 'https://api.mistral.ai/v1',
    note: 'The free tier requires opting in to training on your data — not recommended for resumes.',
    keyUrl: 'https://console.mistral.ai/api-keys',
  },
  { id: 'custom', name: 'Other (OpenAI-compatible)', key: '', auth_type: 'bearer', base_url: '', note: 'Any service that implements the OpenAI chat-completions API.' },
]

const hostOf = (url: string | null) => {
  try {
    return url ? new URL(url).host : ''
  } catch {
    return url ?? ''
  }
}

export default function AdminAIProviders() {
  const { wrapFn } = useGlobalLoading()
  const [overview, setOverview] = useState<AiOverview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<AiProviderView | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      setOverview(await adminApi<AiOverview>('/ai/overview'))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load providers')
    }
  }, [])

  useEffect(() => {
    void wrapFn(load)
  }, [load, wrapFn])

  const providers = overview?.providers ?? []
  const ready = providers.filter((p) => p.usable).length

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-lg font-semibold">AI providers</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">
            The AI services this app can call. Each one needs an API key. Use <strong>Test</strong> to confirm a key works before relying on it.
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => void wrapFn(load)} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
          <button type="button" onClick={() => setAdding(true)} className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
            <Plus className="h-4 w-4" /> Add provider
          </button>
        </div>
      </div>

      <HowItWorks />

      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</div> : null}

      {overview ? (
        <div className="text-sm text-slate-600">
          {ready} of {providers.length} provider{providers.length === 1 ? '' : 's'} ready to use.
        </div>
      ) : (
        <div className="h-40 animate-pulse rounded-2xl bg-slate-100" />
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        {providers.map((p) => (
          <ProviderCard key={p.id} provider={p} onChanged={() => void wrapFn(load)} onEdit={() => setEditing(p)} />
        ))}
      </div>

      {adding || editing ? (
        <ProviderModal
          provider={editing}
          existingKeys={providers.map((p) => p.key)}
          onClose={() => {
            setAdding(false)
            setEditing(null)
          }}
          onSaved={async () => {
            setAdding(false)
            setEditing(null)
            await wrapFn(load)
          }}
        />
      ) : null}
    </div>
  )
}

function HowItWorks() {
  const steps: Array<[string, ReactNode]> = [
    ['Add a provider and its API key', 'on this page, then press Test.'],
    ['Choose which provider serves each feature', <>on <Link className="underline" to="/admin/ai/models">Models &amp; routing</Link>, with backups if the first fails.</>],
    ['Watch requests, errors and limits', <>on <Link className="underline" to="/admin/usage">Usage</Link>.</>],
  ]
  return (
    <ol className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-sm sm:grid-cols-3">
      {steps.map(([title, detail], i) => (
        <li key={title} className="flex gap-3">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-semibold text-white">{i + 1}</span>
          <span>
            <span className="font-medium text-slate-900">{title}</span> <span className="text-slate-600">{detail}</span>
          </span>
        </li>
      ))}
    </ol>
  )
}

function StatusPill({ provider }: { provider: AiProviderView }) {
  if (provider.status !== 'active')
    return <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600"><Power className="h-3 w-3" /> Disabled</span>
  if (!provider.usable)
    return <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800"><AlertTriangle className="h-3 w-3" /> No API key</span>
  return <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800"><CheckCircle2 className="h-3 w-3" /> Ready</span>
}

function ProviderCard({ provider: p, onChanged, onEdit }: { provider: AiProviderView; onChanged: () => void; onEdit: () => void }) {
  const [panel, setPanel] = useState<'test' | 'keys' | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const toggleStatus = async () => {
    setBusy(true)
    setError(null)
    try {
      await adminApi('/ai/providers', { body: { id: p.id, key: p.key, name: p.name, base_url: p.base_url, auth_type: p.auth_type, status: p.status === 'active' ? 'disabled' : 'active' } })
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setBusy(false)
    }
  }

  const keyLine =
    p.active_keys > 0
      ? `${p.active_keys} saved key${p.active_keys === 1 ? '' : 's'}${p.env_key ? ' (server environment key also available)' : ''}`
      : p.env_key
        ? 'Using the key from the server environment'
        : 'No key — every request routed here is skipped'

  return (
    <section className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-sm font-semibold text-white">{p.name.slice(0, 1)}</div>
          <div className="min-w-0">
            <div className="truncate font-semibold text-slate-900">{p.name}</div>
            <div className="truncate text-xs text-slate-500">
              {p.auth_type === 'google' ? 'Google Gemini API' : 'OpenAI-compatible API'} · {hostOf(p.base_url)} · id <code>{p.key}</code>
            </div>
          </div>
        </div>
        <StatusPill provider={p} />
      </div>

      <dl className="mt-4 space-y-2 text-sm">
        <Row label="API key">
          <span className={p.usable || p.status !== 'active' ? 'text-slate-700' : 'text-amber-800'}>{keyLine}</span>
        </Row>
        <Row label="Used by">
          {p.used_by.length ? (
            <div className="flex flex-wrap gap-1.5">
              {p.used_by.map((u) => (
                <span key={u.model_id} className="rounded-lg bg-slate-100 px-2 py-0.5 text-xs text-slate-700" title={u.provider_model_name ?? ''}>
                  {u.display_name} · {u.position === 0 ? 'primary' : `fallback ${u.position}`}
                  {u.provider_model_name ? <span className="text-slate-500"> ({u.provider_model_name})</span> : null}
                </span>
              ))}
            </div>
          ) : (
            <span className="text-slate-500">Not used by any feature yet — add it on Models &amp; routing.</span>
          )}
        </Row>
        <Row label="Activity">
          <span className="text-slate-700">
            Last success {timeAgo(p.last_used_at)} · last error {timeAgo(p.last_error_at)}
          </span>
        </Row>
      </dl>

      {error ? <div className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</div> : null}

      <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
        <CardButton active={panel === 'test'} onClick={() => setPanel(panel === 'test' ? null : 'test')} icon={<FlaskConical className="h-4 w-4" />}>
          Test
        </CardButton>
        <CardButton active={panel === 'keys'} onClick={() => setPanel(panel === 'keys' ? null : 'keys')} icon={<KeyRound className="h-4 w-4" />}>
          Keys ({p.keys.filter((k) => k.status === 'active').length})
        </CardButton>
        <CardButton onClick={onEdit} icon={<Pencil className="h-4 w-4" />}>
          Edit
        </CardButton>
        <CardButton onClick={() => void toggleStatus()} disabled={busy} icon={<Power className="h-4 w-4" />}>
          {p.status === 'active' ? 'Disable' : 'Enable'}
        </CardButton>
      </div>

      {panel === 'test' ? <TestPanel provider={p} onDone={onChanged} /> : null}
      {panel === 'keys' ? <KeysPanel provider={p} onChanged={onChanged} /> : null}
    </section>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[5.5rem_1fr] gap-3">
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}

function CardButton({ children, icon, onClick, active, disabled }: { children: ReactNode; icon: ReactNode; onClick: () => void; active?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-expanded={active}
      className={
        'inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-sm transition disabled:opacity-50 ' +
        (active ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50')
      }
    >
      {icon}
      {children}
    </button>
  )
}

function TestPanel({ provider, keyId, onDone }: { provider: AiProviderView; keyId?: string; onDone?: () => void }) {
  const list = useProviderModels(provider.id)
  const suggested = provider.used_by.find((u) => u.provider_model_name)?.provider_model_name ?? ''
  const [model, setModel] = useState(suggested)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<ProbeResult | null>(null)

  useEffect(() => {
    if (!model && list.models.length) setModel(list.models.find((m) => /flash-lite|mini|instant/.test(m)) ?? list.models[0])
  }, [list.models, model])

  const run = async () => {
    setRunning(true)
    setResult(null)
    try {
      const r = await adminApi<{ result: ProbeResult }>(`/ai/providers/${provider.id}/test`, { body: { model, key_id: keyId } })
      setResult(r.result)
      onDone?.()
    } catch (e) {
      setResult({ ok: false, status: 0, latency_ms: 0, key_source: null, message: e instanceof Error ? e.message : 'Test failed', preview: null })
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="mt-4 space-y-3 rounded-xl bg-slate-50 p-4">
      <div className="text-sm text-slate-700">Sends one tiny request to the model below (uses one request of the provider's quota; not charged to any user).</div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <ModelInput value={model} onChange={setModel} models={list.models} loading={list.loading} id={`test-${provider.id}-${keyId ?? 'any'}`} />
        <button
          type="button"
          onClick={() => void run()}
          disabled={!model || running}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <FlaskConical className="h-4 w-4" />}
          Run test
        </button>
      </div>
      {list.message ? <div className="text-xs text-amber-800">Couldn't list models: {list.message}</div> : null}
      {result ? <ProbeResultLine result={result} /> : null}
    </div>
  )
}

function KeysPanel({ provider, onChanged }: { provider: AiProviderView; onChanged: () => void }) {
  const [label, setLabel] = useState('')
  const [secret, setSecret] = useState('')
  const [replacing, setReplacing] = useState<string | null>(null)
  const [replacement, setReplacement] = useState('')
  const [testing, setTesting] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const keys = useMemo(() => [...provider.keys].sort((a, b) => (a.status === b.status ? b.priority - a.priority : a.status === 'active' ? -1 : 1)), [provider.keys])
  const lowestPriority = Math.min(1000, ...provider.keys.map((k) => k.priority))
  const activeOrder = keys.filter((k) => k.status === 'active')

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setBusy(false)
    }
  }

  // Rewrites priorities as 10, 20, 30… in the chosen order (highest = tried first).
  const reorder = (from: number, to: number) =>
    act(async () => {
      const order = [...activeOrder]
      const [moved] = order.splice(from, 1)
      order.splice(to, 0, moved)
      await Promise.all(
        order.map((k, idx) => {
          const priority = (order.length - idx) * 10
          return k.priority === priority ? Promise.resolve() : adminApi(`/ai/provider-keys/${k.id}`, { method: 'PUT', body: { priority } })
        }),
      )
    })

  return (
    <div className="mt-4 space-y-3 rounded-xl bg-slate-50 p-4 text-sm">
      <div className="space-y-1 text-slate-700">
        <p>
          Keys are stored encrypted and never shown again. Requests try keys <strong>in this order</strong>: if a key is rejected or hits its own quota or rate limit, the next key is used
          automatically, then the next provider in the route.
          {provider.env_key ? ' The server environment key is tried last if it is different.' : ''}
        </p>
        {provider.auth_type === 'google' ? (
          <p className="text-xs text-slate-500">Gemini limits apply per Google Cloud project, so keys from the same project share one quota — a second key only adds capacity if it belongs to a different project.</p>
        ) : null}
      </div>
      {error ? <div className="rounded-lg bg-rose-50 px-3 py-2 text-rose-800">{error}</div> : null}
      {keys.length ? (
        <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
          {keys.map((k) => {
            const isPrimary = k.status === 'active' && activeOrder[0]?.id === k.id
            return (
              <li key={k.id} className="space-y-2 px-3 py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <span className="font-medium text-slate-900">{k.label}</span>{' '}
                    {k.status !== 'active' ? (
                      <span className="text-xs text-slate-500">(disabled)</span>
                    ) : isPrimary ? (
                      <span className="rounded bg-slate-900 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white">1st</span>
                    ) : (
                      <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-700">{ordinal(activeOrder.indexOf(k) + 1)}</span>
                    )}
                    <div className="text-xs text-slate-500">
                      added {timeAgo(k.created_at)} · last success {timeAgo(k.last_used_at)} · last error {timeAgo(k.last_error_at)}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {k.status === 'active' ? (
                      <SmallButton onClick={() => setTesting(testing === k.id ? null : k.id)}>Test</SmallButton>
                    ) : null}
                    {k.status === 'active' && activeOrder.length > 1 ? (
                      <>
                        <SmallButton disabled={busy || isPrimary} onClick={() => void reorder(activeOrder.indexOf(k), activeOrder.indexOf(k) - 1)} label="Try earlier">
                          <ArrowUp className="h-3 w-3" />
                        </SmallButton>
                        <SmallButton disabled={busy || activeOrder.indexOf(k) === activeOrder.length - 1} onClick={() => void reorder(activeOrder.indexOf(k), activeOrder.indexOf(k) + 1)} label="Try later">
                          <ArrowDown className="h-3 w-3" />
                        </SmallButton>
                      </>
                    ) : null}
                    <SmallButton onClick={() => setReplacing(replacing === k.id ? null : k.id)}>Replace</SmallButton>
                    <SmallButton
                      disabled={busy}
                      onClick={() => void act(() => adminApi(`/ai/provider-keys/${k.id}`, { method: 'PUT', body: { status: k.status === 'active' ? 'disabled' : 'active' } }))}
                    >
                      {k.status === 'active' ? 'Disable' : 'Enable'}
                    </SmallButton>
                  </div>
                </div>
                {replacing === k.id ? (
                  <form
                    className="flex gap-2"
                    onSubmit={(e) => {
                      e.preventDefault()
                      void act(async () => {
                        await adminApi(`/ai/provider-keys/${k.id}`, { method: 'PUT', body: { key: replacement } })
                        setReplacing(null)
                        setReplacement('')
                      })
                    }}
                  >
                    <input type="password" autoComplete="off" value={replacement} onChange={(e) => setReplacement(e.target.value)} placeholder="Paste the new key" className="flex-1 rounded-xl border border-slate-200 px-3 py-2" />
                    <button type="submit" disabled={!replacement.trim() || busy} className="rounded-xl bg-slate-900 px-3 py-2 text-white disabled:opacity-50">
                      Save
                    </button>
                  </form>
                ) : null}
                {testing === k.id ? <TestPanel provider={provider} keyId={k.id} onDone={onChanged} /> : null}
              </li>
            )
          })}
        </ul>
      ) : (
        <div className="text-slate-600">No keys saved yet.</div>
      )}
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault()
          void act(async () => {
            await adminApi('/ai/provider-keys', {
              body: { provider_id: provider.id, label: label.trim() || `key ${provider.keys.length + 1}`, key: secret.trim(), priority: provider.keys.length ? Math.max(1, lowestPriority - 10) : 100, status: 'active' },
            })
            setLabel('')
            setSecret('')
          })
        }}
      >
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label (e.g. personal, team)" className="rounded-xl border border-slate-200 px-3 py-2 sm:w-44" />
        <input type="password" autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="Paste API key" className="flex-1 rounded-xl border border-slate-200 px-3 py-2" />
        <button type="submit" disabled={!secret.trim() || busy} className="inline-flex items-center justify-center gap-1 rounded-xl bg-slate-900 px-3 py-2 text-white disabled:opacity-50">
          <Plus className="h-4 w-4" /> Add key
        </button>
      </form>
    </div>
  )
}

const ordinal = (n: number) => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`

function SmallButton({ children, onClick, disabled, label }: { children: ReactNode; onClick: () => void; disabled?: boolean; label?: string }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label} title={label} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50">
      {children}
    </button>
  )
}

function ProviderModal({ provider, existingKeys, onClose, onSaved }: { provider: AiProviderView | null; existingKeys: string[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const editing = !!provider
  const [presetId, setPresetId] = useState(editing ? '' : 'groq')
  const preset = PRESETS.find((p) => p.id === presetId) ?? null
  const [name, setName] = useState(provider?.name ?? preset?.name ?? '')
  const [key, setKey] = useState(provider?.key ?? preset?.key ?? '')
  const [baseUrl, setBaseUrl] = useState(provider?.base_url ?? preset?.base_url ?? '')
  const [authType, setAuthType] = useState<string>(provider?.auth_type ?? preset?.auth_type ?? 'bearer')
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const choosePreset = (id: string) => {
    const p = PRESETS.find((x) => x.id === id)
    setPresetId(id)
    if (!p) return
    setName(p.name === 'Other (OpenAI-compatible)' ? '' : p.name)
    setKey(p.key)
    setBaseUrl(p.base_url)
    setAuthType(p.auth_type)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const slug = key.trim().toLowerCase()
  const keyTaken = !editing && existingKeys.includes(slug)
  const valid = !!name.trim() && /^[a-z0-9_-]{2,32}$/.test(slug) && /^https:\/\//.test(baseUrl.trim()) && !keyTaken

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      await adminApi('/ai/providers', {
        body: { id: provider?.id, key: slug, name: name.trim(), base_url: baseUrl.trim(), auth_type: authType, status: provider?.status ?? 'active' },
      })
      if (!editing && apiKey.trim()) {
        const overview = await adminApi<AiOverview>('/ai/overview')
        const created = overview.providers.find((p) => p.key === slug)
        if (created) await adminApi('/ai/provider-keys', { body: { provider_id: created.id, label: 'primary', key: apiKey.trim(), priority: 100, status: 'active' } })
      }
      await onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save')
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true" aria-labelledby="provider-modal-title">
      <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <h2 id="provider-modal-title" className="text-base font-semibold">
            {editing ? `Edit ${provider!.name}` : 'Add an AI provider'}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-slate-500 hover:text-slate-900">
            <X className="h-5 w-5" />
          </button>
        </div>

        {!editing ? (
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => choosePreset(p.id)}
                disabled={!!p.key && existingKeys.includes(p.key)}
                className={'rounded-xl border p-3 text-left text-sm transition disabled:opacity-40 ' + (presetId === p.id ? 'border-slate-900 ring-1 ring-slate-900' : 'border-slate-200 hover:border-slate-400')}
              >
                <div className="font-medium">
                  {p.name}
                  {p.key && existingKeys.includes(p.key) ? <span className="ml-1 text-xs font-normal text-slate-500">(added)</span> : null}
                </div>
                <div className="mt-0.5 text-xs text-slate-500">{p.note}</div>
              </button>
            ))}
          </div>
        ) : null}

        <div className="mt-4 grid gap-3 text-sm">
          <label className="grid gap-1">
            <span className="text-slate-600">Display name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} className="rounded-xl border border-slate-200 px-3 py-2" />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1">
              <span className="text-slate-600">Short id</span>
              <input value={key} onChange={(e) => setKey(e.target.value)} disabled={editing} className="rounded-xl border border-slate-200 px-3 py-2 disabled:bg-slate-50" />
              <span className="text-xs text-slate-500">{keyTaken ? 'Already used by another provider.' : 'Lowercase letters, digits, - or _. Cannot be changed later.'}</span>
            </label>
            <label className="grid gap-1">
              <span className="text-slate-600">API type</span>
              <select value={authType} onChange={(e) => setAuthType(e.target.value)} className="rounded-xl border border-slate-200 px-3 py-2">
                <option value="google">Google Gemini API</option>
                <option value="bearer">OpenAI-compatible API</option>
              </select>
            </label>
          </div>
          <label className="grid gap-1">
            <span className="text-slate-600">Base URL</span>
            <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://…" className="rounded-xl border border-slate-200 px-3 py-2" />
          </label>
          {!editing ? (
            <label className="grid gap-1">
              <span className="flex items-center justify-between text-slate-600">
                API key (optional — you can add it later)
                {preset?.keyUrl ? (
                  <a href={preset.keyUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs underline">
                    Get a key <ExternalLink className="h-3 w-3" />
                  </a>
                ) : null}
              </span>
              <input type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} className="rounded-xl border border-slate-200 px-3 py-2" />
            </label>
          ) : null}
        </div>

        {error ? <div className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</div> : null}
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2 text-sm">
            Cancel
          </button>
          <button type="button" onClick={() => void save()} disabled={!valid || busy} className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {editing ? 'Save changes' : 'Add provider'}
          </button>
        </div>
        {!editing ? <p className="mt-3 text-xs text-slate-500">After adding, press Test on its card, then add it to a feature on Models &amp; routing.</p> : null}
      </div>
    </div>
  )
}
