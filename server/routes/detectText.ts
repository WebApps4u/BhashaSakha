import { Router, type Request, type Response } from 'express'
import { createClient } from '@supabase/supabase-js'

const router = Router()

const getSupabaseUrl = () => process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? ''
const getSupabaseAnonKey = () => process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? ''
const getGeminiApiKey = () => (process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? '').trim()

type GeminiModelListCache = {
  expiresAtMs: number
  models: Array<{ name: string; supportedGenerationMethods: string[] }>
}

let geminiModelCache: GeminiModelListCache | null = null

const parseBearer = (req: Request) => {
  const auth = req.header('authorization') ?? ''
  return auth.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : ''
}

const verifyUser = async (req: Request) => {
  const SUPABASE_URL = getSupabaseUrl()
  const SUPABASE_ANON_KEY = getSupabaseAnonKey()
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return { ok: false as const, status: 500, error: 'Supabase not configured' }

  const token = parseBearer(req)
  if (!token) return { ok: false as const, status: 401, error: 'Unauthorized' }

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user) return { ok: false as const, status: 401, error: 'Unauthorized' }
  return { ok: true as const, userId: data.user.id }
}

const listGeminiModels = async (apiKey: string) => {
  const now = Date.now()
  if (geminiModelCache && geminiModelCache.expiresAtMs > now) return geminiModelCache.models

  const url = 'https://generativelanguage.googleapis.com/v1beta/models'
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
  })

  const raw = await response.text()
  if (!response.ok) {
    throw new Error(`Gemini ListModels error: ${response.status} ${raw.slice(0, 200)}`)
  }

  const data = JSON.parse(raw)
  const models = Array.isArray(data.models) ? data.models : []
  const normalized = models
    .map((m: any) => ({
      name: String(m?.name ?? ''),
      supportedGenerationMethods: Array.isArray(m?.supportedGenerationMethods)
        ? m.supportedGenerationMethods.map((x: any) => String(x))
        : [],
    }))
    .filter((m: any) => m.name)

  geminiModelCache = { expiresAtMs: now + 10 * 60 * 1000, models: normalized }
  return normalized
}

const pickGeminiGenerateContentModel = async (apiKey: string) => {
  const models = await listGeminiModels(apiKey)
  const candidates = models
    .filter((m) => m.supportedGenerationMethods.includes('generateContent'))
    .map((m) => m.name)

  const preferred = [
    /gemini-2\.5.*flash/i,
    /gemini-2\.0.*flash/i,
    /gemini-1\.5.*flash/i,
    /gemini-1\.5.*pro/i,
    /gemini/i,
  ]

  for (const re of preferred) {
    const found = candidates.find((n) => re.test(n))
    if (found) return found
  }
  return candidates[0] ?? null
}

const detectTextLanguageWithGemini = async (apiKey: string, text: string) => {

  const prompt = `Detect the primary spoken language of the following transcript text.

The text may be romanized (e.g. Hindi written in Latin letters, sometimes called Hinglish). Focus on the underlying spoken language.

Return ONLY a BCP-47 code. Examples: en-US, en-IN, hi-IN, mr-IN, ta-IN, bn-IN, gu-IN.

Rules:
1) If it's Hindi (even romanized + a few English words), return hi-IN.
2) If it's an Indian language, prefer the -IN variant.
3) If unsure, return und.

Text:
"""${text}"""`

  const modelName = await pickGeminiGenerateContentModel(apiKey)
  if (!modelName) throw new Error('Gemini: no available models for generateContent')

  const callOnce = async (name: string) => {
    const url = `https://generativelanguage.googleapis.com/v1beta/${name}:generateContent`
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
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 16,
        },
      }),
    })

    const raw = await response.text()
    if (!response.ok) {
      throw new Error(`Gemini API error (${name}): ${response.status} ${raw.slice(0, 200)}`)
    }

    const data = JSON.parse(raw)
    const out = (data.candidates?.[0]?.content?.parts?.[0]?.text ?? '').trim()
    return out.replace(/[^a-zA-Z0-9-]/g, '') || 'und'
  }

  try {
    return await callOnce(modelName)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes(' 404 ')) {
      geminiModelCache = null
      const retryModel = await pickGeminiGenerateContentModel(apiKey)
      if (retryModel && retryModel !== modelName) {
        return await callOnce(retryModel)
      }
    }
    throw err
  }
}

router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const v = await verifyUser(req)
    if (!v.ok) {
      res.status(v.status).json({ success: false, error: v.error })
      return
    }

    const apiKey = getGeminiApiKey()
    if (!apiKey) {
      res.status(500).json({ success: false, error: 'API key missing on server' })
      return
    }

    const text = String((req.body as any)?.text ?? '').trim()
    if (!text) {
      res.status(400).json({ success: false, error: 'Missing text' })
      return
    }

    const language = await detectTextLanguageWithGemini(apiKey, text)
    res.status(200).json({ success: true, language })
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Server error',
    })
  }
})

export default router
