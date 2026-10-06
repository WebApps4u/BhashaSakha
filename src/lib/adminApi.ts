import { supabase } from '@/lib/supabaseClient'

/** Authenticated call to /api/admin/*; throws with the server's error message. */
export async function adminApi<T = any>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token ?? ''
  if (!token) throw new Error('Not signed in')
  const resp = await fetch(`/api/admin${path}`, {
    method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
    headers: { Authorization: `Bearer ${token}`, ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  })
  const json = (await resp.json().catch(() => ({}))) as any
  if (!resp.ok || json?.success === false) throw new Error(json?.error ?? `Request failed (${resp.status})`)
  return json as T
}

export const timeAgo = (iso: string | null | undefined) => {
  if (!iso) return 'never'
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return `${Math.round(s / 86400)} d ago`
}

export type AiProviderView = {
  id: string
  key: string
  name: string
  base_url: string | null
  auth_type: 'google' | 'bearer' | string
  status: string
  keys: Array<{ id: string; label: string; status: string; priority: number; last_used_at: string | null; last_error_at: string | null; created_at: string }>
  active_keys: number
  env_key: boolean
  usable: boolean
  used_by: Array<{ model_id: string; display_name: string; position: number; provider_model_name: string | null }>
  last_used_at: string | null
  last_error_at: string | null
}

export type AiRouteStep = {
  position: number
  provider_id: string | null
  provider_key: string
  provider_name: string
  provider_model_name: string | null
  problem: string | null
}

export type AiModelView = {
  id: string
  model_id: string
  display_name: string
  status: string
  used_for: string
  virtual: boolean
  route: AiRouteStep[]
  works: boolean
  limits: Array<{ plan_code: string; enabled: boolean; monthly_request_limit: number }>
  requests_this_month: number
}

export type AiOverview = { month: string; providers: AiProviderView[]; models: AiModelView[]; plans: Array<{ code: string; name: string; is_active: boolean }> }

export type ProbeResult = {
  ok: boolean
  status: number
  latency_ms: number
  key_source: string | null
  message: string
  preview: string | null
}
