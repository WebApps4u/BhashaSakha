import { decryptSecret } from './cryptoVault.js'

type SupabaseLike = {
  from: (table: string) => any
  rpc: (fn: string, args?: Record<string, any>) => any
}

export type AllowedModel = {
  model_id: string
  display_name: string
  remaining_requests: number | null
  remaining_input_units: number | null
  remaining_output_units: number | null
  resets_at: string
}

type Provider = {
  id: string
  key: string
  name: string
  base_url: string | null
  auth_type: string
  status: string
}

type ProviderKey = {
  id: string
  provider_id: string
  label: string
  key_ciphertext: string
  status: string
  priority: number
}

type Model = {
  id: string
  model_id: string
  display_name: string
  modality: string
  status: string
}

type ModelMapping = {
  id: string
  model_pk: string
  provider_id: string
  provider_model_name: string
  status: string
}

type RoutingPolicyRow = {
  id: string
  model_pk: string
  status: string
  policy: any
}

type RoutingPolicy = {
  primary?: { provider_key?: string; key_strategy?: string }
  fallbacks?: Array<{ provider_key?: string }>
  max_attempts?: number
  retry_on?: string[]
  quota_exhausted_fallback_model_id?: string
}

type RouteAttempt = { providerKey: string }

const nowIso = () => new Date().toISOString()

const clampAttempts = (n: unknown) => {
  const num = typeof n === 'number' && Number.isFinite(n) ? Math.trunc(n) : 1
  return Math.min(10, Math.max(1, num))
}

const isRetryableStatus = (status: number) => status === 408 || status === 429 || status >= 500

const fetchWithTimeout = async (url: string, init: RequestInit, timeoutMs: number) => {
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const resp = await fetch(url, { ...init, signal: controller.signal })
    const text = await resp.text().catch(() => '')
    return { resp, text }
  } finally {
    clearTimeout(t)
  }
}

const parseOpenAiLikeText = (rawBodyText: string) => {
  try {
    const parsed = JSON.parse(rawBodyText) as any
    const content = parsed?.choices?.[0]?.message?.content
    return typeof content === 'string' ? content : ''
  } catch {
    return ''
  }
}

const parseGeminiText = (rawBodyText: string) => {
  try {
    const parsed = JSON.parse(rawBodyText) as any
    const content = parsed?.candidates?.[0]?.content?.parts?.[0]?.text
    return typeof content === 'string' ? content : ''
  } catch {
    return ''
  }
}

const extractJsonObject = (text: string) => {
  const trimmed = text.trim()
  if (!trimmed) return null
  try {
    return JSON.parse(trimmed)
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/)
    if (!match) return null
    try {
      return JSON.parse(match[0])
    } catch {
      return null
    }
  }
}

const buildAttemptsFromPolicy = (policy: RoutingPolicy): RouteAttempt[] => {
  const primaryKey = typeof policy.primary?.provider_key === 'string' ? policy.primary?.provider_key.trim() : ''
  const fallbacks = Array.isArray(policy.fallbacks) ? policy.fallbacks : []
  const keys = [primaryKey, ...fallbacks.map((f) => (typeof f?.provider_key === 'string' ? f.provider_key.trim() : ''))]
    .filter(Boolean)
    .filter((v, idx, arr) => arr.indexOf(v) === idx)

  const maxAttempts = clampAttempts(policy.max_attempts)
  return keys.slice(0, maxAttempts).map((providerKey) => ({ providerKey }))
}

export const getAllowedModelsForUser = async (supabase: SupabaseLike, userId: string): Promise<AllowedModel[]> => {
  const { data, error } = await supabase.rpc('ai_get_allowed_models', { uid: userId })
  if (error) throw new Error(error.message || 'Failed to load allowed models')
  return (data ?? []) as AllowedModel[]
}

export const getUserSelectedModelId = async (supabase: SupabaseLike, userId: string) => {
  const { data, error } = await supabase
    .from('ai_user_model_selection')
    .select('model_pk')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw new Error(error.message || 'Failed to load model selection')
  const modelPk = (data as any)?.model_pk
  if (!modelPk) return null
  const { data: m, error: mErr } = await supabase.from('ai_models').select('model_id').eq('id', modelPk).maybeSingle()
  if (mErr) throw new Error(mErr.message || 'Failed to resolve model selection')
  const modelId = (m as any)?.model_id
  return typeof modelId === 'string' && modelId ? modelId : null
}

