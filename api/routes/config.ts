import { Router, type Request, type Response } from 'express'

const router = Router()

const listGenerateContentModels = async (apiKey: string) => {
  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models', {
    method: 'GET',
    headers: { 'x-goog-api-key': apiKey },
  })
  const bodyText = await response.text().catch(() => '')
  if (!response.ok) return { ok: false as const, bodyText }

  try {
    const data = JSON.parse(bodyText) as {
      models?: Array<{ name?: string; baseModelId?: string; supportedGenerationMethods?: string[] }>
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

router.get('/', async (req: Request, res: Response): Promise<void> => {
  void req
  const configuredModel = process.env.GEMINI_MODEL_TRANSLATE ?? 'gemini-2.0-flash'
  const googleKey = process.env.GOOGLE_API_KEY

  const payload: any = {
    success: true,
    gemini: {
      model: configuredModel,
      has_google_api_key: !!googleKey,
    },
    supabase: {
      has_url: !!process.env.SUPABASE_URL,
      has_anon_key: !!process.env.SUPABASE_ANON_KEY,
    },
  }

  if (googleKey) {
    const listed = await listGenerateContentModels(googleKey)
    if (!listed.ok) {
      payload.gemini_diagnostics = { ok: false, details: listed.bodyText.slice(0, 500) }
    } else {
      payload.gemini_diagnostics = {
        ok: true,
        model_ok: listed.models.includes(configuredModel),
        sample_models: listed.models.slice(0, 8),
      }
    }
  }

  res.status(200).json(payload)
})

export default router
