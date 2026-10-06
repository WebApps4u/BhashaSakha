import { Router, type Request, type Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import { encryptSecret } from '../lib/cryptoVault.js'
import { listProviderModels, probeProviderModel } from '../lib/aiModelLayer.js'
import { getAiOverview, getUsageOverview, monthKeyUtc as aiMonthKey, resetUserUsage, saveModelRoute, testModelRoute } from '../lib/adminAiConsole.js'

const router = Router()

const getSupabaseUrl = () => process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? ''
const getSupabaseAnonKey = () => process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? ''
const getSupabaseServiceRoleKey = () => process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const getAdminBootstrapToken = () => process.env.ADMIN_BOOTSTRAP_TOKEN ?? ''

const jsonError = (res: Response, status: number, message: string) => {
  res.status(status).json({ success: false, error: message })
}

const parseBearer = (req: Request) => {
  const auth = req.header('authorization') ?? ''
  return auth.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : ''
}

const requireAnonEnv = () => {
  const SUPABASE_URL = getSupabaseUrl()
  const SUPABASE_ANON_KEY = getSupabaseAnonKey()
  if (!SUPABASE_URL) throw new Error('Missing SUPABASE_URL')
  if (!SUPABASE_ANON_KEY) throw new Error('Missing SUPABASE_ANON_KEY')
}

const requireServiceEnv = () => {
  requireAnonEnv()
  if (!getSupabaseServiceRoleKey()) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY')
}

const adminClient = () => {
  requireServiceEnv()
  const SUPABASE_URL = getSupabaseUrl()
  const SUPABASE_SERVICE_ROLE_KEY = getSupabaseServiceRoleKey()
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

const userClient = (token: string) => {
  requireAnonEnv()
  const SUPABASE_URL = getSupabaseUrl()
  const SUPABASE_ANON_KEY = getSupabaseAnonKey()
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  })
}

const verifyUser = async (req: Request) => {
  requireAnonEnv()
  const token = parseBearer(req)
  if (!token) return { ok: false as const, status: 401, error: 'Unauthorized' }

  const SUPABASE_URL = getSupabaseUrl()
  const SUPABASE_ANON_KEY = getSupabaseAnonKey()
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user) return { ok: false as const, status: 401, error: 'Unauthorized' }
  return { ok: true as const, userId: data.user.id, token }
}

const isAdmin = async ({ userId, token }: { userId: string; token: string }) => {
  const hasServiceKey = !!getSupabaseServiceRoleKey()
  const supabase = hasServiceKey ? adminClient() : userClient(token)
  const { data: links, error } = await supabase.from('admin_user_roles').select('role_id').eq('user_id', userId)
  if (error) return false
  const roleIds = (links ?? []).map((r: any) => r.role_id).filter(Boolean)
  if (!roleIds.length) return false
  const { data: roles } = await supabase.from('admin_roles').select('key').in('id', roleIds)
  const keys = (roles ?? []).map((r: any) => r.key).filter(Boolean)
  return keys.includes('admin') || keys.includes('super_admin')
}

const audit = async ({
  actorId,
  token,
  action,
  entityType,
  entityId,
  meta,
}: {
  actorId: string
  token: string
  action: string
  entityType: string
  entityId?: string
  meta?: Record<string, unknown>
}) => {
  try {
    const supabase = userClient(token)
    await supabase.from('audit_logs').insert({
      actor_id: actorId,
      action,
      entity_type: entityType,
      entity_id: entityId ?? null,
      meta: meta ?? {},
    })
  } catch {
    return
  }
}

const requireAdmin = async (req: Request, res: Response) => {
  const v = await verifyUser(req)
  if (!v.ok) {
    jsonError(res, v.status, v.error)
    return { ok: false as const }
  }
  const allowed = await isAdmin({ userId: v.userId, token: v.token })
  if (!allowed) {
    jsonError(res, 403, 'Forbidden')
    return { ok: false as const }
  }
  return { ok: true as const, userId: v.userId, token: v.token }
}

const monthKeyUtc = (d = new Date()) => {
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth() + 1
  return `${y}-${String(m).padStart(2, '0')}`
}

router.get('/me', async (req: Request, res: Response): Promise<void> => {
  try {
    const v = await verifyUser(req)
    if (!v.ok) {
      jsonError(res, v.status, v.error)
      return
    }

    const hasServiceKey = !!getSupabaseServiceRoleKey()
    const supabase = hasServiceKey ? adminClient() : userClient(v.token)

    const { data: links, error: linksErr } = await supabase.from('admin_user_roles').select('role_id').eq('user_id', v.userId)
    if (linksErr) {
      jsonError(res, 500, linksErr.message)
      return
    }
    const roleIds = (links ?? []).map((x: any) => x.role_id).filter(Boolean)
    const { data: rolesRows, error: rolesErr } = roleIds.length
      ? await supabase.from('admin_roles').select('id,key,name').in('id', roleIds)
      : { data: [] as any[] }
    if (rolesErr) {
      jsonError(res, 500, rolesErr.message)
      return
    }

    const roles = (rolesRows ?? []).map((r: any) => ({ key: r.key as string, name: r.name as string }))

    const { data: rolePermRows, error: rolePermErr } = roleIds.length
      ? await supabase.from('admin_role_permissions').select('permission_id').in('role_id', roleIds)
      : { data: [] as any[] }
    if (rolePermErr) {
      jsonError(res, 500, rolePermErr.message)
      return
    }
    const permIds = (rolePermRows ?? []).map((x: any) => x.permission_id).filter(Boolean)
    const { data: permRows, error: permErr } = permIds.length
      ? await supabase.from('admin_permissions').select('key').in('id', permIds)
      : { data: [] as any[] }
    if (permErr) {
      jsonError(res, 500, permErr.message)
      return
    }

    const permissions = Array.from(new Set((permRows ?? []).map((x: any) => x.key).filter(Boolean)))

    res.status(200).json({ success: true, user_id: v.userId, roles, permissions })
  } catch (err) {
    jsonError(res, 500, err instanceof Error ? err.message : 'Server error')
  }
})

router.get('/ai/providers', async (req: Request, res: Response) => {
  try {
    const a = await requireAdmin(req, res)
    if (!a.ok) return
    const supabase = adminClient()
    const { data, error } = await supabase.from('ai_providers').select('id,key,name,base_url,auth_type,status,created_at,updated_at').order('name')
    if (error) return jsonError(res, 500, error.message)
    res.status(200).json({ success: true, providers: data ?? [] })
  } catch (err) {
    jsonError(res, 500, err instanceof Error ? err.message : 'Server error')
  }
})

router.post('/ai/providers', async (req: Request, res: Response) => {
  try {
    const a = await requireAdmin(req, res)
    if (!a.ok) return
    const body = (req.body ?? {}) as any
    const id = typeof body.id === 'string' ? body.id : null
    const key = typeof body.key === 'string' ? body.key.trim() : ''
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    const baseUrl = typeof body.base_url === 'string' ? body.base_url.trim() : null
    const authType = typeof body.auth_type === 'string' ? body.auth_type.trim() : ''
    const status = typeof body.status === 'string' ? body.status.trim() : 'active'

    if (!key || !name || !authType) return jsonError(res, 400, 'key, name, and auth_type are required')
    const supabase = adminClient()
    const payload: any = { key, name, base_url: baseUrl, auth_type: authType, status }

    const q = id ? supabase.from('ai_providers').update(payload).eq('id', id).select('id').maybeSingle() : supabase.from('ai_providers').upsert(payload, { onConflict: 'key' }).select('id').maybeSingle()
    const { data, error } = await q
    if (error) return jsonError(res, 500, error.message)
    await audit({ actorId: a.userId, token: a.token, action: 'upsert', entityType: 'ai_provider', entityId: (data as any)?.id, meta: { key } })
    res.status(200).json({ success: true })
  } catch (err) {
    jsonError(res, 500, err instanceof Error ? err.message : 'Server error')
  }
})

