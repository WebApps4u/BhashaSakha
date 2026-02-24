import { Router, type Request, type Response } from 'express'
import crypto from 'crypto'
import { createClient } from '@supabase/supabase-js'

const router = Router()

const getSupabaseUrl = () => process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? ''
const getSupabaseAnonKey = () => process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? ''
const getSupabaseServiceRoleKey = () => process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

const parseBearer = (req: Request) => {
  const auth = req.header('authorization') ?? ''
  return auth.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : ''
}

const todayUtcDate = () => new Date().toISOString().slice(0, 10)

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

const anonClient = () => {
  requireAnonEnv()
  return createClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

const userClient = (token: string) => {
  requireAnonEnv()
  return createClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  })
}

const adminClient = () => {
  requireServiceEnv()
  return createClient(getSupabaseUrl(), getSupabaseServiceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

const verifyUser = async (req: Request) => {
  requireAnonEnv()
  const token = parseBearer(req)
  if (!token) return { ok: false as const, status: 401, error: 'Unauthorized' }
  const supabase = anonClient()
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user) return { ok: false as const, status: 401, error: 'Unauthorized' }
  return { ok: true as const, userId: data.user.id, token }
}

const normalizePlanTier = (planCode: string) => {
  const v = String(planCode ?? '').trim().toLowerCase()
  return v === 'free' ? 'free' : 'pro'
}

const isStylePromptAllowedForUser = async ({ userId, token }: { userId: string; token: string }) => {
  const supabase = getSupabaseServiceRoleKey() ? adminClient() : userClient(token)
  const { data: flag } = await supabase
    .from('feature_flags')
    .select('is_enabled,config')
    .eq('key', 'tts_style_prompting')
    .maybeSingle()
  if (!flag || !(flag as any).is_enabled) return false

  const allowed = (flag as any)?.config?.allowed_plans
  const allowedPlans = Array.isArray(allowed) ? allowed.map((x: any) => String(x).toLowerCase()) : ['free', 'pro']

  const today = todayUtcDate()
  const { data: sub } = await supabase
    .from('user_subscriptions')
    .select('plan_code,effective_from,created_at')
    .eq('user_id', userId)
    .lte('effective_from', today)
    .order('effective_from', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const planTier = normalizePlanTier((sub as any)?.plan_code ?? 'free')
  return allowedPlans.includes(planTier)
}

const getGoogleTtsApiKey = () => (process.env.GOOGLE_TTS_API_KEY ?? process.env.GOOGLE_API_KEY ?? '').trim()
const getGeminiApiKey = () => (process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? '').trim()

const ttsCacheBucket = () => (process.env.TTS_CACHE_BUCKET ?? 'tts-cache').trim() || 'tts-cache'
const ttsCacheVersion = () => (process.env.TTS_CACHE_VERSION ?? '1').trim() || '1'
const enableStorageCache = () => {
  const v = (process.env.ENABLE_TTS_STORAGE_CACHE ?? 'true').toLowerCase().trim()
  return v === 'true' || v === '1' || v === 'yes'
}

const normalizeLang = (lang: string) => {
  const v = String(lang ?? '').trim().toLowerCase()
  if (!v) return ''
  if (v.includes('-')) return v
  const map: Record<string, string> = {
    en: 'en-us',
    hi: 'hi-in',
    mr: 'mr-in',
    bn: 'bn-in',
    ta: 'ta-in',
    te: 'te-in',
    kn: 'kn-in',
    gu: 'gu-in',
    pa: 'pa-in',
    or: 'or-in',
    ml: 'ml-in',
  }
  return map[v] ?? v
}

type VoiceInfo = { name: string; languageCodes: string[]; ssmlGender?: string }

const voicesCache = new Map<string, { at: number; voices: VoiceInfo[] }>()
const VOICES_TTL_MS = 6 * 60_000

const listVoices = async (apiKey: string, languageCode: string) => {
  const cached = voicesCache.get(languageCode)
  const now = Date.now()
  if (cached && now - cached.at < VOICES_TTL_MS) return cached.voices

  const url = `https://texttospeech.googleapis.com/v1/voices?languageCode=${encodeURIComponent(languageCode)}`
  const resp = await fetch(url, { method: 'GET', headers: { 'X-Goog-Api-Key': apiKey } })
  const text = await resp.text().catch(() => '')
  if (!resp.ok) throw new Error(text || `tts_voices_http_${resp.status}`)
  const parsed = JSON.parse(text) as any
  const voices = ((parsed.voices ?? []) as any[])
    .map((v) => ({
      name: String(v.name ?? ''),
      languageCodes: Array.isArray(v.languageCodes) ? (v.languageCodes as any[]).map((x) => String(x)) : [],
      ssmlGender: typeof v.ssmlGender === 'string' ? v.ssmlGender : undefined,
    }))
    .filter((v) => v.name && v.languageCodes.length)

  voicesCache.set(languageCode, { at: now, voices })
  return voices
}

const pickVoice = (voices: VoiceInfo[], languageCode: string, gender: 'FEMALE' | 'MALE' | 'NEUTRAL' | 'SSML_VOICE_GENDER_UNSPECIFIED') => {
  const lc = languageCode.toLowerCase()
  const supports = voices.filter((v) => v.languageCodes.some((c) => String(c).toLowerCase() === lc))
  const preferred = supports.find((v) => v.ssmlGender === gender) ?? supports[0]
  return preferred ?? voices[0] ?? null
}

const audioCache = new Map<string, { at: number; buf: Buffer; contentType: string }>()
const AUDIO_TTL_MS = 10 * 60_000
const AUDIO_MAX = 80

const cacheGet = (key: string) => {
  const row = audioCache.get(key)
  if (!row) return null
  if (Date.now() - row.at > AUDIO_TTL_MS) {
    audioCache.delete(key)
    return null
  }
  return row
}

const cacheSet = (key: string, buf: Buffer, contentType: string) => {
  if (audioCache.size > AUDIO_MAX) {
    const oldest = Array.from(audioCache.entries()).sort((a, b) => a[1].at - b[1].at)[0]
    if (oldest) audioCache.delete(oldest[0])
  }
  audioCache.set(key, { at: Date.now(), buf, contentType })
}

const pcm16leToWav = (pcm: Buffer, sampleRate = 24000, channels = 1) => {
  const bytesPerSample = 2
  const blockAlign = channels * bytesPerSample
  const byteRate = sampleRate * blockAlign
  const dataSize = pcm.length
  const chunkSize = 36 + dataSize

  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(chunkSize, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(byteRate, 28)
  header.writeUInt16LE(blockAlign, 32)
  header.writeUInt16LE(bytesPerSample * 8, 34)
  header.write('data', 36)
  header.writeUInt32LE(dataSize, 40)

  return Buffer.concat([header, pcm])
}

const extForContentType = (contentType: string) => {
  const v = contentType.toLowerCase()
  if (v.includes('mpeg') || v.includes('mp3')) return 'mp3'
  if (v.includes('ogg')) return 'ogg'
  if (v.includes('wav')) return 'wav'
  return 'bin'
}

const contentTypeForExt = (ext: string) => {
  const v = ext.toLowerCase()
  if (v === 'mp3') return 'audio/mpeg'
  if (v === 'ogg') return 'audio/ogg'
  if (v === 'wav') return 'audio/wav'
  return 'application/octet-stream'
}

const sha256Hex = (s: string) => crypto.createHash('sha256').update(s).digest('hex')

const storagePathForKey = ({
  cacheKey,
  lang,
  contentType,
}: {
  cacheKey: string
  lang: string
  contentType: string
}) => {
  const ext = extForContentType(contentType)
  const safeLang = (lang || 'und').replace(/[^a-z0-9-]/gi, '_')
  return { path: `tts/${safeLang}/${cacheKey}.${ext}`, contentType: contentTypeForExt(ext) }
}

const storageTryGet = async ({
  cacheKey,
  lang,
  contentType,
}: {
  cacheKey: string
  lang: string
  contentType: string
}) => {
  if (!enableStorageCache()) return null
  if (!getSupabaseServiceRoleKey()) return null

  const supabase = adminClient()
  const bucket = ttsCacheBucket()
  const { path, contentType: ct } = storagePathForKey({ cacheKey, lang, contentType })
  const { data, error } = await supabase.storage.from(bucket).download(path)
  if (error || !data) return null

  const arrayBuffer = await (data as any).arrayBuffer()
  return { buf: Buffer.from(arrayBuffer), contentType: ct }
}

const storagePut = async ({
  cacheKey,
  lang,
  contentType,
  buf,
}: {
  cacheKey: string
  lang: string
  contentType: string
  buf: Buffer
}) => {
  if (!enableStorageCache()) return
  if (!getSupabaseServiceRoleKey()) return
  const supabase = adminClient()
  const bucket = ttsCacheBucket()
  const { path, contentType: ct } = storagePathForKey({ cacheKey, lang, contentType })
  await supabase.storage.from(bucket).upload(path, new Uint8Array(buf), { contentType: ct, upsert: true })
}

const extractInlineAudio = (bodyText: string) => {
  const parsed = JSON.parse(bodyText) as any
  const part = parsed?.candidates?.[0]?.content?.parts?.[0]
  const inline = part?.inlineData
  const data = typeof inline?.data === 'string' ? inline.data : ''
  const mimeType = typeof inline?.mimeType === 'string' ? String(inline.mimeType) : ''
  if (!data) return null
  const buf = Buffer.from(data, 'base64')
  return { buf, mimeType }
}

const callGeminiTts = async ({
  apiKey,
  model,
  text,
  lang,
  voiceName,
  stylePrompt,
}: {
  apiKey: string
  model: string
  text: string
  lang: string
  voiceName: string
  stylePrompt: string
}) => {
  const styleLine = stylePrompt ? `STYLE: ${stylePrompt}\n` : ''
  const prompt =
    styleLine +
    `Read the following text verbatim in ${lang} with natural prosody. Do not add or omit words.\n\nTEXT:\n${text}`
  const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName,
            },
          },
        },
      },
    }),
  })
  const bodyText = await resp.text().catch(() => '')
  return { ok: resp.ok, status: resp.status, bodyText }
}

