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

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY
const GEMINI_MODEL = process.env.GEMINI_MODEL_TRANSLATE ?? 'gemini-2.0-flash'
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY

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

const verifySupabaseAccessToken = async (req: Request): Promise<boolean> => {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return true
  const auth = req.header('authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : ''
  if (!token) return false

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data, error } = await supabase.auth.getUser(token)
  if (error) return false
  return !!data.user
}

router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    if (!GOOGLE_API_KEY) {
      res.status(500).json({
        success: false,
        error: 'Missing GOOGLE_API_KEY on the server.',
      })
      return
    }

    const ok = await verifySupabaseAccessToken(req)
    if (!ok) {
      res.status(401).json({
        success: false,
        error: 'Unauthorized',
      })
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

    res.status(200).json({
      success: true,
      detected_language,
      translations,
    })
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Server error',
    })
  }
})

export default router
