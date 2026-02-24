import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useGlobalLoading } from '@/hooks/useGlobalLoading'
import { Plus, RefreshCw, Save, Trash2 } from 'lucide-react'

type Provider = { id: string; key: string; name: string; status: string }

type Model = {
  id: string
  model_id: string
  display_name: string
  modality: string
  status: string
}

type Mapping = {
  id: string
  model_pk: string
  provider_id: string
  provider_model_name: string
  status: string
}

export default function AdminAIModels() {
  const { wrapFn } = useGlobalLoading()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [models, setModels] = useState<Model[]>([])
  const [providers, setProviders] = useState<Provider[]>([])
  const [selectedModelPk, setSelectedModelPk] = useState<string | null>(null)
  const [mappings, setMappings] = useState<Mapping[]>([])
  const [mappingsLoading, setMappingsLoading] = useState(false)

  const [draft, setDraft] = useState({ model_id: 'translate_pro', display_name: 'Translate Pro', modality: 'text', status: 'active' })
  const [mappingDraft, setMappingDraft] = useState({ provider_id: '', provider_model_name: '', status: 'active' })

  const selectedModel = useMemo(() => models.find((m) => m.id === selectedModelPk) ?? null, [models, selectedModelPk])
  const providerName = useCallback((id: string) => providers.find((p) => p.id === id)?.name ?? id, [providers])

  const loadAll = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token ?? ''
    if (!token) {
      setError('Not signed in')
      setLoading(false)
      return
    }
    const [mResp, pResp] = await Promise.all([
      fetch('/api/admin/ai/models', { headers: { Authorization: `Bearer ${token}` } }),
      fetch('/api/admin/ai/providers', { headers: { Authorization: `Bearer ${token}` } }),
    ])
    const mJson = (await mResp.json().catch(() => ({}))) as any
    const pJson = (await pResp.json().catch(() => ({}))) as any
    if (!mResp.ok || !mJson.success) {
      setError(mJson.error ?? 'Failed to load models')
      setLoading(false)
      return
    }
    if (!pResp.ok || !pJson.success) {
      setError(pJson.error ?? 'Failed to load providers')
      setLoading(false)
      return
    }
    const ms = (mJson.models ?? []) as Model[]
    const ps = (pJson.providers ?? []) as Provider[]
    setModels(ms)
    setProviders(ps)
    if (ps.length && !mappingDraft.provider_id) setMappingDraft((d) => ({ ...d, provider_id: ps[0].id }))
    if (ms.length && !selectedModelPk) setSelectedModelPk(ms[0].id)
    setLoading(false)
  }, [mappingDraft.provider_id, selectedModelPk])

  const loadMappings = useCallback(
    async (modelPk: string) => {
      setMappingsLoading(true)
      setError(null)
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token ?? ''
      const resp = await fetch(`/api/admin/ai/model-mappings?model_pk=${encodeURIComponent(modelPk)}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const json = (await resp.json().catch(() => ({}))) as any
      if (!resp.ok || !json.success) {
        setError(json.error ?? 'Failed to load mappings')
        setMappings([])
        setMappingsLoading(false)
        return
      }
      setMappings((json.mappings ?? []) as Mapping[])
      setMappingsLoading(false)
    },
    [],
  )

  useEffect(() => {
    void wrapFn(loadAll)
  }, [loadAll, wrapFn])

  useEffect(() => {
    if (!selectedModelPk) return
    void wrapFn(() => loadMappings(selectedModelPk))
  }, [selectedModelPk, loadMappings, wrapFn])

  const saveModel = async () => {
    setError(null)
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token ?? ''
    const resp = await fetch('/api/admin/ai/models', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model_id: draft.model_id.trim(),
        display_name: draft.display_name.trim(),
        modality: draft.modality,
        status: draft.status,
      }),
    })
    const json = (await resp.json().catch(() => ({}))) as any
    if (!resp.ok || !json.success) throw new Error(json.error ?? 'Failed to save model')
  }

  const deleteModel = async (id: string) => {
    setError(null)
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token ?? ''
    const resp = await fetch(`/api/admin/ai/models/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
    const json = (await resp.json().catch(() => ({}))) as any
    if (!resp.ok || !json.success) throw new Error(json.error ?? 'Failed to delete model')
  }

  const addMapping = async () => {
    if (!selectedModelPk) return
    setError(null)
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token ?? ''
    const resp = await fetch('/api/admin/ai/model-mappings', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model_pk: selectedModelPk,
        provider_id: mappingDraft.provider_id,
        provider_model_name: mappingDraft.provider_model_name.trim(),
        status: mappingDraft.status,
      }),
    })
    const json = (await resp.json().catch(() => ({}))) as any
    if (!resp.ok || !json.success) throw new Error(json.error ?? 'Failed to add mapping')
  }

  const updateMapping = async (mapping: Mapping) => {
    setError(null)
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token ?? ''
    const resp = await fetch('/api/admin/ai/model-mappings', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: mapping.id,
        model_pk: mapping.model_pk,
        provider_id: mapping.provider_id,
        provider_model_name: mapping.provider_model_name.trim(),
        status: mapping.status,
      }),
    })
    const json = (await resp.json().catch(() => ({}))) as any
    if (!resp.ok || !json.success) throw new Error(json.error ?? 'Failed to update mapping')
  }

  const deleteMapping = async (id: string) => {
    setError(null)
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token ?? ''
    const resp = await fetch(`/api/admin/ai/model-mappings/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
    const json = (await resp.json().catch(() => ({}))) as any
    if (!resp.ok || !json.success) throw new Error(json.error ?? 'Failed to delete mapping')
  }

  const canSaveModel = useMemo(() => !!draft.model_id.trim() && !!draft.display_name.trim(), [draft])
  const canAddMapping = useMemo(() => !!selectedModelPk && !!mappingDraft.provider_id && !!mappingDraft.provider_model_name.trim(), [selectedModelPk, mappingDraft])

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-lg font-semibold">Models</h1>
          <div className="mt-1 text-sm text-slate-600">Manage internal models and provider-specific mappings.</div>
        </div>
        <button
          type="button"
          onClick={() => void wrapFn(loadAll)}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 transition hover:bg-slate-50"
        >
          <RefreshCw className="h-4 w-4" />
          Refresh
        </button>
      </div>

      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</div> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-sm font-semibold">Create or update model</div>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <input
              value={draft.model_id}
              onChange={(e) => setDraft((p) => ({ ...p, model_id: e.target.value }))}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
              placeholder="model_id (stable)"
            />
            <input
              value={draft.display_name}
              onChange={(e) => setDraft((p) => ({ ...p, display_name: e.target.value }))}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
              placeholder="display name"
            />
            <select
              value={draft.modality}
              onChange={(e) => setDraft((p) => ({ ...p, modality: e.target.value }))}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
            >
              <option value="text">text</option>
              <option value="multimodal">multimodal</option>
              <option value="image">image</option>
              <option value="audio">audio</option>
            </select>
            <select
              value={draft.status}
              onChange={(e) => setDraft((p) => ({ ...p, status: e.target.value }))}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
            >
              <option value="active">active</option>
              <option value="deprecated">deprecated</option>
              <option value="disabled">disabled</option>
            </select>
          </div>
          <div className="mt-3 flex justify-end">
            {selectedModel ? (
              <button
                type="button"
                onClick={() =>
                  void wrapFn(async () => {
                    if (!window.confirm(`Disable model ${selectedModel.model_id}?`)) return
                    await deleteModel(selectedModel.id)
                    setSelectedModelPk(null)
                    await loadAll()
                  })
                }
                className="mr-2 inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-medium text-rose-700 transition hover:bg-rose-100"
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </button>
            ) : null}
            <button
              type="button"
              disabled={!canSaveModel}
              onClick={() =>
                void wrapFn(async () => {
                  await saveModel()
                  await loadAll()
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
          <div className="text-sm font-semibold">Models</div>
          {loading ? (
            <div className="mt-4 space-y-2">
              <div className="h-10 animate-pulse rounded-xl bg-slate-100" />
              <div className="h-10 animate-pulse rounded-xl bg-slate-100" />
            </div>
          ) : (
            <div className="mt-4 overflow-hidden rounded-xl border border-slate-200">
              <div className="grid grid-cols-[2fr_2fr_1fr_1fr] gap-3 bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-600">
                <div>model_id</div>
                <div>display</div>
                <div>modality</div>
                <div>status</div>
              </div>
              <div className="divide-y divide-slate-200">
                {models.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => {
                      setSelectedModelPk(m.id)
                      setDraft({ model_id: m.model_id, display_name: m.display_name, modality: m.modality, status: m.status })
                    }}
                    className={
                      'grid w-full grid-cols-[2fr_2fr_1fr_1fr] gap-3 px-4 py-3 text-left text-sm transition ' +
                      (selectedModelPk === m.id ? 'bg-indigo-50' : 'hover:bg-slate-50')
                    }
                  >
                    <div className="font-medium text-slate-900">{m.model_id}</div>
                    <div className="text-slate-700">{m.display_name}</div>
                    <div className="text-slate-700">{m.modality}</div>
                    <div className="text-slate-700">{m.status}</div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="text-sm font-semibold">Provider mappings</div>
        <div className="mt-1 text-xs text-slate-600">Model: {selectedModel ? `${selectedModel.display_name} (${selectedModel.model_id})` : 'None selected'}</div>

        <div className="mt-4 grid gap-3 md:grid-cols-5">
          <select
            value={mappingDraft.provider_id}
            onChange={(e) => setMappingDraft((p) => ({ ...p, provider_id: e.target.value }))}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm md:col-span-2"
          >
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.key})
              </option>
            ))}
          </select>
          <input
            value={mappingDraft.provider_model_name}
            onChange={(e) => setMappingDraft((p) => ({ ...p, provider_model_name: e.target.value }))}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm md:col-span-2"
            placeholder="provider_model_name (e.g., gemini-2.5-pro, gpt-4o-mini)"
          />
          <select
            value={mappingDraft.status}
            onChange={(e) => setMappingDraft((p) => ({ ...p, status: e.target.value }))}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
          >
            <option value="active">active</option>
            <option value="disabled">disabled</option>
          </select>
        </div>
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            disabled={!canAddMapping}
            onClick={() =>
              void wrapFn(async () => {
                await addMapping()
                setMappingDraft((p) => ({ ...p, provider_model_name: '' }))
                if (selectedModelPk) await loadMappings(selectedModelPk)
              })
            }
            className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            Add mapping
          </button>
        </div>

        {mappingsLoading ? (
          <div className="mt-4 space-y-2">
            <div className="h-10 animate-pulse rounded-xl bg-slate-100" />
            <div className="h-10 animate-pulse rounded-xl bg-slate-100" />
          </div>
        ) : mappings.length ? (
          <div className="mt-4 overflow-hidden rounded-xl border border-slate-200">
            <div className="grid grid-cols-[2fr_3fr_1fr_1fr] gap-3 bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-600">
              <div>Provider</div>
              <div>Provider model name</div>
              <div>Status</div>
              <div className="text-right">Action</div>
            </div>
            <div className="divide-y divide-slate-200">
              {mappings.map((m) => (
                <div key={m.id} className="grid grid-cols-[2fr_3fr_1fr_1fr] items-center gap-3 px-4 py-3 text-sm">
                  <div className="text-slate-700">{providerName(m.provider_id)}</div>
                  <input
                    value={m.provider_model_name}
                    onChange={(e) =>
                      setMappings((prev) => prev.map((row) => (row.id === m.id ? { ...row, provider_model_name: e.target.value } : row)))
                    }
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                  />
                  <select
                    value={m.status}
                    onChange={(e) => setMappings((prev) => prev.map((row) => (row.id === m.id ? { ...row, status: e.target.value } : row)))}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                  >
                    <option value="active">active</option>
                    <option value="disabled">disabled</option>
                  </select>
                  <div className="flex justify-end">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          void wrapFn(async () => {
                            await updateMapping(m)
                            if (selectedModelPk) await loadMappings(selectedModelPk)
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
                            if (!window.confirm('Delete this mapping?')) return
                            await deleteMapping(m.id)
                            if (selectedModelPk) await loadMappings(selectedModelPk)
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
          <div className="mt-4 text-sm text-slate-600">No mappings found.</div>
        )}
      </div>
    </div>
  )
}