const synthGemini = async ({
  apiKey,
  text,
  lang,
  stylePrompt,
}: {
  apiKey: string
  text: string
  lang: string
  stylePrompt: string
}): Promise<{ buf: Buffer; contentType: string } | null> => {
  const voiceName = (process.env.GEMINI_TTS_VOICE_NAME ?? '').trim() || 'Kore'
  const rawModels = (process.env.GEMINI_TTS_MODELS ?? '').trim()
  const models = rawModels
    ? rawModels.split(',').map((s) => s.trim()).filter(Boolean)
    : [
        'gemini-2.5-flash-preview-tts',
        'gemini-2.5-pro-preview-tts',
        'gemini-2.5-flash-lite-preview-tts',
        'gemini-2.5-flash-tts',
        'gemini-2.5-pro-tts',
      ]

  let lastNon404: { status: number; bodyText: string } | null = null
  for (const model of models) {
    const r = await callGeminiTts({ apiKey, model, text, lang, voiceName, stylePrompt })
    if (r.ok) {
      const extracted = extractInlineAudio(r.bodyText)
      if (!extracted) throw new Error('tts_invalid_response')
      const mime = extracted.mimeType.toLowerCase()
      if (mime.includes('wav')) return { buf: extracted.buf, contentType: 'audio/wav' }
      if (mime.includes('mpeg') || mime.includes('mp3')) return { buf: extracted.buf, contentType: 'audio/mpeg' }
      return { buf: pcm16leToWav(extracted.buf), contentType: 'audio/wav' }
    }
    if (r.status !== 404) {
      lastNon404 = { status: r.status, bodyText: r.bodyText }
      break
    }
  }

  if (lastNon404) {
    const e = new Error(`gemini_tts_http_${lastNon404.status}`)
    ;(e as any).details = lastNon404.bodyText.slice(0, 900)
    throw e
  }
  return null
}