router.get('/ai/provider-keys', async (req: Request, res: Response) => {
  try {
    const a = await requireAdmin(req, res)
    if (!a.ok) return
    const providerId = typeof req.query.provider_id === 'string' ? String(req.query.provider_id) : ''
    if (!providerId) return jsonError(res, 400, 'provider_id is required')
    const supabase = adminClient()
    const { data, error } = await supabase
      .from('ai_provider_keys')
      .select('id,provider_id,label,status,priority,created_at,updated_at,last_used_at,last_error_at')
      .eq('provider_id', providerId)
      .order('priority', { ascending: false })
    if (error) return jsonError(res, 500, error.message)
    res.status(200).json({ success: true, keys: data ?? [] })
  } catch (err) {
    jsonError(res, 500, err instanceof Error ? err.message : 'Server error')
  }
})

router.post('/ai/provider-keys', async (req: Request, res: Response) => {
  try {
    const a = await requireAdmin(req, res)
    if (!a.ok) return
    const body = (req.body ?? {}) as any
    const providerId = typeof body.provider_id === 'string' ? body.provider_id : ''
    const label = typeof body.label === 'string' ? body.label.trim() : ''
    const key = typeof body.key === 'string' ? body.key.trim() : ''
    const priority = Number.isFinite(Number(body.priority)) ? Math.trunc(Number(body.priority)) : 100
    const status = typeof body.status === 'string' ? body.status.trim() : 'active'

    if (!providerId || !label || !key) return jsonError(res, 400, 'provider_id, label, and key are required')
    const supabase = adminClient()
    const { data, error } = await supabase
      .from('ai_provider_keys')
      .insert({ provider_id: providerId, label, key_ciphertext: encryptSecret(key), status, priority })
      .select('id')
      .single()
    if (error) return jsonError(res, 500, error.message)
    await audit({ actorId: a.userId, token: a.token, action: 'create', entityType: 'ai_provider_key', entityId: (data as any)?.id, meta: { provider_id: providerId, label } })
    res.status(200).json({ success: true })
  } catch (err) {
    jsonError(res, 500, err instanceof Error ? err.message : 'Server error')
  }
})

router.put('/ai/provider-keys/:id', async (req: Request, res: Response) => {
  try {
    const a = await requireAdmin(req, res)
    if (!a.ok) return
    const id = String(req.params.id)
    const body = (req.body ?? {}) as any
    const label = typeof body.label === 'string' ? body.label.trim() : undefined
    const priority = body.priority !== undefined ? (Number.isFinite(Number(body.priority)) ? Math.trunc(Number(body.priority)) : 100) : undefined
    const status = typeof body.status === 'string' ? body.status.trim() : undefined
    const key = typeof body.key === 'string' ? body.key.trim() : undefined

    const patch: any = {}
    if (label !== undefined) patch.label = label
    if (priority !== undefined) patch.priority = priority
    if (status !== undefined) patch.status = status
    if (key !== undefined && key) patch.key_ciphertext = encryptSecret(key)
    if (!Object.keys(patch).length) return jsonError(res, 400, 'No fields to update')

    const supabase = adminClient()
    const { error } = await supabase.from('ai_provider_keys').update(patch).eq('id', id)
    if (error) return jsonError(res, 500, error.message)
    await audit({ actorId: a.userId, token: a.token, action: 'update', entityType: 'ai_provider_key', entityId: id, meta: { fields: Object.keys(patch) } })
    res.status(200).json({ success: true })
  } catch (err) {
    jsonError(res, 500, err instanceof Error ? err.message : 'Server error')
  }
})

router.delete('/ai/provider-keys/:id', async (req: Request, res: Response) => {
  try {
    const a = await requireAdmin(req, res)
    if (!a.ok) return
    const id = String(req.params.id)
    const supabase = adminClient()
    const { error } = await supabase.from('ai_provider_keys').update({ status: 'disabled', updated_at: new Date().toISOString() }).eq('id', id)
    if (error) return jsonError(res, 500, error.message)
    await audit({ actorId: a.userId, token: a.token, action: 'delete', entityType: 'ai_provider_key', entityId: id, meta: {} })
    res.status(200).json({ success: true })
  } catch (err) {
    jsonError(res, 500, err instanceof Error ? err.message : 'Server error')
  }
})

router.get('/ai/models', async (req: Request, res: Response) => {
  try {
    const a = await requireAdmin(req, res)
    if (!a.ok) return
    const supabase = adminClient()
    const { data, error } = await supabase
      .from('ai_models')
      .select('id,model_id,display_name,modality,status,created_at,updated_at')
      .neq('status', 'disabled')
      .order('display_name')
    if (error) return jsonError(res, 500, error.message)
    res.status(200).json({ success: true, models: data ?? [] })
  } catch (err) {
    jsonError(res, 500, err instanceof Error ? err.message : 'Server error')
  }
})

router.post('/ai/models', async (req: Request, res: Response) => {
  try {
    const a = await requireAdmin(req, res)
    if (!a.ok) return
    const body = (req.body ?? {}) as any
    const id = typeof body.id === 'string' ? body.id : null
    const modelIdRaw = typeof body.model_id === 'string' ? body.model_id.trim() : ''
    const modelId = modelIdRaw.replace(/-/g, '_')
    const displayName = typeof body.display_name === 'string' ? body.display_name.trim() : ''
    const modality = typeof body.modality === 'string' ? body.modality.trim() : 'text'
    const status = typeof body.status === 'string' ? body.status.trim() : 'active'
    if (!modelId || !displayName) return jsonError(res, 400, 'model_id and display_name are required')
    const supabase = adminClient()
    const payload: any = { model_id: modelId, display_name: displayName, modality, status }
    const q = id ? supabase.from('ai_models').update(payload).eq('id', id).select('id').maybeSingle() : supabase.from('ai_models').upsert(payload, { onConflict: 'model_id' }).select('id').maybeSingle()
    const { data, error } = await q
    if (error) return jsonError(res, 500, error.message)
    await audit({ actorId: a.userId, token: a.token, action: 'upsert', entityType: 'ai_model', entityId: (data as any)?.id, meta: { model_id: modelId } })
    res.status(200).json({ success: true })
  } catch (err) {
    jsonError(res, 500, err instanceof Error ? err.message : 'Server error')
  }
})

router.delete('/ai/models/:id', async (req: Request, res: Response) => {
  try {
    const a = await requireAdmin(req, res)
    if (!a.ok) return
    const id = String(req.params.id)
    const supabase = adminClient()
    const { error } = await supabase.from('ai_models').update({ status: 'disabled', updated_at: new Date().toISOString() }).eq('id', id)
    if (error) return jsonError(res, 500, error.message)
    await audit({ actorId: a.userId, token: a.token, action: 'delete', entityType: 'ai_model', entityId: id, meta: {} })
    res.status(200).json({ success: true })
  } catch (err) {
    jsonError(res, 500, err instanceof Error ? err.message : 'Server error')
  }
})

