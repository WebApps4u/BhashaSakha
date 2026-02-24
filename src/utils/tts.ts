import type { TtsGenderPreference } from '@/store/settingsStore'
import { supabase } from '@/lib/supabaseClient'

const normalize = (v: string) => v.trim().toLowerCase()

const normalizeLangTag = (lang: string) => {
  const v = normalize(lang)
  if (!v) return ''
  if (v.includes('-')) return v
  const m: Record<string, string> = {
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
  return m[v] ?? v
}

const inferGender = (voice: SpeechSynthesisVoice): 'female' | 'male' | 'unknown' => {
  const s = normalize(`${voice.name} ${voice.voiceURI}`)
  const female = /(female|woman|girl|feminine)/i.test(s)
  const male = /(male|man|boy|masculine)/i.test(s)
  if (female && !male) return 'female'
  if (male && !female) return 'male'
  return 'unknown'
}

let requestSeq = 0
let audioSeq = 0
let audioEl: HTMLAudioElement | null = null
let audioAbort: AbortController | null = null
let audioObjectUrl: string | null = null

const waitForVoices = (timeoutMs = 800) => {
  if (typeof window === 'undefined') return Promise.resolve([] as SpeechSynthesisVoice[])
  const synth = window.speechSynthesis
  if (!synth) return Promise.resolve([] as SpeechSynthesisVoice[])
  const existing = synth.getVoices()
  if (existing.length) return Promise.resolve(existing)

  return new Promise<SpeechSynthesisVoice[]>((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      window.removeEventListener('voiceschanged', onChanged)
      resolve(synth.getVoices())
    }
    const onChanged = () => finish()
    window.addEventListener('voiceschanged', onChanged)
    setTimeout(finish, timeoutMs)
  })
}

const tick = (ms = 0) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export function speakTts({
  text,
  lang,
  voiceUri,
  gender,
  rate,
  pitch,
  volume,
}: {
  text: string
  lang: string
  voiceUri: string
  gender: TtsGenderPreference
  rate: number
  pitch: number
  volume: number
}) {
  if (typeof window === 'undefined') return false
  if (!('speechSynthesis' in window)) return false
  const trimmed = text.trim()
  if (!trimmed) return false

  const id = ++requestSeq
  void (async () => {
    const synth = window.speechSynthesis
    await waitForVoices()
    if (id !== requestSeq) return

    const utter = new SpeechSynthesisUtterance(trimmed)
    utter.lang = normalizeLangTag(lang)
    utter.rate = Math.min(2, Math.max(0.5, rate))
    utter.pitch = Math.min(2, Math.max(0, pitch))
    utter.volume = Math.min(1, Math.max(0, volume))

    const voices = synth.getVoices()
    const lowerLang = normalize(utter.lang)

    let selected: SpeechSynthesisVoice | undefined
    if (voiceUri) {
      selected = voices.find((v) => v.voiceURI === voiceUri)
    }

    if (!selected) {
      const langMatches = voices.filter((v) => normalize(v.lang).startsWith(lowerLang))
      const defaults = langMatches.filter((v) => v.default)

      const pickByGender = (list: SpeechSynthesisVoice[]) => {
        if (gender === 'any') return undefined
        return list.find((v) => inferGender(v) === gender)
      }

      selected = pickByGender(langMatches) ?? pickByGender(defaults) ?? defaults[0] ?? langMatches[0]
    }

    if (!selected) {
      selected = voices.find((v) => v.default) ?? voices[0]
    }

    if (selected) {
      utter.voice = selected
      utter.lang = selected.lang || utter.lang
    }

    synth.cancel()
    await tick(30)
    if (id !== requestSeq) return
    synth.speak(utter)

    await tick(250)
    if (id !== requestSeq) return
    if (!synth.speaking && !synth.pending) {
      synth.cancel()
      await tick(30)
      if (id !== requestSeq) return
      synth.speak(utter)
    }
  })()

  return true
}

export async function playServerTts({
  text,
  lang,
  gender,
  rate,
  pitch,
  volume,
  stylePrompt,
}: {
  text: string
  lang: string
  gender: TtsGenderPreference
  rate: number
  pitch: number
  volume: number
  stylePrompt?: string
}) {
  if (typeof window === 'undefined') return false
  const trimmed = text.trim()
  if (!trimmed) return false

  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token ?? ''
  if (!token) return false

  audioSeq += 1
  const id = audioSeq
  if (!audioEl) audioEl = new Audio()
  if (audioAbort) audioAbort.abort()
  audioAbort = new AbortController()
  if (audioObjectUrl) {
    URL.revokeObjectURL(audioObjectUrl)
    audioObjectUrl = null
  }
  audioEl.pause()
  audioEl.currentTime = 0
  audioEl.volume = Math.min(1, Math.max(0, volume))

  const genderParam = gender === 'female' ? 'FEMALE' : gender === 'male' ? 'MALE' : 'NEUTRAL'

  try {
    const resp = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ text: trimmed, lang, gender: genderParam, rate, pitch, style: String(stylePrompt ?? '').slice(0, 240) || undefined }),
      signal: audioAbort.signal,
    })

    if (id !== audioSeq) return false
    if (!resp.ok) {
      return speakTts({ text: trimmed, lang, voiceUri: '', gender, rate, pitch, volume })
    }
    const blob = await resp.blob()
    if (id !== audioSeq) return false
    audioObjectUrl = URL.createObjectURL(blob)
    audioEl.src = audioObjectUrl

    try {
      await audioEl.play()
      return true
    } catch {
      return speakTts({ text: trimmed, lang, voiceUri: '', gender, rate, pitch, volume })
    }
  } catch {
    return speakTts({ text: trimmed, lang, voiceUri: '', gender, rate, pitch, volume })
  }
}