export const setUserSelectedModelId = async (supabase: SupabaseLike, userId: string, modelId: string) => {
  const { data: model, error: mErr } = await supabase
    .from('ai_models')
    .select('id,model_id,status')
    .eq('model_id', modelId)
    .maybeSingle()
  if (mErr) throw new Error(mErr.message || 'Failed to resolve model')
  if (!model || (model as any).status !== 'active') throw new Error('Model not available')

  const { error } = await supabase.from('ai_user_model_selection').upsert({ user_id: userId, model_pk: (model as any).id, updated_at: nowIso() })
  if (error) throw new Error(error.message || 'Failed to save selection')
}

export const resolveRequestedModelId = async ({
  supabase,
  userId,
  requestedModelId,
}: {
  supabase: SupabaseLike
  userId: string
  requestedModelId: string | null
}) => {
  const allowed = await getAllowedModelsForUser(supabase, userId)
  const allowedIds = new Set(allowed.map((m) => m.model_id))

  if (requestedModelId && allowedIds.has(requestedModelId)) return { requested: requestedModelId, effective: requestedModelId, allowed }
  const selected = await getUserSelectedModelId(supabase, userId)
  if (selected && allowedIds.has(selected)) return { requested: requestedModelId, effective: selected, allowed }
  const fallback = allowed[0]?.model_id ?? null
  if (!fallback) throw new Error('No models available for this account')
  return { requested: requestedModelId, effective: fallback, allowed }
}

const resolveModelRow = async (supabase: SupabaseLike, modelId: string): Promise<Model> => {
  const { data, error } = await supabase.from('ai_models').select('*').eq('model_id', modelId).maybeSingle()
  if (error) throw new Error(error.message || 'Failed to load model')
  if (!data) throw new Error('Model not found')
  if ((data as any).status !== 'active') throw new Error('Model is not active')
  return data as Model
}

const resolveRoutingPolicy = async (supabase: SupabaseLike, modelPk: string): Promise<RoutingPolicyRow> => {
  const { data, error } = await supabase.from('ai_routing_policies').select('*').eq('model_pk', modelPk).maybeSingle()
  if (error) throw new Error(error.message || 'Failed to load routing policy')
  if (!data || (data as any).status !== 'active') throw new Error('Routing policy not configured')
  return data as RoutingPolicyRow
}

const resolveProviderByKey = async (supabase: SupabaseLike, providerKey: string): Promise<Provider> => {
  const { data, error } = await supabase.from('ai_providers').select('*').eq('key', providerKey).maybeSingle()
  if (error) throw new Error(error.message || 'Failed to load provider')
  if (!data || (data as any).status !== 'active') throw new Error('Provider not available')
  return data as Provider
}

const pickProviderKey = async (supabase: SupabaseLike, providerId: string, providerKey: string): Promise<ProviderKey> => {
  const { data, error } = await supabase
    .from('ai_provider_keys')
    .select('id,provider_id,label,key_ciphertext,status,priority')
    .eq('provider_id', providerId)
    .eq('status', 'active')
    .order('priority', { ascending: false })
    .limit(1)
  if (error) throw new Error(error.message || 'Failed to load provider key')
  const key = (data ?? [])[0] as ProviderKey | undefined
  if (!key) throw new Error(`No active API key configured for provider: ${providerKey || providerId}`)
  return key
}

const resolveProviderModelName = async (supabase: SupabaseLike, modelPk: string, providerId: string) => {
  const { data, error } = await supabase
    .from('ai_model_mappings')
    .select('*')
    .eq('model_pk', modelPk)
    .eq('provider_id', providerId)
    .eq('status', 'active')
    .maybeSingle()
  if (error) throw new Error(error.message || 'Failed to load model mapping')
  const name = (data as any)?.provider_model_name
  if (typeof name !== 'string' || !name) return null
  return name.startsWith('models/') ? name.slice('models/'.length) : name
}

const callGeminiGenerateContent = async ({
  baseUrl,
  apiKey,
  model,
  promptText,
}: {
  baseUrl: string
  apiKey: string
  model: string
  promptText: string
}) => {
  const url = `${baseUrl.replace(/\/$/, '')}/v1beta/models/${encodeURIComponent(model)}:generateContent`
  const { resp, text } = await fetchWithTimeout(
    url,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: promptText }] }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json' },
      }),
    },
    35_000,
  )
  const content = parseGeminiText(text)
  return { status: resp.status, ok: resp.ok, raw: text, content }
}