router.get('/ai/model-mappings', async (req: Request, res: Response) => {
  try {
    const a = await requireAdmin(req, res)
    if (!a.ok) return
    const modelPk = typeof req.query.model_pk === 'string' ? String(req.query.model_pk) : ''
    if (!modelPk) return jsonError(res, 400, 'model_pk is required')
    const supabase = adminClient()
    const { data, error } = await supabase
      .from('ai_model_mappings')
      .select('id,model_pk,provider_id,provider_model_name,status,created_at')
      .eq('model_pk', modelPk)
      .neq('status', 'disabled')
      .order('created_at', { ascending: false })
    if (error) return jsonError(res, 500, error.message)
    res.status(200).json({ success: true, mappings: data ?? [] })
  } catch (err) {
    jsonError(res, 500, err instanceof Error ? err.message : 'Server error')
  }
})

router.delete('/ai/model-mappings/:id', async (req: Request, res: Response) => {
  try {
    const a = await requireAdmin(req, res)
    if (!a.ok) return
    const id = String(req.params.id)
    const supabase = adminClient()
    const { error } = await supabase.from('ai_model_mappings').update({ status: 'disabled' }).eq('id', id)
    if (error) return jsonError(res, 500, error.message)
    await audit({ actorId: a.userId, token: a.token, action: 'delete', entityType: 'ai_model_mapping', entityId: id, meta: {} })
    res.status(200).json({ success: true })
  } catch (err) {
    jsonError(res, 500, err instanceof Error ? err.message : 'Server error')
  }
})

router.post('/ai/model-mappings', async (req: Request, res: Response) => {
  try {
    const a = await requireAdmin(req, res)
    if (!a.ok) return
    const body = (req.body ?? {}) as any
    const id = typeof body.id === 'string' ? body.id : null
    const modelPk = typeof body.model_pk === 'string' ? body.model_pk : ''
    const providerId = typeof body.provider_id === 'string' ? body.provider_id : ''
    const providerModelName = typeof body.provider_model_name === 'string' ? body.provider_model_name.trim() : ''
    const status = typeof body.status === 'string' ? body.status.trim() : 'active'
    if (!modelPk || !providerId || !providerModelName) return jsonError(res, 400, 'model_pk, provider_id, and provider_model_name are required')
    const supabase = adminClient()
    if (id) {
      const { error } = await supabase
        .from('ai_model_mappings')
        .update({ model_pk: modelPk, provider_id: providerId, provider_model_name: providerModelName, status })
        .eq('id', id)
      if (error) return jsonError(res, 500, error.message)
      await audit({ actorId: a.userId, token: a.token, action: 'update', entityType: 'ai_model_mapping', entityId: id })
      res.status(200).json({ success: true })
      return
    }
    const { data, error } = await supabase
      .from('ai_model_mappings')
      .insert({ model_pk: modelPk, provider_id: providerId, provider_model_name: providerModelName, status })
      .select('id')
      .single()
    if (error) return jsonError(res, 500, error.message)
    await audit({ actorId: a.userId, token: a.token, action: 'create', entityType: 'ai_model_mapping', entityId: (data as any)?.id })
    res.status(200).json({ success: true })
  } catch (err) {
    jsonError(res, 500, err instanceof Error ? err.message : 'Server error')
  }
})

router.get('/ai/routing-policies', async (req: Request, res: Response) => {
  try {
    const a = await requireAdmin(req, res)
    if (!a.ok) return
    const supabase = adminClient()
    const { data, error } = await supabase.from('ai_routing_policies').select('id,model_pk,status,policy,created_at,updated_at').order('updated_at', { ascending: false })
    if (error) return jsonError(res, 500, error.message)
    res.status(200).json({ success: true, policies: data ?? [] })
  } catch (err) {
    jsonError(res, 500, err instanceof Error ? err.message : 'Server error')
  }
})

router.post('/ai/routing-policies', async (req: Request, res: Response) => {
  try {
    const a = await requireAdmin(req, res)
    if (!a.ok) return
    const body = (req.body ?? {}) as any
    const modelPk = typeof body.model_pk === 'string' ? body.model_pk : ''
    const status = typeof body.status === 'string' ? body.status.trim() : 'active'
    const policy = body.policy ?? {}
    if (!modelPk) return jsonError(res, 400, 'model_pk is required')
    const supabase = adminClient()
    const { data, error } = await supabase
      .from('ai_routing_policies')
      .upsert({ model_pk: modelPk, status, policy }, { onConflict: 'model_pk' })
      .select('id')
      .single()
    if (error) return jsonError(res, 500, error.message)
    await audit({ actorId: a.userId, token: a.token, action: 'upsert', entityType: 'ai_routing_policy', entityId: (data as any)?.id, meta: { model_pk: modelPk } })
    res.status(200).json({ success: true })
  } catch (err) {
    jsonError(res, 500, err instanceof Error ? err.message : 'Server error')
  }
})

router.get('/ai/plans-matrix', async (req: Request, res: Response) => {
  try {
    const a = await requireAdmin(req, res)
    if (!a.ok) return
    const supabase = adminClient()
    const [{ data: plans }, { data: models }, { data: entitlements }] = await Promise.all([
      supabase.from('subscription_plans').select('code,name,is_active').order('code'),
      supabase.from('ai_models').select('id,model_id,display_name,modality,status').neq('status', 'disabled').order('display_name'),
      supabase.from('ai_plan_entitlements').select('id,plan_code,model_pk,is_enabled,monthly_request_limit,monthly_input_unit_limit,monthly_output_unit_limit,updated_at'),
    ])
    res.status(200).json({ success: true, plans: plans ?? [], models: models ?? [], entitlements: entitlements ?? [] })
  } catch (err) {
    jsonError(res, 500, err instanceof Error ? err.message : 'Server error')
  }
})

router.post('/ai/plan-entitlements', async (req: Request, res: Response) => {
  try {
    const a = await requireAdmin(req, res)
    if (!a.ok) return
    const body = (req.body ?? {}) as any
    const planCode = typeof body.plan_code === 'string' ? body.plan_code.trim() : ''
    const modelPk = typeof body.model_pk === 'string' ? body.model_pk : ''
    const isEnabled = body.is_enabled === undefined ? true : Boolean(body.is_enabled)
    const reqLimit = Number.isFinite(Number(body.monthly_request_limit)) ? Math.max(0, Math.trunc(Number(body.monthly_request_limit))) : 0
    const inLimit = Number.isFinite(Number(body.monthly_input_unit_limit)) ? Math.max(0, Math.trunc(Number(body.monthly_input_unit_limit))) : 0
    const outLimit = Number.isFinite(Number(body.monthly_output_unit_limit)) ? Math.max(0, Math.trunc(Number(body.monthly_output_unit_limit))) : 0
    if (!planCode || !modelPk) return jsonError(res, 400, 'plan_code and model_pk are required')
    const supabase = adminClient()
    const { data, error } = await supabase
      .from('ai_plan_entitlements')
      .upsert(
        {
          plan_code: planCode,
          model_pk: modelPk,
          is_enabled: isEnabled,
          monthly_request_limit: reqLimit,
          monthly_input_unit_limit: inLimit,
          monthly_output_unit_limit: outLimit,
        },
        { onConflict: 'plan_code,model_pk' },
      )
      .select('id')
      .single()
    if (error) return jsonError(res, 500, error.message)
    await audit({ actorId: a.userId, token: a.token, action: 'upsert', entityType: 'ai_plan_entitlement', entityId: (data as any)?.id, meta: { plan_code: planCode, model_pk: modelPk } })
    res.status(200).json({ success: true })
  } catch (err) {
    jsonError(res, 500, err instanceof Error ? err.message : 'Server error')
  }
})

