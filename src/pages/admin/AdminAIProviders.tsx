import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useGlobalLoading } from '@/hooks/useGlobalLoading'
import { KeyRound, Plus, RefreshCw, Save, Trash2 } from 'lucide-react'

type Provider = {
  id: string
  key: string
  name: string
  base_url: string | null
  auth_type: string
  status: string
  updated_at?: string
}

type ProviderKeyRow = {
  id: string
  provider_id: string
  label: string
  status: string
  priority: number
  last_used_at?: string | null
  last_error_at?: string | null
}

const toInt = (v: unknown) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.trunc(n) : 0
}

export default function AdminAIProviders() {
  const { wrapFn } = useGlobalLoading()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [providers, setProviders] = useState<Provider[]>([])
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null)
  const [keys, setKeys] = useState<ProviderKeyRow[]>([])
  const [keysLoading, setKeysLoading] = useState(false)

  const [draft, setDraft] = useState({
    key: 'gemini',
    name: 'Google Gemini',
    base_url: 'https://generativelanguage.googleapis.com',
    auth_type: 'google',
    status: 'active',
  })

  const [showKeyModal, setShowKeyModal] = useState(false)
  const [keyDraft, setKeyDraft] = useState({ label: 'primary', key: '', priority: 100, status: 'active' })

  const [rotateKeyId, setRotateKeyId] = useState<string | null>(null)
  const [rotateKeyValue, setRotateKeyValue] = useState('')

  const selectedProvider = useMemo(
    () => providers.find((p) => p.id === selectedProviderId) ?? null,
    [providers, selectedProviderId],
  )

  const loadProviders = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token ?? ''
    if (!token) {
      setError('Not signed in')
      setLoading(false)
      return
    }

    const resp = await fetch('/api/admin/ai/providers', {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    })
    const json = (await resp.json().catch(() => ({}))) as any
    if (!resp.ok || !json.success) {
      setError(json.error ?? 'Failed to load providers')
      setLoading(false)
      return
    }
    const rows = (json.providers ?? []) as Provider[]
    setProviders(rows)
    if (rows.length && !selectedProviderId) setSelectedProviderId(rows[0].id)
    setLoading(false)
  }, [selectedProviderId])

  const loadKeys = useCallback(
    async (providerId: string) => {
      setKeysLoading(true)
      setError(null)
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token ?? ''
      const resp = await fetch(`/api/admin/ai/provider-keys?provider_id=${encodeURIComponent(providerId)}`, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      })
      const json = (await resp.json().catch(() => ({}))) as any
      if (!resp.ok || !json.success) {
        setError(json.error ?? 'Failed to load provider keys')
        setKeys([])
        setKeysLoading(false)
        return
      }
      setKeys((json.keys ?? []) as ProviderKeyRow[])
      setKeysLoading(false)
    },
    [],
  )

  useEffect(() => {
    void wrapFn(loadProviders)
  }, [loadProviders, wrapFn])

  useEffect(() => {
    if (!selectedProviderId) return
    void wrapFn(() => loadKeys(selectedProviderId))
  }, [selectedProviderId, loadKeys, wrapFn])

  const saveProvider = async () => {
    setError(null)
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token ?? ''
    const resp = await fetch('/api/admin/ai/providers', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: draft.key.trim(),
        name: draft.name.trim(),
        base_url: draft.base_url.trim() || null,
        auth_type: draft.auth_type,
        status: draft.status,
      }),
    })
    const json = (await resp.json().catch(() => ({}))) as any
    if (!resp.ok || !json.success) throw new Error(json.error ?? 'Failed to save provider')
  }

  const createKey = async () => {
    if (!selectedProviderId) return
    setError(null)
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token ?? ''
    const resp = await fetch('/api/admin/ai/provider-keys', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider_id: selectedProviderId,
        label: keyDraft.label.trim(),
        key: keyDraft.key.trim(),
        priority: keyDraft.priority,
        status: keyDraft.status,
      }),
    })
    const json = (await resp.json().catch(() => ({}))) as any
    if (!resp.ok || !json.success) throw new Error(json.error ?? 'Failed to create key')
  }

  const updateKey = async (id: string, patch: Partial<Pick<ProviderKeyRow, 'label' | 'status' | 'priority'>>) => {
    setError(null)
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token ?? ''
    const resp = await fetch(`/api/admin/ai/provider-keys/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    const json = (await resp.json().catch(() => ({}))) as any
    if (!resp.ok || !json.success) throw new Error(json.error ?? 'Failed to update key')
  }

  const rotateKey = async (id: string, key: string) => {
    setError(null)
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token ?? ''
    const resp = await fetch(`/api/admin/ai/provider-keys/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ key }),
    })
    const json = (await resp.json().catch(() => ({}))) as any
    if (!resp.ok || !json.success) throw new Error(json.error ?? 'Failed to update key')
  }

  const deleteKey = async (id: string) => {
    setError(null)
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token ?? ''
    const resp = await fetch(`/api/admin/ai/provider-keys/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    })
    const json = (await resp.json().catch(() => ({}))) as any
    if (!resp.ok || !json.success) throw new Error(json.error ?? 'Failed to delete key')
  }

  const canSaveProvider = useMemo(() => !!draft.key.trim() && !!draft.name.trim() && !!draft.auth_type.trim(), [draft])
  const canCreateKey = useMemo(() => !!keyDraft.label.trim() && !!keyDraft.key.trim() && !!selectedProviderId, [keyDraft, selectedProviderId])

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-lg font-semibold">Providers & Keys</h1>
          <div className="mt-1 text-sm text-slate-600">Manage AI providers and their API keys.</div>
        </div>
        <button
          type="button"
          onClick={() => void wrapFn(loadProviders)}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 transition hover:bg-slate-50"
        >
          <RefreshCw className="h-4 w-4" />
          Refresh
        </button>
      </div>

      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</div> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-sm font-semibold">Create or update provider</div>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <input
              value={draft.key}
              onChange={(e) => setDraft((p) => ({ ...p, key: e.target.value }))}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
              placeholder="key (e.g., gemini, openai, deepseek)"
            />
            <input
              value={draft.name}
              onChange={(e) => setDraft((p) => ({ ...p, name: e.target.value }))}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
              placeholder="name"
            />
            <input
              value={draft.base_url}
              onChange={(e) => setDraft((p) => ({ ...p, base_url: e.target.value }))}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm md:col-span-2"
              placeholder="base_url"
            />
            <select
              value={draft.auth_type}
              onChange={(e) => setDraft((p) => ({ ...p, auth_type: e.target.value }))}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
            >
              <option value="google">google (Gemini)</option>
              <option value="bearer">bearer (OpenAI-compatible)</option>
            </select>
            <select
              value={draft.status}
              onChange={(e) => setDraft((p) => ({ ...p, status: e.target.value }))}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
            >
              <option value="active">active</option>
              <option value="disabled">disabled</option>
            </select>
          </div>
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              disabled={!canSaveProvider}
              onClick={() =>
                void wrapFn(async () => {
                  await saveProvider()
                  await loadProviders()
                })
              }
              className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-50"
            >
              <Plus className="h-4 w-4" />
              Save
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-sm font-semibold">Providers</div>
          {loading ? (
            <div className="mt-4 space-y-2">
              <div className="h-10 animate-pulse rounded-xl bg-slate-100" />
              <div className="h-10 animate-pulse rounded-xl bg-slate-100" />
            </div>
          ) : (
            <div className="mt-4 overflow-hidden rounded-xl border border-slate-200">
              <div className="grid grid-cols-[1fr_1fr_1fr_1fr] gap-3 bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-600">
                <div>Key</div>
                <div>Name</div>
                <div>Status</div>
                <div>Auth</div>
              </div>
              <div className="divide-y divide-slate-200">
                {providers.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setSelectedProviderId(p.id)}
                    className={
                      'grid w-full grid-cols-[1fr_1fr_1fr_1fr] gap-3 px-4 py-3 text-left text-sm transition ' +
                      (selectedProviderId === p.id ? 'bg-indigo-50' : 'hover:bg-slate-50')
                    }
                  >
                    <div className="font-medium text-slate-900">{p.key}</div>
                    <div className="text-slate-700">{p.name}</div>
                    <div className="text-slate-700">{p.status}</div>
                    <div className="text-slate-700">{p.auth_type}</div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-sm font-semibold">API keys</div>
            <div className="mt-1 text-xs text-slate-600">Provider: {selectedProvider ? `${selectedProvider.name} (${selectedProvider.key})` : 'None selected'}</div>
          </div>
          <button
            type="button"
            disabled={!selectedProviderId}
            onClick={() => {
              setKeyDraft({ label: 'primary', key: '', priority: 100, status: 'active' })
              setShowKeyModal(true)
            }}
            className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            Add key
          </button>
        </div>

        {keysLoading ? (
          <div className="mt-4 space-y-2">
            <div className="h-10 animate-pulse rounded-xl bg-slate-100" />
            <div className="h-10 animate-pulse rounded-xl bg-slate-100" />
          </div>
        ) : keys.length ? (
          <div className="mt-4 overflow-hidden rounded-xl border border-slate-200">
            <div className="grid grid-cols-[2fr_1fr_1fr_2fr_2fr_1fr] gap-3 bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-600">
              <div>Label</div>
              <div>Status</div>
              <div className="text-right">Priority</div>
              <div>Last used</div>
              <div>Last error</div>
              <div className="text-right">Action</div>
            </div>
            <div className="divide-y divide-slate-200">
              {keys.map((k) => (
                <div key={k.id} className="grid grid-cols-[2fr_1fr_1fr_2fr_2fr_1fr] items-center gap-3 px-4 py-3 text-sm">
                  <input
                    value={k.label}
                    onChange={(e) => setKeys((prev) => prev.map((row) => (row.id === k.id ? { ...row, label: e.target.value } : row)))}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                  />
                  <select
                    value={k.status}
                    onChange={(e) => setKeys((prev) => prev.map((row) => (row.id === k.id ? { ...row, status: e.target.value } : row)))}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                  >
                    <option value="active">active</option>
                    <option value="disabled">disabled</option>
                  </select>
                  <input
                    value={k.priority}
                    onChange={(e) => setKeys((prev) => prev.map((row) => (row.id === k.id ? { ...row, priority: toInt(e.target.value) } : row)))}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-right text-sm"
                  />
                  <div className="text-slate-700">{k.last_used_at ? new Date(k.last_used_at).toLocaleString() : '-'}</div>
                  <div className="text-slate-700">{k.last_error_at ? new Date(k.last_error_at).toLocaleString() : '-'}</div>
                  <div className="flex justify-end">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setRotateKeyId(k.id)
                          setRotateKeyValue('')
                        }}
                        className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-50"
                      >
                        <KeyRound className="h-4 w-4" />
                        Update key
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          void wrapFn(async () => {
                            await updateKey(k.id, { label: k.label, status: k.status, priority: k.priority })
                            if (selectedProviderId) await loadKeys(selectedProviderId)
                          })
                        }
                        className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-50"
                      >
                        <Save className="h-4 w-4" />
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          void wrapFn(async () => {
                            await deleteKey(k.id)
                            if (selectedProviderId) await loadKeys(selectedProviderId)
                          })
                        }
                        className="inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 transition hover:bg-rose-100"
                      >
                        <Trash2 className="h-4 w-4" />
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="mt-4 text-sm text-slate-600">No keys found.</div>
        )}
      </div>

      {showKeyModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-xl rounded-2xl bg-white p-5 shadow-xl">
            <div className="text-sm font-semibold">Add API key</div>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <input
                value={keyDraft.label}
                onChange={(e) => setKeyDraft((p) => ({ ...p, label: e.target.value }))}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm md:col-span-1"
                placeholder="label"
              />
              <input
                value={keyDraft.priority}
                onChange={(e) => setKeyDraft((p) => ({ ...p, priority: toInt(e.target.value) }))}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm md:col-span-1"
                placeholder="priority"
              />
              <select
                value={keyDraft.status}
                onChange={(e) => setKeyDraft((p) => ({ ...p, status: e.target.value }))}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm md:col-span-1"
              >
                <option value="active">active</option>
                <option value="disabled">disabled</option>
              </select>
              <input
                value={keyDraft.key}
                onChange={(e) => setKeyDraft((p) => ({ ...p, key: e.target.value }))}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm md:col-span-3"
                placeholder="paste API key"
              />
            </div>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowKeyModal(false)}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 transition hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!canCreateKey}
                onClick={() =>
                  void wrapFn(async () => {
                    await createKey()
                    setShowKeyModal(false)
                    if (selectedProviderId) await loadKeys(selectedProviderId)
                  })
                }
                className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-50"
              >
                Save key
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {rotateKeyId ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-xl rounded-2xl bg-white p-5 shadow-xl">
            <div className="text-sm font-semibold">Update API key</div>
            <div className="mt-1 text-xs text-slate-600">Paste a new secret to rotate this key.</div>
            <div className="mt-3 grid gap-3">
              <input
                value={rotateKeyValue}
                onChange={(e) => setRotateKeyValue(e.target.value)}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                placeholder="paste new API key"
              />
            </div>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setRotateKeyId(null)
                  setRotateKeyValue('')
                }}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 transition hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!rotateKeyValue.trim()}
                onClick={() =>
                  void wrapFn(async () => {
                    await rotateKey(rotateKeyId, rotateKeyValue.trim())
                    setRotateKeyId(null)
                    setRotateKeyValue('')
                    if (selectedProviderId) await loadKeys(selectedProviderId)
                  })
                }
                className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-50"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
