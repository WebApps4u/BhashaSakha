import { Router, type Request, type Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import { resolveRequestedModelId, runModelRequest } from '../lib/aiModelLayer.js'

type TranslateRequestBody = {
  text?: unknown
  targets?: unknown
}

type TranslateResponseBody = {
  detected_language: string
  translations: Record<string, string>
}

const router = Router()

const getSupabaseUrl = () => process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? ''
const getSupabaseAnonKey = () => process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? ''
const getSupabaseServiceRoleKey = () => process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

const MAX_TARGETS_ABSOLUTE = 20
const MAX_TEXT_ABSOLUTE = 20000

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((v) => typeof v === 'string')

const parseBody = (body: TranslateRequestBody) => {
  const text = typeof body.text === 'string' ? body.text.trim() : ''
  const targets = isStringArray(body.targets)
    ? body.targets.map((t) => t.trim()).filter(Boolean)
    : []

  return { text, targets: Array.from(new Set(targets)) }
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

const parseBearer = (req: Request) => {
  const auth = req.header('authorization') ?? ''
  return auth.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : ''
}

const monthKeyUtc = (d = new Date()) => {
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth() + 1
  return `${y}-${String(m).padStart(2, '0')}`
}

const verifyUser = async (req: Request) => {
  const SUPABASE_URL = getSupabaseUrl()
  const SUPABASE_ANON_KEY = getSupabaseAnonKey()
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return { ok: false as const, status: 500, error: 'Supabase is not configured on the server' }
  const token = parseBearer(req)
  if (!token) return { ok: false as const, status: 401, error: 'Unauthorized' }

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user) return { ok: false as const, status: 401, error: 'Unauthorized' }
  return { ok: true as const, userId: data.user.id, token }
}

const serviceClient = () => {
  const SUPABASE_URL = getSupabaseUrl()
  const key = getSupabaseServiceRoleKey()
  if (!SUPABASE_URL || !key) return null
  return createClient(SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

const nowMs = () => Date.now()

type Bucket = { tokens: number; updatedAt: number }
const bucketsByUser = new Map<string, Bucket>()

type Entitlement = {
  planCode: string
  plan: {
    code: string
    name: string
    monthly_request_limit: number
    monthly_char_limit: number
    per_request_char_limit: number
    max_targets: number
  }
  requestLimit: number
  charLimit: number
  perReqCharLimit: number
  maxTargets: number
}

const entitlements = new Map<string, { at: number; value: Entitlement }>()
const ENT_TTL_MS = 30_000

const getEntitlement = async (supabaseAdmin: ReturnType<typeof serviceClient>, userId: string): Promise<Entitlement> => {
  if (entitlements.size > 5000) entitlements.clear()
  const cached = entitlements.get(userId)
  const t = nowMs()
  if (cached && t - cached.at < ENT_TTL_MS) return cached.value

  if (!supabaseAdmin) {
    const fallback: Entitlement = {
      planCode: 'free',
      plan: { code: 'free', name: 'Free', monthly_request_limit: 0, monthly_char_limit: 0, per_request_char_limit: 0, max_targets: 0 },
      requestLimit: 0,
      charLimit: 0,
      perReqCharLimit: 0,
      maxTargets: 0,
    }
    entitlements.set(userId, { at: t, value: fallback })
    return fallback
  }

  const today = new Date().toISOString().slice(0, 10)
  const { data: sub } = await supabaseAdmin
    .from('user_subscriptions')
    .select('plan_code,effective_from,override_monthly_request_limit,override_monthly_char_limit,override_per_request_char_limit,override_max_targets,created_at')
    .eq('user_id', userId)
    .lte('effective_from', today)
    .order('effective_from', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const planCode = (sub as any)?.plan_code ?? 'free'
  const { data: planRow } = await supabaseAdmin
    .from('subscription_plans')
    .select('code,name,monthly_request_limit,monthly_char_limit,per_request_char_limit,max_targets,is_active')
    .eq('code', planCode)
    .maybeSingle()

  const requestLimit = Number((sub as any)?.override_monthly_request_limit ?? (planRow as any)?.monthly_request_limit ?? 0)
  const charLimit = Number((sub as any)?.override_monthly_char_limit ?? (planRow as any)?.monthly_char_limit ?? 0)
  const perReqCharLimit = Number((sub as any)?.override_per_request_char_limit ?? (planRow as any)?.per_request_char_limit ?? 0)
  const maxTargets = Number((sub as any)?.override_max_targets ?? (planRow as any)?.max_targets ?? 0)

  const ent: Entitlement = {
    planCode: (planRow as any)?.code ?? planCode,
    plan: {
      code: (planRow as any)?.code ?? planCode,
      name: (planRow as any)?.name ?? planCode,
      monthly_request_limit: requestLimit,
      monthly_char_limit: charLimit,
      per_request_char_limit: perReqCharLimit,
      max_targets: maxTargets,
    },
    requestLimit,
    charLimit,
    perReqCharLimit,
    maxTargets,
  }

  entitlements.set(userId, { at: t, value: ent })
  return ent
}

const takeTokens = ({ key, refillPerMin, burst, cost }: { key: string; refillPerMin: number; burst: number; cost: number }) => {
  if (bucketsByUser.size > 5000) bucketsByUser.clear()
  const t = nowMs()
  const prev = bucketsByUser.get(key) ?? { tokens: burst, updatedAt: t }
  const elapsedMin = Math.max(0, (t - prev.updatedAt) / 60000)
  const nextTokens = Math.min(burst, prev.tokens + elapsedMin * refillPerMin)
  const ok = nextTokens >= cost
  const next: Bucket = { tokens: ok ? nextTokens - cost : nextTokens, updatedAt: t }
  bucketsByUser.set(key, next)
  return { ok, remaining: Math.floor(next.tokens) }
}

router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const v = await verifyUser(req)
    if (!v.ok) {
      res.status(v.status).json({ success: false, error: v.error })
      return
    }

    const { text, targets } = parseBody(req.body as TranslateRequestBody)
    if (!text) {
      res.status(400).json({ success: false, error: 'text is required' })
      return
    }
    if (text.length > MAX_TEXT_ABSOLUTE) {
      res.status(413).json({ success: false, error: `text is too long (max ${MAX_TEXT_ABSOLUTE} chars)` })
      return
    }
    if (targets.length === 0) {
      res.status(400).json({ success: false, error: 'targets[] is required' })
      return
    }
    if (targets.length > MAX_TARGETS_ABSOLUTE) {
      res.status(400).json({ success: false, error: `Too many targets (max ${MAX_TARGETS_ABSOLUTE})` })
      return
    }

    const month = monthKeyUtc()
    const sourceChars = text.length
    const supabaseAdmin = serviceClient()

    if (v.userId) {
      const rl = takeTokens({ key: v.userId, refillPerMin: 30, burst: 60, cost: 1 })
      if (!rl.ok) {
        res.status(429).json({ success: false, error: 'Too many requests. Please wait a moment.' })
        return
      }
    }

    if (supabaseAdmin && v.userId) {
      const ent = await getEntitlement(supabaseAdmin, v.userId)
      const requestLimit = ent.requestLimit
      const charLimit = ent.charLimit
      const perReqCharLimit = ent.perReqCharLimit
      const maxTargets = ent.maxTargets

      if (perReqCharLimit > 0 && sourceChars > perReqCharLimit) {
        res.status(413).json({ success: false, error: 'Request too large for your plan', code: 'request_too_large', limit: perReqCharLimit })
        return
      }
      if (maxTargets > 0 && targets.length > maxTargets) {
        res.status(400).json({ success: false, error: 'Too many target languages for your plan', code: 'too_many_targets', limit: maxTargets })
        return
      }

      const { data: usageRow } = await supabaseAdmin
        .from('usage_months')
        .select('requests_used,chars_used')
        .eq('user_id', v.userId)
        .eq('month', month)
        .maybeSingle()

      const requestsUsed = Number((usageRow as any)?.requests_used ?? 0)
      const charsUsed = Number((usageRow as any)?.chars_used ?? 0)

      const requestBlocked = requestLimit > 0 && requestsUsed + 1 > requestLimit
      const charBlocked = charLimit > 0 && charsUsed + sourceChars > charLimit
      if (requestBlocked || charBlocked) {
        await supabaseAdmin.from('translation_requests').insert({
          user_id: v.userId,
          month,
          source_lang: null,
          target_langs: targets,
          source_chars: sourceChars,
          output_chars: 0,
          status: 'rejected_limit',
          error_message: requestBlocked ? 'Monthly request limit exceeded' : 'Monthly character limit exceeded',
        })
        res.status(429).json({
          success: false,
          error: 'Monthly limit reached',
          code: 'quota_exceeded',
          month,
          plan: {
            ...ent.plan,
          },
          usage: { requests_used: requestsUsed, chars_used: charsUsed },
          remaining: {
            requests_remaining: requestLimit > 0 ? Math.max(0, requestLimit - requestsUsed) : null,
            chars_remaining: charLimit > 0 ? Math.max(0, charLimit - charsUsed) : null,
          },
        })
        return
      }
    }

    const prompt =
      'You are a translation engine. ' +
      'Task: detect the input language and translate the text into each requested target language code. ' +
      'Return ONLY valid JSON (no markdown) with keys: ' +
      'detected_language (BCP-47 like "en", "es", "hi") and translations (object mapping target language code -> translated text).'

    const promptText =
      prompt + '\n\nINPUT: ' + JSON.stringify({ text, targets }) + '\n\nOUTPUT JSON:'

    if (!supabaseAdmin || !v.userId) {
      res.status(500).json({ success: false, error: 'Supabase service client is not configured on the server' })
      return
    }

    const requestedModelId = typeof (req.body as any)?.model_id === 'string' ? String((req.body as any).model_id).trim() : null
    const resolved = await resolveRequestedModelId({ supabase: supabaseAdmin as any, userId: v.userId, requestedModelId })

    const inputUnits = promptText.length
    let modelResult: Awaited<ReturnType<typeof runModelRequest>>
    try {
      modelResult = await runModelRequest({
        supabase: supabaseAdmin as any,
        userId: v.userId,
        requestedModelId: resolved.effective,
        promptText,
        unitCounts: { inputUnits, outputUnits: 0 },
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Model request failed'
      if (message === 'quota_exceeded') {
        res.status(429).json({ success: false, error: 'Model quota exceeded', code: 'quota_exceeded' })
        return
      }
      const status = err && typeof (err as any).httpStatus === 'number' ? (err as any).httpStatus : 502
      res.status(status).json({
        success: false,
        error: message,
        details: (err as any)?.details ? String((err as any).details).slice(0, 1000) : undefined,
      })
      return
    }

    const jsonFromModel = modelResult.output_json ?? extractJsonObject(modelResult.output_text)
    const parsed = (jsonFromModel ?? null) as TranslateResponseBody | null

    if (!parsed) {
      res.status(502).json({ success: false, error: 'Invalid JSON from model provider' })
      return
    }

    const detected_language =
      typeof parsed.detected_language === 'string' ? parsed.detected_language : 'und'
    const translations =
      parsed.translations && typeof parsed.translations === 'object' ? parsed.translations : {}

    const outputChars = Object.values(translations)
      .filter((v) => typeof v === 'string')
      .reduce((sum, v) => sum + (v as string).length, 0)

    let meterInfo: any = null
    if (supabaseAdmin && v.userId) {
      const { data: meterData, error: meterErr } = await supabaseAdmin
        .rpc('meter_translation', {
          uid: v.userId,
          source_chars: sourceChars,
          output_chars: outputChars,
          request_inc: 1,
        })
        .single()

      if (meterErr) {
        if ((meterErr.message ?? '').includes('quota_exceeded')) {
          await supabaseAdmin.from('translation_requests').insert({
            user_id: v.userId,
            month,
            source_lang: detected_language,
            target_langs: targets,
            source_chars: sourceChars,
            output_chars: outputChars,
            status: 'rejected_limit',
            error_message: 'quota_exceeded',
          })
          res.status(429).json({ success: false, error: 'Monthly limit reached', code: 'quota_exceeded', month })
          return
        }
      } else {
        meterInfo = meterData
        await supabaseAdmin.from('translation_requests').insert({
          user_id: v.userId,
          month,
          source_lang: detected_language,
          target_langs: targets,
          source_chars: sourceChars,
          output_chars: outputChars,
          status: 'success',
          error_message: null,
        })
      }
    }

    res.status(200).json({
      success: true,
      detected_language,
      translations,
      meter: meterInfo,
      model: {
        requested: modelResult.requested_model_id,
        used: modelResult.used_model_id,
        provider: modelResult.provider_key,
        used_fallback: modelResult.used_fallback,
        downgraded: modelResult.downgraded,
      },
    })
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Server error',
    })
  }
})

export default router