router.get('/ai/user-overrides', async (req: Request, res: Response) => {
  try {
    const a = await requireAdmin(req, res)
    if (!a.ok) return
    const userId = typeof req.query.user_id === 'string' ? String(req.query.user_id) : ''
    if (!userId) return jsonError(res, 400, 'user_id is required')
    const supabase = adminClient()
    const { data, error } = await supabase
      .from('ai_user_overrides')
      .select('id,user_id,model_pk,override_enabled,override_monthly_request_limit,override_monthly_input_unit_limit,override_monthly_output_unit_limit,updated_at')
      .eq('user_id', userId)
    if (error) return jsonError(res, 500, error.message)
    res.status(200).json({ success: true, overrides: data ?? [] })
  } catch (err) {
    jsonError(res, 500, err instanceof Error ? err.message : 'Server error')
  }
})

router.post('/ai/user-overrides', async (req: Request, res: Response) => {
  try {
    const a = await requireAdmin(req, res)
    if (!a.ok) return
    const body = (req.body ?? {}) as any
    const userId = typeof body.user_id === 'string' ? body.user_id : ''
    const modelPk = typeof body.model_pk === 'string' ? body.model_pk : ''
    if (!userId || !modelPk) return jsonError(res, 400, 'user_id and model_pk are required')

    const patch: any = { user_id: userId, model_pk: modelPk }
    if (body.override_enabled !== undefined) patch.override_enabled = body.override_enabled === null ? null : Boolean(body.override_enabled)
    if (body.override_monthly_request_limit !== undefined)
      patch.override_monthly_request_limit = body.override_monthly_request_limit === null ? null : Math.max(0, Math.trunc(Number(body.override_monthly_request_limit) || 0))
    if (body.override_monthly_input_unit_limit !== undefined)
      patch.override_monthly_input_unit_limit = body.override_monthly_input_unit_limit === null ? null : Math.max(0, Math.trunc(Number(body.override_monthly_input_unit_limit) || 0))
    if (body.override_monthly_output_unit_limit !== undefined)
      patch.override_monthly_output_unit_limit = body.override_monthly_output_unit_limit === null ? null : Math.max(0, Math.trunc(Number(body.override_monthly_output_unit_limit) || 0))

    const supabase = adminClient()
    const { data, error } = await supabase
      .from('ai_user_overrides')
      .upsert(patch, { onConflict: 'user_id,model_pk' })
      .select('id')
      .single()
    if (error) return jsonError(res, 500, error.message)
    await audit({ actorId: a.userId, token: a.token, action: 'upsert', entityType: 'ai_user_override', entityId: (data as any)?.id, meta: { user_id: userId, model_pk: modelPk } })
    res.status(200).json({ success: true })
  } catch (err) {
    jsonError(res, 500, err instanceof Error ? err.message : 'Server error')
  }
})

router.get('/ai/usage', async (req: Request, res: Response) => {
  try {
    const a = await requireAdmin(req, res)
    if (!a.ok) return
    const userId = typeof req.query.user_id === 'string' ? String(req.query.user_id) : null
    const status = typeof req.query.status === 'string' ? String(req.query.status) : null
    const limit = Math.min(500, Math.max(1, Number(req.query.limit ?? 100) || 100))
    const supabase = adminClient()
    let q = supabase
      .from('ai_usage_events')
      .select('id,created_at,user_id,status,error_code,used_fallback,downgraded,input_units,output_units,model_pk_requested,model_pk_used,provider_id_used,provider_key_id_used')
      .order('created_at', { ascending: false })
      .limit(limit)
    if (userId) q = q.eq('user_id', userId)
    if (status) q = q.eq('status', status)
    const { data, error } = await q
    if (error) return jsonError(res, 500, error.message)
    res.status(200).json({ success: true, events: data ?? [] })
  } catch (err) {
    jsonError(res, 500, err instanceof Error ? err.message : 'Server error')
  }
})

router.post('/bootstrap', async (req: Request, res: Response): Promise<void> => {
  try {
    if (!getSupabaseServiceRoleKey()) {
      jsonError(res, 409, 'Admin bootstrap requires SUPABASE_SERVICE_ROLE_KEY')
      return
    }
    const token = req.header('x-bootstrap-token') ?? ''
    const ADMIN_BOOTSTRAP_TOKEN = getAdminBootstrapToken()
    if (!ADMIN_BOOTSTRAP_TOKEN || token !== ADMIN_BOOTSTRAP_TOKEN) {
      jsonError(res, 403, 'Forbidden')
      return
    }

    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : ''
    if (!email) {
      jsonError(res, 400, 'email is required')
      return
    }

    const supabase = adminClient()
    let found: { id: string; email?: string | null } | null = null
    for (let page = 1; page <= 20; page++) {
      const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 50 })
      if (error) break
      const hit = (data.users as any[]).find((u: any) => (u.email ?? '').toLowerCase() === email)
      if (hit) {
        found = { id: hit.id, email: hit.email }
        break
      }
      if (data.users.length < 50) break
    }

    if (!found) {
      jsonError(res, 404, 'User not found')
      return
    }

    let roleId: string | null = null
    {
      const { data, error } = await supabase.from('admin_roles').select('id').eq('key', 'admin').maybeSingle()
      if (error) {
        jsonError(res, 500, `Admin role lookup failed: ${error.message}`)
        return
      }
      roleId = (data as any)?.id ?? null
    }

    if (!roleId) {
      const { data: created, error } = await supabase
        .from('admin_roles')
        .insert({ key: 'admin', name: 'Admin' })
        .select('id')
        .single()
      if (error) {
        jsonError(res, 500, `Admin role create failed: ${error.message}`)
        return
      }
      roleId = (created as any)?.id ?? null
    }

    if (!roleId) {
      jsonError(res, 500, 'Missing admin role')
      return
    }

    await supabase.from('admin_user_roles').upsert({ user_id: found.id, role_id: roleId })
    res.status(200).json({ success: true, user_id: found.id })
  } catch (err) {
    jsonError(res, 500, err instanceof Error ? err.message : 'Server error')
  }
})

router.get('/roles', async (req: Request, res: Response): Promise<void> => {
  try {
    const v = await verifyUser(req)
    if (!v.ok) {
      jsonError(res, v.status, v.error)
      return
    }
    const ok = await isAdmin({ userId: v.userId, token: v.token })
    if (!ok) {
      jsonError(res, 403, 'Forbidden')
      return
    }

    const supabase = userClient(v.token)
    const { data, error } = await supabase.from('admin_roles').select('key,name').order('key')
    if (error) {
      jsonError(res, 500, error.message)
      return
    }
    res.status(200).json({ success: true, roles: data ?? [] })
  } catch (err) {
    jsonError(res, 500, err instanceof Error ? err.message : 'Server error')
  }
})