router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const v = await verifyUser(req)
    if (!v.ok) {
      res.status(v.status).json({ success: false, error: v.error })
      return
    }

    const geminiKey = getGeminiApiKey()
    const googleTtsKey = getGoogleTtsApiKey()

    const text = typeof (req.body as any)?.text === 'string' ? String((req.body as any).text) : ''
    const lang = normalizeLang(typeof (req.body as any)?.lang === 'string' ? String((req.body as any).lang) : '')
    const rate = Number((req.body as any)?.rate ?? 1)
    const pitch = Number((req.body as any)?.pitch ?? 0)
    let stylePrompt = typeof (req.body as any)?.style === 'string' ? String((req.body as any).style).trim().slice(0, 240) : ''
    const genderRaw = String((req.body as any)?.gender ?? 'NEUTRAL').toUpperCase()
    const gender = (['FEMALE', 'MALE', 'NEUTRAL', 'SSML_VOICE_GENDER_UNSPECIFIED'] as const).includes(genderRaw as any)
      ? (genderRaw as any)
      : 'NEUTRAL'

    const trimmed = text.trim()
    if (!trimmed) {
      res.status(400).json({ success: false, error: 'text is required' })
      return
    }
    if (trimmed.length > 1200) {
      res.status(413).json({ success: false, error: 'text is too long (max 1200 chars)' })
      return
    }
    if (!lang) {
      res.status(400).json({ success: false, error: 'lang is required' })
      return
    }

    if (stylePrompt) {
      const allowed = await isStylePromptAllowedForUser({ userId: v.userId, token: v.token })
      if (!allowed) stylePrompt = ''
    }

    const baseKey = {
      v: ttsCacheVersion(),
      t: trimmed,
      l: lang,
      r: Math.min(4, Math.max(0.25, rate)),
      p: Math.min(20, Math.max(-20, pitch)),
      g: gender,
      s: stylePrompt,
    }

    if (geminiKey) {
      const voiceName = (process.env.GEMINI_TTS_VOICE_NAME ?? '').trim() || 'Kore'
      const geminiCacheKey = sha256Hex(JSON.stringify({ ...baseKey, provider: 'gemini', voice: voiceName }))
      const storageHit = await storageTryGet({ cacheKey: geminiCacheKey, lang, contentType: 'audio/wav' })
      if (storageHit) {
        cacheSet(geminiCacheKey, storageHit.buf, storageHit.contentType)
        res.status(200)
        res.setHeader('Content-Type', storageHit.contentType)
        res.setHeader('Cache-Control', 'private, max-age=31536000')
        res.send(storageHit.buf)
        return
      }

      const memHit = cacheGet(geminiCacheKey)
      if (memHit) {
        res.status(200)
        res.setHeader('Content-Type', memHit.contentType)
        res.setHeader('Cache-Control', 'private, max-age=600')
        res.send(memHit.buf)
        return
      }

      const gemini = await synthGemini({ apiKey: geminiKey, text: trimmed, lang, stylePrompt })
      if (gemini) {
        cacheSet(geminiCacheKey, gemini.buf, gemini.contentType)
        await storagePut({ cacheKey: geminiCacheKey, lang, contentType: gemini.contentType, buf: gemini.buf })
        res.status(200)
        res.setHeader('Content-Type', gemini.contentType)
        res.setHeader('Cache-Control', 'private, max-age=600')
        res.send(gemini.buf)
        return
      }
    }

    if (!googleTtsKey) {
      res.status(500).json({ success: false, error: 'No TTS provider configured on server (missing GEMINI_API_KEY/GOOGLE_API_KEY and GOOGLE_TTS_API_KEY)' })
      return
    }

    const voices = await listVoices(googleTtsKey, lang)
    const chosen = pickVoice(voices, lang, gender)
    if (!chosen) {
      res.status(404).json({ success: false, error: `No voice available for ${lang}` })
      return
    }

    const cloudCacheKey = sha256Hex(JSON.stringify({ ...baseKey, provider: 'cloud', voice: chosen.name }))
    const cloudStorageHit = await storageTryGet({ cacheKey: cloudCacheKey, lang, contentType: 'audio/mpeg' })
    if (cloudStorageHit) {
      cacheSet(cloudCacheKey, cloudStorageHit.buf, cloudStorageHit.contentType)
      res.status(200)
      res.setHeader('Content-Type', cloudStorageHit.contentType)
      res.setHeader('Cache-Control', 'private, max-age=31536000')
      res.send(cloudStorageHit.buf)
      return
    }

    const cloudMemHit = cacheGet(cloudCacheKey)
    if (cloudMemHit) {
      res.status(200)
      res.setHeader('Content-Type', cloudMemHit.contentType)
      res.setHeader('Cache-Control', 'private, max-age=600')
      res.send(cloudMemHit.buf)
      return
    }

    const synthResp = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Goog-Api-Key': googleTtsKey },
      body: JSON.stringify({
        input: { text: trimmed },
        voice: { languageCode: lang, name: chosen.name, ssmlGender: gender },
        audioConfig: {
          audioEncoding: 'MP3',
          speakingRate: Math.min(4, Math.max(0.25, rate)),
          pitch: Math.min(20, Math.max(-20, pitch)),
        },
      }),
    })
    const synthText = await synthResp.text().catch(() => '')
    if (!synthResp.ok) {
      res.status(502).json({ success: false, error: `tts_provider_http_${synthResp.status}`, details: synthText.slice(0, 800) })
      return
    }
    const synthJson = JSON.parse(synthText) as any
    const audioContent = typeof synthJson?.audioContent === 'string' ? synthJson.audioContent : ''
    if (!audioContent) {
      res.status(502).json({ success: false, error: 'tts_invalid_response' })
      return
    }

    const buf = Buffer.from(audioContent, 'base64')
    cacheSet(cloudCacheKey, buf, 'audio/mpeg')
    await storagePut({ cacheKey: cloudCacheKey, lang, contentType: 'audio/mpeg', buf })

    res.status(200)
    res.setHeader('Content-Type', 'audio/mpeg')
    res.setHeader('Cache-Control', 'private, max-age=600')
    res.send(buf)
  } catch (err) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Server error' })
  }
})

export default router