const callOpenAiChatCompletions = async ({
  baseUrl,
  apiKey,
  model,
  promptText,
}: {
  baseUrl: string
  apiKey: string
  model: string
  promptText: string
}) => {
  const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`
  const { resp, text } = await fetchWithTimeout(
    url,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: promptText }],
        temperature: 0,
        response_format: { type: 'json_object' },
      }),
    },
    35_000,
  )
  const content = parseOpenAiLikeText(text)
  return { status: resp.status, ok: resp.ok, raw: text, content }
}

const envKeyForProvider = (provider: Provider) => {
  if (provider.auth_type === 'google') return (process.env.GOOGLE_API_KEY ?? '').trim()
  if (provider.auth_type === 'bearer') return (process.env.OPENAI_API_KEY ?? '').trim()
  return ''
}

const resolveActiveProvidersByKey = async (supabase: SupabaseLike, providerKeys: string[]): Promise<Provider[]> => {
  const keys = Array.from(new Set(providerKeys.map((k) => k.trim()).filter(Boolean)))
  if (!keys.length) return []
  const { data, error } = await supabase.from('ai_providers').select('*').in('key', keys).eq('status', 'active')
  if (error) throw new Error(error.message || 'Failed to load providers')
  return (data ?? []) as Provider[]
}

const resolveProviderKeysAvailability = async (supabase: SupabaseLike, providers: Provider[]) => {
  const byKey = new Map<string, Provider>()
  for (const p of providers) byKey.set(p.key, p)

  const available = new Set<string>()
  const dbCheckIds: string[] = []
  for (const p of providers) {
    if (envKeyForProvider(p)) {
      available.add(p.key)
    } else {
      dbCheckIds.push(p.id)
    }
  }

  if (dbCheckIds.length) {
    const { data, error } = await supabase
      .from('ai_provider_keys')
      .select('provider_id')
      .in('provider_id', dbCheckIds)
      .eq('status', 'active')
    if (error) throw new Error(error.message || 'Failed to load provider keys')
    const idsWithKeys = new Set((data ?? []).map((r: any) => String(r.provider_id)))
    for (const p of providers) {
      if (idsWithKeys.has(p.id)) available.add(p.key)
    }
  }

  return { byKey, available }
}

export const runModelRequest = async ({
  supabase,
  userId,
  requestedModelId,
  promptText,
  unitCounts,
}: {
  supabase: SupabaseLike
  userId: string
  requestedModelId: string
  promptText: string
  unitCounts: { inputUnits: number; outputUnits: number }
}) => {
  const requestedModel = await resolveModelRow(supabase, requestedModelId)
  const policyRow = await resolveRoutingPolicy(supabase, requestedModel.id)
  const policy = (policyRow.policy ?? {}) as RoutingPolicy

  const allowed = await getAllowedModelsForUser(supabase, userId)
  const remaining = allowed.find((m) => m.model_id === requestedModelId)?.remaining_requests
  let effectiveModelId = requestedModelId
  let downgraded = false

  if (typeof remaining === 'number' && remaining <= 0) {
    const fb = typeof policy.quota_exhausted_fallback_model_id === 'string' ? policy.quota_exhausted_fallback_model_id.trim() : ''
    if (fb && allowed.some((m) => m.model_id === fb)) {
      effectiveModelId = fb
      downgraded = true
    }
  }

  const effectiveModel = effectiveModelId === requestedModelId ? requestedModel : await resolveModelRow(supabase, effectiveModelId)
  const effectivePolicyRow = effectiveModelId === requestedModelId ? policyRow : await resolveRoutingPolicy(supabase, effectiveModel.id)
  const effectivePolicy = (effectivePolicyRow.policy ?? {}) as RoutingPolicy

  const attempts = buildAttemptsFromPolicy(effectivePolicy)
  if (!attempts.length) throw new Error('Routing policy has no providers')

  const attemptProviderKeys = attempts.map((a) => a.providerKey)
  const attemptProviders = await resolveActiveProvidersByKey(supabase, attemptProviderKeys)
  const availability = await resolveProviderKeysAvailability(supabase, attemptProviders)
  const prioritizedAttempts = attempts
    .filter((a) => availability.byKey.has(a.providerKey))
    .sort((a, b) => (availability.available.has(a.providerKey) === availability.available.has(b.providerKey) ? 0 : availability.available.has(a.providerKey) ? -1 : 1))

  let usedFallback = false
  let lastError: { status?: number; code: string; details?: string } | null = null
  const missingKeyProviders: string[] = []

  for (let i = 0; i < prioritizedAttempts.length; i++) {
    const attempt = prioritizedAttempts[i]
    usedFallback = i > 0
    try {
      if (!availability.available.has(attempt.providerKey)) {
        missingKeyProviders.push(attempt.providerKey)
        continue
      }
      const provider = await resolveProviderByKey(supabase, attempt.providerKey)
      const mapping = await resolveProviderModelName(supabase, effectiveModel.id, provider.id)
      if (!mapping) throw new Error('Model not mapped to provider')
      let pkey: ProviderKey | null = null
      let apiKey = ''
      try {
        pkey = await pickProviderKey(supabase, provider.id, provider.key)
        apiKey = decryptSecret(pkey.key_ciphertext)
      } catch (err) {
        const msg = err instanceof Error ? err.message : ''
        if (msg.startsWith('No active API key configured for provider')) {
          apiKey = envKeyForProvider(provider)
          if (!apiKey) throw err
        } else {
          throw err
        }
      }

      const baseUrl = provider.base_url || (provider.key === 'gemini' ? 'https://generativelanguage.googleapis.com' : 'https://api.openai.com/v1')

      const callResult =
        provider.auth_type === 'google'
          ? await callGeminiGenerateContent({ baseUrl, apiKey, model: mapping, promptText })
          : await callOpenAiChatCompletions({ baseUrl, apiKey, model: mapping, promptText })

      if (!callResult.ok) {
        lastError = { status: callResult.status, code: `provider_http_${callResult.status}`, details: callResult.raw.slice(0, 1200) }
        if (pkey) await supabase.from('ai_provider_keys').update({ last_error_at: nowIso() }).eq('id', pkey.id)
        if (isRetryableStatus(callResult.status)) continue
        break
      }

      if (pkey) await supabase.from('ai_provider_keys').update({ last_used_at: nowIso() }).eq('id', pkey.id)

      const parsedJson = extractJsonObject(callResult.content)

      const outputUnits = callResult.content.length

      const { error: meterErr } = await supabase.rpc('ai_meter_model_request', {
        uid: userId,
        model_pk: effectiveModel.id,
        input_units: unitCounts.inputUnits,
        output_units: outputUnits,
        request_inc: 1,
      })
      if (meterErr) {
        if ((meterErr.message ?? '').includes('quota_exceeded')) throw new Error('quota_exceeded')
        if ((meterErr.message ?? '').includes('model_not_allowed')) throw new Error('model_not_allowed')
        throw new Error(meterErr.message || 'meter_failed')
      }

      await supabase.from('ai_usage_events').insert({
        user_id: userId,
        model_pk_requested: requestedModel.id,
        model_pk_used: effectiveModel.id,
        provider_id_used: provider.id,
        provider_key_id_used: pkey ? pkey.id : null,
        used_fallback: usedFallback,
        downgraded,
        status: 'success',
        error_code: null,
        input_units: unitCounts.inputUnits,
        output_units: outputUnits,
      })

      return {
        requested_model_id: requestedModelId,
        used_model_id: effectiveModelId,
        provider_key: provider.key,
        used_fallback: usedFallback,
        downgraded,
        output_text: callResult.content,
        output_json: parsedJson,
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'model_request_failed'
      if (msg === 'quota_exceeded') {
        await supabase.from('ai_usage_events').insert({
          user_id: userId,
          model_pk_requested: requestedModel.id,
          model_pk_used: effectiveModel.id,
          provider_id_used: null,
          provider_key_id_used: null,
          used_fallback: usedFallback,
          downgraded,
          status: 'rejected_limit',
          error_code: 'quota_exceeded',
          input_units: unitCounts.inputUnits,
          output_units: unitCounts.outputUnits,
        })
        throw new Error('quota_exceeded')
      }
      lastError = { code: msg, details: lastError?.details }
      if (i < prioritizedAttempts.length - 1) continue
    }
  }

  if (!prioritizedAttempts.length) {
    const missing = attempts.map((a) => a.providerKey).join(', ')
    throw new Error(`No available providers configured (missing keys): ${missing}`)
  }

  if (!lastError && missingKeyProviders.length) {
    const uniq = Array.from(new Set(missingKeyProviders))
    throw new Error(`No active API key configured for provider(s): ${uniq.join(', ')}`)
  }

  await supabase.from('ai_usage_events').insert({
    user_id: userId,
    model_pk_requested: requestedModel.id,
    model_pk_used: (await resolveModelRow(supabase, effectiveModelId)).id,
    provider_id_used: null,
    provider_key_id_used: null,
    used_fallback: usedFallback,
    downgraded,
    status: 'error',
    error_code: lastError?.code ?? 'unknown_error',
    input_units: unitCounts.inputUnits,
    output_units: unitCounts.outputUnits,
  })

  const status = typeof lastError?.status === 'number' ? lastError.status : 502
  const details = lastError?.details ?? ''
  const error = lastError?.code ?? 'model_request_failed'
  const e = new Error(error)
  ;(e as any).httpStatus = status
  ;(e as any).details = details
  throw e
}