router.get('/settings', async (req: Request, res: Response): Promise<void> => {
  try {
    const v = await verifyUser(req)
    if (!v.ok) {
      jsonError(res, v.status, v.error)
      return
    }
    if (!(await isAdmin({ userId: v.userId, token: v.token }))) {
      jsonError(res, 403, 'Forbidden')
      return
    }

    const supabase = userClient(v.token)
    const { data, error } = await supabase.from('app_settings').select('key,value,updated_at,updated_by').order('key')
    if (error) {
      jsonError(res, 500, error.message)
      return
    }
    res.status(200).json({ success: true, settings: data ?? [] })
  } catch (err) {
    jsonError(res, 500, err instanceof Error ? err.message : 'Server error')
  }
})

router.put('/settings/:key', async (req: Request, res: Response): Promise<void> => {
  try {
    const v = await verifyUser(req)
    if (!v.ok) {
      jsonError(res, v.status, v.error)
      return
    }
    if (!(await isAdmin({ userId: v.userId, token: v.token }))) {
      jsonError(res, 403, 'Forbidden')
      return
    }

    const key = (req.params.key ?? '').trim()
    if (!key) {
      jsonError(res, 400, 'key is required')
      return
    }
    const value = req.body?.value
    if (value == null || typeof value !== 'object') {
      jsonError(res, 400, 'value (json) is required')
      return
    }

    const supabase = userClient(v.token)
    const { error } = await supabase
      .from('app_settings')
      .upsert({ key, value, updated_by: v.userId })
    if (error) {
      jsonError(res, 500, error.message)
      return
    }

    await audit({ actorId: v.userId, token: v.token, action: 'settings.upsert', entityType: 'app_settings', entityId: key, meta: { key } })
    res.status(200).json({ success: true })
  } catch (err) {
    jsonError(res, 500, err instanceof Error ? err.message : 'Server error')
  }
})

router.get('/flags', async (req: Request, res: Response): Promise<void> => {
  try {
    const v = await verifyUser(req)
    if (!v.ok) {
      jsonError(res, v.status, v.error)
      return
    }
    if (!(await isAdmin({ userId: v.userId, token: v.token }))) {
      jsonError(res, 403, 'Forbidden')
      return
    }

    const supabase = userClient(v.token)
    const { data, error } = await supabase.from('feature_flags').select('key,description,is_enabled,config,updated_at').order('key')
    if (error) {
      jsonError(res, 500, error.message)
      return
    }
    const flags = (data ?? []).map((r: any) => ({
      key: r.key as string,
      enabled: !!r.is_enabled,
      description: (r.description ?? '') as string,
      payload: (r.config ?? {}) as unknown,
    }))
    res.status(200).json({ success: true, flags })
  } catch (err) {
    jsonError(res, 500, err instanceof Error ? err.message : 'Server error')
  }
})

router.put('/flags/:key', async (req: Request, res: Response): Promise<void> => {
  try {
    const v = await verifyUser(req)
    if (!v.ok) {
      jsonError(res, v.status, v.error)
      return
    }
    if (!(await isAdmin({ userId: v.userId, token: v.token }))) {
      jsonError(res, 403, 'Forbidden')
      return
    }

    const key = (req.params.key ?? '').trim()
    if (!key) {
      jsonError(res, 400, 'key is required')
      return
    }

    const enabled = typeof req.body?.enabled === 'boolean' ? req.body.enabled : null
    const description = typeof req.body?.description === 'string' ? req.body.description : null
    const payload = req.body?.payload

    if (enabled == null || description == null || payload == null || typeof payload !== 'object') {
      jsonError(res, 400, 'enabled, description, payload are required')
      return
    }

    const supabase = userClient(v.token)
    const { error } = await supabase
      .from('feature_flags')
      .upsert({ key, is_enabled: enabled, description, config: payload })
    if (error) {
      jsonError(res, 500, error.message)
      return
    }

    await audit({ actorId: v.userId, token: v.token, action: 'flags.upsert', entityType: 'feature_flags', entityId: key, meta: { key, enabled } })
    res.status(200).json({ success: true })
  } catch (err) {
    jsonError(res, 500, err instanceof Error ? err.message : 'Server error')
  }
})

router.get('/logs', async (req: Request, res: Response): Promise<void> => {
  try {
    const v = await verifyUser(req)
    if (!v.ok) {
      jsonError(res, v.status, v.error)
      return
    }
    if (!(await isAdmin({ userId: v.userId, token: v.token }))) {
      jsonError(res, 403, 'Forbidden')
      return
    }

    const supabase = userClient(v.token)
    const { data, error } = await supabase
      .from('audit_logs')
      .select('id,actor_id,action,entity_type,entity_id,meta,created_at')
      .order('created_at', { ascending: false })
      .limit(200)
    if (error) {
      jsonError(res, 500, error.message)
      return
    }
    res.status(200).json({ success: true, logs: data ?? [] })
  } catch (err) {
    jsonError(res, 500, err instanceof Error ? err.message : 'Server error')
  }
})

router.get('/users', async (req: Request, res: Response): Promise<void> => {
  try {
    const v = await verifyUser(req)
    if (!v.ok) {
      jsonError(res, v.status, v.error)
      return
    }
    if (!(await isAdmin({ userId: v.userId, token: v.token }))) {
      jsonError(res, 403, 'Forbidden')
      return
    }

    const supabase = userClient(v.token)

    const perPage = Math.min(100, Math.max(1, Number(req.query.per_page ?? '50')))
    const page = Math.max(1, Number(req.query.page ?? '1'))
    const from = (page - 1) * perPage
    const to = from + perPage - 1

    const { data: profiles, error: profilesErr } = await supabase
      .from('profiles')
      .select('id,display_name,email,is_blocked,created_at')
      .order('created_at', { ascending: false })
      .range(from, to)
    if (profilesErr) {
      jsonError(res, 500, profilesErr.message)
      return
    }

    const ids = (profiles ?? []).map((p: any) => p.id).filter(Boolean)
    const { data: roleLinks } = ids.length
      ? await supabase.from('admin_user_roles').select('user_id,role_id').in('user_id', ids)
      : { data: [] as any[] }
    const roleIds = Array.from(new Set((roleLinks ?? []).map((r: any) => r.role_id).filter(Boolean)))
    const { data: roles } = roleIds.length
      ? await supabase.from('admin_roles').select('id,key').in('id', roleIds)
      : { data: [] as any[] }
    const idToKey = new Map((roles ?? []).map((r: any) => [r.id, r.key]))

    const roleMap = new Map<string, string[]>()
    for (const row of roleLinks ?? []) {
      const uid = row.user_id as string
      const rid = row.role_id as string
      const key = idToKey.get(rid)
      if (!uid || !key) continue
      roleMap.set(uid, roleMap.get(uid) ? [...(roleMap.get(uid) as string[]), key] : [key])
    }

    const users = (profiles ?? []).map((p: any) => ({
      id: p.id,
      email: p.email ?? null,
      created_at: p.created_at ?? null,
      last_sign_in_at: null,
      display_name: p.display_name ?? '',
      is_blocked: !!p.is_blocked,
      roles: roleMap.get(p.id) ?? [],
    }))

    const planRows = await Promise.all(
      users.map(async (u) => {
        try {
          const { data } = await supabase.rpc('get_user_plan', { uid: u.id })
          const row = Array.isArray(data) ? (data[0] as any) : (data as any)
          return { userId: u.id, plan_code: row?.plan_code ?? 'free' }
        } catch {
          return { userId: u.id, plan_code: 'free' }
        }
      }),
    )
    const planByUserId = new Map(planRows.map((r) => [r.userId, r.plan_code]))
    const usersWithPlan = users.map((u) => ({ ...u, plan_code: planByUserId.get(u.id) ?? 'free' }))

    res.status(200).json({ success: true, users: usersWithPlan, page, per_page: perPage, source: 'profiles' })
  } catch (err) {
    jsonError(res, 500, err instanceof Error ? err.message : 'Server error')
  }
})

