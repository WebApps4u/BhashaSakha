import { Router, type Request, type Response } from 'express'

const router = Router()

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY

const generateOnce = async ({ apiKey, model, text }: { apiKey: string; model: string; text: string }) => {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text }] }],
      generationConfig: { temperature: 0 },
    }),
  })
  const bodyText = await response.text().catch(() => '')
  return { response, bodyText }
}

router.get('/models', async (req: Request, res: Response): Promise<void> => {
  void req
  if (!GOOGLE_API_KEY) {
    res.status(500).json({ success: false, error: 'Missing GOOGLE_API_KEY on the server.' })
    return
  }

  try {
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models', {
      method: 'GET',
      headers: { 'x-goog-api-key': GOOGLE_API_KEY },
    })
    const text = await response.text().catch(() => '')
    if (!response.ok) {
      res.status(502).json({
        success: false,
        error: `Gemini models.list error (${response.status})`,
        details: text.slice(0, 1500),
      })
      return
    }

    const data = JSON.parse(text) as {
      models?: Array<{
        name?: string
        baseModelId?: string
        supportedGenerationMethods?: string[]
        displayName?: string
      }>
    }

    const models = (data.models ?? [])
      .filter((m) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
      .map((m) => ({
        id: m.baseModelId || (m.name?.startsWith('models/') ? m.name.slice('models/'.length) : m.name) || '',
        displayName: m.displayName ?? '',
      }))
      .filter((m) => !!m.id)

    res.status(200).json({
      success: true,
      count: models.length,
      models,
    })
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Server error',
    })
  }
})

router.post('/test', async (req: Request, res: Response): Promise<void> => {
  if (!GOOGLE_API_KEY) {
    res.status(500).json({ success: false, error: 'Missing GOOGLE_API_KEY on the server.' })
    return
  }

  const inputText = typeof (req.body as any)?.text === 'string' ? String((req.body as any).text) : 'Say OK.'
  const preferredModel =
    typeof process.env.GEMINI_MODEL_TRANSLATE === 'string' && process.env.GEMINI_MODEL_TRANSLATE.trim()
      ? process.env.GEMINI_MODEL_TRANSLATE.trim()
      : 'gemini-2.0-flash'

  try {
    const tried: string[] = []
    const candidates = [preferredModel, 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-flash-latest', 'gemini-pro-latest']

    for (const model of candidates) {
      if (!model || tried.includes(model)) continue
      tried.push(model)
      const { response, bodyText } = await generateOnce({ apiKey: GOOGLE_API_KEY, model, text: inputText })
      if (response.ok) {
        res.status(200).json({ success: true, model, tried_models: tried })
        return
      }
      if (response.status !== 404) {
        res.status(502).json({
          success: false,
          error: `Gemini test error (${response.status})`,
          model,
          tried_models: tried,
          details: bodyText.slice(0, 1500),
        })
        return
      }
    }

    res.status(502).json({
      success: false,
      error: 'Gemini test error (404)',
      model: preferredModel,
      tried_models: tried,
      details: 'Preferred model was not found. Use /api/gemini/models to pick an available model.',
    })
  } catch (err) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Server error', model: preferredModel })
  }
})

export default router
