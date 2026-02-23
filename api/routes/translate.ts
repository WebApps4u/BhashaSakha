import { Router, type Request, type Response } from 'express'
import { createClient } from '@supabase/supabase-js'

type TranslateRequestBody = {
  text?: unknown
  targets?: unknown
}

type TranslateResponseBody = {
  detected_language: string
  translations: Record<string, string>
}

const router = Router()

const getGoogleApiKey = () => process.env.GOOGLE_API_KEY ?? ''
const getGeminiModel = () => process.env.GEMINI_MODEL_TRANSLATE ?? 'gemini-2.0-flash'
const getSupabaseUrl = () => process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? ''
const getSupabaseAnonKey = () => process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? ''
const getSupabaseServiceRoleKey = () => process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((v) => typeof v === 'string')

const parseBody = (body: TranslateRequestBody) => {
  const text = typeof body.text === 'string' ? body.text.trim() : ''
  const targets = isStringArray(body.targets)
    ? body.targets.map((t) => t.trim()).filter(Boolean)
    : []

  return { text, targets }
}

const modelFallbacks = (model: string) => {
  const trimmed = model.trim()
  const fallbacks = new Set<string>()
  if (trimmed) fallbacks.add(trimmed)

  const add = (m: string) => {
    if (m) fallbacks.add(m)
  }

  add('gemini-3-flash-preview')
  add('gemini-2.5-flash')
  add('gemini-2.5-pro')
  add('gemini-2.0-flash')
  add('gemini-2.0-pro')
  add('gemini-1.5-flash')
  add('gemini-1.5-pro')

  if (!trimmed.includes('-latest') && !/\d{3}$/.test(trimmed)) {
    add(`${trimmed}-latest`)
  }
  if (trimmed === 'gemini-1.5-pro') add('gemini-1.5-pro-latest')
  if (trimmed === 'gemini-1.5-flash') add('gemini-1.5-flash-latest')
  if (trimmed === 'gemini-2.0-flash') add('gemini-2.0-flash-001')
  if (trimmed === 'gemini-2.0-pro') add('gemini-2.0-pro-001')
  if (trimmed === 'gemini-1.5-flash') add('gemini-1.5-flash-001')
  if (trimmed === 'gemini-1.5-pro') add('gemini-1.5-pro-001')

  return Array.from(fallbacks)
}

const geminiGenerate = async ({
  apiKey,
  model,
  promptText,
}: {
  apiKey: string
  model: string
  promptText: string
}) => {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [{ text: promptText }],
        },
      ],
      generationConfig: {
        temperature: 0,
        responseMimeType: 'application/json',
      },
    }),
  })

  const bodyText = await response.text().catch(() => '')
  return { response, bodyText }
}

const listGeminiModels = async (apiKey: string) => {
  const url = 'https://generativelanguage.googleapis.com/v1beta/models'
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'x-goog-api-key': apiKey,
    },
  })
  const bodyText = await response.text().catch(() => '')
  if (!response.ok) return { ok: false as const, bodyText }

  try {
    const data = JSON.parse(bodyText) as {
      models?: Array<{
        name?: string
        baseModelId?: string
        supportedGenerationMethods?: string[]
      }>
    }
    const models = (data.models ?? [])
      .filter((m) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
      .map((m) => m.baseModelId || (m.name?.startsWith('models/') ? m.name.slice('models/'.length) : m.name) || '')
      .filter(Boolean)
    return { ok: true as const, models }
  } catch {
    return { ok: false as const, bodyText }
  }
}

const pickBestModel = (models: string[]) => {
  const preferred = [
    'gemini-3-flash-preview',
    'gemini-2.5-flash',
    'gemini-2.5-pro',
    'gemini-2.0-flash',
    'gemini-2.0-pro',
    'gemini-1.5-flash',
    'gemini-1.5-pro',
  ]
  for (const p of preferred) {
    const found = models.find((m) => m === p || m.startsWith(`${p}-`))
    if (found) return found
  }
  return models[0] ?? ''
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
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return { ok: true as const, userId: null as string | null, token: '' }
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

router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const GOOGLE_API_KEY = getGoogleApiKey()
    const GEMINI_MODEL = getGeminiModel()

    if (!GOOGLE_API_KEY) {
      res.status(500).json({
        success: false,
        error: 'Missing GOOGLE_API_KEY on the server.',
      })
      return
    }

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
    if (targets.length === 0) {
      res.status(400).json({ success: false, error: 'targets[] is required' })
      return
    }

    const month = monthKeyUtc()
    const sourceChars = text.length
    const supabaseAdmin = serviceClient()

    if (supabaseAdmin && v.userId) {
      const { data: sub } = await supabaseAdmin
        .from('user_subscriptions')
        .select('plan_code,effective_from,override_monthly_request_limit,override_monthly_char_limit,created_at')
        .eq('user_id', v.userId)
        .order('effective_from', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      const planCode = (sub as any)?.plan_code ?? 'free'
      const { data: planRow } = await supabaseAdmin
        .from('subscription_plans')
        .select('code,name,monthly_request_limit,monthly_char_limit,is_active')
        .eq('code', planCode)
        .maybeSingle()

      const requestLimit = Number((sub as any)?.override_monthly_request_limit ?? (planRow as any)?.monthly_request_limit ?? 0)
      const charLimit = Number((sub as any)?.override_monthly_char_limit ?? (planRow as any)?.monthly_char_limit ?? 0)

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
            code: (planRow as any)?.code ?? planCode,
            name: (planRow as any)?.name ?? planCode,
            monthly_request_limit: requestLimit,
            monthly_char_limit: charLimit,
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

    let lastStatus = 0
    let lastDetails = ''
    let successBodyText = ''
    const triedModels: string[] = []

    for (const model of modelFallbacks(GEMINI_MODEL)) {
      triedModels.push(model)
      const { response, bodyText } = await geminiGenerate({
        apiKey: GOOGLE_API_KEY,
        model,
        promptText,
      })

      if (response.ok) {
        successBodyText = bodyText
        break
      }

      lastStatus = response.status
      lastDetails = bodyText

      if (response.status !== 404) {
        break
      }
    }

    if (!successBodyText && lastStatus === 404) {
      const listed = await listGeminiModels(GOOGLE_API_KEY)
      if (listed.ok && listed.models.length) {
        const best = pickBestModel(listed.models)
        if (best && !triedModels.includes(best)) {
          triedModels.push(best)
          const { response, bodyText } = await geminiGenerate({
            apiKey: GOOGLE_API_KEY,
            model: best,
            promptText,
          })
          if (response.ok) {
            successBodyText = bodyText
          } else {
            lastStatus = response.status
            lastDetails = bodyText
          }
        }
      }
    }

    if (!successBodyText) {
      res.status(502).json({
        success: false,
        error: `Gemini error (${lastStatus || 500})`,
        details: lastDetails.slice(0, 1000),
        tried_models: triedModels,
      })
      return
    }

    let parsed: TranslateResponseBody | null = null
    try {
      const maybeJson = JSON.parse(successBodyText) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
      }
      const content = maybeJson.candidates?.[0]?.content?.parts?.[0]?.text ?? ''

      try {
        parsed = JSON.parse(content) as TranslateResponseBody
      } catch {
        const match = content.match(/\{[\s\S]*\}/)
        parsed = match ? (JSON.parse(match[0]) as TranslateResponseBody) : null
      }
    } catch {
      parsed = null
    }

    if (!parsed) {
      res.status(502).json({ success: false, error: 'Invalid JSON from Gemini' })
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
    })
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Server error',
    })
  }
})

export default router