router.delete('/subscriptions/plans/:code', async (req: Request, res: Response): Promise<void> => {
  try {
    const v = await verifyUser(req)
    if (!v.ok) {
      jsonError(res, v.status, v.error)
      return
    }
    if (!(await isAdmin({ userId: v.userId, token: v.token }))) {
      jsonError(res, 403, 'Forbidden')
      return
    }

    const code = String(req.params.code ?? '')
      .trim()
      .toLowerCase()
    if (!code) {
      jsonError(res, 400, 'code is required')
      return
    }

    const supabase = adminClient()
    const { error } = await supabase.from('subscription_plans').update({ is_active: false }).eq('code', code)
    if (error) {
      jsonError(res, 500, error.message)
      return
    }
    await supabase.from('admin_audit_log').insert({
      actor_user_id: v.userId,
      action: 'subscriptions.plan.delete',
      target_type: 'subscription_plans',
      target_id: code,
      details: { code },
    })
    res.status(200).json({ success: true })
  } catch (err) {
    jsonError(res, 500, err instanceof Error ? err.message : 'Server error')
  }
})

router.post('/users/:userId/block', async (req: Request, res: Response): Promise<void> => {
  try {
    const v = await verifyUser(req)
    if (!v.ok) {
      jsonError(res, v.status, v.error)
      return
    }
    if (!(await isAdmin({ userId: v.userId, token: v.token }))) {
      jsonError(res, 403, 'Forbidden')
      return
    }

    const userId = (req.params.userId ?? '').trim()
    const blocked = typeof req.body?.blocked === 'boolean' ? req.body.blocked : null
    if (!userId || blocked == null) {
      jsonError(res, 400, 'blocked (boolean) is required')
      return
    }

    const supabase = userClient(v.token)
    const { error } = await supabase.from('profiles').upsert({ id: userId, is_blocked: blocked })
    if (error) {
      jsonError(res, 500, error.message)
      return
    }
    await audit({ actorId: v.userId, token: v.token, action: 'users.block', entityType: 'profiles', entityId: userId, meta: { user_id: userId, blocked } })
    res.status(200).json({ success: true })
  } catch (err) {
    jsonError(res, 500, err instanceof Error ? err.message : 'Server error')
  }
})

router.post('/users/:userId/roles', async (req: Request, res: Response): Promise<void> => {
  try {
    const v = await verifyUser(req)
    if (!v.ok) {
      jsonError(res, v.status, v.error)
      return
    }
    if (!(await isAdmin({ userId: v.userId, token: v.token }))) {
      jsonError(res, 403, 'Forbidden')
      return
    }

    const userId = (req.params.userId ?? '').trim()
    const roles = Array.isArray(req.body?.roles) ? req.body.roles.filter((x: any) => typeof x === 'string').map((x: string) => x.trim()) : []
    if (!userId) {
      jsonError(res, 400, 'userId is required')
      return
    }

    const supabase = userClient(v.token)
    const { data: allRoles } = await supabase.from('admin_roles').select('id,key')
    const keyToId = new Map((allRoles ?? []).map((r: any) => [r.key, r.id]))
    const wantedRoleIds = roles.map((k: string) => keyToId.get(k)).filter(Boolean)

    const { data: existing } = await supabase.from('admin_user_roles').select('role_id').eq('user_id', userId)
    const existingRoleIds = new Set((existing ?? []).map((r: any) => r.role_id))

    const toInsert = wantedRoleIds.filter((rid: any) => !existingRoleIds.has(rid)).map((rid: any) => ({ user_id: userId, role_id: rid }))
    const toDelete = Array.from(existingRoleIds).filter((rid) => !wantedRoleIds.includes(rid as any))

    if (toInsert.length) await supabase.from('admin_user_roles').insert(toInsert)
    if (toDelete.length) await supabase.from('admin_user_roles').delete().eq('user_id', userId).in('role_id', toDelete as any)

    await audit({ actorId: v.userId, token: v.token, action: 'users.roles.set', entityType: 'admin_user_roles', entityId: userId, meta: { user_id: userId, roles } })
    res.status(200).json({ success: true })
  } catch (err) {
    jsonError(res, 500, err instanceof Error ? err.message : 'Server error')
  }
})

router.get('/subscriptions/plans', async (req: Request, res: Response): Promise<void> => {
  try {
    const v = await verifyUser(req)
    if (!v.ok) {
      jsonError(res, v.status, v.error)
      return
    }
    if (!(await isAdmin({ userId: v.userId, token: v.token }))) {
      jsonError(res, 403, 'Forbidden')
      return
    }

    const supabase = getSupabaseServiceRoleKey() ? adminClient() : userClient(v.token)
    const { data, error } = await supabase
      .from('subscription_plans')
      .select('code,name,monthly_request_limit,monthly_char_limit,per_request_char_limit,max_targets,is_active,created_at')
      .order('monthly_request_limit', { ascending: true })
    if (error) {
      jsonError(res, 500, error.message)
      return
    }
    res.status(200).json({ success: true, plans: data ?? [] })
  } catch (err) {
    jsonError(res, 500, err instanceof Error ? err.message : 'Server error')
  }
})

router.post('/subscriptions/plans', async (req: Request, res: Response): Promise<void> => {
  try {
    const v = await verifyUser(req)
    if (!v.ok) {
      jsonError(res, v.status, v.error)
      return
    }
    if (!(await isAdmin({ userId: v.userId, token: v.token }))) {
      jsonError(res, 403, 'Forbidden')
      return
    }

    const code = typeof req.body?.code === 'string' ? req.body.code.trim().toLowerCase() : ''
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : ''
    const reqLimit = Number(req.body?.monthly_request_limit ?? NaN)
    const charLimit = Number(req.body?.monthly_char_limit ?? NaN)
    const perReqCharLimit = Number(req.body?.per_request_char_limit ?? NaN)
    const maxTargets = Number(req.body?.max_targets ?? NaN)
    const isActive = typeof req.body?.is_active === 'boolean' ? req.body.is_active : true

    if (!code || !/^[a-z0-9_-]{2,32}$/.test(code)) {
      jsonError(res, 400, 'Invalid code')
      return
    }
    if (!name) {
      jsonError(res, 400, 'name is required')
      return
    }
    if (!Number.isFinite(reqLimit) || reqLimit < 0 || reqLimit > 1000000) {
      jsonError(res, 400, 'monthly_request_limit is invalid')
      return
    }
    if (!Number.isFinite(charLimit) || charLimit < 0 || charLimit > 1000000000) {
      jsonError(res, 400, 'monthly_char_limit is invalid')
      return
    }
    if (!Number.isFinite(perReqCharLimit) || perReqCharLimit < 0 || perReqCharLimit > 200000) {
      jsonError(res, 400, 'per_request_char_limit is invalid')
      return
    }
    if (!Number.isFinite(maxTargets) || maxTargets < 0 || maxTargets > 50) {
      jsonError(res, 400, 'max_targets is invalid')
      return
    }

    const supabase = adminClient()
    const { error } = await supabase
      .from('subscription_plans')
      .upsert({
        code,
        name,
        monthly_request_limit: Math.trunc(reqLimit),
        monthly_char_limit: Math.trunc(charLimit),
        per_request_char_limit: Math.trunc(perReqCharLimit),
        max_targets: Math.trunc(maxTargets),
        is_active: isActive,
      })
    if (error) {
      jsonError(res, 500, error.message)
      return
    }

    await supabase.from('admin_audit_log').insert({
      actor_user_id: v.userId,
      action: 'subscriptions.plan.upsert',
      target_type: 'subscription_plans',
      target_id: code,
      details: {
        code,
        name,
        monthly_request_limit: Math.trunc(reqLimit),
        monthly_char_limit: Math.trunc(charLimit),
        per_request_char_limit: Math.trunc(perReqCharLimit),
        max_targets: Math.trunc(maxTargets),
        is_active: isActive,
      },
    })

    res.status(200).json({ success: true })
  } catch (err) {
    jsonError(res, 500, err instanceof Error ? err.message : 'Server error')
  }
})

