import { Router, type Request, type Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import { getAllowedModelsForUser, resolveRequestedModelId, setUserSelectedModelId, getUserSelectedModelId } from '../lib/aiModelLayer.js'

const router = Router()

const getSupabaseUrl = () => process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? ''
const getSupabaseAnonKey = () => process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? ''
const getSupabaseServiceRoleKey = () => process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

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

const userClient = (token: string) => {
  requireAnonEnv()
  const SUPABASE_URL = getSupabaseUrl()
  const SUPABASE_ANON_KEY = getSupabaseAnonKey()
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
}

const adminClient = () => {
  requireServiceEnv()
  const SUPABASE_URL = getSupabaseUrl()
  const SUPABASE_SERVICE_ROLE_KEY = getSupabaseServiceRoleKey()
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

const verifyUser = async (req: Request) => {
  requireAnonEnv()
  const token = parseBearer(req)
  if (!token) return { ok: false as const, status: 401, error: 'Unauthorized' }

  const SUPABASE_URL = getSupabaseUrl()
  const SUPABASE_ANON_KEY = getSupabaseAnonKey()
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user) return { ok: false as const, status: 401, error: 'Unauthorized' }
  return { ok: true as const, userId: data.user.id, token }
}

router.get('/allowed', async (req: Request, res: Response) => {
  try {
    const v = await verifyUser(req)
    if (!v.ok) {
      res.status(v.status).json({ success: false, error: v.error })
      return
    }

    const supabase = adminClient()
    const allowed = await getAllowedModelsForUser(supabase as any, v.userId)
    const selected = await getUserSelectedModelId(supabase as any, v.userId)
    const { data: planData } = await (supabase as any).rpc('get_user_plan', { uid: v.userId })
    const planRow = Array.isArray(planData) ? (planData[0] as any) : (planData as any)
    const planCode = typeof planRow?.plan_code === 'string' ? planRow.plan_code : 'free'
    res.status(200).json({ success: true, models: allowed, selected_model_id: selected, plan_code: planCode })
  } catch (err) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Server error' })
  }
})

router.get('/selection', async (req: Request, res: Response) => {
  try {
    const v = await verifyUser(req)
    if (!v.ok) {
      res.status(v.status).json({ success: false, error: v.error })
      return
    }

    const supabase = adminClient()
    const selected = await getUserSelectedModelId(supabase as any, v.userId)
    res.status(200).json({ success: true, selected_model_id: selected })
  } catch (err) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Server error' })
  }
})

router.put('/selection', async (req: Request, res: Response) => {
  try {
    const v = await verifyUser(req)
    if (!v.ok) {
      res.status(v.status).json({ success: false, error: v.error })
      return
    }
    const modelId = typeof (req.body as any)?.model_id === 'string' ? (req.body as any).model_id.trim() : ''
    if (!modelId) {
      res.status(400).json({ success: false, error: 'model_id is required' })
      return
    }

    const supabaseAdmin = adminClient()
    const { effective } = await resolveRequestedModelId({ supabase: supabaseAdmin as any, userId: v.userId, requestedModelId: modelId })
    const supabaseUser = userClient(v.token)
    await setUserSelectedModelId(supabaseUser as any, v.userId, effective)
    res.status(200).json({ success: true, selected_model_id: effective })
  } catch (err) {
    res.status(400).json({ success: false, error: err instanceof Error ? err.message : 'Failed to save selection' })
  }
})

router.get('/usage', async (req: Request, res: Response) => {
  try {
    const v = await verifyUser(req)
    if (!v.ok) {
      res.status(v.status).json({ success: false, error: v.error })
      return
    }
    const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 25) || 25))
    const supabase = adminClient()
    const { data, error } = await supabase
      .from('ai_usage_events')
      .select('created_at,status,error_code,used_fallback,downgraded,input_units,output_units,model_pk_used,model_pk_requested,provider_id_used')
      .eq('user_id', v.userId)
      .order('created_at', { ascending: false })
      .limit(limit)
    if (error) throw new Error(error.message)

    const events = (data ?? []) as any[]
    const modelIds = Array.from(new Set(events.flatMap((e) => [e.model_pk_used, e.model_pk_requested]).filter(Boolean)))
    const providerIds = Array.from(new Set(events.map((e) => e.provider_id_used).filter(Boolean)))

    const [modelsRes, providersRes] = await Promise.all([
      modelIds.length ? supabase.from('ai_models').select('id,model_id,display_name').in('id', modelIds) : Promise.resolve({ data: [] as any[], error: null as any }),
      providerIds.length ? supabase.from('ai_providers').select('id,key,name').in('id', providerIds) : Promise.resolve({ data: [] as any[], error: null as any }),
    ])

    if (modelsRes.error) throw new Error(modelsRes.error.message)
    if (providersRes.error) throw new Error(providersRes.error.message)

    const modelMap = new Map<string, any>((modelsRes.data ?? []).map((m: any) => [m.id, m]))
    const providerMap = new Map<string, any>((providersRes.data ?? []).map((p: any) => [p.id, p]))

    const enriched = events.map((e) => ({
      ...e,
      model_used: e.model_pk_used ? modelMap.get(e.model_pk_used) ?? null : null,
      model_requested: e.model_pk_requested ? modelMap.get(e.model_pk_requested) ?? null : null,
      provider: e.provider_id_used ? providerMap.get(e.provider_id_used) ?? null : null,
    }))

    res.status(200).json({ success: true, events: enriched })
  } catch (err) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Server error' })
  }
})

export default router
