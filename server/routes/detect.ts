import { Router, type Request, type Response } from 'express'
import multer from 'multer'
import { createClient } from '@supabase/supabase-js'

const router = Router()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 4 * 1024 * 1024 } }) // 4MB limit

const getSupabaseUrl = () => process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? ''
const getSupabaseAnonKey = () => process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? ''
const getGeminiApiKey = () => (process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? '').trim()

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

const detectLanguageWithGemini = async (apiKey: string, audioBuffer: Buffer, mimeType: string) => {
  // Clean mimeType (Gemini only wants the base type, e.g., 'audio/webm' not 'audio/webm;codecs=opus')
  const cleanMimeType = mimeType.split(';')[0].trim()
  const base64Audio = audioBuffer.toString('base64')
  
  const prompt = `Listen to this audio and identify the spoken language. 
  Return ONLY the BCP-47 language code (e.g., en-US, hi-IN, mr-IN, es-ES, fr-FR). 
  
  CRITICAL RULES:
  1. If the speaker is speaking Hindi (even if they use some English words), you MUST return "hi-IN".
  2. If the speaker is speaking an Indian language, ALWAYS prefer the -IN variant.
  3. Return ONLY the code, no punctuation, no explanation.`

  const models = ['gemini-1.5-flash', 'gemini-2.0-flash-exp', 'gemini-1.5-pro']
  let lastError: any = null

  for (const model of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          contents: [{
            role: 'user',
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType: cleanMimeType,
                  data: base64Audio
                }
              }
            ]
          }],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 10,
          }
        })
      })

      const text = await response.text()
      if (!response.ok) {
        console.error(`Gemini Detection Error (Model: ${model}):`, text)
        lastError = new Error(`Gemini ${model} error: ${response.status} - ${text.slice(0, 100)}`)
        continue
      }

      const data = JSON.parse(text)
      const result = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? 'und'
      return result.replace(/[^a-zA-Z0-9-]/g, '')
    } catch (err) {
      console.error(`Gemini Detection Exception (Model: ${model}):`, err)
      lastError = err
    }
  }

  throw lastError || new Error('All detection models failed')
}

router.post('/', upload.single('audio'), async (req: Request, res: Response): Promise<void> => {
  try {
    const v = await verifyUser(req)
    if (!v.ok) {
      res.status(v.status).json({ success: false, error: v.error })
      return
    }

    const file = req.file
    if (!file) {
      res.status(400).json({ success: false, error: 'No audio file provided' })
      return
    }

    const apiKey = getGeminiApiKey()
    if (!apiKey) {
      res.status(500).json({ success: false, error: 'API Key missing on server' })
      return
    }

    const mimeType = file.mimetype || 'audio/webm'
    const detectedLang = await detectLanguageWithGemini(apiKey, file.buffer, mimeType)

    res.status(200).json({
      success: true,
      language: detectedLang
    })

  } catch (err) {
    console.error('Detect language final catch:', err)
    res.status(200).json({ 
      success: false, 
      error: err instanceof Error ? err.message : 'Server error' 
    })
  }
})

export default router