router.get('/subscriptions/users/:userId', async (req: Request, res: Response): Promise<void> => {
  try {
    const v = await verifyUser(req)
    if (!v.ok) {
      jsonError(res, v.status, v.error)
      return
    }
    if (!(await isAdmin({ userId: v.userId, token: v.token }))) {
      jsonError(res, 403, 'Forbidden')
      return
    }

    const userId = (req.params.userId ?? '').trim()
    if (!userId) {
      jsonError(res, 400, 'userId is required')
      return
    }

    const month = monthKeyUtc()
    const supabase = adminClient()

    const { data: profile } = await supabase.from('profiles').select('id,email,display_name,is_blocked,created_at').eq('id', userId).maybeSingle()

    const { data: sub } = await supabase
      .from('user_subscriptions')
      .select(
        'plan_code,effective_from,override_monthly_request_limit,override_monthly_char_limit,override_per_request_char_limit,override_max_targets,created_at',
      )
      .eq('user_id', userId)
      .order('effective_from', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const { data: usage } = await supabase
      .from('usage_months')
      .select('month,requests_used,chars_used,updated_at')
      .eq('user_id', userId)
      .eq('month', month)
      .maybeSingle()

    res.status(200).json({ success: true, profile: profile ?? null, subscription: sub ?? null, usage: usage ?? null })
  } catch (err) {
    jsonError(res, 500, err instanceof Error ? err.message : 'Server error')
  }
})

router.post('/subscriptions/users/:userId', async (req: Request, res: Response): Promise<void> => {
  try {
    const v = await verifyUser(req)
    if (!v.ok) {
      jsonError(res, v.status, v.error)
      return
    }
    if (!(await isAdmin({ userId: v.userId, token: v.token }))) {
      jsonError(res, 403, 'Forbidden')
      return
    }

    const userId = (req.params.userId ?? '').trim()
    if (!userId) {
      jsonError(res, 400, 'userId is required')
      return
    }

    const planCode = typeof req.body?.plan_code === 'string' ? req.body.plan_code.trim().toLowerCase() : ''
    const effectiveFrom = typeof req.body?.effective_from === 'string' ? req.body.effective_from.trim() : ''
    const overrideReq = req.body?.override_monthly_request_limit
    const overrideChars = req.body?.override_monthly_char_limit
    const overridePerReqChars = req.body?.override_per_request_char_limit
    const overrideMaxTargets = req.body?.override_max_targets
    const resetCurrentMonth = !!req.body?.reset_current_month

    if (!planCode) {
      jsonError(res, 400, 'plan_code is required')
      return
    }

    const eff = effectiveFrom ? new Date(effectiveFrom) : new Date()
    if (Number.isNaN(eff.getTime())) {
      jsonError(res, 400, 'effective_from is invalid')
      return
    }
    const effDate = eff.toISOString().slice(0, 10)

    const cleanOverrideReq = overrideReq == null || overrideReq === '' ? null : Math.trunc(Number(overrideReq))
    const cleanOverrideChars = overrideChars == null || overrideChars === '' ? null : Math.trunc(Number(overrideChars))
    const cleanOverridePerReqChars = overridePerReqChars == null || overridePerReqChars === '' ? null : Math.trunc(Number(overridePerReqChars))
    const cleanOverrideMaxTargets = overrideMaxTargets == null || overrideMaxTargets === '' ? null : Math.trunc(Number(overrideMaxTargets))
    if (cleanOverrideReq != null && (!Number.isFinite(cleanOverrideReq) || cleanOverrideReq < 0 || cleanOverrideReq > 1000000)) {
      jsonError(res, 400, 'override_monthly_request_limit is invalid')
      return
    }
    if (cleanOverrideChars != null && (!Number.isFinite(cleanOverrideChars) || cleanOverrideChars < 0 || cleanOverrideChars > 1000000000)) {
      jsonError(res, 400, 'override_monthly_char_limit is invalid')
      return
    }
    if (cleanOverridePerReqChars != null && (!Number.isFinite(cleanOverridePerReqChars) || cleanOverridePerReqChars < 0 || cleanOverridePerReqChars > 200000)) {
      jsonError(res, 400, 'override_per_request_char_limit is invalid')
      return
    }
    if (cleanOverrideMaxTargets != null && (!Number.isFinite(cleanOverrideMaxTargets) || cleanOverrideMaxTargets < 0 || cleanOverrideMaxTargets > 50)) {
      jsonError(res, 400, 'override_max_targets is invalid')
      return
    }

    const supabase = adminClient()

    const { error: insertErr } = await supabase.from('user_subscriptions').insert({
      user_id: userId,
      plan_code: planCode,
      effective_from: effDate,
      override_monthly_request_limit: cleanOverrideReq,
      override_monthly_char_limit: cleanOverrideChars,
      override_per_request_char_limit: cleanOverridePerReqChars,
      override_max_targets: cleanOverrideMaxTargets,
    })
    if (insertErr) {
      jsonError(res, 500, insertErr.message)
      return
    }

    if (resetCurrentMonth) {
      const month = monthKeyUtc()
      await supabase.from('usage_months').delete().eq('user_id', userId).eq('month', month)
    }

    await supabase.from('admin_audit_log').insert({
      actor_user_id: v.userId,
      action: 'subscriptions.user.set',
      target_type: 'user_subscriptions',
      target_id: userId,
      details: {
        user_id: userId,
        plan_code: planCode,
        effective_from: effDate,
        override_monthly_request_limit: cleanOverrideReq,
        override_monthly_char_limit: cleanOverrideChars,
        override_per_request_char_limit: cleanOverridePerReqChars,
        override_max_targets: cleanOverrideMaxTargets,
        reset_current_month: resetCurrentMonth,
      },
    })

    res.status(200).json({ success: true })
  } catch (err) {
    jsonError(res, 500, err instanceof Error ? err.message : 'Server error')
  }
})

router.get('/subscriptions/usage', async (req: Request, res: Response): Promise<void> => {
  try {
    const v = await verifyUser(req)
    if (!v.ok) {
      jsonError(res, v.status, v.error)
      return
    }
    if (!(await isAdmin({ userId: v.userId, token: v.token }))) {
      jsonError(res, 403, 'Forbidden')
      return
    }

    const month = typeof req.query.month === 'string' && req.query.month.trim() ? req.query.month.trim() : monthKeyUtc()
    if (!/^\d{4}-\d{2}$/.test(month)) {
      jsonError(res, 400, 'month must be YYYY-MM')
      return
    }

    const supabase = adminClient()
    const { data: usageRows, error } = await supabase
      .from('usage_months')
      .select('user_id,month,requests_used,chars_used,updated_at')
      .eq('month', month)
      .order('requests_used', { ascending: false })
      .limit(300)
    if (error) {
      jsonError(res, 500, error.message)
      return
    }

    const ids = Array.from(new Set((usageRows ?? []).map((r: any) => r.user_id).filter(Boolean)))
    const { data: profiles } = ids.length
      ? await supabase.from('profiles').select('id,email,display_name').in('id', ids)
      : { data: [] as any[] }
    const profileMap = new Map((profiles ?? []).map((p: any) => [p.id, p]))

    const { data: subs } = ids.length
      ? await supabase
          .from('user_subscriptions')
          .select(
            'user_id,plan_code,effective_from,override_monthly_request_limit,override_monthly_char_limit,override_per_request_char_limit,override_max_targets,created_at',
          )
          .in('user_id', ids)
          .order('effective_from', { ascending: false })
          .order('created_at', { ascending: false })
      : { data: [] as any[] }

    const subMap = new Map<string, any>()
    for (const row of subs ?? []) {
      const uid = row.user_id as string
      if (!subMap.has(uid)) subMap.set(uid, row)
    }

    const rows = (usageRows ?? []).map((u: any) => {
      const p = profileMap.get(u.user_id)
      const s = subMap.get(u.user_id)
      return {
        user_id: u.user_id,
        email: p?.email ?? null,
        display_name: p?.display_name ?? '',
        month: u.month,
        requests_used: u.requests_used,
        chars_used: u.chars_used,
        updated_at: u.updated_at,
        plan_code: s?.plan_code ?? 'free',
        effective_from: s?.effective_from ?? null,
        override_monthly_request_limit: s?.override_monthly_request_limit ?? null,
        override_monthly_char_limit: s?.override_monthly_char_limit ?? null,
        override_per_request_char_limit: s?.override_per_request_char_limit ?? null,
        override_max_targets: s?.override_max_targets ?? null,
      }
    })

    res.status(200).json({ success: true, month, rows })
  } catch (err) {
    jsonError(res, 500, err instanceof Error ? err.message : 'Server error')
  }
})

router.get('/subscriptions/audit', async (req: Request, res: Response): Promise<void> => {
  try {
    const v = await verifyUser(req)
    if (!v.ok) {
      jsonError(res, v.status, v.error)
      return
    }
    if (!(await isAdmin({ userId: v.userId, token: v.token }))) {
      jsonError(res, 403, 'Forbidden')
      return
    }

    const supabase = adminClient()
    const { data, error } = await supabase
      .from('admin_audit_log')
      .select('id,actor_user_id,action,target_type,target_id,details,created_at')
      .order('created_at', { ascending: false })
      .limit(200)
    if (error) {
      jsonError(res, 500, error.message)
      return
    }
    res.status(200).json({ success: true, logs: data ?? [] })
  } catch (err) {
    jsonError(res, 500, err instanceof Error ? err.message : 'Server error')
  }
})

// ---------------------------------------------------------------------------
// AI console: overview, provider/model tests, routes and usage (used by the admin AI + Usage pages)
// ---------------------------------------------------------------------------

router.get('/ai/overview', async (req: Request, res: Response) => {
  try {
    const a = await requireAdmin(req, res)
    if (!a.ok) return
    res.status(200).json({ success: true, ...(await getAiOverview(adminClient() as any)) })
  } catch (err) {
    jsonError(res, 500, err instanceof Error ? err.message : 'Server error')
  }
})

router.get('/ai/providers/:id/models', async (req: Request, res: Response) => {
  try {
    const a = await requireAdmin(req, res)
    if (!a.ok) return
    res.status(200).json({ success: true, ...(await listProviderModels({ supabase: adminClient() as any, providerId: String(req.params.id) })) })
  } catch (err) {
    jsonError(res, 500, err instanceof Error ? err.message : 'Server error')
  }
})

router.post('/ai/providers/:id/test', async (req: Request, res: Response) => {
  try {
    const a = await requireAdmin(req, res)
    if (!a.ok) return
    const model = typeof req.body?.model === 'string' ? req.body.model.trim().slice(0, 120) : ''
    if (!model) return jsonError(res, 400, 'Choose a model to test')
    const keyId = typeof req.body?.key_id === 'string' ? req.body.key_id : null
    const result = await probeProviderModel({ supabase: adminClient() as any, providerId: String(req.params.id), modelName: model, keyId })
    await audit({ actorId: a.userId, token: a.token, action: 'test', entityType: 'ai_provider', entityId: String(req.params.id), meta: { model, ok: result.ok, status: result.status } })
    res.status(200).json({ success: true, result })
  } catch (err) {
    jsonError(res, 500, err instanceof Error ? err.message : 'Server error')
  }
})

router.put('/ai/models/:id/route', async (req: Request, res: Response) => {
  try {
    const a = await requireAdmin(req, res)
    if (!a.ok) return
    const policy = await saveModelRoute(adminClient() as any, String(req.params.id), req.body?.steps)
    await audit({ actorId: a.userId, token: a.token, action: 'update', entityType: 'ai_model_route', entityId: String(req.params.id), meta: { policy } })
    res.status(200).json({ success: true })
  } catch (err) {
    jsonError(res, 400, err instanceof Error ? err.message : 'Could not save route')
  }
})

router.post('/ai/models/:id/test', async (req: Request, res: Response) => {
  try {
    const a = await requireAdmin(req, res)
    if (!a.ok) return
    res.status(200).json({ success: true, result: await testModelRoute(adminClient() as any, String(req.params.id)) })
  } catch (err) {
    jsonError(res, 500, err instanceof Error ? err.message : 'Server error')
  }
})

router.get('/ai/usage-overview', async (req: Request, res: Response) => {
  try {
    const a = await requireAdmin(req, res)
    if (!a.ok) return
    const month = typeof req.query.month === 'string' && /^\d{4}-\d{2}$/.test(req.query.month) ? req.query.month : aiMonthKey()
    res.status(200).json({ success: true, ...(await getUsageOverview(adminClient() as any, month)) })
  } catch (err) {
    jsonError(res, 500, err instanceof Error ? err.message : 'Server error')
  }
})

router.post('/ai/usage/reset', async (req: Request, res: Response) => {
  try {
    const a = await requireAdmin(req, res)
    if (!a.ok) return
    const userId = typeof req.body?.user_id === 'string' ? req.body.user_id : ''
    const month = typeof req.body?.month === 'string' && /^\d{4}-\d{2}$/.test(req.body.month) ? req.body.month : ''
    const modelPk = typeof req.body?.model_pk === 'string' ? req.body.model_pk : null
    if (!userId || !month) return jsonError(res, 400, 'user_id and month are required')
    await resetUserUsage(adminClient() as any, userId, month, modelPk)
    await audit({ actorId: a.userId, token: a.token, action: 'reset_usage', entityType: 'ai_usage_month', entityId: userId, meta: { month, model_pk: modelPk } })
    res.status(200).json({ success: true })
  } catch (err) {
    jsonError(res, 500, err instanceof Error ? err.message : 'Server error')
  }
})

export default router
